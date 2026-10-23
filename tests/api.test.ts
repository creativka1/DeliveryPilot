import {
  beforeAll,
  afterAll,
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "vitest";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { GET, POST, PATCH, DELETE } from "../app/api/[...path]/route";
import { db, BUSINESS_ID } from "../lib/db";
import { signSession } from "../lib/auth";
let count = 0;
let createdId = "";
const origin = "http://localhost:3000";
async function call(
  path: string,
  method = "GET",
  data?: unknown,
  headers: Record<string, string> = {},
) {
  const fn = { GET, POST, PATCH, DELETE }[method as "GET"];
  return fn(
    new Request(origin + "/api/" + path, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: data
        ? typeof data === "string"
          ? data
          : JSON.stringify(data)
        : undefined,
    }),
    { params: Promise.resolve({ path: path.split("?")[0].split("/") }) },
  );
}
const delivery = (supplier = "API Supplier") => ({
  supplier,
  reference: "HTTP-" + ++count,
  windowStart: "2026-10-20T09:00:00Z",
  windowEnd: "2026-10-20T10:00:00Z",
  locationId: "a",
  employeeId: "alex",
  notes: "",
});
beforeAll(async () => {
  const statements = readFileSync(
    "prisma/migrations/202610200001_initial/migration.sql",
    "utf8",
  )
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  const found = await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='Business'",
  );
  if (!found.length)
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
    data: { id: BUSINESS_ID, name: "API Test Warehouse" },
  });
  await db.location.create({
    data: { id: "a", businessId: BUSINESS_ID, name: "Entrance A" },
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
        locations: { create: { locationId: "a" } },
      },
    });
  await db.cameraDevice.create({
    data: {
      id: "test-a",
      externalId: "test-a",
      businessId: BUSINESS_ID,
      source: "LOCAL_TEST",
      name: "Local camera",
      locationId: "a",
    },
  });
  await db.cameraDevice.create({
    data: {
      id: "ring-a",
      externalId: "ring-a",
      businessId: BUSINESS_ID,
      source: "RING_API",
      name: "Real-contract fixture camera",
      locationId: "a",
    },
  });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());
describe.sequential("HTTP route contracts", () => {
  it("returns the persisted state with no-store caching", async () => {
    const r = await call("state");
    expect(r.status).toBe(200);
    const s = await r.json();
    expect(s.business.id).toBe(BUSINESS_ID);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(s.integration.configured).toBe(false);
  });
  it("creates a delivery and returns 201", async () => {
    const r = await call("deliveries", "POST", delivery());
    expect(r.status).toBe(201);
    createdId = (await r.json()).id;
  });
  it("validates bad delivery input with a useful 400", async () => {
    const r = await call("deliveries", "POST", { supplier: "" });
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("VALIDATION");
  });
  it("rejects malformed JSON", async () =>
    expect((await call("deliveries", "POST", "{bad")).status).toBe(400));
  it("rejects oversized input", async () =>
    expect((await call("deliveries", "POST", "x".repeat(100001))).status).toBe(
      413,
    ));
  it("updates a delivery with persistent audit attribution", async () => {
    const r = await call(
      "deliveries/" + createdId,
      "PATCH",
      delivery("API Edited Supplier"),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).supplier).toBe("API Edited Supplier");
    expect(
      await db.auditLog.count({
        where: {
          deliveryId: createdId,
          action: "DELIVERY_UPDATED",
          actorId: "manager",
        },
      }),
    ).toBe(1);
  });
  it("archives expected deliveries while retaining their audit history", async () => {
    expect((await call("deliveries/" + createdId, "DELETE")).status).toBe(200);
    expect(
      (
        await db.expectedDelivery.findUniqueOrThrow({
          where: { id: createdId },
        })
      ).archived,
    ).toBe(true);
    expect(
      await db.auditLog.count({ where: { deliveryId: createdId } }),
    ).toBeGreaterThan(1);
  });
  it("enforces role checks on manager operations", async () => {
    const r = await call("deliveries", "POST", delivery(), {
      Cookie: "dp_session=" + signSession("alex"),
    });
    expect(r.status).toBe(403);
  });
  it("rejects a cross-origin mutation", async () =>
    expect(
      (
        await call("deliveries", "POST", delivery(), {
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403));
  it("supports the explicitly configured trusted proxy origin", async () => {
    vi.stubEnv("APP_ORIGIN", "http://terminal.local:4173");
    expect(
      (
        await call("deliveries", "POST", delivery(), {
          Origin: "http://terminal.local:4173",
        })
      ).status,
    ).toBe(201);
  });
  it("provides an HttpOnly signed demo employee session", async () => {
    const r = await call("session", "POST", { employeeId: "alex" });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    expect(r.headers.get("set-cookie")?.toLowerCase()).toContain(
      "samesite=strict",
    );
  });
  it("disables demo impersonation without the production password", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("APP_ADMIN_PASSWORD", "a-long-test-password");
    expect((await call("session", "POST", { employeeId: "alex" })).status).toBe(
      401,
    );
  });
  it("requires authentication outside demo mode", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("APP_SESSION_SECRET", "a".repeat(32));
    expect((await call("state")).status).toBe(401);
  });
  it("creates a source-labeled local event and deduplicates its request", async () => {
    const p = {
      cameraId: "test-a",
      type: "motion_detected",
      occurredAt: "2026-10-20T09:20:00Z",
      requestId: "http-duplicate",
      scenario: "standard",
    };
    const first = await (await call("test-events", "POST", p)).json();
    const second = await (await call("test-events", "POST", p)).json();
    expect(first.eventId).toBe(second.eventId);
    expect(second.duplicate).toBe(true);
    expect(
      (await db.ringEvent.findUniqueOrThrow({ where: { id: first.eventId } }))
        .source,
    ).toBe("LOCAL_TEST");
  });
  it("returns 503 for unconfigured webhook credentials", async () =>
    expect((await call("webhooks/ring", "POST", {})).status).toBe(503));
  it("validates the raw-body signature before parsing a webhook", async () => {
    vi.stubEnv("RING_WEBHOOK_SIGNING_KEY", "test-key");
    vi.stubEnv("RING_ACCOUNT_ID", "test-account");
    const r = await call("webhooks/ring", "POST", "{not-json", {
      "X-Signature": "sha256=" + "0".repeat(64),
    });
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe("Invalid Ring signature.");
  });
  it("accepts a correctly signed contract fixture once and preserves Ring provenance", async () => {
    vi.stubEnv("RING_WEBHOOK_SIGNING_KEY", "test-key");
    vi.stubEnv("RING_ACCOUNT_ID", "test-account");
    const p = {
      meta: {
        version: "1.1",
        time: "2026-10-20T09:20:00Z",
        request_id: "signed-http-fixture",
        account_id: "test-account",
      },
      data: {
        id: "fixture-1",
        type: "button_press",
        attributes: {
          source: "ring-a",
          source_type: "devices",
          timestamp: 1792488000000,
        },
      },
    };
    const raw = JSON.stringify(p, null, 2);
    const signature =
      "sha256=" +
      createHmac("sha256", "test-key").update(Buffer.from(raw)).digest("hex");
    const first = await call("webhooks/ring", "POST", raw, {
      "X-Signature": signature,
    });
    expect(first.status).toBe(200);
    const a = await first.json();
    const b = await (
      await call("webhooks/ring", "POST", raw, { "X-Signature": signature })
    ).json();
    expect(a.eventId).toBe(b.eventId);
    expect(b.duplicate).toBe(true);
    const e = await db.ringEvent.findUniqueOrThrow({
      where: { id: a.eventId },
    });
    expect(e.source).toBe("RING_WEBHOOK");
    expect(e.type).toBe("button_press");
  });
  it("does not create delivery candidates from signed device lifecycle events", async () => {
    vi.stubEnv("RING_WEBHOOK_SIGNING_KEY", "test-key");
    vi.stubEnv("RING_ACCOUNT_ID", "test-account");
    const raw = JSON.stringify({
      meta: {
        version: "1.1",
        time: "2026-10-20T09:20:00Z",
        request_id: "online-fixture",
        account_id: "test-account",
      },
      data: {
        id: "lifecycle",
        type: "device_online",
        attributes: { source: "ring-a", timestamp: 1792488000000 },
      },
    });
    const signature = createHmac("sha256", "test-key")
      .update(raw)
      .digest("hex");
    const r = await call("webhooks/ring", "POST", raw, {
      "X-Signature": signature,
    });
    const e = await r.json();
    expect(
      await db.deliveryCandidate.count({ where: { eventId: e.eventId } }),
    ).toBe(0);
  });
  it("reports missing Ring auth and saves a failed integration check without secrets", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "");
    vi.stubEnv("RING_REFRESH_TOKEN", "");
    const r = await call("ring/connect", "POST", {});
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("RING_NOT_CONFIGURED");
    expect(
      (
        await db.integrationCheck.findFirstOrThrow({
          orderBy: { createdAt: "desc" },
        })
      ).success,
    ).toBe(false);
  });
  it("rejects arbitrary stream URLs before making any upstream request", async () =>
    expect(
      (
        await call("ring/stream", "DELETE", {
          sessionUrl: "https://evil.example",
        })
      ).status,
    ).toBe(400));
  it("streams a database revision for real-time updates", async () => {
    const abort = new AbortController();
    const response = await GET(
      new Request(origin + "/api/stream", { signal: abort.signal }),
      { params: Promise.resolve({ path: ["stream"] }) },
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: ready");
    await call("deliveries", "POST", delivery("SSE integration fixture"));
    const next = await reader.read();
    expect(new TextDecoder().decode(next.value)).toContain("event: change");
    abort.abort();
    await reader.cancel();
  });
  it("returns 404 for unknown routes", async () =>
    expect((await call("not-a-route")).status).toBe(404));
});
