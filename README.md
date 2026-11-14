# CFJS — browser-native HTML composition

Compose trusted HTML fragments in the browser with one script and no build step. Serve over HTTP(S); file URLs are unsupported.

- [Includes](docs/cf-include.html)
- [Slots](docs/slots.html)
- [Paths and requests](docs/paths.html)
- [Events and lifecycle](docs/events.html)
- [Scripts and styles](docs/scripts.html)

## Development

Use Node.js 22.19 or newer. Run `npm ci`, `npx playwright install chromium`, then `npm test`. `npm run docs:dev` serves docs unchanged; it needs no dependency install. Compare runtime copies before `npm run docs:sync`; `npm run docs:check` verifies equality.

Rendering is one-time. Fragments must be trusted. No server renderer, static compiler, or build pipeline is provided. The package is private; release and license selection are pending.
