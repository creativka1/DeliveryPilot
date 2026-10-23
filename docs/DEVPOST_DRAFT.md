# DeliveryPilot

**Tagline:** Turn your Ring camera into a delivery operations assistant.

**Primary track:** Ring — business systems.

## Inspiration

A receiving entrance is where a business's physical world meets its operations. A motion alert tells someone to look at a camera; it doesn't tell the team which delivery was expected, who should receive it, or whether anyone followed through. Small warehouses and shops often coordinate that handoff through ad hoc messages and memory.

## What it does

DeliveryPilot gives every arrival a clear path to an accountable receipt. Employees enter expected deliveries, receiving windows, entrances, and responsible teammates. Entrance activity becomes an arrival candidate. Explainable rules compare location and time with the schedule, suggest possible matches, and ask a manager to choose. A receiving task notifies the designated employee, who acknowledges, checks the goods, confirms receipt, or reports an exception. The dashboard and complete audit trail update from persistent data.

The product deliberately distinguishes camera evidence, schedule correlation, and human confirmation. It does not claim that motion proves delivery, or that video recognizes a supplier or order. Ambiguous matches stay visible; unrecognized activity stays unmatched; unavailable employees cause an explicit unassigned task.

## How we built it

A single Next.js App Router application uses TypeScript, React, Tailwind, Radix/shadcn-style UI components, Lucide, Zod, and Prisma with SQLite. A pure matching engine ranks deliveries by receiving entrance and time window. Transactional services manage assignments, receiving actions, notifications, and actor-attributed audit entries. Database-backed SSE keeps open workspaces current.

Server Ring integration adapts the official Amazon Ring API Hello World starter: device discovery, device status/capabilities, event history, and documented WHEP/WebRTC session negotiation. Partner webhooks verify raw-body HMAC signatures, validate account association, and deduplicate request IDs. Credentials remain server-side. A separate local event adapter retains explicit test provenance.

## Challenges

Playground video and real partner webhooks are different integration surfaces. We designed the demonstration to keep a locally generated test arrival visibly separate from real Ring API and stream evidence. The official starter and current webhook documentation differ in some example schema details, so we followed the documented v1.1 event types and raw-body signature contract. We also addressed SQLite initialization behavior and a restricted development-preview runtime during setup.

## Accomplishments

The complete local workflow persists from expected delivery to employee-confirmed receipt, with working exceptions, reassignment, audit history, notifications, and calculated metrics. The UI exposes the evidence source at the point where people decide what to do. Automated tests cover the business workflow and Ring failure handling rather than relying on a static dashboard.

## What we learned

The useful output of a camera integration is often a coordinated action with a clear owner. Strong boundaries between observation, inference, and confirmation make this product more understandable and trustworthy.

## What's next

Verify and record the real Playground connection, extend partner onboarding and organizational employee identity, pilot with a receiving desk, and calibrate timing rules from actual operations. Add retention controls and background webhook processing before a broader deployment.

## Build period / attribution

DeliveryPilot's business models, matching engine, workflow services, persistent notifications/audit, responsive interface, and test suite were created for this build on 2026-10-20. Ring integration flow adapts Amazon's MIT-licensed official starter, with attribution and the original license included. Replace or extend this statement with your team's actual hackathon development history before submitting; do not claim earlier work as newly created.

## Live integration disclosure — update before submission

The source implements real Ring runtime calls. Initial validation could not establish live success because no Playground token was supplied and Amazon sign-in rejected the automated browser session. Do not remove this disclosure until a real device discovery and simulator/device video demonstration have been recorded. Automated mock tests and local arrival events are not authentic Ring proof.

Repository URL: add your repository. Demo video URL: add a public YouTube/Vimeo video under three minutes. These drafts have not been submitted.
