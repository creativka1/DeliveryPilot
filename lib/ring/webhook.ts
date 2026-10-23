import { AppError, invariant } from "../errors";
import { demoMode } from "../auth";
import { systemActor } from "../audit";
import {
  verifySignature,
  ringEventAdapter,
  simulatedRingEventAdapter,
} from "./events";

// The server configuration selects provenance. Neither headers nor payload
// fields can turn generated test input into an authenticated partner event.
export async function receiveRingWebhook(request: Request) {
  const mode = process.env.RING_WEBHOOK_MODE || "partner";
  invariant(
    mode === "partner" || mode === "simulated",
    "Invalid RING_WEBHOOK_MODE. Use partner or simulated.",
    503,
  );
  const simulated = mode === "simulated";
  invariant(
    !simulated || demoMode(),
    "Signed webhook simulation requires DEMO_MODE=true.",
    403,
  );
  const key = simulated
    ? process.env.RING_SIMULATED_WEBHOOK_SIGNING_KEY
    : process.env.RING_WEBHOOK_SIGNING_KEY;
  const accountId = simulated
    ? process.env.RING_SIMULATED_ACCOUNT_ID
    : process.env.RING_ACCOUNT_ID;
  invariant(
    key && accountId,
    simulated
      ? "Simulated webhook signing key and account ID are not configured."
      : "Webhook signing key and account ID are not configured.",
    503,
  );
  // A development key must never also authenticate the real partner route.
  invariant(
    !simulated || key !== process.env.RING_WEBHOOK_SIGNING_KEY,
    "Use a separate simulated webhook signing key, distinct from the partner key.",
    503,
  );
  invariant(
    (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase() === "application/json",
    "Expected application/json.",
    415,
  );
  const raw = Buffer.from(await request.arrayBuffer());
  invariant(raw.length <= 100000, "Webhook is too large.", 413);
  invariant(
    verifySignature(raw, request.headers.get("x-signature") ?? "", key!),
    "Invalid Ring signature.",
    401,
  );
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid webhook JSON.");
  }
  return {
    event: (simulated ? simulatedRingEventAdapter : ringEventAdapter).normalize(
      payload,
    ),
    initiator: simulated
      ? { id: "system:ring-simulation", name: "Signed webhook simulator" }
      : systemActor,
  };
}
