import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifySignature,
  ringEventAdapter,
  localEventAdapter,
} from "../lib/ring/events";
import {
  ringRequest,
  validateSessionUrl,
  discoverDevices,
} from "../lib/ring/client";
import { getAccessToken, clearTokenCache } from "../lib/ring/auth";
const raw = Buffer.from('{ "meta": {"request_id":"request-1"} }');
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearTokenCache();
});
describe("documented Ring HMAC and normalization", () => {
  it("accepts the documented raw body hex HMAC", () => {
    const sig = createHmac("sha256", "key").update(raw).digest("hex");
    expect(verifySignature(raw, "sha256=" + sig, "key")).toBe(true);
  });
  it("rejects modified raw bytes", () => {
    const sig = createHmac("sha256", "key").update(raw).digest("hex");
    expect(
      verifySignature(
        Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),
        sig,
        "key",
      ),
    ).toBe(false);
  });
  it.each(["", "sha256=no", "00", "g".repeat(64)])(
    "rejects malformed signatures without throwing (%s)",
    (sig) => expect(verifySignature(raw, sig, "key")).toBe(false),
  );
  it("rejects incorrect signing keys", () =>
    expect(
      verifySignature(
        raw,
        createHmac("sha256", "wrong").update(raw).digest("hex"),
        "key",
      ),
    ).toBe(false));
  const p = {
    meta: {
      version: "1.1",
      time: "2026-10-20T09:20:00Z",
      request_id: "ring-1",
      account_id: "account",
    },
    data: {
      id: "event",
      type: "motion_detected",
      attributes: {
        source: "ring-camera",
        source_type: "devices",
        timestamp: 1792488000000,
      },
    },
  };
  it("preserves authentic webhook provenance", () =>
    expect(ringEventAdapter.normalize(p)).toMatchObject({
      source: "RING_WEBHOOK",
      deviceId: "ring-camera",
      requestId: "ring-1",
      type: "motion_detected",
    }));
  it("supports documented button_press", () =>
    expect(
      ringEventAdapter.normalize({
        ...p,
        data: { ...p.data, type: "button_press" },
      }).type,
    ).toBe("button_press"));
  it("rejects invented delivery event types", () =>
    expect(() =>
      ringEventAdapter.normalize({
        ...p,
        data: { ...p.data, type: "package_delivered" },
      }),
    ).toThrow());
  it("rejects a webhook for a different partner account", () => {
    vi.stubEnv("RING_ACCOUNT_ID", "different");
    expect(() => ringEventAdapter.normalize(p)).toThrow("not linked");
  });
  it("local adapter can never produce Ring provenance", () =>
    expect(
      localEventAdapter.normalize({
        requestId: "a",
        deviceId: "b",
        type: "motion_detected",
        occurredAt: new Date(),
        scenario: "standard",
      }).source,
    ).toBe("LOCAL_TEST"));
});
describe("Ring connection reliability and token privacy", () => {
  it("requires a configured token", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "");
    vi.stubEnv("RING_REFRESH_TOKEN", "");
    await expect(getAccessToken()).rejects.toMatchObject({
      code: "RING_NOT_CONFIGURED",
    });
  });
  it("rejects conflicting auth modes", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "one");
    vi.stubEnv("RING_REFRESH_TOKEN", "two");
    await expect(getAccessToken()).rejects.toThrow("only one");
  });
  it("handles an expired Playground token without returning upstream secrets", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "super-secret");
    vi.stubEnv("RING_REFRESH_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("super-secret echoed", { status: 401 }),
        ),
    );
    await expect(ringRequest("/v1/devices")).rejects.toMatchObject({
      status: 401,
      code: "RING_TOKEN_EXPIRED",
    });
  });
  it("handles network failures safely", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "secret");
    vi.stubEnv("RING_REFRESH_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret network debug")),
    );
    await expect(ringRequest("/v1/devices")).rejects.toMatchObject({
      code: "RING_NETWORK",
      message: "The Ring API is unreachable or timed out.",
    });
  });
  it("handles upstream API errors without reflecting response bodies", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "secret");
    vi.stubEnv("RING_REFRESH_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("private token secret", { status: 500 }),
        ),
    );
    await expect(ringRequest("/v1/devices")).rejects.toMatchObject({
      message: "Ring API returned HTTP 500.",
    });
  });
  it("renews and caches a partner token using the documented OAuth endpoint", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "");
    vi.stubEnv("RING_REFRESH_TOKEN", "refresh");
    vi.stubEnv("RING_CLIENT_ID", "id");
    vi.stubEnv("RING_CLIENT_SECRET", "secret");
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ access_token: "renewed", expires_in: 3600 }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await getAccessToken()).toBe("renewed");
    expect(await getAccessToken()).toBe("renewed");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://oauth.ring.com/oauth/token");
  });
  it("reports OAuth refresh failures safely", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "");
    vi.stubEnv("RING_REFRESH_TOKEN", "refresh");
    vi.stubEnv("RING_CLIENT_ID", "id");
    vi.stubEnv("RING_CLIENT_SECRET", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("sensitive", { status: 401 })),
    );
    await expect(getAccessToken()).rejects.toMatchObject({
      code: "RING_TOKEN_EXPIRED",
    });
  });
  it("normalizes real-shaped JSON API devices with actual capability calls", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "secret");
    vi.stubEnv("RING_REFRESH_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/status")
          ? Response.json({ data: { id: "s", attributes: { online: true } } })
          : url.endsWith("/capabilities")
            ? Response.json({
                data: { id: "c", attributes: { video: { codecs: ["H264"] } } },
              })
            : Response.json({
                data: [
                  {
                    id: "device",
                    type: "devices",
                    attributes: { name: "Package sample" },
                  },
                ],
              }),
      ),
    );
    const r = await discoverDevices();
    expect(r.devices[0]).toMatchObject({
      name: "Package sample",
      online: true,
      supportsVideo: true,
    });
  });
  it("never converts a missing status into a false offline claim", async () => {
    vi.stubEnv("RING_ACCESS_TOKEN", "secret");
    vi.stubEnv("RING_REFRESH_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/devices")
          ? Response.json({
              data: [{ id: "device", attributes: { name: "Camera" } }],
            })
          : new Response("", { status: 403 }),
      ),
    );
    const r = await discoverDevices();
    expect(r.devices[0].online).toBeNull();
    expect(r.devices[0].warnings).toHaveLength(2);
  });
  it("rejects a forged upstream WHEP URL (SSRF)", () =>
    expect(() =>
      validateSessionUrl(
        "https://evil.example/v1/devices/device/media/streaming/whep/sessions/123",
        "device",
      ),
    ).toThrow());
  it("accepts only the selected device session URL", () =>
    expect(
      validateSessionUrl(
        "https://api.amazonvision.com/v1/devices/device/media/streaming/whep/sessions/123",
        "device",
      ),
    ).toBe("/v1/devices/device/media/streaming/whep/sessions/123"));
  it.each([
    "https://api.amazonvision.com/v1/devices/device/media/streaming/whep/sessions/123?token=a%2Bb&component_id=1",
    "/v1/devices/device/media/streaming/whep/sessions/123?token=a%2Bb&component_id=1",
  ])("preserves valid session query parameters (%s)", (url) => {
    expect(validateSessionUrl(url, "device")).toBe(
      "/v1/devices/device/media/streaming/whep/sessions/123?token=a%2Bb&component_id=1",
    );
  });
  it.each([
    "https://api.amazonvision.com/v1/devices/device/media/streaming/whep/sessions/123?token=ok#fragment",
    "https://api.amazonvision.com/v1/devices/device/media/streaming/whep/sessions/?token=ok",
    "https://api.amazonvision.com/v1/devices/device/media/streaming/whep/sessions/123/extra?token=ok",
    "https://api.amazonvision.com.evil.example/v1/devices/device/media/streaming/whep/sessions/123?token=ok",
  ])(
    "retains strict host/path/fragment validation with query strings (%s)",
    (url) => {
      expect(() => validateSessionUrl(url, "device")).toThrow();
    },
  );
  it("rejects another device session URL", () =>
    expect(() =>
      validateSessionUrl(
        "https://api.amazonvision.com/v1/devices/other/media/streaming/whep/sessions/123",
        "device",
      ),
    ).toThrow());
});
