# Developer friction log

All entries are observed during this build or direct comparisons of inspected primary sources. No live Ring API failure is fabricated. Severity reflects impact on this project.

## 1. Amazon sign-in rejects this automated browser session

- Task: obtain a Playground access token for a real device discovery call.
- Steps: navigate to `https://developer.amazon.com/ring/console/playground` in the available cloud browser.
- Expected: account sign-in, then Playground access.
- Actual: redirect to Amazon sign-in returned a page stating the session/client is unsupported. No credentials were entered and no token was obtained.
- Severity: critical for proving the live Ring demo in this environment.
- Workaround: user configures a Playground token server-side from their own supported browser; continue implementing and testing the application without inventing live success.
- Suggestion: document supported sign-in environments for developer sandboxes and provide a supported developer authentication handoff.

## 2. Starter schemas differ from the current webhook/video reference

- Task: implement documented event normalization and streaming.
- Steps: compare official starter `lib/schemas/webhook.ts` and `app/hooks/useWebRTCStream.ts` at commit 76100aa… with current Ring API notification and WHEP sections.
- Expected: matching documented event types and track directions.
- Actual: starter schema allows person_detected; reference lists motion_detected with sub_type and button_press. Starter offers sendrecv audio; current reference requires receive-only media.
- Severity: important.
- Workaround: implement the current documented v1.1 schema and a video-only recvonly offer; preserve starter attribution.
- Suggestion: version sample code with the reference and run contract tests using maintained fixtures.

## 3. SQLite migration initialization gave an empty engine error

- Task: apply the checked-in Prisma migration to an absent local SQLite file.
- Steps: run Prisma 6.19 migrate deploy with `file:./dev.db` before the file exists.
- Expected: create database and apply migration.
- Actual in this runtime: “Schema engine error” without useful detail.
- Severity: important for first-run setup.
- Workaround implemented: the migration wrapper creates the SQLite file, then runs the standard migration command. It never deletes or resets an existing database.
- Suggestion: surface the original filesystem error and database path in migration diagnostics.

## 4. TypeScript CLI IPC is unavailable in the restricted runtime

- Task: execute the demo seed with the tsx CLI.
- Steps: run `tsx prisma/seed.ts`.
- Expected: seed script completes.
- Actual: EPERM when tsx tries to create a temporary Unix IPC socket.
- Severity: important here, not a Ring API problem.
- Workaround implemented: Node's `--import tsx` executes the same seed without the CLI IPC server.
- Suggestion: document this mode for restricted environments.

## 5. Next.js development preview memory diagnostics

- Task: run the Next.js 16.4.2 development preview in the supplied managed preview.
- Steps: start the supervised development entrypoint.
- Expected: healthy local preview.
- Actual: Next.js memory diagnostics threw ENOENT from uv_resident_set_memory before the preview became healthy.
- Severity: important for browser validation in this runtime.
- Workaround attempted: use the successfully compiled production app for internal browser validation. See VALIDATION.md for the final observed result.
- Suggestion: make nonessential development memory telemetry tolerant of unavailable container process metrics.
