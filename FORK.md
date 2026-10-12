# Fork Manifest

Private fork of **[`companion-inc/feynman`](https://github.com/companion-inc/feynman)**.

> The old `getcompanion-ai/feynman` URL still works but is a **redirect**. Always use
> `companion-inc/feynman` — the GitHub API returns `getcompanion-ai` paths as `404` in some
> forms, which silently produces wrong answers when scripting against it.

This fork is **not** upstreamed. Nothing here is intended for a PR to `companion-inc`. The only
reason it exists is to keep the **web search integration** working: **wigolo** (local, keyless,
the default) with **parallel-cli** (parallel.ai) as the fallback. Everything else should track
upstream exactly. See [Web backends](#web-backends-wigolo-default-parallel-fallback).

## Sync State

| | |
|---|---|
| Last synced | **2026-10-12** |
| Upstream commit | `6f1adbe` (`main`, package version `0.5.39`) |
| Upstream tag line | v0.5.39 |
| Previous sync | 2026-08-06 at `daa7f47` (v0.3.12) — 462 commits of drift |

**Update this table on every sync.** It is the only record of where the fork sits.

---

## Guiding Principle

> **Take upstream verbatim for everything except the fork-owned files listed in the Fork Delta below.
> Never re-apply a fork edit to agent *prose*, only to the frontmatter `tools:` allowlist.**

Upstream actively rewrites the agent prompts (`researcher.md`, `verifier.md`, `SYSTEM.md`).
An earlier version of this fork overrode that prose, which meant every sync had to hand-merge
upstream's prompt improvements, and it silently dropped new upstream tools. That is retired —
see [Retired Customisations](#retired-customisations).

### Deliberate non-change: `pi-web-access` stays

All web access is meant to go through parallel.ai, so it is tempting to strip `pi-web-access`.
**Don't.** Decided 2026-08-06:

- No keyed backend is configured here: `feynman doctor` shows exa / perplexity / gemini all *"not
  configured"*. This fork has **not** verified whether pi-web-access's keyless path makes calls, so
  treat its `web_search` as possibly live. The fork's own web traffic goes through `feynman_web_*`
  (wigolo, then parallel).
- Removing it from `.feynman/settings.json` does not stick — `src/pi/settings.ts`
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
| **wigolo** runtime | The default web backend for `feynman_web_*`. Run `sh scripts/fork/install-wigolo.sh` under the `.nvmrc` Node. It installs the pinned `wigolo@0.2.1` into `~/.feynman/tools/wigolo` and writes the wrapper `~/.feynman/bin/wigolo`. |
| **`parallel-cli`** on `$PATH` | The fallback backend, and the only route to parallel's deep research. Without it `feynman_web_*` has no fallback, and `provider:"parallel"` calls and the legacy `parallel_*` tools fail with `ENOENT`. |
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

Exactly **thirteen** files differ from upstream. Verify with:

```bash
sh scripts/fork/check-fork-delta.sh          # automated
git diff --name-status upstream/main HEAD    # or by hand
```

| File | Risk | Change |
|---|---|---|
| `extensions/parallel-search/parallel.ts` | **LOW** | **New, fork-owned.** Exports `registerParallelTools(pi)` and `runParallelCli` (the web router reuses it), registering `parallel_search`, `parallel_fetch`, `parallel_research`. Shells out to `parallel-cli` via `execFile` (no shell → no injection), always `--json`, 5-min timeout, 50 MB stdout cap. |
| `tests/parallel-search.test.ts` | **LOW** | **New, fork-owned.** 13 unit tests over a mock `pi`. Runs as part of `npm test`. |
| `extensions/web-providers/exec.ts` | **LOW** | **New, fork-owned.** Injectable `execFile` wrapper for the wigolo and parallel CLIs. Non-zero exits resolve with stdout. |
| `extensions/web-providers/wigolo.ts` | **LOW** | **New, fork-owned.** wigolo argument builders, stdout parser, failure classifier, one jittered `SQLITE_BUSY` retry, and a concurrency limiter. |
| `extensions/web-providers/tools.ts` | **MEDIUM** | **New, fork-owned.** Registers `feynman_web_search`, `feynman_web_fetch`, `feynman_web_research` and the router (wigolo by default, parallel as fallback). See [Web backends](#web-backends-wigolo-default-parallel-fallback). |
| `tests/web-providers.test.ts` | **LOW** | **New, fork-owned.** 25 router, classifier, argument, and limiter tests with an injected `exec`. No real backend is spawned. Runs as part of `npm test`. |
| `scripts/fork/install-wigolo.sh` | **LOW** | **New, fork-owned.** Installs the pinned `wigolo@0.2.1`, warms its models, and writes the `~/.feynman/bin/wigolo` wrapper. |
| `scripts/fork/check-fork-delta.sh` | **LOW** | **New, fork-owned.** Post-sync verification. |
| `scripts/fork/gen-models-json.mjs` | **LOW** | **New, fork-owned.** Generates `~/.feynman/agent/models.json` for Nebius and Trail Openers. See below. |
| `extensions/research-tools.ts` | **MEDIUM** | **Two imports and two calls**: `registerParallelTools` and `registerWebTools`. Upstream adds registrations here often — it has merged cleanly so far because our lines sit in a stable alphabetical slot. |
| `.feynman/agents/researcher.md` | **MEDIUM** | Frontmatter only: appends `parallel_search, parallel_fetch, parallel_research, feynman_web_search, feynman_web_fetch, feynman_web_research` to upstream's `tools:`. |
| `.feynman/agents/verifier.md` | **MEDIUM** | Frontmatter only: appends `parallel_fetch, feynman_web_fetch` to upstream's `tools:`. |
| `FORK.md` | **LOW** | This file. Upstream has no counterpart. |

Nothing else. In particular the fork does **not** touch `package.json`, `package-lock.json`,
`.feynman/settings.json`, `.feynman/SYSTEM.md`, `src/model/catalog.ts`, or `outputs/`. If a sync
leaves a diff in any of those, it is accidental — revert it to upstream.

### Current-date injection (RETIRED 2026-10-12 — upstream ships its own)

Upstream added `extensions/research-tools/current-date.ts`, which injects the date into the system
prompt via `before_agent_start`. Per the rule below, the fork's own injection was removed and its
`extensions/fork/current-date.ts`, its test, and its wiring in `research-tools.ts` were dropped.
Subagents still get the date because they load `research-tools.ts` as a whole.

_Original rationale, kept for history:_

### Current-date injection — research correctness, not cosmetics

**Neither Pi nor Feynman puts the current date in the prompt.** Verified by capturing a real
provider request: 38,311 characters of system prompt, zero references to any date. Yet that same
prompt tells the agent to research *"latest/current/recent"* topics.

With no anchor, the model assumes its training cutoff is "now". An observed research run
**silently discarded every source published after 2025** as implausible. This is a correctness
bug, not a cosmetic one: it corrupts recency judgements and citation selection without any error.

`extensions/fork/current-date.ts` registers a handler on Pi's `context` event — which shapes the
per-request context only and does **not** mutate persisted session state — appending a block that
states the real date and tells the model not to reject post-cutoff material. Old blocks are
stripped before a fresh one is added, so a long-running session can neither accumulate duplicates
nor carry a stale date.

It is wired in `extensions/research-tools.ts`, the same file the agents load via
`subagentOnlyExtensions`, so **subagents get the date too** — important, because the researcher
subagent is what actually judges source recency.

If upstream ever adds its own date/environment block, drop this to avoid two competing blocks.

### `subagentOnlyExtensions` — RETIRED 2026-10-12 (kept for history; upstream now wires this)

Child subagents **do not inherit Feynman's local `./extensions`**. `pi-subagents` launches them
with only its runtime extension plus whatever npm packages `settings.json` lists — a run's
`launchResolvedExtensions.configured` is `[]` without this fix. The frontmatter `tools:` field is
a *strict allowlist that does not load extension code*, so naming an extension tool there without
loading its provider is a hard failure:

```
Error: Agent 'researcher' requested unavailable child tools:
hf_dataset_info, hf_repo_files, hf_repo_read_file, parallel_search, parallel_fetch, parallel_research
```

Both agents therefore carry:

```
subagentOnlyExtensions: /Users/janni/projects/feynman/extensions/research-tools.ts
```

That single file registers **both** upstream's `hf_*` tools and this fork's `parallel_*` tools.

Two things to know:

- **This is upstream's bug too.** Upstream's `researcher.md` declares `hf_dataset_info`,
  `hf_repo_files` and `hf_repo_read_file` with no `subagentOnlyExtensions`, so upstream research
  delegations fail on those names as well. Our `parallel_*` entries merely lengthen the list. If
  upstream ever wires its own extensions into children, this line may become redundant — check at
  sync time before carrying it forward blindly.
- **The path is absolute**, because the child's cwd is the project being worked in, not this repo.
  Move or re-clone the repo and every delegation breaks. `scripts/fork/check-fork-delta.sh`
  check 5 asserts the path matches the current repo root and exists, so this fails loudly
  rather than at the next research run.

Package-provided tools are unaffected: `web_search` / `fetch_content` come from the
`pi-web-access` **package**, which children do load. That asymmetry is why a delegation can look
half-working — one agent succeeds on `fetch_content` while its siblings die on `parallel_search`.

### The `src/model/catalog.ts` patch — RETIRED 2026-10-12 (kept for history; see below)

Upstream disables "Pro-class" models as a cost guard:

```js
const PRO_CLASS_MODEL_PATTERN = /(?:^|[-_.:/])pro(?:$|[-_.:/])/i;
```

It matches the literal word "pro", which false-positives on open-weight models merely *named*
"Pro". `deepseek-ai/DeepSeek-V4-Pro` costs $1.75/$3.50 per Mtok on Nebius — cheaper than
`moonshotai/Kimi-K3` ($3/$15), which the guard allows. The guard is enforced in **8 places**
(`src/cli.ts` ×6, `src/pi/settings.ts`, `src/model/catalog.ts`) with **no env var or flag
override**, so config alone cannot bypass it, and Pi has no display-id/wire-id split to alias
around it.

The fork narrows the guard with an allowlist, defaulting to DeepSeek-V4-Pro and extensible at
runtime via `FEYNMAN_ALLOW_PRO_MODELS` (comma-separated) — so **adding future models needs no
further code change**.

**Why this is safe to carry:** `tests/pro-class-allowlist.test.ts` fails loudly if the patch is
lost, and `scripts/fork/check-fork-delta.sh` greps for it explicitly. A sync that resolves this
file by taking upstream wholesale cannot fail silently. To re-apply after a bad merge: re-add
`PRO_CLASS_ALLOWLIST_DEFAULT` + `proClassAllowlist()` near the pattern, and the early-return
inside `isProClassModelSpec`. Keep upstream's regex untouched.

---

## Web backends (wigolo default, parallel fallback)

Agents reach the web through `feynman_web_search`, `feynman_web_fetch` and `feynman_web_research`.
They use **wigolo** (local, keyless, `wigolo@0.2.1`) by default and **parallel-cli** as the fallback.
The legacy `parallel_search`, `parallel_fetch` and `parallel_research` tools are unchanged and still
call parallel directly, so they remain a no-surprise escape hatch.

| Tool | `auto` order | Falls back to parallel when | Notes |
|---|---|---|---|
| `feynman_web_search` | wigolo, then parallel | infra error, timeout, or no results with no engines reached | `includeDomains`, `category`, `withContent` are wigolo-only |
| `feynman_web_fetch` | wigolo, then parallel | infra error, `fetch_failed`, or `blocked_by_challenge` | `section`, `maxChars` are wigolo-only; `objective` is parallel-only |
| `feynman_web_research` | wigolo only | **never** in `auto`; the error names `provider:"parallel"` as the paid deep-run alternative | `depth` is wigolo-only |

- A per-call `provider: "auto" | "wigolo" | "parallel"` overrides the default. An explicit provider makes
  exactly one attempt.
- `invalid_input` is never retried or sent to the other backend. It is thrown.
- A result starts with `[backend: wigolo]` or `[backend: parallel | fallback from wigolo: <reason>]`.
  `details` carries `provider`, `attempts`, `warnings` and the backend's raw payload.
- Tool names are deliberately not `wigolo_*` or `parallel_*`, so the model sees one surface whichever
  backend answers.

Environment variables:

| Variable | Default | Effect |
|---|---|---|
| `FEYNMAN_WEB_PROVIDER` | `auto` | Default backend when a call does not pass `provider`. An invalid value warns and uses `auto`. Set `parallel` to roll everything back. |
| `FEYNMAN_WEB_FALLBACK` | on | Set to `0` to disable fallback in `auto`. |
| `FEYNMAN_WIGOLO_BIN` | `~/.feynman/bin/wigolo`, else `wigolo` on `PATH` | wigolo executable or wrapper. |
| `FEYNMAN_WIGOLO_CONCURRENCY` | `2` (max 8) | Concurrent wigolo processes per Feynman process. Subagents are separate processes that share `~/.wigolo`, so this is not a global cap. |

Install, and re-install after any Node bump:

```bash
sh scripts/fork/install-wigolo.sh      # under the .nvmrc Node
```

The script installs `wigolo@0.2.1` into `~/.feynman/tools/wigolo`, runs `wigolo warmup` (a one-time
model download), and writes `~/.feynman/bin/wigolo`. The wrapper pins the Node that built the native
module, and points wigolo's `research` synthesis at the Trail Openers endpoint through
`OPENAI_BASE_URL` and `WIGOLO_LLM_MODEL`. The API key is **not** handled by the fork: wigolo keeps it
in its own keychain entry (`wigolo doctor` shows `openai configured (keychain)`).

Known limits:

- `wigolo research` synthesis runs on the Trail Openers box. If that box is down, research fails with
  `upstream_error` and there is no automatic fallback. Use `provider:"parallel"` deliberately.
- Concurrent wigolo processes share one SQLite cache. `SQLITE_BUSY` gets one retry and then falls back.
- The `sampling_supported` field in wigolo's payload reports MCP client sampling, not LLM availability.
  The fork does not treat it as a warning signal.
- Upstream prose (`SYSTEM.md`, the agent bodies) still names `web_search` and `fetch_content`. The
  default is enforced by the tools agents can call, not by that prose.
- Cold start is roughly one second for a cached search. Measured-cold numbers are not recorded yet.

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
| `.feynman/settings.json` | `git checkout --theirs` — **take upstream whole.** Upstream pins package versions here and `src/pi/settings.ts` reconciles it; any edit is fought by the reconciler. |
| `package.json`, `package-lock.json` | `git checkout --theirs` — the fork owns nothing here. |
| `.feynman/agents/researcher.md` | Take upstream whole, then append `, parallel_search, parallel_fetch, parallel_research, feynman_web_search, feynman_web_fetch, feynman_web_research` to the **frontmatter `tools:` line**. Leave all prose alone. |
| `.feynman/agents/verifier.md` | Take upstream whole, then append `, parallel_fetch, feynman_web_fetch` to the **frontmatter `tools:` line**. Leave all prose alone. |
| `extensions/research-tools.ts` | Keep upstream's full import + registration lists, then re-insert our two lines. |
| `src/model/catalog.ts` | Take upstream whole. The fork no longer patches this file (see Retired Customisations). |
| `extensions/parallel-search/parallel.ts`, `tests/parallel-search.test.ts`, `extensions/web-providers/*.ts`, `tests/web-providers.test.ts`, `scripts/fork/check-fork-delta.sh`, `scripts/fork/install-wigolo.sh` | Ours — upstream has no counterpart, so these never conflict. But `parallel.ts` **does** silently break on runtime renames; see Hazards. |

Never resolve an agent file by keeping "ours". Upstream adds tools to those allowlists
(it added `write`, `edit`, and three `hf_*` tools in the 0.2.17 → 0.3.11 window); keeping our
side wholesale would delete them and quietly reduce the agent's capability.

---

## Custom Model Providers (Nebius + Trail Openers)

This lives in `~/.feynman/agent/models.json`, **outside the repo** — so it is not part of the
fork delta, but it *is* wiped along with the rest of `~/.feynman/` on a bad day. Regenerate with:

```bash
node scripts/fork/gen-models-json.mjs
feynman model list          # expect 13 nebius/* + 1 trailopeners-h100/*
```

The script is idempotent, backs up any existing file, and writes keys as `$NEBIUS_API_KEY` /
`$TRAIL_OPENERS_LLM_KEY` **references** — no secret is ever written to disk. It needs
`node_modules/` installed (it reads Pi's model catalogue from there).

Two things worth knowing:

- **Nebius has two endpoints.** `api.tokenfactory.nebius.com` (global) serves 28 models;
  `api.tokenfactory.eu-west2.nebius.com` serves exactly one (`Kimi-K3`), because that model is
  hosted in `eu-west2`. The generator uses the global endpoint. Model names embed the region
  (e.g. *"GLM-5.1 (Nebius eu-north1)"*) so data residency is visible in the picker — most of the
  roster is `eu-north1`, with some in `uk-south1` and `us-central1`.
- **Trail Openers models come from the live server, with thinking OFF.** The model list and
  context window are read from `/v1/models` (vLLM reports `max_model_len`), so a box migration —
  e.g. Qwen3.6 → Qwen3.8 — is picked up by re-running the generator; no code edit needed. Entries
  are written with `reasoning: false`, matching the hand-maintained Pi config at
  `~/.pi/agent/models.json`. That parity is also a correctness requirement, because of a
  **bug in the served model**: it rejects `reasoning_effort: "high"` while accepting
  `low` / `medium` / `xhigh` (*"Supported types are xhigh (default), medium, and low"*).
  Feynman's researcher agent runs at `thinking: high`, so enabling reasoning without a
  workaround would fail every research delegation against this box. With `reasoning: false`
  Pi never sends the parameter — verified by a delegation that ran as
  `…Qwen3.8-27B-FP8:high` and exited 0.

  This is a **model-side defect, not an endpoint policy**, so re-check it after each box
  migration — a future model may accept `high` and need no special handling. If thinking is
  ever wanted here before then, do *not* flip `reasoning` on its own: add
  `thinkingLevelMap: { high: "xhigh" }` to remap the single broken level (Pi's
  `ThinkingLevelMap` maps pi thinking levels to provider values).
- **Nebius's API exposes no metadata** — `/v1/models` returns ids only, and there is no
  per-model detail endpoint. Pricing and context come from
  `tokenfactory.nebius.com/api/public/models_info` (an undocumented endpoint referenced by their
  pricing page). If that ever disappears, the generator fails loudly rather than writing zeros.

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

`parallel.ts`, `web-providers/tools.ts` and their tests import from the Pi runtime, and upstream has renamed these at least
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

### 4. wigolo's native module follows the Node version

`better-sqlite3` inside wigolo is a native module. The first `wigolo` run under a Node major
that the module was not built for fails with:

```
Error: The module '.../better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137.
```

This happened on this host: the `npx` cache had been built under Node 22 and was used under
Node 24. The fork avoids the `npx` cache entirely. `install-wigolo.sh` builds the module under the
current Node and writes a wrapper that pins that Node's absolute path. After any Node bump, re-run
`sh scripts/fork/install-wigolo.sh`. The delta check also loads `better-sqlite3` under the current
Node and fails if it does not load.

### 5. `.nvmrc` moves between syncs

See [Node gotcha](#node-gotcha). `20.19.0` → `24.18.0` across the 2026-04 → 2026-08 window.

---

## Verification Checklist

A sync is done only when all of these pass.

```bash
node -v                       # 1. matches .nvmrc exactly
npm ci                        # 2. clean; leaves package-lock.json unmodified
npm run typecheck             # 3. THE gate on parallel.ts — build alone won't catch it
npm test                      # 4. full suite, incl. the parallel-search and web-providers tests
npm run build                 # 5. clean
feynman --version             # 6. reports the new version, not the old one
feynman doctor                # 7. "pi runtime: ok"
git diff --name-status upstream/main HEAD   # 8. only the fork-owned files listed in the Fork Delta
```

Then two runtime checks that no unit test covers:

```bash
# 9. parallel-cli reachable and returning results
parallel-cli search "test query" --json --max-results 2

# 9b. wigolo (default backend) answers a search through the wrapper
~/.feynman/bin/wigolo search "test query" --json --max-results 2 --no-content

# 10. all four Feynman agents still win over pi-subagents' colliding builtins
PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT="$PWD/node_modules/@earendil-works/pi-coding-agent" \
node --import tsx -e "
const m = await import('./.feynman/npm/node_modules/pi-subagents/src/agents/agents.ts');
const r = m.discoverAgentsAll(process.cwd());
console.log('project agents:', r.project.map(a => a.name).join(', '));
"
# expect: researcher, reviewer, verifier, writer
```

`scripts/fork/check-fork-delta.sh` automates checks 1, 3 and 8, plus the web-tool wiring and
backend-presence checks. It exits non-zero on any FAIL (Node mismatch, a wrong fork delta, missing
wiring, or both backends missing). A single missing backend prints a WARN and still passes.

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

### `subagentOnlyExtensions` in agent frontmatter — retired 2026-10-12

Upstream now computes the child-session extension list itself (`feynmanSubagentExtensions` in
`src/pi/settings.ts`), pointing at `extensions/research-tools.ts` with the correct install path.
The fork's absolute-path frontmatter line was removed, along with the delta-script check that enforced it. `research-tools.ts` still registers the `parallel_*` tools, so children
still get them. Re-check if upstream ever stops wiring that file into children.

### `src/model/catalog.ts` Pro-class allowlist — retired 2026-10-12

Upstream fixed the same false positive with an exact-ID set (`NON_PREMIUM_PRO_MODEL_IDS`), which
already covers `deepseek-ai/deepseek-v4-pro`. The fork's `FEYNMAN_ALLOW_PRO_MODELS` override was
dropped because upstream's own test (`tests/catalog-snapshot.test.ts`) asserts that env override
must **not** bypass the guard. That is a deliberate upstream choice, so the fork follows it. Model
policy now means: add an entry to `NON_PREMIUM_PRO_MODEL_IDS` upstream, not in the fork.

_Original patch, kept for history:_

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
