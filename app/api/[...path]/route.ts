import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db, BUSINESS_ID } from "@/lib/db";
import {
  actorFor,
  demoMode,
  manager,
  sameOrigin,
  signSession,
  checkPassword,
} from "@/lib/auth";
import { AppError, invariant } from "@/lib/errors";
import { getState } from "@/lib/state";
import {
  saveDelivery,
  archiveDelivery,
  saveEmployee,
  linkCandidate,
  actOnTask,
  ingestEvent,
} from "@/lib/workflow";
import { createTestEvent } from "@/lib/demo";
import { audit } from "@/lib/audit";
import {
  discoverDevices,
  deviceHistory,
  ringRequest,
  validateSessionUrl,
  RING_BASE,
} from "@/lib/ring/client";
import { receiveRingWebhook } from "@/lib/ring/webhook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const text = z.string().min(1).max(200);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request) {
  const raw = await request.text();
  invariant(Buffer.byteLength(raw) <= 100000, "Request is too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(400, "Invalid JSON body.");
  }
}
async function handle(request: Request, context: Context) {
  try {
    const segments = (await context.params).path;
    const path = segments.join("/");
    const method = request.method;
    if (path === "webhooks/ring" && method === "POST") {
      const { event, initiator } = await receiveRingWebhook(request);
      return json(await ingestEvent(event, initiator));
    }
    if (method !== "GET") sameOrigin(request);
    if (path === "session" && method === "POST") {
      const p = z
        .object({
          employeeId: text.optional(),
          password: z.string().max(500).optional(),
        })
        .parse(await body(request));
      if (!demoMode()) checkPassword(p.password ?? "");
      const actor = await db.employee.findFirst({
        where: {
          id: demoMode() ? (p.employeeId ?? "manager") : "manager",
          businessId: BUSINESS_ID,
          archived: false,
        },
      });
      invariant(actor, "Employee not found.", 404);
      const response = json({ actor });
      response.cookies.set("dp_session", signSession(actor.id), {
        httpOnly: true,
        sameSite: "strict",
        secure: !demoMode() && process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 8 * 3600,
      });
      return response;
    }
    const actor = await actorFor(request);
    if (path === "state" && method === "GET")
      return json(await getState(actor));
    if (path === "stream" && method === "GET") {
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setInterval> | undefined;
      let stopped = false;
      let busy = false;
      let revision = "";
      let ticks = 0;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode("retry: 2000\nevent: ready\ndata: {}\n\n"),
          );
          timer = setInterval(async () => {
            if (stopped || busy) return;
            busy = true;
            try {
              const last = await db.auditLog.count({
                where: { businessId: BUSINESS_ID },
              });
              const current = String(last);
              if (revision !== current) {
                revision = current;
                controller.enqueue(
                  encoder.encode(
                    `event: change\ndata: ${JSON.stringify({ revision })}\n\n`,
                  ),
                );
              } else if (++ticks % 15 === 0)
                controller.enqueue(encoder.encode(": heartbeat\n\n"));
            } catch {
              if (!stopped) {
                controller.enqueue(
                  encoder.encode("event: retry\ndata: {}\n\n"),
                );
              }
            } finally {
              busy = false;
            }
          }, 1000);
          request.signal.addEventListener("abort", () => {
            stopped = true;
            if (timer) clearInterval(timer);
            try {
              controller.close();
            } catch {}
          });
        },
        cancel() {
          stopped = true;
          if (timer) clearInterval(timer);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (segments[0] === "deliveries") {
      if (method === "POST" && segments.length === 1)
        return json(await saveDelivery(actor, await body(request)), 201);
      if (method === "PATCH" && segments.length === 2)
        return json(
          await saveDelivery(actor, await body(request), segments[1]),
        );
      if (method === "DELETE" && segments.length === 2) {
        await archiveDelivery(actor, segments[1]);
        return json({ success: true });
      }
    }
    if (segments[0] === "employees") {
      if (method === "POST" && segments.length === 1)
        return json(await saveEmployee(actor, await body(request)), 201);
      if (method === "PATCH" && segments.length === 2)
        return json(
          await saveEmployee(actor, await body(request), segments[1]),
        );
    }
    if (path === "test-events" && method === "POST")
      return json(await createTestEvent(actor, await body(request)), 201);
    if (
      segments[0] === "candidates" &&
      segments[2] === "link" &&
      method === "POST"
    )
      return json(await linkCandidate(actor, segments[1]), 201);
    if (segments[0] === "tasks" && segments.length === 2 && method === "POST")
      return json(
        await actOnTask(
          actor,
          segments[1],
          z
            .object({
              action: z.enum([
                "acknowledge",
                "start",
                "complete",
                "exception",
                "escalate",
                "resolve",
                "reassign",
              ]),
              issue: z.string().max(2000).optional(),
              employeeId: text.optional(),
            })
            .parse(await body(request)),
        ),
      );
    if (path === "notifications/read" && method === "POST") {
      await db.notification.updateMany({
        where: { employeeId: actor.id, businessId: BUSINESS_ID, readAt: null },
        data: { readAt: new Date() },
      });
      return json({ success: true });
    }
    if (path === "locations" && method === "POST") {
      manager(actor);
      const p = z
        .object({ name: z.string().trim().min(1).max(100) })
        .parse(await body(request));
      const location = await db.$transaction(async (tx) => {
        const l = await tx.location.create({
          data: { businessId: BUSINESS_ID, ...p },
        });
        await audit(
          tx,
          actor,
          "LOCATION_CREATED",
          `Created receiving location ${p.name}.`,
        );
        return l;
      });
      return json(location, 201);
    }
    if (path === "settings" && method === "PATCH") {
      manager(actor);
      const p = z
        .object({
          timezone: z.string().max(100),
          notificationsEnabled: z.boolean(),
          acknowledgmentMinutes: z.number().int().min(1).max(120),
        })
        .parse(await body(request));
      try {
        new Intl.DateTimeFormat("en", { timeZone: p.timezone });
      } catch {
        throw new AppError(400, "Choose a valid IANA time zone.");
      }
      return json(
        await db.$transaction(async (tx) => {
          const b = await tx.business.update({
            where: { id: BUSINESS_ID },
            data: p,
          });
          await audit(
            tx,
            actor,
            "SETTINGS_UPDATED",
            "Updated notification rules and business time zone.",
          );
          return b;
        }),
      );
    }
    if (
      segments[0] === "cameras" &&
      segments.length === 2 &&
      method === "PATCH"
    ) {
      manager(actor);
      const p = z
        .object({ locationId: text.nullable() })
        .parse(await body(request));
      invariant(
        await db.cameraDevice.findFirst({
          where: { id: segments[1], businessId: BUSINESS_ID },
        }),
        "Camera not found.",
        404,
      );
      if (p.locationId)
        invariant(
          await db.location.findFirst({
            where: { id: p.locationId, businessId: BUSINESS_ID },
          }),
          "Location not found.",
        );
      return json(
        await db.$transaction(async (tx) => {
          const c = await tx.cameraDevice.update({
            where: { id: segments[1] },
            data: p,
          });
          await audit(
            tx,
            actor,
            "CAMERA_MAPPED",
            `Mapped ${c.name} to ${p.locationId ?? "no receiving location"}.`,
          );
          return c;
        }),
      );
    }
    if (path === "ring/connect" && method === "POST") {
      manager(actor);
      try {
        const result = await discoverDevices();
        await db.$transaction(async (tx) => {
          for (const d of result.devices)
            await tx.cameraDevice.upsert({
              where: { externalId: d.externalId },
              create: {
                businessId: BUSINESS_ID,
                source: "RING_API",
                externalId: d.externalId,
                name: d.name,
                online: d.online,
                supportsVideo: d.supportsVideo,
                lastSeenAt: new Date(),
              },
              update: {
                name: d.name,
                online: d.online,
                supportsVideo: d.supportsVideo,
                lastSeenAt: new Date(),
              },
            });
          await tx.integrationCheck.create({
            data: {
              businessId: BUSINESS_ID,
              endpoint: "GET /v1/devices",
              status: result.httpStatus,
              success: true,
              message: `Verified live response: ${result.devices.length} devices returned.`,
            },
          });
          await audit(
            tx,
            actor,
            "RING_CONNECTED",
            `Real Ring API discovery succeeded (HTTP ${result.httpStatus}); ${result.devices.length} devices returned.`,
            "RING_API",
          );
        });
        return json(result);
      } catch (e) {
        await db.integrationCheck.create({
          data: {
            businessId: BUSINESS_ID,
            endpoint: "GET /v1/devices",
            success: false,
            status: e instanceof AppError ? e.status : null,
            message:
              e instanceof AppError ? e.message : "Ring discovery failed.",
          },
        });
        throw e;
      }
    }
    if (path === "ring/history" && method === "GET") {
      const id = new URL(request.url).searchParams.get("deviceId");
      invariant(id, "Choose a Ring device.");
      invariant(
        await db.cameraDevice.findFirst({
          where: {
            externalId: id!,
            businessId: BUSINESS_ID,
            source: "RING_API",
          },
        }),
        "Discover this Ring device first.",
        404,
      );
      return json(await deviceHistory(id!));
    }
    if (path === "ring/stream" && method === "POST") {
      const p = z
        .object({ deviceId: text, sdpOffer: z.string().min(20).max(60000) })
        .parse(await body(request));
      const d = await db.cameraDevice.findFirst({
        where: {
          externalId: p.deviceId,
          businessId: BUSINESS_ID,
          source: "RING_API",
        },
      });
      invariant(
        d?.supportsVideo,
        "Select a discovered device with video capability.",
      );
      const r = await ringRequest(
        `/v1/devices/${encodeURIComponent(p.deviceId)}/media/streaming/whep/sessions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: p.sdpOffer,
        },
      );
      invariant(r.status === 201, "Ring did not create a WHEP session.", 502);
      const answer = await r.text();
      invariant(
        answer.startsWith("v=0"),
        "Ring returned an invalid SDP answer.",
        502,
      );
      const url = r.headers.get("location");
      invariant(url, "Ring did not return a WHEP session URL.", 502);
      validateSessionUrl(url!, p.deviceId);
      const session = await db.streamSession.create({
        data: {
          employeeId: actor.id,
          deviceId: p.deviceId,
          upstreamUrl: new URL(url!, RING_BASE).href,
        },
      });
      await db.$transaction((tx) =>
        audit(
          tx,
          actor,
          "RING_STREAM_STARTED",
          `Real WHEP session created (HTTP 201) for ${d.name}. Video is not stored.`,
          "RING_API",
        ),
      );
      return json({
        sdpAnswer: answer,
        sessionId: session.id,
        source: "RING_API",
        httpStatus: r.status,
      });
    }
    if (path === "ring/stream" && method === "DELETE") {
      const p = z.object({ sessionId: text }).parse(await body(request));
      const session = await db.streamSession.findUnique({
        where: { id: p.sessionId },
      });
      if (!session) return json({ success: true });
      invariant(
        actor.id === session.employeeId || actor.role === "MANAGER",
        "This stream belongs to another employee.",
        403,
      );
      const age = Date.now() - session.createdAt.getTime();
      if (age < 120000) {
        try {
          await ringRequest(
            validateSessionUrl(session.upstreamUrl, session.deviceId),
            { method: "DELETE" },
          );
        } catch (e) {
          if (age < 60000) throw e;
        }
      }
      await db.streamSession.delete({ where: { id: session.id } });
      return json({ success: true });
    }
    throw new AppError(404, "API route not found.");
  } catch (error) {
    if (error instanceof ZodError)
      return json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".") || "Input"}: ${i.message}`)
            .join("; "),
          code: "VALIDATION",
        },
        400,
      );
    if (error instanceof AppError)
      return json({ error: error.message, code: error.code }, error.status);
    // Do not reflect upstream bodies, request data, or credentials into errors or logs.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      return json(
        {
          error:
            "This record already exists or was changed by another request.",
          code: "CONFLICT",
        },
        409,
      );
    console.error("DeliveryPilot request failed", {
      kind: error instanceof Error ? error.name : "Unknown",
    });
    return json(
      {
        error: "The request could not be completed. Please retry.",
        code: "INTERNAL_ERROR",
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
