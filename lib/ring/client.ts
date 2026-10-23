import { z } from "zod";
import { getAccessToken, clearTokenCache } from "./auth";
import { AppError, invariant } from "../errors";
export const RING_BASE = "https://api.amazonvision.com";
export async function ringRequest(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  invariant(
    path.startsWith("/v1/") && !path.includes("://"),
    "Invalid Ring API path.",
  );
  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(RING_BASE + path, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AppError(
      502,
      "The Ring API is unreachable or timed out.",
      "RING_NETWORK",
    );
  }
  if (response.status === 401) {
    if (process.env.RING_REFRESH_TOKEN && retry) {
      clearTokenCache();
      return ringRequest(path, init, false);
    }
    throw new AppError(
      401,
      "Ring rejected the token. Generate a fresh Playground token, update .env.local, and restart.",
      "RING_TOKEN_EXPIRED",
    );
  }
  if (!response.ok)
    throw new AppError(
      response.status === 429 ? 429 : 502,
      `Ring API returned HTTP ${response.status}${response.status === 403 ? " (check partner permissions)" : ""}.`,
      "RING_API_ERROR",
    );
  return response;
}
const resource = z.object({
  id: z.string(),
  type: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
  relationships: z.record(z.unknown()).optional(),
});
export async function discoverDevices() {
  const response = await ringRequest("/v1/devices");
  const parsed = z
    .object({ data: z.array(resource) })
    .safeParse(await response.json());
  if (!parsed.success)
    throw new AppError(
      502,
      "Ring device discovery returned an unexpected JSON:API shape.",
    );
  const devices = await Promise.all(
    parsed.data.data.map(async (d) => {
      const read = async (
        kind: string,
      ): Promise<{
        attributes: Record<string, unknown>;
        error: string | null;
      }> => {
        try {
          const r = await ringRequest(
            `/v1/devices/${encodeURIComponent(d.id)}/${kind}`,
          );
          const p = z.object({ data: resource }).safeParse(await r.json());
          return p.success
            ? { attributes: p.data.data.attributes ?? {}, error: null }
            : { attributes: {}, error: "Unexpected response" };
        } catch (e) {
          return {
            attributes: {},
            error: e instanceof AppError ? e.message : "Unavailable",
          };
        }
      };
      const [status, capabilities] = await Promise.all([
        read("status"),
        read("capabilities"),
      ]);
      const video = capabilities.attributes.video as
        | {
            codecs?: unknown;
            supported_resolutions?: unknown;
            configurations?: unknown;
          }
        | null
        | undefined;
      const supportsVideo = Boolean(
        video &&
        (video.codecs || video.supported_resolutions || video.configurations),
      );
      return {
        externalId: d.id,
        name:
          typeof d.attributes?.name === "string"
            ? d.attributes.name
            : "Ring device",
        online:
          typeof status.attributes.online === "boolean"
            ? status.attributes.online
            : null,
        supportsVideo,
        status: status.attributes,
        capabilities: capabilities.attributes,
        warnings: [status.error, capabilities.error].filter(Boolean),
      };
    }),
  );
  return { devices, httpStatus: response.status };
}
export async function deviceHistory(deviceId: string) {
  const r = await ringRequest(
    `/v1/history/devices/${encodeURIComponent(deviceId)}/events`,
  );
  return {
    source: "RING_API_HISTORY",
    httpStatus: r.status,
    data: await r.json(),
  };
}
export function validateSessionUrl(url: string, deviceId: string) {
  // Keep this check strict: an upstream Location is untrusted and could
  // otherwise cause server-side requests to an attacker-controlled address.
  // Report only validation *categories*: never log the URL or session ID.
  let u: URL;
  try {
    u = new URL(url, RING_BASE);
  } catch {
    throw new AppError(
      502,
      "Ring session Location could not be parsed (invalid URL syntax).",
      "RING_SESSION_URL_INVALID",
    );
  }
  const prefix =
    `/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions/`;
  const issues: string[] = [];
  if (u.origin !== RING_BASE) issues.push("unexpected origin");
  if (u.username || u.password) issues.push("embedded credentials");
  // Ring may return a session-specific query string in Location.
  // Preserve it when deleting the session, after validating the fixed Ring host and path.
  if (u.hash) issues.push("fragment present");
  if (!u.pathname.startsWith(prefix)) {
    issues.push("session path/device mismatch");
  } else {
    const sessionId = u.pathname.slice(prefix.length);
    if (!sessionId || sessionId.includes("/"))
      issues.push("missing or invalid session ID segment");
  }
  if (issues.length)
    throw new AppError(
      502,
      `Ring returned an invalid session URL (${issues.join(", ")}).`,
      "RING_SESSION_URL_INVALID",
    );
  return u.pathname + u.search;
}
