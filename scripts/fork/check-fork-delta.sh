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
scripts/fork/check-fork-delta.sh
scripts/fork/gen-models-json.mjs
tests/parallel-search.test.ts
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

note "--- 4. parallel tools wired into research-tools.ts (children load it) ---"
if grep -q "registerParallelTools(pi)" extensions/research-tools.ts 2>/dev/null; then
	ok "research-tools.ts registers parallel_* tools"
else
	bad "research-tools.ts no longer registers parallel_* -> subagents lose parallel tools"
fi

note '--- 5. parallel-cli present ---'
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
