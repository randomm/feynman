# Fork Manifest

This repository is a fork of [`getcompanion-ai/feynman`](https://github.com/getcompanion-ai/feynman).

This file tracks all fork-specific customisations — what changed, why, which files are affected, and what to watch for when syncing with upstream.

## Upstream Remote Setup

Add the upstream remote (one-time setup):
```bash
git remote add upstream git@github.com:getcompanion-ai/feynman.git
git config rerere.enabled true
```

`rerere` (Reuse Recorded Resolution) remembers how you resolved merge conflicts and auto-applies those resolutions in future syncs.

## Upstream Sync Runbook

Run this process when you want to pull in upstream changes:

```bash
# 1. Fetch latest upstream commits
git fetch upstream

# 2. Review what changed upstream since last sync
git log HEAD..upstream/main --oneline

# 3. Check MEDIUM/HIGH risk files for upstream changes
git diff HEAD..upstream/main -- .feynman/agents/researcher.md
# Add other MEDIUM/HIGH risk files here as the fork grows

# 4. Merge upstream into main
git merge upstream/main

# 5. Resolve any conflicts — consult the feature entries below for each conflicted file's notes

# 6. After merge: update "Based on upstream" versions in this file
#    and refresh Conflict notes if the upstream structure has changed
```

## Merge Risk Classification

| Risk | Meaning |
|------|---------|
| **LOW** | Fork-owned file (new file, or in `extensions/` which upstream does not maintain). Conflicts very unlikely. |
| **MEDIUM** | File exists upstream and is occasionally updated. Conflicts possible but resolvable. Watch at sync time. |
| **HIGH** | Core upstream infrastructure, updated frequently. Expect conflicts every sync. May need careful manual reconciliation. |

## Fork Features

---

### parallel-cli web search extension

- **Issue**: #1
- **Status**: active
- **Based on upstream**: v0.2.17
- **Files touched**:
  - `extensions/parallel-search/parallel.ts` (new — fork-owned)
  - `extensions/research-tools.ts` (modified — adds registerParallelTools call)
  - `.feynman/agents/researcher.md` (modified — updates tool preference instructions)
- **Purpose**: Registers parallel-cli as the preferred web search backend, eliminating the need for third-party API keys (Perplexity/Exa/Gemini).
- **Merge risk**:
  - `extensions/parallel-search/parallel.ts` — **LOW** (new fork-owned file, upstream will never have it)
  - `extensions/research-tools.ts` — **MEDIUM** (file exists upstream; we added one import and one registerTool call — upstream may add imports/calls that conflict)
  - `.feynman/agents/researcher.md` — **MEDIUM** (upstream actively refines agent prompts; our tool-preference section at lines ~21-27 may conflict)
- **Conflict notes**: If upstream changes `.feynman/agents/researcher.md`, check whether the web search instruction block (lines ~21-27) has been updated. Our change adds tool-preference ordering; upstream changes are likely additive. Keep our `parallel_search` preference and append any new upstream instructions below it. For `extensions/research-tools.ts`: upstream may add new imports or registerTool calls. Keep our `registerParallelTools(pi)` call and merge any new upstream registrations alongside it.

---

### Fork divergence manifest and sync process

- **Issue**: #2
- **Status**: active
- **Based on upstream**: v0.2.17
- **Files touched**:
  - `FORK.md` (new — fork-owned)
- **Purpose**: Documents fork customisations and provides a runbook for syncing with upstream without losing fork-specific changes.
- **Merge risk**: **LOW** (new fork-owned file, upstream will never have it)
- **Conflict notes**: None expected.