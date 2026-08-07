# Fork Manifest

Private fork of **[`companion-inc/feynman`](https://github.com/companion-inc/feynman)**.

> The old `getcompanion-ai/feynman` URL still works but is a **redirect**. Always use
> `companion-inc/feynman` — the GitHub API returns `getcompanion-ai` paths as `404` in some
> forms, which silently produces wrong answers when scripting against it.

This fork is **not** upstreamed. Nothing here is intended for a PR to `companion-inc`. The only
reason it exists is to keep the **parallel-cli (parallel.ai) web search integration** working.
Everything else should track upstream exactly.

## Sync State

| | |
|---|---|
| Last synced | **2026-08-06** |
| Upstream commit | `daa7f47` (`main`, package version `0.3.12`) |
| Upstream tag line | v0.3.11 |
| Previous sync | 2026-04-11 at `b3a82d4` (v0.2.17) — 180 commits of drift |

**Update this table on every sync.** It is the only record of where the fork sits.

---

## Guiding Principle

> **Take upstream verbatim for everything except the five files listed below.
> Never re-apply a fork edit to agent *prose*, only to the frontmatter `tools:` allowlist.**

Upstream actively rewrites the agent prompts (`researcher.md`, `verifier.md`, `SYSTEM.md`).
An earlier version of this fork overrode that prose, which meant every sync had to hand-merge
upstream's prompt improvements, and it silently dropped new upstream tools. That is retired —
see [Retired Customisations](#retired-customisations).

### Deliberate non-change: `pi-web-access` stays

All web access is meant to go through parallel.ai, so it is tempting to strip `pi-web-access`.
**Don't.** Decided 2026-08-06:

- It is already inert here. `feynman doctor` shows exa / perplexity / gemini all *"not
  configured"*, so `web_search` has no backend and cannot make calls. Traffic already goes to
  parallel.ai with zero fork delta.
- Removing it from `.feynman/settings.json` does not stick — `src/pi/package-presets.ts`
  reconciles that list automatically (the same trap that killed the `pi-subagents` removal).
- Upstream *patches* the package (`scripts/lib/pi-web-access-patch.mjs`) and asserts its cache
  wiring (`scripts/verify-package-artifact.mjs`), so removal likely breaks upstream's own checks.
- Upstream prose in `SYSTEM.md` and two agents instructs agents to call `web_search` /
  `fetch_content`; removing the package would require re-introducing the retired prompt overrides.

If a search API key is ever configured here, revisit. The cheap lever then is dropping those
tool names from the two frontmatter allowlists this fork already owns — **not** touching
`settings.json`.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node**, version from `.nvmrc` | Managed by **`fnm`** on this host (Homebrew), initialized in `~/dotfiles/zsh/configs/tools.zsh` via `eval "$(fnm env --use-on-cd)"`. It auto-switches on `cd` from `.nvmrc`. |
| **`parallel-cli`** on `$PATH` | **The whole point of this fork.** `extensions/parallel-search/parallel.ts` shells out to a binary literally named `parallel-cli`. Without it every `parallel_*` tool call fails with `ENOENT`. |
| npm | Bundled with Node. |

### Node gotcha

`fnm` only auto-switches to a version **it already has installed**. If `.nvmrc` names a version
you lack, `fnm` prints a notice and leaves you on the previous version — the build then fails in
confusing ways. **After every sync**, `.nvmrc` may have moved:

```bash
fnm install "$(cat .nvmrc)"   # no-op if already present
fnm use                       # or just cd out and back in
node -v                       # must match .nvmrc exactly
```

### Running the fork

This fork runs from source; there is no binary. The `feynman` command is a wrapper:

```sh
# ~/.local/bin/feynman
#!/bin/sh
set -eu
exec node "/Users/janni/projects/feynman/bin/feynman.js" "$@"
```

`~/.local/bin` must precede any directory holding an upstream-installed binary.
Verify with `which feynman` and `feynman --version`.

---

## The Fork Delta

Exactly **five** files differ from upstream. Verify with:

```bash
git diff --name-status upstream/main HEAD    # should list only these + FORK.md
```

| File | Risk | Change |
|---|---|---|
| `extensions/parallel-search/parallel.ts` | **LOW** | **New, fork-owned.** Exports `registerParallelTools(pi)`, registering `parallel_search`, `parallel_fetch`, `parallel_research`. Shells out to `parallel-cli` via `execFile` (no shell → no injection), always `--json`, 5-min timeout, 50 MB stdout cap. |
| `tests/parallel-search.test.ts` | **LOW** | **New, fork-owned.** 13 unit tests over a mock `pi`. Runs as part of `npm test`. |
| `extensions/research-tools.ts` | **MEDIUM** | **Two lines**: the `registerParallelTools` import and its call. Upstream adds registrations here often — it has merged cleanly so far because our lines sit in a stable alphabetical slot. |
| `.feynman/agents/researcher.md` | **MEDIUM** | **Frontmatter `tools:` only.** Appends `parallel_search, parallel_fetch, parallel_research` to upstream's list. |
| `.feynman/agents/verifier.md` | **MEDIUM** | **Frontmatter `tools:` only.** Appends `parallel_fetch` to upstream's list. |
| `FORK.md` | **LOW** | This file. Upstream has no counterpart. |

Nothing else. In particular the fork does **not** touch `package.json`, `package-lock.json`,
`.feynman/settings.json`, `.feynman/SYSTEM.md`, `src/`, or `scripts/`. If a sync leaves a diff in
any of those, it is accidental — revert it to upstream.

---

## Sync Runbook

One-time setup:

```bash
git remote add upstream https://github.com/companion-inc/feynman.git
git config rerere.enabled true    # remembers conflict resolutions between syncs
```

Then, for each sync:

```bash
# 1. Clean tree, safety net
cd ~/projects/feynman
git status --short                       # must be empty; discard stray package-lock churn
git tag "pre-sync-$(node -p "require('./package.json').version")"

# 2. Fetch and review
git fetch upstream --tags
git log --oneline HEAD..upstream/main | wc -l        # how much drift
git diff --stat HEAD..upstream/main -- .feynman/agents/ extensions/research-tools.ts

# 3. Merge on a branch, never straight onto main
git switch -c "chore/upstream-sync-$(date +%Y%m%d)"
git merge upstream/main

# 4. Resolve — see the policy table below
# 5. Re-apply the frontmatter allowlists (step 4 policy)
# 6. Refresh BOTH stale runtime roots (MANDATORY — see Hazards)
rm -rf .feynman/npm                      # project root; rebuilds on next launch
feynman update                           # user-global root at ~/.feynman/npm-global

# 7. Toolchain + verify
fnm install "$(cat .nvmrc)" && fnm use
npm ci && npm run typecheck && npm test && npm run build

# 8. Land it
git switch main && git merge --ff-only "chore/upstream-sync-$(date +%Y%m%d)"

# 9. Update the Sync State table above, then push
```

Rollback at any point: `git reset --hard pre-sync-<version>`.

### Conflict resolution policy

| Conflicted file | What to do |
|---|---|
| `.feynman/SYSTEM.md` | `git checkout --theirs` — **take upstream whole, no exceptions.** |
| `.feynman/settings.json` | `git checkout --theirs` — **take upstream whole.** Upstream pins package versions here and `src/pi/package-presets.ts` auto-reconciles it; any edit is fought by the reconciler. |
| `package.json`, `package-lock.json` | `git checkout --theirs` — the fork owns nothing here. |
| `.feynman/agents/researcher.md` | Take upstream whole, then append `, parallel_search, parallel_fetch, parallel_research` to the **frontmatter `tools:` line only**. Leave all prose alone. |
| `.feynman/agents/verifier.md` | Take upstream whole, then append `, parallel_fetch` to the **frontmatter `tools:` line only**. Leave all prose alone. |
| `extensions/research-tools.ts` | Keep upstream's full import + registration lists, then re-insert our two lines. |
| `extensions/parallel-search/parallel.ts`, `tests/parallel-search.test.ts` | Ours — upstream has no counterpart, so these never conflict. But they **do** silently break on runtime renames; see Hazards. |

Never resolve an agent file by keeping "ours". Upstream adds tools to those allowlists
(it added `write`, `edit`, and three `hf_*` tools in the 0.2.17 → 0.3.11 window); keeping our
side wholesale would delete them and quietly reduce the agent's capability.

---

## Hazards

Ranked by how much time they cost when missed.

### 1. Stale runtime roots — **there are TWO, and a merge refreshes neither**

Pi packages live outside git, so `git merge` does nothing to them. After a sync they still hold
the *previous* runtime, and Feynman's patchers refuse to operate on a version they don't expect.
Both must be refreshed, every sync:

| Root | Scope | Refresh with |
|---|---|---|
| `<repo>/.feynman/npm/` | project (gitignored, ~500 MB) | `rm -rf .feynman/npm` — rebuilds on next launch |
| `~/.feynman/npm-global/lib/node_modules/` | **user-global, shared by every project** | `feynman update` |

Symptoms, both of which look like merge bugs and are not:

```
# stale project root:
Error: Unsupported Pi ModelRegistry layout: required request-auth patch anchors were not found

# stale global root:
Unsupported pi-web-access patch ~/.feynman/npm-global/lib/node_modules/pi-web-access:
expected 0.18.0, found 0.10.6
```

Observed on the 2026-08 sync: the project root still held
`@mariozechner/pi-coding-agent@0.66.1` (repo had moved to `@earendil-works/…@0.83.0`), and the
global root held `pi-web-access@0.10.6`, `pi-subagents@0.14.1`, `pi-btw@0.3.7`,
`pi-docparser@1.1.1` — all April-era.

Prefer **`feynman update`** over deleting the global root: it upgrades the pinned core packages
in place and leaves optional packages you installed (memory, session-search, charts, zotero…)
alone. Deleting `~/.feynman/npm-global` wholesale would take those with it.

### 2. Pi runtime package renames break `parallel.ts`

`parallel.ts` and its test import from the Pi runtime, and upstream has renamed these at least
twice. Because these files are fork-owned they never conflict — they just **stop compiling**,
and only `npm run typecheck` catches it (`npm run build` compiles `src/` only, per
`tsconfig.build.json`).

Renames absorbed so far:

| Was | Now (as of 0.3.12) |
|---|---|
| `@mariozechner/pi-coding-agent` | `@earendil-works/pi-coding-agent` |
| `@sinclair/typebox` | `typebox` |

**At each sync, check what upstream's own extensions import** and match it:

```bash
head -3 extensions/research-tools/huggingface.ts    # canonical import style
grep -n "^import" extensions/parallel-search/parallel.ts   # must agree
```

Upstream ships `tests/typebox-migration.test.ts`, which fails the build if any source file still
references `@sinclair/typebox` — a useful tripwire, but it won't catch the Pi package rename.

Also watch TypeBox API removals. The 1.x migration dropped `Type.Base`, `Type.Awaited`,
`Type.Promise`, `Type.AsyncIterator`, `Type.Iterator`, `Type.Options`, and `Value.Mutate`.
`parallel.ts` uses only `Type.Object/String/Number/Boolean/Optional`, all stable so far.

### 3. Stale npm metadata cache → bogus `ETARGET`

A sync can fail with:

```
npm error code ETARGET
npm error notarget No matching version found for pi-<something>@<version>.
[feynman] npm failed while setting up bundled packages.
```

even though the version **does** exist. It is a stale cached packument for packages published
since your last install. Confirm and clear:

```bash
npm view pi-docparser versions   # if the version is listed, the registry is fine — cache was stale
```

Running `npm view` on the pinned packages refreshes the cache; so does `npm cache clean --force`.
This is not caused by the merge — it reproduces on a pristine upstream checkout.

### 4. `.nvmrc` moves between syncs

See [Node gotcha](#node-gotcha). `20.19.0` → `24.18.0` across the 2026-04 → 2026-08 window.

---

## Verification Checklist

A sync is done only when all of these pass.

```bash
node -v                       # 1. matches .nvmrc exactly
npm ci                        # 2. clean; leaves package-lock.json unmodified
npm run typecheck             # 3. THE gate on parallel.ts — build alone won't catch it
npm test                      # 4. full suite, incl. 13 parallel-search tests
npm run build                 # 5. clean
feynman --version             # 6. reports the new version, not the old one
feynman doctor                # 7. "pi runtime: ok"
git diff --name-status upstream/main HEAD   # 8. only the 5 fork files + FORK.md
```

Then two runtime checks that no unit test covers:

```bash
# 9. parallel-cli reachable and returning results
parallel-cli search "test query" --json --max-results 2

# 10. all four Feynman agents still win over pi-subagents' colliding builtins
PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT="$PWD/node_modules/@earendil-works/pi-coding-agent" \
node --import tsx -e "
const m = await import('./.feynman/npm/node_modules/pi-subagents/src/agents/agents.ts');
const r = m.discoverAgentsAll(process.cwd());
console.log('project agents:', r.project.map(a => a.name).join(', '));
"
# expect: researcher, reviewer, verifier, writer
```

`scripts/fork/check-fork-delta.sh` automates checks 1, 3 and 8.

---

## Retired Customisations

Kept for history. **Do not re-apply these.**

### Agent prompt overrides — retired 2026-08-06

The fork used to rewrite the "Search strategy" prose in `researcher.md`, the `fetch_content` →
`parallel_fetch` guidance in `verifier.md`, and the search instructions in `.feynman/SYSTEM.md`,
so the agents were *told* to prefer the parallel tools.

**Why retired:** upstream rewrites this prose constantly. Carrying it meant a hand-merge of
upstream's prompt work on every sync, and it had already silently dropped upstream's newer
`hf_*` tool guidance. Registering the tools and adding them to the frontmatter allowlist is
enough for the agents to use them, at a fraction of the merge cost.

### `npm:pi-subagents` removal — retired 2026-08-06

The fork removed `npm:pi-subagents` from `.feynman/settings.json` because that package's own
`researcher.md`/`reviewer.md` appeared to hide Feynman's `verifier`/`reviewer`/`writer` agents.

**Why retired:** upstream fixed it. Between v0.2.17 and v0.3.11 they shipped pi-subagents 0.40.0
plus "Patch Pi's user-scope package root so subagent fixes actually load" and "Repair
half-patched pi-subagents agents.ts". Verified on 2026-08-06: project-scope agents take
precedence over pi-subagents' builtins, and all four Feynman agents resolve to
`.feynman/agents/*.md`. Upstream's delegated-research architecture now depends on pi-subagents,
and `src/pi/package-presets.ts` re-adds it automatically — so the removal both breaks features
and does not stick.
