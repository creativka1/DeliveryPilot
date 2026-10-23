# Ring integration contract

Reviewed 2026-10-20 against official primary sources:

- https://developer.amazon.com/docs/ring/api-documentation.html
- https://developer.amazon.com/docs/ring/get-started.html
- https://github.com/AmazonAppDev/ring-api-helloworld
- https://developer.amazon.com/ring/console/playground (Amazon sign-in rejected the automated session; no token obtained)

## Implemented calls

| Operation             | Actual upstream contract                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Discover devices      | `GET https://api.amazonvision.com/v1/devices`                                                                |
| Device status         | `GET /v1/devices/{device_id}/status`                                                                         |
| Video capabilities    | `GET /v1/devices/{device_id}/capabilities`                                                                   |
| Event history         | `GET /v1/history/devices/{device_id}/events`                                                                 |
| Create WHEP session   | `POST /v1/devices/{device_id}/media/streaming/whep/sessions`, `Content-Type: application/sdp`, raw SDP offer |
| Close WHEP session    | `DELETE` the validated server-returned session Location                                                      |
| Refresh partner token | `POST https://oauth.ring.com/oauth/token`, form encoded refresh grant with client credentials                |

Upstream bearer tokens are read and used only in server modules. The browser receives an SDP answer and an opaque application session ID, never Ring tokens, client secrets, or signing keys. Session deletion accepts this opaque ID and checks ownership; it cannot proxy an arbitrary URL. Upstream response bodies are never reflected in error messages.

The SDP offer contains a receive-only video transceiver. The latest working viewer waits for ICE completion or its existing three-second fallback before POST; this successful behavior was preserved. Playback becomes “real Ring video” only when the video element plays. Ring documentation limits battery streams to 30 seconds and wired streams to 60 seconds; the application uses a conservative 30-second session limit and cleans up on stop, unmount, error, and timeout. Device changes are disabled during active playback. Raw history responses are rendered for inspection and never passed off as new webhook deliveries.

Playground scenes: Package, Vehicle, and Motion sample devices can be selected if they are returned by real discovery. There are no hardcoded Playground device IDs or fabricated sample responses. A stream is not proof that a notification webhook was emitted, and DeliveryPilot does not perform CV/delivery identification on it.

## Webhooks

`POST /api/webhooks/ring`, JSON; enable only with a registered partner HTTPS callback, `RING_WEBHOOK_SIGNING_KEY`, and `RING_ACCOUNT_ID`.

1. Read the raw request body (max 100 KB).
2. Validate `X-Signature: sha256=<hex HMAC-SHA256>` with the partner signing key using constant-time comparison.
3. Parse JSON only after signature verification.
4. Validate the documented v1.1 meta and data shape, including request ID and account ID.
5. Reject accounts other than the configured single-business account.
6. Normalize with source `RING_WEBHOOK`.
7. Within one database transaction, deduplicate `(source, request_id)`, persist the event, create schedule-based suggestions, and audit/notify.

Recognized documented types: `motion_detected`, `button_press`, device add/remove/online/offline, integration add/remove, and subscription activation/deactivation. Only motion and button press can create delivery suggestions. The system does not accept `package_delivered` or claim supplier recognition.

Example **test fixture shape**, not a captured Ring response:

```json
{
  "meta": {
    "version": "1.1",
    "time": "2026-10-20T09:20:00Z",
    "request_id": "example-request-id",
    "account_id": "replace-with-linked-account"
  },
  "data": {
    "id": "example-event-id",
    "type": "motion_detected",
    "attributes": {
      "source": "replace-with-discovered-device-id",
      "source_type": "devices",
      "timestamp": 1792488000000
    }
  }
}
```

Ring expects a callback response in 5 seconds. This local demo processes the small SQLite transaction inline; a production integration should durably enqueue verified callbacks before processing if real workload threatens that budget. Duplicates return success without repeating writes. Unknown/unmapped devices are retained as unmatched activity. Register and configure cameras before generating the demonstration event. Mapping or editing a schedule does not pretend to retroactively authenticate old local test records.

## Signed simulation through the same receiver

The default `RING_WEBHOOK_MODE=partner` retains the existing callback behavior and actual partner key/account configuration. No incoming header or payload field selects provenance.

For automated verification, run `npm run webhook:verify` after a production build. It uses the same `/api/webhooks/ring` endpoint and business services in a separate loopback-only app instance and disposable database. It generates its own signing key; leave your actual Ring credentials unchanged.

An explicitly configured local testing instance can set `RING_WEBHOOK_MODE=simulated`, `DEMO_MODE=true`, `RING_SIMULATED_WEBHOOK_SIGNING_KEY`, and `RING_SIMULATED_ACCOUNT_ID`. The local key must differ from any configured partner signing key. Restart that local instance after changing environment settings. Simulated mode rejects partner-signed callbacks because it uses a different key; switch back to partner mode before expecting genuine partner notifications. This mode is for test deliveries, not for silently altering live operational data.

Both modes verify the raw-byte HMAC before JSON parsing, validate the selected account, normalize documented event types, and deduplicate by `(source, request_id)`. Simulations persist `SIMULATED_RING_WEBHOOK`, have a distinct simulator actor, and display an amber **Simulated webhook** label and history filter. Simulated lifecycle events cannot change real Ring camera online status. The existing local event button remains a separate `LOCAL_TEST` source.

Matching is automatic, but the manager still selects a delivery candidate before the existing assignment service creates a receiving task. A webhook never confirms physical receipt. Ambiguous matches and unavailable employees retain their existing review/escalation behavior.

Full results: [WEBHOOK_VERIFICATION.md](WEBHOOK_VERIFICATION.md).

## Account linking / production scope

The application consumes credentials produced by a properly registered Ring integration. It does not implement an end-user Ring OAuth account-link onboarding product. For this hackathon, the official short-lived Playground bearer token is the simplest path. Refresh flow is provided for an already linked partner account. Registered real webhooks require the partner configuration and a reachable HTTPS endpoint; a local test button cannot substitute for Ring-signed notification proof.

## Current verification boundary

The owner reports successful real Ring authentication, discovery, camera mapping, and Playground package video using the supplied latest source. Its streaming, URL validation, and Ring authentication files are unchanged in this update. The webhook verification used 108 automated tests and 20 HTTP checks against an isolated production instance. No genuine Ring-origin callback or new live video session was captured during this update. Real callback delivery remains a separate partner-configuration check.
