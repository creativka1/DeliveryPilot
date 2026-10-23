import { db, BUSINESS_ID } from "./db";
import { demoMode, type Actor } from "./auth";
import { zonedISO } from "./utils";
export async function getState(actor: Actor) {
  const [
    business,
    locations,
    employees,
    cameras,
    deliveries,
    events,
    tasks,
    audit,
    notifications,
    checks,
  ] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: BUSINESS_ID } }),
    db.location.findMany({
      where: { businessId: BUSINESS_ID },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      where: { businessId: BUSINESS_ID, archived: false },
      include: { locations: true },
      orderBy: { name: "asc" },
    }),
    db.cameraDevice.findMany({
      where: { businessId: BUSINESS_ID },
      include: { location: true },
    }),
    db.expectedDelivery.findMany({
      where: { businessId: BUSINESS_ID, archived: false },
      include: { location: true, employee: true },
      orderBy: { windowStart: "asc" },
    }),
    db.ringEvent.findMany({
      where: { businessId: BUSINESS_ID },
      include: {
        camera: { include: { location: true } },
        candidates: {
          include: { delivery: true },
          orderBy: [{ score: "desc" }, { id: "asc" }],
        },
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
    db.receivingTask.findMany({
      where: { businessId: BUSINESS_ID },
      include: { delivery: { include: { location: true } }, employee: true },
      orderBy: { assignedAt: "desc" },
    }),
    db.auditLog.findMany({
      where: { businessId: BUSINESS_ID },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1000,
    }),
    db.notification.findMany({
      where: { businessId: BUSINESS_ID, employeeId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.integrationCheck.findMany({
      where: { businessId: BUSINESS_ID },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const now = new Date();
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone }).format(d);
  const today = day(now);
  const tomorrow = new Date(today + "T00:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const [activityCount, suggestionCount, potential] = await Promise.all([
    db.ringEvent.count({ where: { businessId: BUSINESS_ID } }),
    db.ringEvent.count({
      where: { businessId: BUSINESS_ID, matchStatus: "SUGGESTED" },
    }),
    db.ringEvent.count({
      where: {
        businessId: BUSINESS_ID,
        matchStatus: "SUGGESTED",
        receivedAt: {
          gte: new Date(zonedISO(today + "T00:00", business.timezone)),
          lt: new Date(
            zonedISO(
              tomorrow.toISOString().slice(0, 10) + "T00:00",
              business.timezone,
            ),
          ),
        },
      },
    }),
  ]);
  const scheduled = deliveries.filter((d) => day(d.windowStart) === today);
  const todaysTasks = tasks.filter((t) => day(t.assignedAt) === today);
  const mean = (v: number[]) =>
    v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  const metrics = {
    expected: scheduled.length,
    potential,
    activityCount,
    suggestionCount,
    unacknowledged: tasks.filter((t) => t.status === "PENDING").length,
    confirmed: deliveries.filter(
      (d) => d.receivedAt && day(d.receivedAt) === today,
    ).length,
    late: deliveries.filter(
      (d) =>
        d.windowEnd < now &&
        ["EXPECTED", "DELAYED", "POSSIBLE_ARRIVAL"].includes(d.status),
    ).length,
    exceptions: tasks.filter((t) =>
      ["EXCEPTION", "ESCALATED"].includes(t.status),
    ).length,
    avgAcknowledgmentSeconds: mean(
      todaysTasks
        .filter((t) => t.acknowledgedAt)
        .map(
          (t) => (t.acknowledgedAt!.getTime() - t.assignedAt.getTime()) / 1000,
        ),
    ),
    avgReceivingSeconds: mean(
      todaysTasks
        .filter((t) => t.completedAt && t.acknowledgedAt)
        .map(
          (t) =>
            (t.completedAt!.getTime() -
              (t.startedAt ?? t.acknowledgedAt)!.getTime()) /
            1000,
        ),
    ),
  };
  return {
    business,
    locations,
    employees,
    cameras,
    deliveries,
    events: events.map(({ payload, ...e }) => {
      void payload;
      return e;
    }),
    tasks,
    audit,
    notifications,
    checks,
    actor,
    metrics,
    serverTime: now.toISOString(),
    today,
    demoMode: demoMode(),
    integration: {
      configured: Boolean(
        process.env.RING_ACCESS_TOKEN || process.env.RING_REFRESH_TOKEN,
      ),
      mode: process.env.RING_ACCESS_TOKEN
        ? "Playground / access token"
        : process.env.RING_REFRESH_TOKEN
          ? "Partner / refresh token"
          : "Not configured",
      webhookMode:
        process.env.RING_WEBHOOK_MODE === "simulated" ? "simulated" : "partner",
      webhookConfigured: Boolean(
        process.env.RING_WEBHOOK_SIGNING_KEY && process.env.RING_ACCOUNT_ID,
      ),
    },
  };
}
export type Serialized<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;
export type AppState = Serialized<Awaited<ReturnType<typeof getState>>>;
