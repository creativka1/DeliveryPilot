# Product feedback draft

This feedback covers tools actually inspected and integration code actually developed. Live Playground/API operation was not verified because credentials were unavailable. Update the live-experience section after testing your account; do not claim unperformed steps.

## Ring Partner API / documentation

**Used for:** documented server-side discovery, status/capabilities, history, WHEP streaming, token refresh, signed webhook ingestion, and a delivery coordination workflow.

**Worked well:** the JSON:API reference supplies concrete paths, the webhook docs specify raw-byte HMAC verification and the request ID for deduplication, and WHEP uses browser-native WebRTC concepts. Documentation separates live streaming from historical event data.

**Needs work:** the current reference and the official starter have differences that can confuse a new developer. The inspected starter's webhook schema includes person_detected while the reference's type list uses motion_detected with sub_type; its streaming example uses sendrecv audio while current docs require recvonly tracks. A versioned starter-to-reference compatibility table and shared schema fixtures would reduce onboarding errors.

**Onboarding:** public documentation and starter retrieval succeeded. Amazon sign-in rejected the automated browser session with “We do not support your session or client.” No token or real upstream success was obtained during this environment's build. This is a session limitation observed here; it does not establish a general outage or product defect.

**Would build again:** yes, subject to verifying the intended account's device scopes and Playground behavior. The receiving workflow is a practical business-system extension of entrance activity.

## Ring API Hello World starter

**Used for:** authentication flow, discovery structure, WHEP offer/answer lifecycle, and attribution-preserved integration reference at commit 76100aa2892b2f4ece7879701bd9934d3f1e7743.

**Worked well:** short-lived bearer-token setup avoids implementing account linking for a first simulator experiment. The Python scripts and web app show the intended API entry points.

**Suggested improvements:** avoid echoing upstream error bodies; constrain session deletion to validated Ring session URLs; keep credentials server-side; align example schemas and track direction with the current reference; show a signed webhook fixture separately from manually generated events.

## Ring Developer Playground

**Intended use:** real Package, Vehicle, and Motion sample streams through discovered devices. DeliveryPilot does not substitute a fabricated player or invented detection output.

**Live experience not yet tested:** token generation, actual sample availability, video connection, expiry duration, and authentic webhook behavior for this account. Fill in after a real session. The app includes explicit “local test” provenance when no actual webhook is available.

## Other tools

Next.js/React, TypeScript, Tailwind, Prisma/SQLite, Zod, Vitest, and Playwright support the application and validation. This project does not claim to have integrated a runtime AWS service or to qualify for the AWS Builder mini-challenge.
