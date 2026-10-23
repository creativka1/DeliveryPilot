import { createHmac, timingSafeEqual } from "node:crypto";
import { db, BUSINESS_ID } from "./db";
import { AppError, invariant } from "./errors";
export const demoMode = () => process.env.DEMO_MODE === "true";
function key() {
  const s = process.env.APP_SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (demoMode()) return "deliverypilot-local-demo-only-secret-do-not-deploy";
  throw new AppError(
    503,
    "Configure APP_SESSION_SECRET with at least 32 characters.",
  );
}
export function signSession(id: string) {
  const data = Buffer.from(
    JSON.stringify({ id, exp: Date.now() + 8 * 3600000 }),
  ).toString("base64url");
  return data + "." + createHmac("sha256", key()).update(data).digest("hex");
}
export function readSession(cookie: string | null) {
  const raw = cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("dp_session="))
    ?.slice(11);
  if (!raw) return null;
  const [data, sig] = raw.split(".");
  if (!data || !sig || !/^[a-f0-9]{64}$/.test(sig)) return null;
  const expected = createHmac("sha256", key()).update(data).digest("hex");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString());
    return typeof p.id === "string" && p.exp > Date.now() ? p.id : null;
  } catch {
    return null;
  }
}
export async function actorFor(request: Request) {
  const id =
    readSession(request.headers.get("cookie")) ??
    (demoMode() ? "manager" : null);
  if (!id)
    throw new AppError(401, "Sign in to this workspace.", "UNAUTHORIZED");
  const actor = await db.employee.findFirst({
    where: { id, businessId: BUSINESS_ID, archived: false },
  });
  if (!actor)
    throw new AppError(401, "The employee session is no longer valid.");
  return actor;
}
export type Actor = Awaited<ReturnType<typeof actorFor>>;
export function manager(actor: Actor) {
  invariant(
    actor.role === "MANAGER",
    "A manager must perform this action.",
    403,
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    const allowed = new URL(request.url).origin;
    const configured = process.env.APP_ORIGIN;
    invariant(
      origin === allowed || origin === configured,
      "Cross-origin mutations are not allowed.",
      403,
    );
  }
}
export function checkPassword(provided: string) {
  const expected = process.env.APP_ADMIN_PASSWORD;
  invariant(
    expected && expected.length >= 12,
    "Configure APP_ADMIN_PASSWORD (12+ characters) before disabling demo mode.",
    503,
  );
  const a = Buffer.from(provided),
    b = Buffer.from(expected);
  invariant(
    a.length === b.length && timingSafeEqual(a, b),
    "Invalid workspace password.",
    401,
  );
}
