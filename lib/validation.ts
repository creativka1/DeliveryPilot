import { z } from "zod";
const text = z.string().trim().min(1).max(160);
export const deliveryInput = z
  .object({
    supplier: text,
    reference: text,
    windowStart: z.string().datetime({ offset: true }),
    windowEnd: z.string().datetime({ offset: true }),
    locationId: text,
    employeeId: text.nullable().default(null),
    notes: z.string().trim().max(2000).default(""),
  })
  .refine((d) => new Date(d.windowEnd) > new Date(d.windowStart), {
    message: "The end of the window must follow the start.",
    path: ["windowEnd"],
  })
  .refine(
    (d) =>
      new Date(d.windowEnd).getTime() - new Date(d.windowStart).getTime() <=
      86400000,
    {
      message: "Use a delivery window of no more than 24 hours.",
      path: ["windowEnd"],
    },
  );
export const employeeInput = z.object({
  name: text,
  role: z.enum(["RECEIVER", "MANAGER"]).default("RECEIVER"),
  available: z.boolean().default(true),
  locationIds: z.array(text).min(1).max(30),
});
export const localEventInput = z.object({
  cameraId: text,
  type: z.enum(["motion_detected", "button_press"]).default("motion_detected"),
  occurredAt: z.string().datetime({ offset: true }),
  requestId: z.string().trim().min(1).max(120).optional(),
  scenario: z
    .enum([
      "standard",
      "unmatched",
      "ambiguous",
      "late",
      "unavailable",
      "duplicate",
    ])
    .default("standard"),
});
export const internalEvent = z.object({
  source: z.enum(["RING_WEBHOOK", "SIMULATED_RING_WEBHOOK", "LOCAL_TEST"]),
  requestId: text,
  deviceId: text,
  type: text,
  occurredAt: z.coerce.date(),
  payload: z.string().max(100000),
  summary: z.string().max(500),
});
export type InternalEvent = z.infer<typeof internalEvent>;
export const webhookInput = z.object({
  meta: z.object({
    version: z.literal("1.1"),
    time: z.string().datetime({ offset: true }),
    request_id: text,
    account_id: text,
  }),
  data: z.object({
    id: text,
    type: z.enum([
      "motion_detected",
      "button_press",
      "device_added",
      "device_removed",
      "device_online",
      "device_offline",
      "app_integration_added",
      "app_integration_removed",
      "subscription_activated",
      "subscription_deactivated",
    ]),
    attributes: z
      .object({
        source: text,
        source_type: z.string().optional(),
        timestamp: z.union([z.number().nonnegative(), z.string()]).optional(),
      })
      .passthrough(),
  }),
});
