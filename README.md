# CFJS — browser-native HTML composition

Compose HTML fragments, fill slots, and render data with one browser script.
CFJS works in the regular DOM with your existing HTML, CSS, and JavaScript.
No consumer build step, runtime dependencies, Shadow DOM, or component registration.

**Status: preparing v0.1.0.** This is an early framework developed alongside a
portfolio that uses it. The API is still evolving; expect changes before 1.0.

## Why CFJS?

Small static sites often need shared headers, reusable markup, and a few lists
backed by data. CFJS explores how much of that can stay in ordinary HTML files,
served directly over HTTP(S), without introducing an application toolchain.

The runtime is a single readable file. The documentation uses CFJS itself, and
browser tests exercise composition, failures, script timing, and runnable examples.

## Try it

Copy [cfjs.js](cfjs.js) into your site. Create these two files beside it:

**index.html**

```html
<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My CFJS site</title>
  <script defer src="./cfjs.js"></script>
  <body>
    <cf-include src="./header.html">Welcome to my site</cf-include>
    <main><h1>Built with plain HTML</h1></main>
  </body>
</html>
```

**header.html**

```html
<header><a href="./index.html">My site</a></header>
```

Serve the folder with any static HTTP server and open `index.html`.
Opening files through `file://` is not supported. All include paths, including
nested includes, resolve against the entry document's base URL.

## What it does

| Feature | Purpose |
| --- | --- |
| [Includes](docs/cf-include.html) | Compose reusable HTML fragments, including nested fragments. |
| [Slots](docs/slots.html) | Supply page-specific content to a fragment. |
| [Data](docs/cf-data.html) | Load JSON or resolve a global JavaScript value or function. |
| [Loops](docs/cf-loop.html) | Render a template for each array item. |
| [Conditions](docs/cf-if.html) | Select a template using a data property's truthiness. |
| [Bindings](docs/bindings.html) | Write text, links, image sources, and alternative text. |
| [Lifecycle events](docs/events.html) | Observe successful rendering and failures. |

Include trees and data results prepare off-document and mount atomically.
Nested work follows document order; separate live includes start independently.
Successful requests are cached for the page lifetime, while each include gets
fresh DOM. Failed composition preserves fallback content.

## Boundaries

- Browsers may preload literal image or script URLs inside unselected templates.
  CFJS does not execute those scripts; use `cf-src` to defer image URL assignment.
- Rendering is one-time, not reactive. Changing a value does not update existing DOM.
- Fragments and scripts must be trusted. CFJS is not a sanitizer or expression evaluator.
- Composition requires JavaScript. Keep essential content and useful fallbacks in initial HTML.
- There is no server renderer, static compiler, progressive mounting, cancellation API,
  automatic lifecycle cleanup, or page-wide completion barrier.
- Large lists can block the main thread; there is no built-in pagination or virtualization.

Read [limitations](docs/troubleshooting.html), [paths and requests](docs/paths.html),
and [migration notes](docs/migration.html) before integrating an existing site.

## Documentation and examples

Start with the [Quickstart](docs/quickstart.html), then explore
[composition](docs/compose.html), [data rendering](docs/render-data.html), and
[repeating templates](docs/repeat.html).

The documentation is a separate static site composed by CFJS in the browser.
Its examples share their runnable source with the displayed code with standalone live previews.

```sh
npm run docs:dev   # http://127.0.0.1:8765/; no npm install needed
```

Or point any static HTTP server at `docs/` and serve it unchanged. There is no
build step or deployment packaging. Runnable HTML examples and fragments live in
`docs/examples/`, with JSON in `docs/data/examples/`, scripts in
`docs/scripts/examples/`, images in `docs/assets/`, and shared styling in
`docs/styles/examples.css`.
See [Contributing](docs/contributing.html#authoring) for the documentation
structure and authoring workflow.

## Development

Use Node.js **22.19 or newer**. Node is only needed for
development tooling, not for sites using the runtime.

```sh
npm ci
npx playwright install chromium
npm test
```

The test command verifies the docs runtime copy and serves source files with its own HTTP server. Coverage
includes runtime behavior, runnable examples, navigation,
and desktop, tablet, and mobile layouts. Select an engine locally with
`BROWSER=firefox` or `BROWSER=webkit` after installing its Playwright browser.

See [Contributing](docs/contributing.html) for the repository map, browser options,
documentation workflow, and runtime synchronization. See the
[performance advice](docs/performance.html) for keeping pages responsive.

## Release status

Version 0.1.0 is pending release. Release publication and license selection are pending. This project is not
published to npm; the package remains private to prevent accidental publication.
