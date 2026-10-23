# Signed-webhook verification of the latest working source

Date: 2026-10-20. Source of truth: supplied `DeliveryPilot_Latest(1).zip`. The workspace contained no current checkout; the original archive was not used. No database or `.env`/`.env.local` credentials were included in the supplied latest archive.

## Outcome

**108 automated tests pass, all four required checks pass, and 20 end-to-end HTTP checks pass against the built Next.js application.** The original 80-test baseline was executed and passed before source edits. The update adds 22 webhook regressions and six session URL regressions.

| Executed command here (Linux)                                       | Result                                  |
| ------------------------------------------------------------------- | --------------------------------------- |
| `npm run typecheck`                                                 | Passed                                  |
| `npm run lint`                                                      | Passed without warnings                 |
| `npm test`                                                          | 108 passed across five test files       |
| `npm run build`                                                     | Passed, Next.js 16.4.2 production build |
| `npm run webhook:verify -- --report docs/webhook-http-results.json` | 20 HTTP checks passed                   |

The corresponding Windows commands are `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run webhook:verify`.

## Integration behavior actually exercised

The verification runner starts the real production app on an OS-selected **127.0.0.1 loopback** port. It uses the existing checked-in migration and seed in a new temporary SQLite database, an ephemeral local signing key, and synthetic account/camera fixtures. The user’s normal database and `.env` files are never used as write targets. All inherited Ring credentials are cleared in the isolated child process. The child server is stopped and the temporary database removed at the end.

Requests travel over real HTTP to the existing `/api/webhooks/ring` endpoint, not directly to a mocked route or an invented Ring API. The saved [HTTP report](webhook-http-results.json) contains the observed results, without keys, cookies, or credentials.

Verified:

- A correct `X-Signature: sha256=<hex>` HMAC over the exact raw request body returns **200**. The observed successful callback took **66 ms** in this local run; this is an observation, not a production latency guarantee.
- Invalid signatures and raw-body tampering return **401**, with no event/candidate/task/audit/notification writes.
- A correctly signed wrong-account payload returns **403**.
- Normalization preserves the request ID, documented event type, timestamp, mapped camera, and source.
- Entrance/time matching automatically identifies Northline Supplies at Entrance A in its expected window. No supplier recognition or package-delivered detection is claimed.
- The existing **manager selection** is preserved. Selecting the match assigns Alex automatically from the delivery's existing designation; a callback alone does not select a delivery or create a confirmed receipt.
- Alex's assigned task notification is present in the authenticated HTTP state response.
- Alex can acknowledge, start receiving, and confirm receipt through the existing HTTP APIs. Actual wall-clock confirmation timestamps and actor-attributed audit entries are persisted.
- Duplicate requests return **200** with `duplicate: true`; event, task, candidate, audit, and notification counts do not change. Replays after task assignment and concurrent retries are covered.
- Unknown cameras become unmatched activity. Ambiguous matches remain unselected. Unavailable employees retain manager escalation/unassigned-task behavior.
- Generated activity is explicitly `SIMULATED_RING_WEBHOOK`, shown as **Simulated webhook**, and attributed to the simulator in its original evidence audit. Manual employee actions retain their actual acting employee.
- Simulated device-offline notifications do not change real Ring camera status. No fake Ring discovery, successful integration check, or video session is created.
- Unrelated delivery and employee fixture records remain unchanged. All writes remain isolated from the user's records.

## Necessary changes

The earlier callback accepted signed developer fixtures but labeled them `RING_WEBHOOK`, with a message suggesting genuine Ring origin. This update adds explicit **server-selected simulation provenance** to the same processing path.

- Default `RING_WEBHOOK_MODE=partner` retains the existing partner key, account checks, and source.
- `RING_WEBHOOK_MODE=simulated` additionally requires `DEMO_MODE=true`, a separate `RING_SIMULATED_WEBHOOK_SIGNING_KEY`, and `RING_SIMULATED_ACCOUNT_ID`.
- A simulation key cannot be reused as the partner key. Payload fields and caller headers cannot select real provenance. Unsupported configuration fails closed.
- Both sources use the same raw-body verification, normalization, matching, persistence, assignment, and audit architecture. Existing review rules and employee workflow remain intact.
- `SIMULATED_RING_WEBHOOK` fits the existing string source columns; **no schema change or migration is introduced**. Existing records retain their original source and history.

These settings are DeliveryPilot configuration, not invented Ring API features. Authentication/payload structure was checked against the current [official Ring notification reference](https://developer.amazon.com/docs/ring/api-documentation.html).

## Exact changed-file list

| Modified existing file       | Purpose                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `app/api/[...path]/route.ts` | Delegate the existing callback's verification/normalization to the shared receiver             |
| `lib/ring/events.ts`         | Shared normalization and a separately labeled simulation adapter                               |
| `lib/validation.ts`          | Accept the explicit internal simulation source                                                 |
| `lib/workflow.ts`            | Retain simulation provenance in ingestion and prevent simulated status changes to real cameras |
| `lib/state.ts`               | Expose the non-secret configured webhook mode                                                  |
| `components/workspace.tsx`   | Simulation source badge, history filter, and settings mode label                               |
| `.env.example`               | Document the optional simulation configuration; preserve actual secrets separately             |
| `package.json`               | Add `webhook:verify`; no dependency changes                                                    |
| `tests/ring.test.ts`         | Valid query-bearing session URLs and strict host/path/fragment regressions                     |
| `README.md`                  | Latest-source status, repeatable verification command, and source semantics                    |
| `docs/RING_INTEGRATION.md`   | Current simulation/partner contract and preserved working ICE behavior                         |
| `docs/VALIDATION.md`         | Retain original results as historical and point to this current report                         |

| Added file                       | Purpose                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| `lib/ring/webhook.ts`            | Shared signed callback receiver, mode/key/account boundaries            |
| `scripts/verify-webhook.mjs`     | Self-contained real-HTTP verification with a disposable database/server |
| `tests/webhook.test.ts`          | 22 focused regression tests                                             |
| `docs/webhook-http-results.json` | Executed HTTP proof metadata, 20 checks                                 |
| `docs/WEBHOOK_VERIFICATION.md`   | This report                                                             |

Generated TypeScript build cache is excluded from the updated source archive.

## Preservation evidence

The following files match the supplied latest source **byte for byte** (SHA-256):

| Protected file               | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `components/ring-viewer.tsx` | `b7ec85c578cae7f4226a51082158af7d8a1859dd515f43215ea42ae8dbbf4f7a` |
| `lib/ring/client.ts`         | `c6e5e36f6b77f08bc1dc6cd2ee32d7a3c434c2d2aa0f5008ba5438b20204747c` |
| `lib/ring/auth.ts`           | `e68f092384b3e4ea194daebe2120593fef3205684adf4d54382f7dbafca94903` |
| `prisma/schema.prisma`       | `1b2fdfbb11eabc7d578657d68ace6fe0163d9d4c038e2fb7e0b50095f4b308d9` |

`lib/db.ts`, the existing migrations and seed, `package-lock.json`, and employee task-action/match-selection implementations are also unchanged. No credentials were supplied or modified. The verification does not reset, re-seed, or migrate the user's working database.

## Reproduce safely

From the updated source folder after dependencies are installed:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run webhook:verify
```

The final command supplies its own ephemeral key and fixture database. Do not replace your working `.env.local` or database with test files. The normal app retains partner mode by default; no simulation mode toggle is required in your working environment to run this isolated verification.

## Remaining limits

- This proves the receiver and downstream business workflow using correctly signed **simulated** events. It does not prove that Ring's servers can reach a registered HTTPS callback or deliver authentic notifications for this account.
- The owner reports working Ring authentication, discovery, mapping, and real Playground package video in the latest source. Those files were preserved; new live playback was not attempted here because credentials were not included.
- The user's existing database was not supplied. Record preservation was checked with unrelated existing fixtures in an isolated database, and no user database was accessed.
- Manager review before task creation remains intentional. Physical receipt always requires an employee action.
- No demo video was prepared, and no application was published or deployed.
