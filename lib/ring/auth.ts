// Adapted from AmazonAppDev/ring-api-helloworld lib/auth.ts (MIT).
// See docs/AMAZON-STARTER-LICENSE.txt and THIRD_PARTY_NOTICES.md.
import { AppError } from "../errors";
import { z } from "zod";
let cached: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<string> | null = null;
export function clearTokenCache() {
  cached = null;
}
export async function getAccessToken(): Promise<string> {
  if (process.env.RING_ACCESS_TOKEN && process.env.RING_REFRESH_TOKEN)
    throw new AppError(503, "Use only one Ring token mode.", "CONFIGURATION");
  if (process.env.RING_ACCESS_TOKEN) return process.env.RING_ACCESS_TOKEN;
  if (!process.env.RING_REFRESH_TOKEN)
    throw new AppError(
      503,
      "Set RING_ACCESS_TOKEN in .env.local using the Ring Developer Playground, then restart.",
      "RING_NOT_CONFIGURED",
    );
  if (!process.env.RING_CLIENT_ID || !process.env.RING_CLIENT_SECRET)
    throw new AppError(
      503,
      "Refresh mode requires RING_CLIENT_ID and RING_CLIENT_SECRET.",
      "CONFIGURATION",
    );
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    let response: Response;
    try {
      response = await fetch("https://oauth.ring.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: process.env.RING_REFRESH_TOKEN!,
          client_id: process.env.RING_CLIENT_ID!,
          client_secret: process.env.RING_CLIENT_SECRET!,
        }),
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
    } catch {
      throw new AppError(502, "Ring OAuth is unreachable.", "RING_NETWORK");
    }
    if (!response.ok)
      throw new AppError(
        502,
        `Ring token refresh failed (HTTP ${response.status}). Relink the partner account if the refresh token was revoked.`,
        "RING_TOKEN_EXPIRED",
      );
    const data = z
      .object({
        access_token: z.string().min(1),
        expires_in: z.number().positive(),
      })
      .safeParse(await response.json());
    if (!data.success)
      throw new AppError(502, "Ring OAuth returned an unexpected response.");
    cached = {
      token: data.data.access_token,
      expiresAt: Date.now() + Math.max(0, data.data.expires_in - 60) * 1000,
    };
    return cached.token;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
