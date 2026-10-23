import { randomUUID } from "node:crypto";
import { db, BUSINESS_ID } from "./db";
import { demoMode, manager, type Actor } from "./auth";
import { invariant } from "./errors";
import { audit } from "./audit";
import { localEventInput } from "./validation";
import { localEventAdapter } from "./ring/events";
import { ingestEvent, saveDelivery } from "./workflow";
export async function createTestEvent(actor: Actor, input: unknown) {
  manager(actor);
  invariant(
    demoMode(),
    "Local test events are disabled outside demo mode.",
    403,
  );
  const p = localEventInput.parse(input);
  const camera = await db.cameraDevice.findFirst({
    where: { id: p.cameraId, businessId: BUSINESS_ID, source: "LOCAL_TEST" },
  });
  invariant(camera?.locationId, "Select a mapped local test camera.");
  let at = new Date(p.occurredAt);
  if (p.scenario === "unmatched") at = new Date(at.getTime() + 7 * 86400000);
  if (p.scenario === "ambiguous") {
    await saveDelivery(actor, {
      supplier: "Demo alternate supplier",
      reference: `TEST-${randomUUID().slice(0, 8)}`,
      windowStart: new Date(at.getTime() - 20 * 60000).toISOString(),
      windowEnd: new Date(at.getTime() + 40 * 60000).toISOString(),
      locationId: camera.locationId,
      employeeId: null,
      notes: "Extra local test fixture to demonstrate ambiguous matches.",
    });
  }
  if (p.scenario === "late") {
    at = new Date();
    await saveDelivery(actor, {
      supplier: "Demo overdue delivery",
      reference: `LATE-${randomUUID().slice(0, 8)}`,
      windowStart: new Date(at.getTime() - 90 * 60000).toISOString(),
      windowEnd: new Date(at.getTime() - 30 * 60000).toISOString(),
      locationId: camera.locationId,
      employeeId: null,
      notes: "Overdue local test fixture.",
    });
  }
  if (p.scenario === "unavailable") {
    await db.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: "alex" },
        data: { available: false },
      });
      await audit(
        tx,
        actor,
        "EMPLOYEE_UPDATED",
        "Local test fixture: Alex marked unavailable. Restore availability in Employees.",
        "LOCAL_TEST",
      );
    });
  }
  return ingestEvent(
    localEventAdapter.normalize({
      requestId:
        p.scenario === "duplicate"
          ? "local-duplicate-example"
          : (p.requestId ?? randomUUID()),
      deviceId: camera.externalId,
      type: p.type,
      occurredAt: at,
      scenario: p.scenario,
    }),
    actor,
  );
}
