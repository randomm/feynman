#!/bin/sh
# Fork-owned. Verifies this fork still looks the way FORK.md says it should.
# Run after an upstream sync:  sh scripts/fork/check-fork-delta.sh
#
# Checks:
#   1. Node matches .nvmrc
#   2. Our tool code imports the same Pi + typebox packages upstream's extensions do
#      (catches Pi/TypeBox renames)
#   3. The diff vs upstream/main contains ONLY the expected fork files
#   4. The research-tools.ts wiring registers both backends, and both agents allowlist
#      the feynman_web_* tools
#   5. Backends present: parallel-cli and wigolo (one missing = WARN, both = FAIL)
set -eu

cd "$(dirname "$0")/../.."
fail=0
nwarn=0
note() { printf '%s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
warn() { printf 'WARN  %s\n' "$*"; nwarn=$((nwarn + 1)); }
ok()   { printf 'ok    %s\n' "$*"; }

# Everything the fork is allowed to change. Keep in sync with FORK.md.
EXPECTED='FORK.md
extensions/parallel-search/parallel.ts
extensions/research-tools.ts
extensions/web-providers/exec.ts
extensions/web-providers/tools.ts
extensions/web-providers/wigolo.ts
scripts/fork/check-fork-delta.sh
scripts/fork/gen-models-json.mjs
scripts/fork/install-wigolo.sh
tests/parallel-search.test.ts
tests/web-providers.test.ts
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

note '--- 2. fork tool code imports match upstream style ---'
# huggingface.ts is upstream-owned and uses the canonical Pi + typebox imports.
ref=extensions/research-tools/huggingface.ts
if [ -f "$ref" ]; then
	for file in extensions/parallel-search/parallel.ts extensions/web-providers/tools.ts; do
		for pkg in $(grep -oE 'from "[^"]+"' "$ref" | sed 's/from "//;s/"//' | grep -E 'pi-coding-agent|typebox'); do
			if grep -q "\"$pkg\"" "$file"; then
				ok "$file imports $pkg"
			else
				bad "$file does NOT import $pkg (upstream renamed it?) -> run: npm run typecheck"
			fi
		done
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

note '--- 4. Web tools wired into research-tools.ts and allowlisted for subagents ---'
if grep -q "registerParallelTools(pi)" extensions/research-tools.ts 2>/dev/null; then
	ok "research-tools.ts registers parallel_* tools (legacy, unchanged)"
else
	bad "research-tools.ts no longer registers parallel_* -> subagents lose parallel tools"
fi
if grep -q "registerWebTools(pi)" extensions/research-tools.ts 2>/dev/null; then
	ok "research-tools.ts registers feynman_web_* tools"
else
	bad "research-tools.ts no longer registers feynman_web_* -> the default web backend is gone"
fi
for tool in feynman_web_search feynman_web_fetch; do
	if grep -q "^tools:.*$tool" .feynman/agents/researcher.md .feynman/agents/verifier.md 2>/dev/null; then
		ok "$tool is on an agent tools: allowlist"
	else
		bad "$tool is on no agent tools: allowlist -> subagents cannot call it"
	fi
done
if grep -q "^tools:.*feynman_web_research" .feynman/agents/researcher.md 2>/dev/null; then
	ok "feynman_web_research is on the researcher tools: allowlist"
else
	bad "feynman_web_research is missing from the researcher tools: allowlist"
fi

note '--- 5. Backends present (fallback needs at least one) ---'
parallel_ok=0
wigolo_bin="${FEYNMAN_WIGOLO_BIN:-}"
if [ -z "$wigolo_bin" ] && [ -x "$HOME/.feynman/bin/wigolo" ]; then
	wigolo_bin="$HOME/.feynman/bin/wigolo"
fi
[ -n "$wigolo_bin" ] || wigolo_bin=wigolo

if command -v parallel-cli >/dev/null 2>&1; then
	parallel_ok=1
	ok "parallel-cli at $(command -v parallel-cli)"
else
	parallel_ok=0
fi

wigolo_ok=0
if command -v "$wigolo_bin" >/dev/null 2>&1 || [ -x "$wigolo_bin" ]; then
	wigolo_ok=1
	ok "wigolo at $wigolo_bin"
	# Native module must load under the Node that runs the wrapper.
	prefix_dir="$HOME/.feynman/tools/wigolo"
	if [ -d "$prefix_dir/node_modules/better-sqlite3" ]; then
		if (cd "$prefix_dir" && node -e "new (require('better-sqlite3'))(':memory:')" >/dev/null 2>&1); then
			ok "better-sqlite3 loads under node $(node -v)"
		else
			bad "better-sqlite3 does not load under node $(node -v) -> sh scripts/fork/install-wigolo.sh"
		fi
	fi
else
	wigolo_ok=0
fi

if [ "$parallel_ok" -eq 0 ] && [ "$wigolo_ok" -eq 0 ]; then
	bad "neither parallel-cli nor wigolo is available - every web tool call will fail"
elif [ "$wigolo_ok" -eq 0 ]; then
	warn "wigolo not found at $wigolo_bin -> feynman_web_* falls back to parallel-cli -> sh scripts/fork/install-wigolo.sh"
elif [ "$parallel_ok" -eq 0 ]; then
	warn "parallel-cli not on PATH -> feynman_web_* has no fallback, and provider:\"parallel\" calls will fail with ENOENT"
fi

note ''
if [ "$fail" -eq 0 ] && [ "$nwarn" -eq 0 ]; then
	note 'Fork delta OK. Still run: npm ci && npm run typecheck && npm test && npm run build'
elif [ "$fail" -eq 0 ]; then
	note "Fork delta OK with $nwarn warning(s)."
else
	note 'Fork delta has problems (see FAIL lines above).'
fi
exit "$fail"
