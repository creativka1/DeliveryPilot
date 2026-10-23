import { createHmac, timingSafeEqual } from "node:crypto";
import { webhookInput, internalEvent, type InternalEvent } from "../validation";
import { invariant } from "../errors";
export interface EventAdapter<T> {
  normalize(input: T): InternalEvent;
}
export function verifySignature(raw: Buffer, signature: string, key: string) {
  const hex = signature.replace(/^sha256=/, "");
  if (!/^[a-fA-F0-9]{64}$/.test(hex) || !key) return false;
  const expected = createHmac("sha256", key).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(hex, "hex"));
}
function normalizeRingEvent(
  input: unknown,
  source: "RING_WEBHOOK" | "SIMULATED_RING_WEBHOOK",
  accountId: string | undefined,
) {
  const p = webhookInput.parse(input);
  if (accountId)
    invariant(
      p.meta.account_id === accountId,
      "Webhook account is not linked to this business.",
      403,
    );
  const ts = p.data.attributes.timestamp;
  const occurredAt =
    ts === undefined
      ? new Date(p.meta.time)
      : typeof ts === "number" || /^\d+$/.test(ts)
        ? new Date(Number(ts))
        : new Date(ts);
  invariant(
    Number.isFinite(occurredAt.getTime()),
    "Invalid Ring event timestamp.",
  );
  return internalEvent.parse({
    source,
    requestId: p.meta.request_id,
    deviceId: p.data.attributes.source,
    type: p.data.type,
    occurredAt,
    payload: JSON.stringify(p),
    summary:
      source === "SIMULATED_RING_WEBHOOK"
        ? `Correctly signed simulated ${p.data.type.replaceAll("_", " ")}. Generated locally; not a real Ring notification or video detection.`
        : `Signed Ring ${p.data.type.replaceAll("_", " ")}. No delivery or supplier identity is inferred from video.`,
  });
}
export const ringEventAdapter: EventAdapter<unknown> = {
  normalize(input) {
    return normalizeRingEvent(
      input,
      "RING_WEBHOOK",
      process.env.RING_ACCOUNT_ID,
    );
  },
};
export const simulatedRingEventAdapter: EventAdapter<unknown> = {
  normalize(input) {
    return normalizeRingEvent(
      input,
      "SIMULATED_RING_WEBHOOK",
      process.env.RING_SIMULATED_ACCOUNT_ID,
    );
  },
};
export const localEventAdapter: EventAdapter<{
  requestId: string;
  deviceId: string;
  type: string;
  occurredAt: Date;
  scenario: string;
}> = {
  normalize(input) {
    return internalEvent.parse({
      source: "LOCAL_TEST",
      ...input,
      payload: JSON.stringify(input),
      summary: `Manually generated local test (${input.scenario}). This is not a Ring webhook or video detection.`,
    });
  },
};
