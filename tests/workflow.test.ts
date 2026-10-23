import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { db, BUSINESS_ID } from "../lib/db";
import {
  saveDelivery,
  archiveDelivery,
  saveEmployee,
  ingestEvent,
  linkCandidate,
  actOnTask,
} from "../lib/workflow";
import { getState } from "../lib/state";
import { signSession, readSession, sameOrigin } from "../lib/auth";
import { localEventAdapter } from "../lib/ring/events";
import type { Actor } from "../lib/auth";
let manager: Actor, alex: Actor, sam: Actor;
const at = new Date("2026-10-20T09:20:00Z");
let sequence = 0;
const input = (overrides: Record<string, unknown> = {}) => ({
  supplier: "Northline Supplies",
  reference: "PO-" + ++sequence,
  windowStart: "2026-10-20T09:00:00Z",
  windowEnd: "2026-10-20T10:00:00Z",
  locationId: "a",
  employeeId: "alex",
  notes: "12 cartons",
  ...overrides,
});
async function arrival(overrides: Record<string, unknown> = {}) {
  return ingestEvent(
    localEventAdapter.normalize({
      requestId: "test-" + ++sequence,
      deviceId: "camera-a",
      type: "motion_detected",
      occurredAt: at,
      scenario: "standard",
      ...overrides,
    }),
    manager,
  );
}
beforeAll(async () => {
  // Isolated, disposable SQLite test database. Application demo data is never reset.
  const statements = readFileSync(
    "prisma/migrations/202610200001_initial/migration.sql",
    "utf8",
  )
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  const tables = await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='Business'",
  );
  if (!tables.length)
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
    data: { id: BUSINESS_ID, name: "Test Warehouse" },
  });
  for (const id of ["a", "b"])
    await db.location.create({
      data: { id, name: id, businessId: BUSINESS_ID },
    });
  for (const [id, role] of [
    ["manager", "MANAGER"],
    ["alex", "RECEIVER"],
    ["sam", "RECEIVER"],
  ])
    await db.employee.create({
      data: {
        id,
        name: id,
        role,
        businessId: BUSINESS_ID,
        locations: { create: [{ locationId: "a" }] },
      },
    });
  manager = await db.employee.findUniqueOrThrow({ where: { id: "manager" } });
  alex = await db.employee.findUniqueOrThrow({ where: { id: "alex" } });
  sam = await db.employee.findUniqueOrThrow({ where: { id: "sam" } });
  await db.cameraDevice.create({
    data: {
      id: "camera-a",
      externalId: "camera-a",
      name: "Entrance A test",
      businessId: BUSINESS_ID,
      source: "LOCAL_TEST",
      locationId: "a",
    },
  });
});
afterAll(() => db.$disconnect());
describe.sequential("persistent receiving workflow", () => {
  it("creates and updates a delivery with actor-attributed audit records", async () => {
    const d = await saveDelivery(manager, input());
    const changed = await saveDelivery(
      manager,
      input({ supplier: "Updated Supplier" }),
      d.id,
    );
    expect(changed.supplier).toBe("Updated Supplier");
    expect(
      await db.auditLog.count({
        where: { deliveryId: d.id, actorId: "manager" },
      }),
    ).toBe(2);
    await archiveDelivery(manager, d.id);
    expect(
      (await db.expectedDelivery.findUniqueOrThrow({ where: { id: d.id } }))
        .archived,
    ).toBe(true);
  });
  it("rejects invalid time windows", async () => {
    await expect(
      saveDelivery(manager, input({ windowEnd: "2026-10-20T08:00:00Z" })),
    ).rejects.toThrow();
  });
  it("prevents receivers from modifying the schedule", async () => {
    await expect(saveDelivery(alex, input())).rejects.toMatchObject({
      status: 403,
    });
  });
  it("validates employee receiving locations", async () => {
    await expect(
      saveDelivery(manager, input({ locationId: "b" })),
    ).rejects.toThrow("does not receive");
  });
  it("matches activity, assigns a task, notifies Alex, acknowledges and confirms with real timestamps", async () => {
    const d = await saveDelivery(manager, input());
    const e = await arrival();
    const c = await db.deliveryCandidate.findUniqueOrThrow({
      where: { eventId_deliveryId: { eventId: e.eventId, deliveryId: d.id } },
    });
    expect(c.score).toBe(100);
    expect(
      (await db.expectedDelivery.findUniqueOrThrow({ where: { id: d.id } }))
        .receivedAt,
    ).toBeNull();
    const t = await linkCandidate(manager, c.id);
    expect(t.employeeId).toBe("alex");
    expect(
      await db.notification.count({
        where: { employeeId: "alex", taskId: t.id },
      }),
    ).toBe(1);
    await expect(
      actOnTask(sam, t.id, { action: "acknowledge" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      actOnTask(alex, t.id, { action: "complete" }),
    ).rejects.toMatchObject({ status: 409 });
    const before = Date.now();
    await actOnTask(alex, t.id, { action: "acknowledge" });
    await actOnTask(alex, t.id, { action: "start" });
    await actOnTask(alex, t.id, { action: "complete" });
    const result = await db.expectedDelivery.findUniqueOrThrow({
      where: { id: d.id },
    });
    expect(result.status).toBe("RECEIVED");
    expect(result.receivedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.receivedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    const log = await db.auditLog.findMany({ where: { taskId: t.id } });
    expect(log.map((x) => x.action)).toContain("DELIVERY_CONFIRMED");
    expect(log.find((x) => x.action === "DELIVERY_CONFIRMED")?.actorId).toBe(
      "alex",
    );
    await expect(
      actOnTask(alex, t.id, { action: "complete" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(saveDelivery(manager, input(), d.id)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("deduplicates the same incoming request, including parallel retries", async () => {
    const id = "duplicate-" + ++sequence;
    const [a, b] = await Promise.all([
      arrival({ requestId: id }),
      arrival({ requestId: id }),
    ]);
    expect(a.eventId).toBe(b.eventId);
    expect([a, b].filter((x) => x.duplicate)).toHaveLength(1);
    expect(await db.ringEvent.count({ where: { requestId: id } })).toBe(1);
  });
  it("keeps an unmatched event without a made-up delivery", async () => {
    const e = await arrival({ occurredAt: new Date("2030-01-01T00:00:00Z") });
    expect(
      await db.deliveryCandidate.count({ where: { eventId: e.eventId } }),
    ).toBe(0);
    expect(
      (await db.ringEvent.findUniqueOrThrow({ where: { id: e.eventId } }))
        .matchStatus,
    ).toBe("UNMATCHED");
  });
  it("retains multiple possible matches and permits only one employee selection", async () => {
    const d1 = await saveDelivery(manager, input()),
      d2 = await saveDelivery(manager, input());
    const e = await arrival();
    const candidates = await db.deliveryCandidate.findMany({
      where: { eventId: e.eventId },
    });
    expect(candidates.some((c) => c.deliveryId === d1.id)).toBe(true);
    expect(candidates.some((c) => c.deliveryId === d2.id)).toBe(true);
    const one = candidates.find((c) => c.deliveryId === d1.id)!,
      two = candidates.find((c) => c.deliveryId === d2.id)!;
    await linkCandidate(manager, one.id);
    await expect(linkCandidate(manager, two.id)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("leaves a task unassigned when its employee is unavailable", async () => {
    await db.employee.update({
      where: { id: "alex" },
      data: { available: false },
    });
    const d = await saveDelivery(manager, input());
    const e = await arrival();
    const c = await db.deliveryCandidate.findUniqueOrThrow({
      where: { eventId_deliveryId: { eventId: e.eventId, deliveryId: d.id } },
    });
    const t = await linkCandidate(manager, c.id);
    expect(t.employeeId).toBeNull();
    await expect(
      actOnTask(manager, t.id, { action: "acknowledge" }),
    ).rejects.toThrow("Assign an employee");
    await actOnTask(manager, t.id, { action: "reassign", employeeId: "sam" });
    expect(
      (await db.receivingTask.findUniqueOrThrow({ where: { id: t.id } }))
        .employeeId,
    ).toBe("sam");
    await db.employee.update({
      where: { id: "alex" },
      data: { available: true },
    });
  });
  it("records exceptions, escalates to managers, and requires an explicit resolution", async () => {
    const d = await saveDelivery(manager, input());
    const e = await arrival();
    const c = await db.deliveryCandidate.findUniqueOrThrow({
      where: { eventId_deliveryId: { eventId: e.eventId, deliveryId: d.id } },
    });
    const t = await linkCandidate(manager, c.id);
    await actOnTask(alex, t.id, { action: "acknowledge" });
    await actOnTask(alex, t.id, {
      action: "exception",
      issue: "Two cartons damaged",
    });
    expect(
      (await db.expectedDelivery.findUniqueOrThrow({ where: { id: d.id } }))
        .status,
    ).toBe("EXCEPTION");
    expect(
      await db.notification.count({
        where: { employeeId: "manager", taskId: t.id },
      }),
    ).toBeGreaterThan(0);
    await expect(
      actOnTask(alex, t.id, { action: "complete" }),
    ).rejects.toMatchObject({ status: 409 });
    await actOnTask(manager, t.id, {
      action: "resolve",
      issue: "Damaged cartons replaced",
    });
    await actOnTask(alex, t.id, { action: "complete" });
  });
  it("rejects a stale suggestion after its receiving entrance is remapped", async () => {
    const d = await saveDelivery(manager, input());
    const e = await arrival();
    const c = await db.deliveryCandidate.findUniqueOrThrow({
      where: { eventId_deliveryId: { eventId: e.eventId, deliveryId: d.id } },
    });
    await db.cameraDevice.update({
      where: { id: "camera-a" },
      data: { locationId: "b" },
    });
    await expect(linkCandidate(manager, c.id)).rejects.toThrow(
      "schedule or camera mapping changed",
    );
    await db.cameraDevice.update({
      where: { id: "camera-a" },
      data: { locationId: "a" },
    });
  });
  it("creates employees with role and location validation", async () => {
    const employee = await saveEmployee(manager, {
      name: "Taylor",
      role: "RECEIVER",
      available: true,
      locationIds: ["b"],
    });
    expect(employee.name).toBe("Taylor");
    await expect(
      saveEmployee(manager, {
        name: "Bad",
        role: "RECEIVER",
        available: true,
        locationIds: ["missing"],
      }),
    ).rejects.toThrow("Invalid receiving location");
  });
  it("calculates dashboard metrics from persisted data and omits raw webhook payloads", async () => {
    const state = await getState(manager);
    expect(state.metrics.confirmed).toBe(2);
    expect(state.metrics.avgAcknowledgmentSeconds).not.toBeNaN();
    expect(state.events.every((e) => !("payload" in e))).toBe(true);
    expect(state.metrics.unacknowledged).toBe(
      await db.receivingTask.count({ where: { status: "PENDING" } }),
    );
  });
});
describe("local workspace session and origin boundaries", () => {
  it("signs and reads a bounded session", () =>
    expect(readSession("dp_session=" + signSession("alex"))).toBe("alex"));
  it("rejects forged session cookies", () =>
    expect(readSession("dp_session=wrong." + "a".repeat(64))).toBeNull());
  it("rejects expired sessions", () => {
    const token = signSession("alex");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 9 * 3600000));
    expect(readSession("dp_session=" + token)).toBeNull();
    vi.useRealTimers();
  });
  it("rejects cross-origin state changes", () =>
    expect(() =>
      sameOrigin(
        new Request("http://localhost:3000/api/tasks", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        }),
      ),
    ).toThrow("Cross-origin"));
});
