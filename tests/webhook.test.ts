import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

vi.hoisted(() => {
  process.env.DATABASE_URL = "file:./webhook-test.db";
});
import { GET, POST } from "../app/api/[...path]/route";
import { db, BUSINESS_ID } from "../lib/db";
import { signSession } from "../lib/auth";

const localKey = "isolated-local-webhook-test-key";
const partnerKey = "isolated-partner-contract-test-key";
const timestamp = Date.parse("2026-10-20T09:20:00.000Z");
let sequence = 0;
function payload(
  options: {
    id?: string;
    device?: string;
    account?: string;
    type?: string;
    at?: number;
  } = {},
) {
  const id = options.id ?? `signed-test-${++sequence}`;
  return {
    meta: {
      version: "1.1",
      time: new Date(options.at ?? timestamp).toISOString(),
      request_id: id,
      account_id: options.account ?? "local-account",
    },
    data: {
      id: `event-${id}`,
      type: options.type ?? "motion_detected",
      attributes: {
        source: options.device ?? "ring-camera",
        source_type: "devices",
        timestamp: options.at ?? timestamp,
      },
    },
  };
}
function signature(raw: string, key = localKey) {
  return (
    "sha256=" + createHmac("sha256", key).update(Buffer.from(raw)).digest("hex")
  );
}
async function webhook(
  raw: string,
  signed = signature(raw),
  headers: Record<string, string> = {},
) {
  return POST(
    new Request("http://localhost:3000/api/webhooks/ring", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signed,
        ...headers,
      },
      body: raw,
    }),
    { params: Promise.resolve({ path: ["webhooks", "ring"] }) },
  );
}
async function action(path: string, data: unknown, employee = "manager") {
  return POST(
    new Request(`http://localhost:3000/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `dp_session=${signSession(employee)}`,
      },
      body: JSON.stringify(data),
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}
async function expected(id: string, overrides: Record<string, unknown> = {}) {
  return db.expectedDelivery.create({
    data: {
      id,
      businessId: BUSINESS_ID,
      supplier: id,
      reference: id,
      windowStart: new Date(timestamp - 20 * 60000),
      windowEnd: new Date(timestamp + 40 * 60000),
      locationId: "a",
      employeeId: "alex",
      ...overrides,
    },
  });
}
async function counts() {
  return Promise.all([
    db.ringEvent.count(),
    db.deliveryCandidate.count(),
    db.receivingTask.count(),
    db.auditLog.count(),
    db.notification.count(),
  ]);
}
beforeAll(async () => {
  const statements = readFileSync(
    "prisma/migrations/202610200001_initial/migration.sql",
    "utf8",
  )
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  const exists = await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='Business'",
  );
  if (!exists.length)
    for (const sql of statements) await db.$executeRawUnsafe(sql);
  for (const remove of [
    () => db.notification.deleteMany(),
    () => db.auditLog.deleteMany(),
    () => db.receivingTask.deleteMany(),
    () => db.deliveryCandidate.deleteMany(),
    () => db.ringEvent.deleteMany(),
    () => db.expectedDelivery.deleteMany(),
    () => db.employeeLocation.deleteMany(),
    () => db.cameraDevice.deleteMany(),
    () => db.location.deleteMany(),
    () => db.employee.deleteMany(),
    () => db.integrationCheck.deleteMany(),
    () => db.business.deleteMany(),
  ])
    await remove();
  await db.business.create({
    data: { id: BUSINESS_ID, name: "Isolated webhook regression fixtures" },
  });
  for (const id of ["a", "b"])
    await db.location.create({
      data: { id, businessId: BUSINESS_ID, name: id },
    });
  for (const [id, role] of [
    ["manager", "MANAGER"],
    ["alex", "RECEIVER"],
  ])
    await db.employee.create({
      data: {
        id,
        name: id,
        role,
        businessId: BUSINESS_ID,
        locations: { create: [{ locationId: "a" }, { locationId: "b" }] },
      },
    });
  for (const [id, source] of [
    ["ring-camera", "RING_API"],
    ["test-camera", "LOCAL_TEST"],
  ])
    await db.cameraDevice.create({
      data: {
        id,
        externalId: id,
        name: `Fixture ${id}`,
        businessId: BUSINESS_ID,
        source,
        locationId: "a",
        online: true,
      },
    });
  await expected("preserved-record", {
    status: "RECEIVED",
    notes: "Existing record preservation sentinel",
    receivedAt: new Date(timestamp - 86400000),
  });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());
function simulated() {
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("RING_WEBHOOK_MODE", "simulated");
  vi.stubEnv("RING_SIMULATED_WEBHOOK_SIGNING_KEY", localKey);
  vi.stubEnv("RING_SIMULATED_ACCOUNT_ID", "local-account");
  vi.stubEnv("RING_WEBHOOK_SIGNING_KEY", partnerKey);
  vi.stubEnv("RING_ACCOUNT_ID", "partner-account");
}
describe.sequential(
  "signed webhook → matching → reviewed employee assignment → audit",
  () => {
    it("accepts a valid raw-body HMAC, normalizes the event, matches the mapped delivery, and preserves simulation provenance", async () => {
      simulated();
      const delivery = await expected("primary-delivery");
      await expected("different-entrance", { locationId: "b" });
      await expected("different-window", {
        windowStart: new Date(timestamp + 4 * 3600000),
        windowEnd: new Date(timestamp + 5 * 3600000),
      });
      const sentinel = await db.expectedDelivery.findUniqueOrThrow({
        where: { id: "preserved-record" },
      });
      const raw = JSON.stringify(payload({ id: "primary-request" }), null, 2);
      const response = await webhook(raw);
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.duplicate).toBe(false);
      const event = await db.ringEvent.findUniqueOrThrow({
        where: { id: result.eventId },
        include: { candidates: true },
      });
      expect(event).toMatchObject({
        source: "SIMULATED_RING_WEBHOOK",
        requestId: "primary-request",
        type: "motion_detected",
        externalDeviceId: "ring-camera",
        cameraId: "ring-camera",
        matchStatus: "SUGGESTED",
      });
      expect(event.occurredAt.getTime()).toBe(timestamp);
      expect(event.summary).toContain("not a real Ring notification");
      expect(event.candidates).toHaveLength(1);
      expect(event.candidates[0]).toMatchObject({
        deliveryId: delivery.id,
        score: 100,
        selected: false,
      });
      expect(await db.receivingTask.count()).toBe(0); // Preserve the existing manager-review boundary.
      const received = await db.auditLog.findFirstOrThrow({
        where: { eventId: event.id, action: "ACTIVITY_RECEIVED" },
      });
      expect(received).toMatchObject({
        source: "SIMULATED_RING_WEBHOOK",
        actorId: "system:ring-simulation",
      });
      expect(received.message).toContain("not a real Ring notification");
      expect(
        await db.expectedDelivery.findUniqueOrThrow({
          where: { id: "preserved-record" },
        }),
      ).toEqual(sentinel);
    });
    it("rejects an invalid signature without event, candidate, task, audit, or notification writes", async () => {
      simulated();
      const before = await counts();
      const response = await webhook(
        JSON.stringify(payload()),
        "sha256=" + "0".repeat(64),
      );
      expect(response.status).toBe(401);
      expect(await counts()).toEqual(before);
    });
    it("rejects body tampering and a signature over reserialized rather than raw JSON", async () => {
      simulated();
      const object = payload();
      const raw = JSON.stringify(object, null, 2);
      const before = await counts();
      expect(
        (await webhook(raw, signature(JSON.stringify(object)))).status,
      ).toBe(401);
      expect((await webhook(raw + " ", signature(raw))).status).toBe(401);
      expect(await counts()).toEqual(before);
    });
    it("verifies the signature before attempting to parse invalid JSON", async () => {
      simulated();
      expect((await webhook("{invalid", "bad-signature")).status).toBe(401);
      expect((await webhook("{invalid")).status).toBe(400);
    });
    it("rejects signed payloads for the wrong account without writes", async () => {
      simulated();
      const before = await counts();
      expect(
        (await webhook(JSON.stringify(payload({ account: "wrong-account" }))))
          .status,
      ).toBe(403);
      expect(await counts()).toEqual(before);
    });
    it("deduplicates before and after manager selection, and assigns Alex through the existing workflow", async () => {
      simulated();
      const raw = JSON.stringify(payload({ id: "primary-request" }), null, 2);
      const before = await counts();
      const duplicate = await (await webhook(raw)).json();
      expect(duplicate.duplicate).toBe(true);
      expect(await counts()).toEqual(before);
      const candidate = await db.deliveryCandidate.findFirstOrThrow({
        where: { eventId: duplicate.eventId },
      });
      const selected = await action(`candidates/${candidate.id}/link`, {});
      expect(selected.status).toBe(201);
      const task = await selected.json();
      expect(task).toMatchObject({
        employeeId: "alex",
        deliveryId: "primary-delivery",
        status: "PENDING",
        acknowledgedAt: null,
        completedAt: null,
      });
      expect(
        await db.notification.count({
          where: { taskId: task.id, employeeId: "alex" },
        }),
      ).toBe(1);
      const afterAssignment = await counts();
      expect((await (await webhook(raw)).json()).duplicate).toBe(true);
      expect(await counts()).toEqual(afterAssignment);
      const taskAudit = await db.auditLog.findMany({
        where: { taskId: task.id },
      });
      expect(taskAudit.map((a) => a.action)).toEqual(
        expect.arrayContaining(["MATCH_SELECTED", "TASK_ASSIGNED"]),
      );
      expect(taskAudit.every((a) => a.actorId === "manager")).toBe(true);
      const stateResponse = await GET(
        new Request("http://localhost:3000/api/state"),
        { params: Promise.resolve({ path: ["state"] }) },
      );
      const state = await stateResponse.json();
      expect(
        state.events.find((e: { id: string }) => e.id === duplicate.eventId)
          .source,
      ).toBe("SIMULATED_RING_WEBHOOK");
      expect(JSON.stringify(state)).not.toContain(localKey);
      expect(JSON.stringify(state)).not.toContain(partnerKey);
      for (const actionName of ["acknowledge", "start", "complete"])
        expect(
          (await action(`tasks/${task.id}`, { action: actionName }, "alex"))
            .status,
        ).toBe(200);
      expect(
        (
          await db.auditLog.findFirstOrThrow({
            where: { taskId: task.id, action: "DELIVERY_CONFIRMED" },
          })
        ).actorId,
      ).toBe("alex");
    });
    it("handles concurrent retries without duplicated events or audits", async () => {
      simulated();
      const raw = JSON.stringify(payload({ id: "concurrent-request" }));
      const responses = await Promise.all([webhook(raw), webhook(raw)]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const bodies = await Promise.all(responses.map((r) => r.json()));
      expect(bodies[0].eventId).toBe(bodies[1].eventId);
      expect(bodies.filter((r) => r.duplicate)).toHaveLength(1);
      expect(
        await db.auditLog.count({
          where: { eventId: bodies[0].eventId, action: "ACTIVITY_RECEIVED" },
        }),
      ).toBe(1);
    });
    it("retains ambiguous candidates for review without automatically selecting either", async () => {
      simulated();
      await expected("ambiguous-one");
      await expected("ambiguous-two");
      const result = await (await webhook(JSON.stringify(payload()))).json();
      const event = await db.ringEvent.findUniqueOrThrow({
        where: { id: result.eventId },
        include: { candidates: true },
      });
      expect(event.candidates).toHaveLength(2);
      expect(event.candidates.every((c) => !c.selected)).toBe(true);
      expect(
        await db.receivingTask.count({
          where: { candidateId: { in: event.candidates.map((c) => c.id) } },
        }),
      ).toBe(0);
    });
    it("records unknown cameras as unmatched activity", async () => {
      simulated();
      const result = await (
        await webhook(JSON.stringify(payload({ device: "unknown-camera" })))
      ).json();
      expect(
        await db.deliveryCandidate.count({
          where: { eventId: result.eventId },
        }),
      ).toBe(0);
      expect(
        (
          await db.ringEvent.findUniqueOrThrow({
            where: { id: result.eventId },
          })
        ).matchStatus,
      ).toBe("UNMATCHED");
    });
    it("does not let simulated lifecycle events alter a real camera's status", async () => {
      simulated();
      const response = await webhook(
        JSON.stringify(payload({ type: "device_offline" })),
      );
      expect(response.status).toBe(200);
      expect(
        (
          await db.cameraDevice.findUniqueOrThrow({
            where: { id: "ring-camera" },
          })
        ).online,
      ).toBe(true);
    });
    it("normalizes documented button_press and timestamp fallback", async () => {
      simulated();
      const p = payload({ type: "button_press" });
      const raw = JSON.stringify({
        ...p,
        data: {
          ...p.data,
          attributes: { source: "test-camera", source_type: "devices" },
        },
      });
      const result = await (await webhook(raw)).json();
      const event = await db.ringEvent.findUniqueOrThrow({
        where: { id: result.eventId },
      });
      expect(event.type).toBe("button_press");
      expect(event.occurredAt.getTime()).toBe(timestamp);
      expect(event.cameraId).toBe("test-camera");
    });
    it("rejects invented package_delivered events without writes", async () => {
      simulated();
      const before = await counts();
      expect(
        (await webhook(JSON.stringify(payload({ type: "package_delivered" }))))
          .status,
      ).toBe(400);
      expect(await counts()).toEqual(before);
    });
    it("validates JSON content type and the body size limit", async () => {
      simulated();
      expect(
        (await webhook("{}", signature("{}"), { "Content-Type": "text/plain" }))
          .status,
      ).toBe(415);
      const raw = " ".repeat(100001);
      expect((await webhook(raw)).status).toBe(413);
    });
    it("preserves unassigned-task escalation when Alex is unavailable", async () => {
      simulated();
      await db.employee.update({
        where: { id: "alex" },
        data: { available: false },
      });
      const d = await expected("unavailable-delivery", {
        windowStart: new Date(timestamp + 8 * 3600000),
        windowEnd: new Date(timestamp + 9 * 3600000),
      });
      const result = await (
        await webhook(
          JSON.stringify(payload({ at: timestamp + 8 * 3600000 + 60000 })),
        )
      ).json();
      const c = await db.deliveryCandidate.findFirstOrThrow({
        where: { eventId: result.eventId, deliveryId: d.id },
      });
      const task = await (await action(`candidates/${c.id}/link`, {})).json();
      expect(task.employeeId).toBeNull();
      expect(
        await db.notification.count({
          where: { taskId: task.id, employeeId: "manager" },
        }),
      ).toBe(1);
      await db.employee.update({
        where: { id: "alex" },
        data: { available: true },
      });
    });
  },
);
describe("simulation/partner trust boundary", () => {
  it("simulation is disabled outside explicit demo mode", async () => {
    simulated();
    vi.stubEnv("DEMO_MODE", "false");
    const before = await counts();
    expect((await webhook(JSON.stringify(payload()))).status).toBe(403);
    expect(await counts()).toEqual(before);
  });
  it("requires separate configured simulation credentials", async () => {
    simulated();
    vi.stubEnv("RING_SIMULATED_WEBHOOK_SIGNING_KEY", "");
    expect((await webhook("{}")).status).toBe(503);
  });
  it("rejects an unknown server mode instead of silently choosing real provenance", async () => {
    simulated();
    vi.stubEnv("RING_WEBHOOK_MODE", "mistyped");
    expect((await webhook("{}")).status).toBe(503);
  });
  it("rejects reuse of the partner HMAC key for simulations", async () => {
    simulated();
    vi.stubEnv("RING_SIMULATED_WEBHOOK_SIGNING_KEY", partnerKey);
    expect((await webhook("{}", signature("{}", partnerKey))).status).toBe(503);
  });
  it("does not authenticate a simulation key in partner mode", async () => {
    simulated();
    vi.stubEnv("RING_WEBHOOK_MODE", "partner");
    const before = await counts();
    expect(
      (await webhook(JSON.stringify(payload({ account: "partner-account" }))))
        .status,
    ).toBe(401);
    expect(await counts()).toEqual(before);
  });
  it("does not authenticate a partner key in simulation mode", async () => {
    simulated();
    const raw = JSON.stringify(payload());
    expect((await webhook(raw, signature(raw, partnerKey))).status).toBe(401);
  });
  it("ignores provenance claims in a caller's headers and JSON", async () => {
    simulated();
    const raw = JSON.stringify({
      ...payload(),
      source: "RING_WEBHOOK",
      simulated: false,
    });
    const result = await (
      await webhook(raw, signature(raw), {
        "X-DeliveryPilot-Source": "RING_WEBHOOK",
        "X-Simulated": "false",
      })
    ).json();
    expect(
      (await db.ringEvent.findUniqueOrThrow({ where: { id: result.eventId } }))
        .source,
    ).toBe("SIMULATED_RING_WEBHOOK");
  });
  it("keeps partner mode compatible and namespaces its request IDs independently", async () => {
    simulated();
    const id = "same-id-two-sources";
    const localRaw = JSON.stringify(payload({ id }));
    const local = await (await webhook(localRaw)).json();
    vi.stubEnv("RING_WEBHOOK_MODE", "partner");
    const partnerRaw = JSON.stringify(
      payload({ id, account: "partner-account" }),
    );
    const response = await webhook(
      partnerRaw,
      signature(partnerRaw, partnerKey),
    );
    expect(response.status).toBe(200);
    const partner = await response.json();
    expect(partner.duplicate).toBe(false);
    expect(partner.eventId).not.toBe(local.eventId);
    expect(
      (await db.ringEvent.findUniqueOrThrow({ where: { id: partner.eventId } }))
        .source,
    ).toBe("RING_WEBHOOK");
  });
});
