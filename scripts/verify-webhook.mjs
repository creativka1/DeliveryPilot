import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

// Run the built application against disposable fixtures. Never inherit the
// user's database, Ring tokens, signing keys, cookies, or partner account.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder = await mkdtemp(join(tmpdir(), "deliverypilot-signed-webhook-"));
const databaseUrl = `file:${join(folder, "verification.db").replaceAll("\\", "/")}`;
const signingKey = randomBytes(32).toString("hex");
const accountId = "local-signed-webhook-fixture";
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: databaseUrl,
  DEMO_MODE: "true",
  APP_SESSION_SECRET: randomBytes(32).toString("hex"),
  APP_ORIGIN: "",
  RING_ACCESS_TOKEN: "",
  RING_REFRESH_TOKEN: "",
  RING_CLIENT_ID: "",
  RING_CLIENT_SECRET: "",
  RING_WEBHOOK_MODE: "simulated",
  RING_SIMULATED_WEBHOOK_SIGNING_KEY: signingKey,
  RING_SIMULATED_ACCOUNT_ID: accountId,
  RING_WEBHOOK_SIGNING_KEY: "",
  RING_ACCOUNT_ID: "",
  NEXT_TELEMETRY_DISABLED: "1",
};
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const checks = [];
let server;
let serverOutput = "";
let origin = "";
const report = {
  verified: false,
  transport: "loopback HTTP",
  server: "Next.js production build",
  database: "isolated temporary SQLite",
  source: "SIMULATED_RING_WEBHOOK",
  realRingApiCalled: false,
  generatedAt: new Date().toISOString(),
  checks,
};
function passed(name, details = {}) {
  checks.push({ name, passed: true, ...details });
}
function command(args) {
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
  });
  if (r.status !== 0)
    throw new Error(
      `Fixture setup failed: ${r.stderr || r.stdout || "unknown error"}`,
    );
}
function signed(raw, key = signingKey) {
  return `sha256=${createHmac("sha256", key).update(Buffer.from(raw)).digest("hex")}`;
}
async function request(
  path,
  { raw, data, cookie, signature, headers = {} } = {},
) {
  const body = raw ?? (data === undefined ? undefined : JSON.stringify(data));
  const started = performance.now();
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(signature ? { "X-Signature": signature } : {}),
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  return {
    status: response.status,
    result,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    elapsedMs: Math.round(performance.now() - started),
  };
}
async function stats() {
  return {
    events: await prisma.ringEvent.count(),
    candidates: await prisma.deliveryCandidate.count(),
    tasks: await prisma.receivingTask.count(),
    audit: await prisma.auditLog.count(),
    notifications: await prisma.notification.count(),
  };
}
function event({
  id = randomUUID(),
  device = "verification-ring-camera",
  account = accountId,
  type = "motion_detected",
  at,
} = {}) {
  return {
    meta: {
      version: "1.1",
      time: new Date(at).toISOString(),
      request_id: id,
      account_id: account,
    },
    data: {
      id: `fixture-${id}`,
      type,
      attributes: { source: device, source_type: "devices", timestamp: at },
    },
  };
}
async function postEvent(value, options = {}) {
  const raw = JSON.stringify(value, null, 2);
  return request("/api/webhooks/ring", {
    raw,
    signature: signed(raw),
    ...options,
  });
}
try {
  // The verification runner consumes an existing production build; it does not
  // rebuild the project or modify source files, .env files, or application data.
  await readFile(join(root, ".next", "BUILD_ID"));
  command(["scripts/migrate.mjs"]);
  command(["--import", "tsx", "prisma/seed.ts"]);
  const delivery = await prisma.expectedDelivery.findUniqueOrThrow({
    where: { id: "northline" },
  });
  const at = delivery.windowStart.getTime() + 20 * 60000;
  await prisma.cameraDevice.create({
    data: {
      id: "verification-ring-camera",
      externalId: "verification-ring-camera",
      name: "Isolated mapped camera fixture (not a discovered device)",
      businessId: "warehouse",
      source: "RING_API",
      locationId: "entrance-a",
      online: true,
    },
  });
  const sentinel = await prisma.expectedDelivery.create({
    data: {
      businessId: "warehouse",
      supplier: "Existing-record preservation fixture",
      reference: "KEEP-UNCHANGED",
      windowStart: new Date(at - 3 * 86400000),
      windowEnd: new Date(at - 3 * 86400000 + 3600000),
      locationId: "entrance-b",
      employeeId: "jordan",
      notes:
        "Unrelated record must remain byte-for-byte equivalent at the model level.",
    },
  });
  const originalCamera = await prisma.cameraDevice.findUniqueOrThrow({
    where: { id: "verification-ring-camera" },
  });
  const originalEmployees = await prisma.employee.findMany({
    orderBy: { id: "asc" },
  });
  const probe = createServer();
  await new Promise((yes, no) => {
    probe.once("error", no);
    probe.listen(0, "127.0.0.1", yes);
  });
  const port = probe.address().port;
  await new Promise((yes, no) =>
    probe.close((error) => (error ? no(error) : yes())),
  );
  origin = `http://127.0.0.1:${port}`;
  env.APP_ORIGIN = origin;
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (x) => {
    serverOutput = (serverOutput + x.toString()).slice(-6000);
  });
  server.stderr.on("data", (x) => {
    serverOutput = (serverOutput + x.toString()).slice(-6000);
  });
  const deadline = Date.now() + 30000;
  while (true) {
    if (server.exitCode !== null)
      throw new Error(`Local app exited: ${serverOutput}`);
    try {
      const r = await request("/api/state");
      if (r.status === 200) break;
    } catch {
      /* Wait only for this runner's local child server. */
    }
    if (Date.now() >= deadline)
      throw new Error(`Local app did not become ready: ${serverOutput}`);
    await delay(100);
  }
  passed("Production app started on loopback with an isolated database");
  const managerSession = await request("/api/session", {
    data: { employeeId: "manager" },
  });
  const alexSession = await request("/api/session", {
    data: { employeeId: "alex" },
  });
  assert.equal(managerSession.status, 200);
  assert.equal(alexSession.status, 200);
  const managerCookie = managerSession.cookie,
    alexCookie = alexSession.cookie;
  const beforeInvalid = await stats();
  const invalid = await postEvent(event({ at }), {
    signature: `sha256=${"0".repeat(64)}`,
  });
  assert.equal(invalid.status, 401);
  assert.deepEqual(await stats(), beforeInvalid);
  passed("Invalid signature rejected without any workflow writes", {
    httpStatus: invalid.status,
  });
  const value = event({ id: "verified-simulation", at });
  const raw = JSON.stringify(value, null, 2);
  const tampered = await request("/api/webhooks/ring", {
    raw: raw + " ",
    signature: signed(raw),
  });
  assert.equal(tampered.status, 401);
  assert.deepEqual(await stats(), beforeInvalid);
  passed("Raw body byte tampering rejected", { httpStatus: tampered.status });
  const wrongAccount = await postEvent(
    event({ at, account: "different-account" }),
  );
  assert.equal(wrongAccount.status, 403);
  assert.deepEqual(await stats(), beforeInvalid);
  passed("Correctly signed wrong-account payload rejected", {
    httpStatus: wrongAccount.status,
  });
  const valid = await request("/api/webhooks/ring", {
    raw,
    signature: signed(raw),
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.result.duplicate, false);
  passed("Correctly signed simulated webhook authenticated over real HTTP", {
    httpStatus: valid.status,
    elapsedMs: valid.elapsedMs,
  });
  const persisted = await prisma.ringEvent.findUniqueOrThrow({
    where: { id: valid.result.eventId },
    include: { candidates: true },
  });
  assert.equal(persisted.source, "SIMULATED_RING_WEBHOOK");
  assert.equal(persisted.requestId, value.meta.request_id);
  assert.equal(persisted.type, "motion_detected");
  assert.equal(persisted.occurredAt.getTime(), at);
  assert.equal(persisted.cameraId, "verification-ring-camera");
  passed(
    "Event normalization preserves source, request ID, timestamp, event type, and camera mapping",
  );
  assert.equal(persisted.candidates.length, 1);
  assert.equal(persisted.candidates[0].deliveryId, delivery.id);
  assert.equal(persisted.candidates[0].score, 100);
  assert.equal(await prisma.receivingTask.count(), 0);
  passed(
    "Automatic entrance/time matching produces Northline candidate and preserves manager review",
  );
  const sourceAudit = await prisma.auditLog.findMany({
    where: { eventId: persisted.id },
  });
  assert.ok(
    sourceAudit.some(
      (a) =>
        a.action === "ACTIVITY_RECEIVED" &&
        a.actorId === "system:ring-simulation" &&
        a.source === "SIMULATED_RING_WEBHOOK",
    ),
  );
  assert.ok(sourceAudit.some((a) => a.action === "MATCHES_SUGGESTED"));
  assert.ok(persisted.summary.includes("not a real Ring notification"));
  passed(
    "Generated event and original audit evidence are labeled as simulation",
  );
  const beforeDuplicate = await stats();
  const duplicate = await request("/api/webhooks/ring", {
    raw,
    signature: signed(raw),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.result.duplicate, true);
  assert.equal(duplicate.result.eventId, persisted.id);
  assert.deepEqual(await stats(), beforeDuplicate);
  passed("Duplicate request ID returns success without repeated side effects", {
    httpStatus: duplicate.status,
  });
  const assigned = await request(
    `/api/candidates/${persisted.candidates[0].id}/link`,
    { data: {}, cookie: managerCookie },
  );
  assert.equal(assigned.status, 201);
  assert.equal(assigned.result.employeeId, "alex");
  assert.equal(assigned.result.status, "PENDING");
  assert.equal(assigned.result.completedAt, null);
  passed("Manager selection assigns the existing designated employee Alex", {
    httpStatus: assigned.status,
  });
  assert.equal(
    await prisma.notification.count({
      where: { taskId: assigned.result.id, employeeId: "alex" },
    }),
    1,
  );
  const alexState = await request("/api/state", { cookie: alexCookie });
  assert.ok(
    alexState.result.notifications.some((n) => n.taskId === assigned.result.id),
  );
  passed(
    "Assigned task notification is visible in Alex's real HTTP state response",
  );
  const assignedAudit = await prisma.auditLog.findMany({
    where: { taskId: assigned.result.id },
  });
  assert.ok(
    assignedAudit.some(
      (a) => a.action === "MATCH_SELECTED" && a.actorId === "manager",
    ),
  );
  assert.ok(
    assignedAudit.some(
      (a) => a.action === "TASK_ASSIGNED" && a.actorId === "manager",
    ),
  );
  passed(
    "Match selection and task assignment have actor-attributed audit entries",
  );
  const afterAssignment = await stats();
  assert.equal(
    (await request("/api/webhooks/ring", { raw, signature: signed(raw) }))
      .result.duplicate,
    true,
  );
  assert.deepEqual(await stats(), afterAssignment);
  passed("Replay after assignment does not recreate a task or notification");
  const createdAt = Date.now();
  for (const action of ["acknowledge", "start", "complete"])
    assert.equal(
      (
        await request(`/api/tasks/${assigned.result.id}`, {
          data: { action },
          cookie: alexCookie,
        })
      ).status,
      200,
    );
  const received = await prisma.expectedDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  assert.equal(received.status, "RECEIVED");
  assert.ok(received.receivedAt.getTime() >= createdAt);
  assert.ok(received.receivedAt.getTime() <= Date.now());
  assert.equal(
    (
      await prisma.auditLog.findFirstOrThrow({
        where: { taskId: assigned.result.id, action: "DELIVERY_CONFIRMED" },
      })
    ).actorId,
    "alex",
  );
  passed(
    "Employee acknowledgment, start, and confirmation still work with actual timestamps",
  );
  const unknown = await postEvent(
    event({ at, device: "unmapped-fixture-device" }),
  );
  assert.equal(unknown.status, 200);
  assert.equal(
    (
      await prisma.ringEvent.findUniqueOrThrow({
        where: { id: unknown.result.eventId },
      })
    ).matchStatus,
    "UNMATCHED",
  );
  assert.equal(
    await prisma.deliveryCandidate.count({
      where: { eventId: unknown.result.eventId },
    }),
    0,
  );
  passed("Unknown camera activity is retained as unmatched");
  const eastpoint = await prisma.expectedDelivery.findUniqueOrThrow({
    where: { id: "eastpoint" },
  });
  await prisma.expectedDelivery.create({
    data: {
      businessId: "warehouse",
      supplier: "Ambiguity fixture",
      reference: "LOCAL-AMBIGUITY",
      windowStart: eastpoint.windowStart,
      windowEnd: eastpoint.windowEnd,
      locationId: eastpoint.locationId,
      employeeId: "sam",
    },
  });
  const ambiguous = await postEvent(
    event({ at: eastpoint.windowStart.getTime() + 20 * 60000 }),
  );
  const choices = await prisma.deliveryCandidate.findMany({
    where: { eventId: ambiguous.result.eventId },
  });
  assert.equal(choices.length, 2);
  assert.ok(choices.every((c) => !c.selected));
  assert.equal(
    await prisma.receivingTask.count({
      where: { candidateId: { in: choices.map((c) => c.id) } },
    }),
    0,
  );
  passed("Ambiguous matches remain unselected and require manager review");
  const concurrentValue = event({ at, id: "concurrent-http-retries" });
  const responses = await Promise.all([
    postEvent(concurrentValue),
    postEvent(concurrentValue),
  ]);
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(responses[0].result.eventId, responses[1].result.eventId);
  assert.equal(responses.filter((r) => r.result.duplicate).length, 1);
  passed("Concurrent HTTP retries are idempotent");
  const lifecycle = await postEvent(event({ at, type: "device_offline" }));
  assert.equal(lifecycle.status, 200);
  assert.deepEqual(
    await prisma.cameraDevice.findUniqueOrThrow({
      where: { id: originalCamera.id },
    }),
    originalCamera,
  );
  passed(
    "Simulated lifecycle notification cannot change the real-camera fixture's online status",
  );
  const state = await request("/api/state", { cookie: managerCookie });
  assert.ok(
    state.result.events.every((e) => e.source === "SIMULATED_RING_WEBHOOK"),
  );
  assert.equal(
    await prisma.ringEvent.count({ where: { source: "RING_WEBHOOK" } }),
    0,
  );
  assert.equal(await prisma.integrationCheck.count(), 0);
  assert.equal(await prisma.streamSession.count(), 0);
  assert.ok(!JSON.stringify(state.result).includes(signingKey));
  assert.ok(state.result.events.every((e) => !("payload" in e)));
  passed(
    "UI state separates simulated events, omits raw payloads/keys, and records no fake Ring API success",
  );
  assert.deepEqual(
    await prisma.expectedDelivery.findUniqueOrThrow({
      where: { id: sentinel.id },
    }),
    sentinel,
  );
  assert.deepEqual(
    await prisma.employee.findMany({ orderBy: { id: "asc" } }),
    originalEmployees,
  );
  passed("Unrelated existing delivery and employee records remain unchanged");
  report.verified = true;
  report.checksPassed = checks.length;
} catch (error) {
  report.error =
    error instanceof Error ? error.message : "Webhook verification failed.";
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((yes) => server.once("exit", yes));
    server.kill("SIGTERM");
    await Promise.race([exited, delay(3000)]);
    if (server.exitCode === null) {
      server.kill("SIGKILL");
      await exited;
    }
  }
  await prisma.$disconnect();
  await rm(folder, { recursive: true, force: true });
  const json = JSON.stringify(report, null, 2) + "\n";
  const index = process.argv.indexOf("--report");
  if (index !== -1) {
    assert.ok(process.argv[index + 1], "--report requires an output path");
    await writeFile(resolve(process.cwd(), process.argv[index + 1]), json);
  }
  console.log(json);
}
