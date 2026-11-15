## Integration expectations (Dominic)

- **M0, contract freeze.** DOM-001 and DOM-002 on `main`. Announce it; Thant and Muste branch from there. From now on `packages/shared` changes are additive.
- **M1, walking skeleton.** DOM-003 to DOM-007 merged. `scenario-mini` streams over the WebSocket. Tell Muste; they point `@bastion/client` at the real server (MUS-009).
- **M2, flood vertical slice.** DOM-008 to DOM-012 merged, running on Muste's real region pack and flood scenario with `@bastion/intel` mounted.
- **M3, restoration and earthquake.** DOM-013 and DOM-014 merged; earthquake scenario plays.
- **M4, feature freeze.** P1 tasks merged; fixes only afterwards.
- **M5, demo lock.** Deployed, golden runs green, three clean rehearsals.

Merge each task as soon as it is green; do not hoard. After each milestone, run the real app with the others for ten minutes and fix what the integration reveals before starting the next task.

You are the architectural coordinator, not the merge bottleneck: answer change requests against `packages/shared` and root config quickly (target 30 minutes), keep them additive, and get back to your own tasks.

## Your first actions

1. Read this brief once, fully.
2. DOM-001: initialise the repository in the current (empty) folder, scaffold the workspace, commit in the listed steps, create the GitHub repository, push, protect `main`. Ask the human for the GitHub organisation or account name and repository visibility before creating the remote.
3. DOM-002 on `feat/dominic-shared-contracts`: implement the contracts exactly as specified, with fixtures. PR, merge, announce the contract freeze.
4. Continue with DOM-003 and onward in order. Work one task per branch, commit at each listed milestone, open a PR per task, merge when CI is green.
5. At the end of each task, report: what was built, test results (paste the summary line), what the other developers can now rely on.
