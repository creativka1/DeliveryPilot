import { Prisma } from "@prisma/client";
import { db, BUSINESS_ID } from "./db";
import {
  audit,
  notify,
  notifyManagers,
  systemActor,
  type Initiator,
} from "./audit";
import { type Actor, manager } from "./auth";
import { AppError, invariant } from "./errors";
import {
  deliveryInput,
  employeeInput,
  internalEvent,
  type InternalEvent,
} from "./validation";
import { rankDeliveries } from "./matching";

async function validateReferences(
  tx: Prisma.TransactionClient,
  locationId: string,
  employeeId: string | null,
) {
  invariant(
    await tx.location.findFirst({
      where: { id: locationId, businessId: BUSINESS_ID },
    }),
    "Choose a valid receiving location.",
  );
  if (employeeId) {
    const e = await tx.employee.findFirst({
      where: { id: employeeId, businessId: BUSINESS_ID, archived: false },
      include: { locations: true },
    });
    invariant(e, "Employee not found.");
    invariant(
      e.locations.some((l) => l.locationId === locationId),
      "This employee does not receive at the selected location.",
    );
  }
}
export async function saveDelivery(actor: Actor, input: unknown, id?: string) {
  manager(actor);
  const d = deliveryInput.parse(input);
  return db.$transaction(async (tx) => {
    await validateReferences(tx, d.locationId, d.employeeId);
    if (id) {
      const old = await tx.expectedDelivery.findFirst({
        where: { id, businessId: BUSINESS_ID, archived: false },
        include: { task: true },
      });
      invariant(old, "Delivery not found.", 404);
      invariant(
        !old.task,
        "A linked delivery cannot be edited. Manage its receiving task instead.",
        409,
      );
    }
    const data = {
      ...d,
      windowStart: new Date(d.windowStart),
      windowEnd: new Date(d.windowEnd),
    };
    const result = id
      ? await tx.expectedDelivery.update({ where: { id }, data })
      : await tx.expectedDelivery.create({
          data: { ...data, businessId: BUSINESS_ID },
        });
    await audit(
      tx,
      actor,
      id ? "DELIVERY_UPDATED" : "DELIVERY_CREATED",
      `${id ? "Updated" : "Created"} expected delivery: ${d.supplier} (${d.reference}).`,
      "HUMAN",
      { deliveryId: result.id },
    );
    return result;
  });
}
export async function archiveDelivery(actor: Actor, id: string) {
  manager(actor);
  return db.$transaction(async (tx) => {
    const d = await tx.expectedDelivery.findFirst({
      where: { id, businessId: BUSINESS_ID, archived: false },
      include: { task: true },
    });
    invariant(d, "Delivery not found.", 404);
    invariant(
      !d.task,
      "Deliveries with receiving tasks are retained for the audit trail.",
      409,
    );
    await tx.expectedDelivery.update({
      where: { id },
      data: { archived: true },
    });
    await audit(
      tx,
      actor,
      "DELIVERY_ARCHIVED",
      `Removed ${d.supplier} from the schedule. Its history is retained.`,
      "HUMAN",
      { deliveryId: id },
    );
  });
}
export async function saveEmployee(actor: Actor, input: unknown, id?: string) {
  manager(actor);
  const d = employeeInput.parse(input);
  return db.$transaction(async (tx) => {
    const count = await tx.location.count({
      where: {
        id: { in: [...new Set(d.locationIds)] },
        businessId: BUSINESS_ID,
      },
    });
    invariant(
      count === new Set(d.locationIds).size,
      "Invalid receiving location.",
    );
    if (id) {
      const old = await tx.employee.findFirst({
        where: { id, businessId: BUSINESS_ID, archived: false },
      });
      invariant(old, "Employee not found.", 404);
      if (old.role === "MANAGER" && d.role !== "MANAGER")
        invariant(
          (await tx.employee.count({
            where: {
              businessId: BUSINESS_ID,
              role: "MANAGER",
              archived: false,
              id: { not: id },
            },
          })) > 0,
          "Keep at least one manager.",
        );
      const assigned = await tx.expectedDelivery.findMany({
        where: { employeeId: id, archived: false, status: { not: "RECEIVED" } },
      });
      invariant(
        assigned.every((x) => d.locationIds.includes(x.locationId)),
        "Reassign active deliveries before removing their location.",
      );
      await tx.employeeLocation.deleteMany({ where: { employeeId: id } });
    }
    const data = {
      name: d.name,
      role: d.role,
      available: d.available,
      locations: {
        create: [...new Set(d.locationIds)].map((locationId) => ({
          locationId,
        })),
      },
    };
    const e = id
      ? await tx.employee.update({ where: { id }, data })
      : await tx.employee.create({
          data: { ...data, businessId: BUSINESS_ID },
        });
    await audit(
      tx,
      actor,
      id ? "EMPLOYEE_UPDATED" : "EMPLOYEE_CREATED",
      `${id ? "Updated" : "Created"} employee ${d.name}; availability: ${d.available ? "available" : "unavailable"}.`,
    );
    return e;
  });
}
export async function ingestEvent(
  raw: InternalEvent,
  initiator: Initiator = systemActor,
) {
  const e = internalEvent.parse(raw);
  const existing = await db.ringEvent.findUnique({
    where: { source_requestId: { source: e.source, requestId: e.requestId } },
  });
  if (existing) return { eventId: existing.id, duplicate: true };
  try {
    return await db.$transaction(async (tx) => {
      const camera = await tx.cameraDevice.findUnique({
        where: { externalId: e.deviceId },
      });
      const mapped =
        camera &&
        camera.businessId === BUSINESS_ID &&
        (e.source === "SIMULATED_RING_WEBHOOK"
          ? ["LOCAL_TEST", "RING_API"].includes(camera.source)
          : camera.source ===
            (e.source === "LOCAL_TEST" ? "LOCAL_TEST" : "RING_API"))
          ? camera
          : null;
      const event = await tx.ringEvent.create({
        data: {
          businessId: BUSINESS_ID,
          source: e.source,
          requestId: e.requestId,
          externalDeviceId: e.deviceId,
          cameraId: mapped?.id,
          type: e.type,
          occurredAt: e.occurredAt,
          payload: e.payload,
          summary: e.summary,
        },
      });
      await audit(
        tx,
        initiator,
        "ACTIVITY_RECEIVED",
        `${e.source === "LOCAL_TEST" ? "Local test" : e.source === "SIMULATED_RING_WEBHOOK" ? "Signed simulation (not a real Ring notification)" : "Signed Ring"} ${e.type.replaceAll("_", " ")} reported at ${e.occurredAt.toISOString()}. ${mapped?.locationId ? "Receiving entrance is mapped." : "Device has no receiving entrance mapping."}`,
        e.source,
        { eventId: event.id },
      );
      if (
        ["device_online", "device_offline", "device_removed"].includes(
          e.type,
        ) &&
        mapped &&
        (e.source !== "SIMULATED_RING_WEBHOOK" ||
          mapped.source === "LOCAL_TEST")
      )
        await tx.cameraDevice.update({
          where: { id: mapped.id },
          data: { online: e.type === "device_online" },
        });
      const eligible = await tx.expectedDelivery.findMany({
        where: { businessId: BUSINESS_ID, archived: false, task: { is: null } },
      });
      const ranked = ["motion_detected", "button_press"].includes(e.type)
        ? rankDeliveries(
            {
              locationId: mapped?.locationId ?? null,
              occurredAt: e.occurredAt,
            },
            eligible,
          )
        : [];
      for (const match of ranked) {
        await tx.deliveryCandidate.create({
          data: {
            eventId: event.id,
            deliveryId: match.deliveryId,
            score: match.score,
            reasons: JSON.stringify(match.reasons),
          },
        });
        await tx.expectedDelivery.update({
          where: { id: match.deliveryId },
          data: { status: "POSSIBLE_ARRIVAL" },
        });
      }
      await tx.ringEvent.update({
        where: { id: event.id },
        data: { matchStatus: ranked.length ? "SUGGESTED" : "UNMATCHED" },
      });
      await audit(
        tx,
        initiator,
        ranked.length ? "MATCHES_SUGGESTED" : "UNMATCHED_ACTIVITY",
        ranked.length
          ? `${ranked.length} schedule-based ${ranked.length === 1 ? "match" : "matches"} suggested. Employee selection required.`
          : "No eligible delivery matches the receiving location and time.",
        e.source,
        { eventId: event.id },
      );
      await notifyManagers(
        tx,
        ranked.length
          ? `${ranked.length} possible delivery ${ranked.length === 1 ? "match" : "matches"} needs review.`
          : "Unmatched entrance activity needs review.",
      );
      return { eventId: event.id, duplicate: false };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const duplicate = await db.ringEvent.findUnique({
        where: {
          source_requestId: { source: e.source, requestId: e.requestId },
        },
      });
      if (duplicate) return { eventId: duplicate.id, duplicate: true };
    }
    throw error;
  }
}
export async function linkCandidate(actor: Actor, candidateId: string) {
  manager(actor);
  return db.$transaction(async (tx) => {
    const c = await tx.deliveryCandidate.findUnique({
      where: { id: candidateId },
      include: {
        event: { include: { camera: true } },
        delivery: {
          include: { employee: { include: { locations: true } }, task: true },
        },
      },
    });
    invariant(
      c && c.event.businessId === BUSINESS_ID,
      "Arrival candidate not found.",
      404,
    );
    invariant(
      !c.delivery.archived && !c.delivery.task && !c.selected,
      "This delivery already has a receiving task or was removed.",
      409,
    );
    invariant(
      !(await tx.deliveryCandidate.findFirst({
        where: { eventId: c.eventId, selected: true },
      })),
      "This activity is already linked to a delivery.",
      409,
    );
    invariant(
      ["EXPECTED", "DELAYED", "POSSIBLE_ARRIVAL"].includes(c.delivery.status),
      "This delivery is no longer eligible.",
      409,
    );
    invariant(
      rankDeliveries(
        {
          locationId: c.event.camera?.locationId ?? null,
          occurredAt: c.event.occurredAt,
        },
        [c.delivery],
      ).length,
      "The schedule or camera mapping changed. Generate new activity to refresh this suggestion.",
      409,
    );
    const e = c.delivery.employee;
    const available =
      e &&
      e.available &&
      !e.archived &&
      e.locations.some((l) => l.locationId === c.delivery.locationId);
    const task = await tx.receivingTask.create({
      data: {
        businessId: BUSINESS_ID,
        deliveryId: c.deliveryId,
        candidateId: c.id,
        employeeId: available ? e.id : null,
      },
    });
    await tx.deliveryCandidate.update({
      where: { id: c.id },
      data: { selected: true },
    });
    await tx.ringEvent.update({
      where: { id: c.eventId },
      data: { matchStatus: "LINKED" },
    });
    // Discard other suggestions for this event. Other events may still suggest those deliveries.
    for (const other of await tx.deliveryCandidate.findMany({
      where: { eventId: c.eventId, id: { not: c.id } },
    })) {
      const another = await tx.deliveryCandidate.count({
        where: {
          deliveryId: other.deliveryId,
          eventId: { not: c.eventId },
          event: { matchStatus: "SUGGESTED" },
        },
      });
      if (!another)
        await tx.expectedDelivery.updateMany({
          where: {
            id: other.deliveryId,
            status: "POSSIBLE_ARRIVAL",
            task: { is: null },
          },
          data: { status: "EXPECTED" },
        });
    }
    await tx.expectedDelivery.update({
      where: { id: c.deliveryId },
      data: { status: "AWAITING_ACKNOWLEDGMENT" },
    });
    await audit(
      tx,
      actor,
      "MATCH_SELECTED",
      `Selected ${c.delivery.supplier} as a possible match. Receipt remains unconfirmed.`,
      "HUMAN",
      { deliveryId: c.deliveryId, eventId: c.eventId, taskId: task.id },
    );
    await audit(
      tx,
      actor,
      "TASK_ASSIGNED",
      available
        ? `Receiving task assigned to ${e.name}.`
        : "Designated employee is unavailable or missing. Task is unassigned and requires a manager.",
      "HUMAN",
      { deliveryId: c.deliveryId, taskId: task.id },
    );
    if (available)
      await notify(
        tx,
        e.id,
        `Receive ${c.delivery.supplier} at your entrance.`,
        task.id,
      );
    else
      await notifyManagers(
        tx,
        "A receiving task has no available employee.",
        task.id,
      );
    return task;
  });
}
export async function actOnTask(
  actor: Actor,
  id: string,
  input: { action: string; issue?: string; employeeId?: string },
) {
  return db.$transaction(async (tx) => {
    const t = await tx.receivingTask.findFirst({
      where: { id, businessId: BUSINESS_ID },
      include: { delivery: true },
    });
    invariant(t, "Task not found.", 404);
    invariant(
      actor.role === "MANAGER" || t.employeeId === actor.id,
      "This task belongs to another employee.",
      403,
    );
    const now = new Date();
    let message = "",
      action = "";
    const data: Prisma.ReceivingTaskUpdateInput = {};
    let status = t.delivery.status;
    switch (input.action) {
      case "acknowledge":
        invariant(
          t.status === "PENDING",
          "Only a pending task can be acknowledged.",
          409,
        );
        invariant(t.employeeId, "Assign an employee first.", 409);
        data.status = "ACKNOWLEDGED";
        data.acknowledgedAt = now;
        status = "RECEIVING";
        message = "Employee acknowledged the receiving task.";
        action = "TASK_ACKNOWLEDGED";
        break;
      case "start":
        invariant(
          t.status === "ACKNOWLEDGED",
          "Acknowledge this task before starting.",
          409,
        );
        data.status = "RECEIVING";
        data.startedAt = now;
        status = "RECEIVING";
        message = "Receiving started.";
        action = "RECEIVING_STARTED";
        break;
      case "complete":
        invariant(
          ["ACKNOWLEDGED", "RECEIVING"].includes(t.status),
          "Acknowledge the task before confirming receipt.",
          409,
        );
        data.status = "RECEIVED";
        data.completedAt = now;
        status = "RECEIVED";
        message = "Employee confirmed physical receipt of the delivery.";
        action = "DELIVERY_CONFIRMED";
        break;
      case "exception":
      case "escalate":
        invariant(
          !["RECEIVED", "EXCEPTION", "ESCALATED"].includes(t.status),
          "This task cannot accept another issue.",
          409,
        );
        invariant(
          input.issue?.trim() && input.issue.trim().length <= 2000,
          "Describe the problem (1–2000 characters).",
        );
        data.status = input.action === "exception" ? "EXCEPTION" : "ESCALATED";
        data.issue = input.issue!.trim();
        status = "EXCEPTION";
        message = `${input.action === "exception" ? "Problem reported" : "Escalated to manager"}: ${data.issue}`;
        action =
          input.action === "exception"
            ? "EXCEPTION_REPORTED"
            : "TASK_ESCALATED";
        await notifyManagers(tx, message, t.id);
        break;
      case "resolve":
        manager(actor);
        invariant(
          ["EXCEPTION", "ESCALATED"].includes(t.status),
          "There is no open issue to resolve.",
          409,
        );
        invariant(
          input.issue?.trim() && input.issue.trim().length <= 2000,
          "Describe how the issue was resolved.",
        );
        data.status = t.acknowledgedAt ? "ACKNOWLEDGED" : "PENDING";
        data.issue = null;
        status = t.acknowledgedAt ? "RECEIVING" : "AWAITING_ACKNOWLEDGMENT";
        message = `Issue resolved: ${input.issue!.trim()}`;
        action = "ISSUE_RESOLVED";
        break;
      case "reassign":
        manager(actor);
        invariant(
          t.status !== "RECEIVED",
          "Completed tasks cannot be reassigned.",
          409,
        );
        invariant(input.employeeId, "Choose an available employee.");
        await validateReferences(tx, t.delivery.locationId, input.employeeId!);
        const e = await tx.employee.findUniqueOrThrow({
          where: { id: input.employeeId },
        });
        invariant(e.available, "This employee is unavailable.");
        data.employee = { connect: { id: e.id } };
        data.assignedAt = now;
        data.acknowledgedAt = null;
        data.startedAt = null;
        if (!["EXCEPTION", "ESCALATED"].includes(t.status)) {
          data.status = "PENDING";
          status = "AWAITING_ACKNOWLEDGMENT";
        }
        message = `Task reassigned to ${e.name}; acknowledgment timer restarted.`;
        action = "TASK_REASSIGNED";
        await tx.expectedDelivery.update({
          where: { id: t.deliveryId },
          data: { employeeId: e.id },
        });
        await notify(
          tx,
          e.id,
          `Receiving task reassigned to you: ${t.delivery.supplier}.`,
          t.id,
        );
        break;
      default:
        throw new AppError(400, "Unknown task action.");
    }
    await tx.receivingTask.update({ where: { id }, data });
    await tx.expectedDelivery.update({
      where: { id: t.deliveryId },
      data: { status, ...(status === "RECEIVED" ? { receivedAt: now } : {}) },
    });
    await audit(tx, actor, action, message, "HUMAN", {
      deliveryId: t.deliveryId,
      taskId: t.id,
    });
    return { success: true };
  });
}
