## GitHub collaboration protocol (mandatory for all three developers and their Claude sessions)

**Workspaces.** One clone per developer. If two sessions ever share a machine, use separate clones or `git worktree`; never let two sessions write to the same working directory.

**Main is always demo-able.** Nobody develops on `main`. The only commits made directly on `main` are Dominic's initial bootstrap (DOM-001), because the repository does not exist before it.

**Branches.** Short-lived, one per task, cut from the latest `main`:

```
feat/dominic-<feature>     e.g. feat/dominic-routing
feat/thant-<feature>       e.g. feat/thant-map-scene
feat/muste-<feature>       e.g. feat/muste-signal-fusion
```

Use the branch name given in each task. A branch lives hours, not days. No personal mega-branch.

**Starting a task.**

```bash
git switch main
git pull origin main
git switch -c feat/<you>-<feature>
pnpm install
```

**Commits: small, atomic, conventional. This is not optional.**

- One logical step per commit: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `style:`, `perf:`.
- A task is several commits (each task lists suggested milestones). Never one giant commit at the end.
- Before every commit run `git status` and `git diff --staged`. Stage explicit paths (`git add apps/web/src/map`). **Never `git add -A` or `git add .`** when anything outside your ownership shows as changed.
- A commit must typecheck. Do not commit generated junk, `.env`, `.data/`, `node_modules`, or build output.
- No drive-by refactors or reformatting of files you were not asked to change.

**Staying current.** Sync by merging, never by rewriting history:

```bash
git fetch origin
git merge origin/main
```

No force-push, on any branch, ever. No `git reset --hard` on pushed work. No rebasing pushed branches.

**Lockfile.** If `pnpm-lock.yaml` conflicts: `git checkout origin/main -- pnpm-lock.yaml`, then `pnpm install`, then commit the result. Never edit it by hand.

**Pull requests.** Every task merges through a PR into `main`. Keep it small (aim for under about 400 changed lines excluding data and lockfile). The description states:

- What was implemented, with task id(s) in the title, for example `DOM-005: road graph and routing service`.
- Files and areas touched.
- How it was tested (commands run and their result).
- Configuration or environment changes.
- Known limitations.
- What other developers need to do to integrate.

**Merging.**

- CI must be green: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- If the PR touches only paths you own, you merge it yourself once CI passes. Do not wait for a reviewer; waiting is how hackathons die.
- If it touches anything owned by someone else (it should not), that owner must approve. `CODEOWNERS` enforces this.
- Use a normal merge commit (not squash) so the atomic commits survive. Delete the branch after merging.
- Never bypass failing checks or resolve a conflict by discarding someone else's side.

**Conflicts.** If a conflict appears in a file you do not own, stop and ping the owner; do not guess. If it is in your own file, resolve it, rerun the checks, commit.

**Shared files and contracts.** See the ownership table: one owner per shared file, change requests go to the owner, contracts are additive-only after the freeze.

**After every merge to `main`**, the person who merged pulls `main`, runs `pnpm install && pnpm dev`, and confirms the app still boots and the mock demo still plays. If `main` is broken, fixing it is the top priority for whoever broke it.
