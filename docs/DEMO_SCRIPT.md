# DeliveryPilot demonstration — target 2:50

## Before recording

- Generate a current Ring Playground token; configure the server, restart, and verify device discovery. Map the discovered Package sample to Entrance A. Confirm real video playback works before recording. Keep credentials and environment files off screen.
- Start with the three example deliveries, Northline unreceived, and Morgan as manager. Expected windows must match the business date used in the demo. Avoid previous ambiguity fixtures that could distract from the primary path.
- If the Playground does not emit actual partner webhooks, use the explicitly labeled local event path below. Do not describe it as a Ring notification.
- This script requires actual Ring credentials to demonstrate the Ring track. A blank player plus local tests is not a completed Ring demonstration.

## 0:00–0:20 — The problem and dashboard

“A motion alert is useful. But at a small warehouse, someone still has to connect the arrival with an order and find the person responsible. DeliveryPilot turns that signal into a clear, accountable handoff.”

Show Overview with three scheduled deliveries. Open Northline briefly: 14:00–15:00, Entrance A, Alex.

## 0:20–0:55 — Prove the actual Ring integration

Open Settings and press Verify & discover devices. Show the timestamped successful `GET /v1/devices` result. Open Ring Live, select the actual Playground Package sample, and start the live WHEP stream.

“This is a real Ring Partner API connection and the Ring Developer Playground video stream. Credentials stay on the server. We don't store video or claim to recognize an order from it.”

Show actual playback; do not claim success if it fails. Stop the stream after proof.

## 0:55–1:20 — Separate activity from delivery claims

If no authentic webhook arrives, press Local test event → Expected arrival → Entrance A → 14:20.

“The Playground video and partner webhooks are separate. For this handoff, I'm explicitly creating a local test event. Its source remains visible throughout.”

Open the event. Show source, receiving location, and event occurrence time versus actual logged time. Inspect Northline's reasons: same entrance, expected time window. Mention the rule score is not recognition confidence.

## 1:20–1:55 — Assign, acknowledge, receive

Select Northline's possible match. Switch Acting as → Alex. Open the in-app notification, then the receiving task. Press Acknowledge → Start receiving.

“Alex has an explicit assignment and can report damage or escalate a problem. Only a person can confirm what physically arrived.”

Press Confirm received. Explain demo employee switching is for the local demonstration.

## 1:55–2:20 — Audit and recalculated metrics

Open the delivery's audit trail. Show the local test signal, manager match selection/assignment, Alex acknowledgment/start/confirmation, and real timestamps. Return to Overview to show confirmed receipt count and timing metrics recalculated from data.

## 2:20–2:40 — One alternative case

Switch to Morgan. Generate an unmatched visitor or ambiguity test. Open it to show it cannot silently produce a confirmed delivery. If rehearsed, use an unavailable employee example instead and show the manager assignment requirement.

## 2:40–2:50 — Close

“DeliveryPilot connects the receiving entrance with the team’s work: an observed signal, an explainable suggestion, and a human-confirmed receipt. Every handoff has an owner and a history.”

Keep the final uploaded video below three minutes. Do not include API keys, private camera footage without consent, third-party music, or claims unsupported by the captured run.
