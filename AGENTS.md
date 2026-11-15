# Developing CFJS

Write simple, semantic code that is easy to understand and tweak. Prefer meaningful names and straightforward implementations over abstractions.

## Branch workflow

- Start feature branches from the latest `origin/develop`, using the `codex/` prefix for agent work. Open feature PRs into `develop`, not `main`.
- Do not commit or push directly to `main` or `develop`. Both branches require pull requests, including for administrators. Do not bypass protection, force-push, or delete either branch.
- Run checks appropriate to the change before merging. Resolve review feedback and pass any required GitHub checks; branch protection currently requires PRs but does not require approving reviews or CI checks.
- Squash-merge feature PRs into `develop`. Promote changes through a `develop` → `main` PR, using a merge commit to preserve shared history. Do not promote or publish without a user request.
- If changes land only on `main`, sync them back through a `main` → `develop` PR using a merge commit before starting another feature branch. Never squash or rebase sync PRs.

## Documentation is part of the feature

Keeping the developer docs current is mission critical. Any public behavior change must update `docs/`, relevant runnable examples, README guidance, and browser coverage in the same task. Document actual behavior and limitations, not intended future features. Record breaking changes in the docs' migration section. Never mark a feature complete with stale docs.

CFJS is browser-only: do not add a static compiler, assembly mode, or server renderer. The docs are a directly servable static site composed by CFJS in the browser from `docs/`. No hosted site service, frontend framework, build step, or deployment packaging is required. `npm run docs:dev` serves source unchanged. Each root topic HTML file contains its own content inside the shared `components/shell.html` include; do not split topics into separate entrypoint and content files. Keep metadata in `data/`, browser code in `scripts/`, CSS in `styles/`, and portable dependencies in `vendor/`. Keep HTML before JavaScript and CSS in reusable component fragments. Verify docs examples and mobile layout with `npm test`. Do not publish without a user request.

The docs vendor runtime must also remain byte-identical to root `cfjs.js`. Compare divergent work first, then use `npm run docs:sync` after runtime changes. `npm run docs:check` and `npm test` check equality. CodeMirror is a checked-in browser module with licenses and provenance in `docs/vendor/`; ordinary docs edits must not require bundling. Do not restore the removed historical performance reports or benchmark toolchain for v0.1.
