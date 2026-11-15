# Developing CFJS

CFJS is a browser-only HTML composition runtime shipped as one readable file: root `cfjs.js` is the canonical runtime. `docs/` is a static documentation site that CFJS itself composes in the browser. `tests/*.cjs` are Playwright suites run through `tests/browser.cjs`. Node 22.19+ is only for tooling; scripts live in `package.json`.

Setup: `npm ci && npx playwright install chromium`. Serve docs with `npm run docs:dev` (http://127.0.0.1:8765/).

Write simple, semantic code that is easy to understand and tweak. Prefer meaningful names and straightforward implementations over abstractions.

## Product boundaries

- Keep all rendering in the browser at runtime. CFJS has no static compiler, assembly mode, or server renderer, by design.
- Serve `docs/` exactly as authored. It needs no build step, frontend framework, hosting service, deployment packaging, or benchmark tooling; any static HTTP server works, including from a subdirectory.

## Branches and pull requests

- Start each feature branch from the latest `origin/develop`, prefixed with the agent's name: `codex/…` for Codex, `claude/…` for Claude Code.
- Open feature PRs into `develop` and squash-merge them after review feedback is resolved and checks pass.
- Promote through a `develop` → `main` PR with a merge commit, only when the user asks.
- If changes land only on `main`, sync them back through a `main` → `develop` PR with a merge commit before starting another feature branch. Sync PRs are never squashed or rebased.
- `main` and `develop` change only through pull requests: never push to them directly, force-push, delete, or bypass their protection.

## Changing the runtime (`cfjs.js`)

`docs/vendor/cfjs.js` is a portable, byte-identical copy of root `cfjs.js`, never a symlink. If the two have diverged, compare them first so work isn't overwritten, then run `npm run docs:sync`.

## Changing the docs site (`docs/`)

- **Topics:** each root topic HTML file holds its own content inside the shared `components/shell.html` include. Edit the topic in that one file. Keep the head stylesheet that hides the slotted topic until the shell composes. Register topics in `data/topics.json`.
- **Anchors:** keep heading IDs stable. When an anchor moves or disappears, update `data/legacy-links.json`; `tests/docs.cjs` follows every entry.
- **Layout:** metadata in `data/`, browser code in `scripts/`, CSS in `styles/`, portable dependencies in `vendor/`. In reusable component fragments, place HTML before JavaScript and CSS.
- **Runnable examples:** HTML entrypoints and fragments go in `examples/`, JSON in `data/examples/`, scripts in `scripts/examples/`, images in `assets/`, shared CSS in `styles/examples.css`. Register files in `data/examples.json` with paths relative to `examples/`, listing the HTML entrypoint first, and reference the key with `data-example`. Source panels and the editor fetch these same files, so they are the single source of truth. Use relative URLs.
- **CodeMirror** is a checked-in browser module in `docs/vendor/`, with its licenses and provenance alongside it. Docs edits need no bundling.

## Definition of done

A change is done only when every item holds:

- [ ] Any public behavior change updates its reference topic, related guides, README, runnable examples, and browser coverage, documenting actual behavior and limitations. Breaking changes are recorded in `docs/migration.html`.
- [ ] `npm run docs:format:check` passes; fix with `npm run docs:format`.
- [ ] `npm test` passes. It checks that `docs/vendor/cfjs.js` matches root, then runs the runtime, docs, examples, editor, and desktop/tablet/mobile layout suites. A run proves only its engine: select others with `BROWSER=firefox` / `BROWSER=webkit`, or `CHROMIUM_PATH` for installed Chrome.
- [ ] Affected pages are inspected visually, including at mobile width.
- [ ] Runtime changes completed every step in "Changing the runtime".

## Release

Version 0.1.0 is pending; license selection and publication are separate steps. No CI workflow is configured, so checks run locally. The npm package stays private. Publish, promote, or host the docs only when the user asks.
