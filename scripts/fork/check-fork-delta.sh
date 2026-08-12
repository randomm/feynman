#!/bin/sh
# Fork-owned. Verifies this fork still looks the way FORK.md says it should.
# Run after an upstream sync:  sh scripts/fork/check-fork-delta.sh
#
# Checks:
#   1. Node matches .nvmrc
#   2. parallel.ts imports agree with upstream's own extensions (catches Pi/TypeBox renames)
#   3. The diff vs upstream/main contains ONLY the expected fork files
#   4. parallel-cli is on PATH
set -eu

cd "$(dirname "$0")/../.."
fail=0
note() { printf '%s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
ok()   { printf 'ok    %s\n' "$*"; }

# Everything the fork is allowed to change. Keep in sync with FORK.md.
EXPECTED='FORK.md
extensions/parallel-search/parallel.ts
extensions/research-tools.ts
extensions/fork/current-date.ts
scripts/fork/check-fork-delta.sh
scripts/fork/gen-models-json.mjs
src/model/catalog.ts
tests/parallel-search.test.ts
tests/current-date-context.test.ts
tests/pro-class-allowlist.test.ts
.feynman/agents/researcher.md
.feynman/agents/verifier.md'

note '--- 1. Node version ---'
want=$(cat .nvmrc)
have=$(node -v 2>/dev/null | sed 's/^v//' || echo none)
if [ "$want" = "$have" ]; then
	ok "node $have matches .nvmrc"
else
	bad "node is $have but .nvmrc wants $want  ->  fnm install $want && fnm use"
fi

note '--- 2. parallel.ts imports match upstream style ---'
# huggingface.ts is upstream-owned and uses the canonical Pi + typebox imports.
ref=extensions/research-tools/huggingface.ts
if [ -f "$ref" ]; then
	for pkg in $(grep -oE 'from "[^"]+"' "$ref" | sed 's/from "//;s/"//' | grep -E 'pi-coding-agent|typebox'); do
		if grep -q "\"$pkg\"" extensions/parallel-search/parallel.ts; then
			ok "parallel.ts imports $pkg"
		else
			bad "parallel.ts does NOT import $pkg (upstream renamed it?) -> run: npm run typecheck"
		fi
	done
else
	bad "reference file $ref missing - upstream restructured extensions/"
fi

note '--- 3. Fork delta vs upstream/main ---'
if git rev-parse --verify --quiet upstream/main >/dev/null; then
	# Diff upstream/main against the WORKING TREE (no HEAD), so uncommitted
	# deviations are caught too - not just committed ones.
	expected_file=$(mktemp)
	actual_file=$(mktemp)
	printf '%s\n' "$EXPECTED" | sort > "$expected_file"
	git diff --name-only upstream/main | sort > "$actual_file"
	unexpected=$(comm -23 "$actual_file" "$expected_file")
	rm -f "$expected_file" "$actual_file"
	if [ -z "$unexpected" ]; then
		ok "only expected fork files differ"
	else
		bad "unexpected files differ from upstream (revert them to upstream):"
		printf '%s\n' "$unexpected" | sed 's/^/        /'
	fi
else
	bad "no upstream/main ref -> git remote add upstream https://github.com/companion-inc/feynman.git && git fetch upstream"
fi

note '--- 4. Pro-class allowlist patch survived ---'
# A merge that takes upstream's src/model/catalog.ts wholesale silently removes
# this, and DeepSeek-V4-Pro vanishes from `feynman model list` again.
if grep -q 'PRO_CLASS_ALLOWLIST_DEFAULT' src/model/catalog.ts 2>/dev/null &&
   grep -q 'proClassAllowlist()' src/model/catalog.ts 2>/dev/null; then
	ok "src/model/catalog.ts still carries the allowlist patch"
else
	bad "src/model/catalog.ts LOST the Pro-class allowlist patch -> re-apply it (see FORK.md); tests/pro-class-allowlist.test.ts will also be failing"
fi

note '--- 5. subagent extension path is correct ---'
# Child subagents do not inherit Feynman's local extensions, so researcher/verifier
# declare subagentOnlyExtensions with an ABSOLUTE path. If the repo is ever moved or
# cloned elsewhere, that path silently stops resolving and every research delegation
# fails with "requested unavailable child tools".
want_ext="$(pwd)/extensions/research-tools.ts"
sub_ok=1
for agent in .feynman/agents/researcher.md .feynman/agents/verifier.md; do
	got=$(grep -m1 '^subagentOnlyExtensions:' "$agent" 2>/dev/null | sed 's/^subagentOnlyExtensions:[[:space:]]*//')
	if [ -z "$got" ]; then
		bad "$agent has no subagentOnlyExtensions -> subagent tool calls will fail"
		sub_ok=0
	elif [ "$got" != "$want_ext" ]; then
		bad "$agent points at '$got' but this repo is at '$want_ext' -> update it"
		sub_ok=0
	elif [ ! -f "$got" ]; then
		bad "$agent points at '$got' which does not exist"
		sub_ok=0
	fi
done
[ "$sub_ok" -eq 1 ] && ok "researcher + verifier load extensions/research-tools.ts in child sessions"

note '--- 6. parallel-cli present ---'
if command -v parallel-cli >/dev/null 2>&1; then
	ok "parallel-cli at $(command -v parallel-cli)"
else
	bad 'parallel-cli not on PATH - every parallel_* tool call will fail with ENOENT'
fi

note ''
if [ "$fail" -eq 0 ]; then
	note 'Fork delta OK. Still run: npm ci && npm run typecheck && npm test && npm run build'
else
	note 'Fork delta has problems (see FAIL lines above).'
fi
exit "$fail"
