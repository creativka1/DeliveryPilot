# Original-build validation — 2026-10-20

**Historical report:** the results below describe the original build. The supplied latest working version subsequently gained successful Playground playback and session URL/ICE fixes, as reported by the owner. Current signed-webhook verification: **108 tests and 20 real-HTTP checks passed**, with protected files preserved. See [WEBHOOK_VERIFICATION.md](WEBHOOK_VERIFICATION.md).

## Automated checks

| Check                               | Observed result                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run typecheck`                 | Passed                                                                                         |
| `npm run lint`                      | Passed, no warnings                                                                            |
| `npm test`                          | **80 passed across 4 files**                                                                   |
| `npm run build`                     | Passed; Next.js 16.4.2 production app compiled and routes generated                            |
| Initial checked-in SQLite migration | Applied successfully using the migration wrapper                                               |
| Repeatable seed                     | Fresh database and repeated seed verified separately; no receipt timestamps are seeded         |
| `npm run ring:verify`               | Executed; failed safely before an upstream request because no Ring token was configured        |
| `npm run test:e2e`                  | Attempted; browser launch blocked by missing Chromium executable after browser download failed |

Test breakdown:

- 17 schedule matching and timezone tests.
- 24 Ring adapter, raw HMAC, token, expiry/network failure, device response, and WHEP URL-boundary tests.
- 17 persistent workflow/session/authorization tests, including unavailable employees, ambiguity, duplicate races, audit attribution, receipt timestamps, exceptions, reassignment, and stale mapping rejection.
- 22 actual HTTP handler contract tests, including request validation, roles, origin checks, signed contract fixtures, duplicate webhook handling, lifecycle events, persistent connection checks, and a streamed database revision.

Ring HTTP responses in automated tests are **mocked fixtures**. Signed webhook fixtures use test signing keys against an isolated test database. They are not captured authentic Ring notifications and do not prove a live integration.

## Browser verification executed against the production preview

The available browser, using its Playwright locator interface, verified:

1. Dashboard renders the three expected deliveries and data-derived zero receipt count.
2. Delivery creation, exact accessible form labels, assigned employee, persisted search result.
3. Delivery editing and removal from the schedule while retaining history.
4. A labeled local motion event at Entrance A, 14:20, matches Northline with entrance/time explanations and unverified-identity disclosure.
5. Manager selection creates a task assigned to Alex.
6. Switching the explicitly labeled demo actor to Alex shows the correct in-app task notification.
7. Alex acknowledges, starts receiving, and confirms receipt.
8. Receipt completion survives browser reload.
9. Overview recalculates confirmed receipts and actual acknowledgment/receiving durations.
10. Employee creation succeeds.
11. Ring verification without credentials shows actionable configuration feedback and no false success.
12. A delivery created in a second browser tab appears in the original open Deliveries view through SSE, without a page reload.
13. Light/dark mode toggles; dark theme was checked with rendered colors and screenshot inspection.

The default Next.js development preview encountered an environment memory-diagnostics error. A built **production** Next.js server was successfully run under the supplied preview supervisor for the browser checks. The final `dev` script uses normal Next.js development behavior; `npm start` runs the production app locally. No public deployment occurred.

## Playwright runner limitation

The repository includes five Playwright end-to-end scenarios and an isolated E2E server/database launcher. The installed Playwright package was invoked successfully. However, `npx playwright install chromium` received invalid/truncated browser archive data in this environment, leaving no executable. The first browser launch failed before application assertions ran, and four subsequent serial scenarios did not run. **The standalone Playwright suite is not reported as passing.**

Run locally after installing a browser:

```bash
npm run build
npx playwright install chromium
npm run test:e2e
```

Mobile media queries are implemented but no actual mobile viewport was available through the supplied browser API. Dedicated mobile runner validation remains outstanding.

## Real Ring verification still required

No Playground token, live API success, real video playback, or authentic Ring webhook was available during this build. The Amazon sign-in flow rejected this automated session. Configure a real `RING_ACCESS_TOKEN` server-side, restart, run `npm run ring:verify`, discover/map the sample devices, and verify actual WHEP playback before recording the Ring-track submission. Registered real webhooks additionally need the issued HMAC key, linked account ID, and HTTPS callback configuration.

## Scope and practical limits

This is a single-business local hackathon app, not a multi-tenant production service. Demo actors are explicitly selected and are not independently identity-verified. Non-demo mode provides a password-gated manager workspace; organizational employee identity/SSO and production onboarding are not implemented. Audit records and events persist, with the latest 1,000 audit records and 100 entrance events included in the main UI read model. Camera video is never stored or analyzed. Metric counts query persistent data rather than assuming seed values.
