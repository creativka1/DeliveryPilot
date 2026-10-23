# Third-party notices

Ring integration flow and token caching/WHEP negotiation are adapted from Amazon's official [Ring API Hello World](https://github.com/AmazonAppDev/ring-api-helloworld), inspected at commit `76100aa2892b2f4ece7879701bd9934d3f1e7743` on 2026-10-20.

Copyright (c) 2026 Amazon. MIT license. The complete original license is included in `docs/AMAZON-STARTER-LICENSE.txt` and must accompany redistribution of the adapted portions.

DeliveryPilot changes include fixed upstream host/session validation, no token endpoint to the browser, server-only Ring credentials, receive-only video, opaque server-owned stream session IDs, documented button_press/lifecycle notifications, raw-body HMAC before parsing, account checks, persistent idempotency, and separate provenance for local tests. Current official documentation takes precedence over the starter's more permissive demonstration schemas.

The button/dialog primitives follow the open shadcn/ui compositional style (MIT) and use Radix primitives, class-variance-authority, clsx, and tailwind-merge. Visual styling and application components were written for DeliveryPilot. Lucide icons are ISC licensed. See each installed package for its license; dependency versions are recorded in package-lock.json. No supplier images, camera recordings, or copyrighted audio are bundled.
