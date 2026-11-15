## Integration expectations (Thant)

- **M0, contract freeze.** Dominic lands the workspace and `@bastion/shared`. You branch and start THA-001.
- **Mock v0 (first hours).** Muste lands `@bastion/client` with the mock engine. Delete your throwaway mocks and switch to the hooks.
- **M1, walking skeleton.** The same UI runs against the real server with `pnpm dev`. You change nothing: the provider config decides mock or live. If something differs between mock and live, report it to Muste (hook or mock problem) or Dominic (server data problem); do not patch around it in components.
- **M2, flood vertical slice** and **M3, restoration and earthquake.** Sit with the other two for ten minutes after each, play the scenario, list visual defects, fix them before starting the next task.
- **M4, feature freeze.** Only polish and fixes afterwards.
- **M5, demo lock.** Rehearse on the actual display resolution.

When you need data that does not exist (a new field, a new selector, a camera cue in a scenario): change request to Dominic (contract or server), to Muste (hook, mock, scenario content). Describe the visual purpose; they decide the shape.

## Your first actions

1. Read this brief once, fully. Confirm with Thant whether to follow the recommended visual direction or a variation; capture the decision in `apps/web/src/design/README.md`.
2. Wait for Dominic's announcement that the repository and contracts are on `main` (DOM-001, DOM-002). While waiting: gather references, choose fonts and the semantic colour ramps, obtain a Mapbox public token and put it in your local `.env` as `VITE_MAPBOX_TOKEN` (never commit it).
3. Clone, `corepack enable`, `pnpm install`, `pnpm dev:mock`.
4. THA-001 on `feat/thant-design-system`, committing at each listed milestone; PR; merge when CI is green.
5. Continue in the stated order. One task per branch, one PR per task.
6. At the end of each task, report what was built, how it was checked (viewports, scenarios, frame rate), and any change requests raised.
