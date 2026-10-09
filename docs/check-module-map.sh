#!/usr/bin/env bash
# Checks docs/module-map.md: the five sections, every backticked repo path exists,
# every proposed refactor carries typed signatures and a size, and the README links it.
# Run from the repo root: bash docs/check-module-map.sh
set -u
doc=docs/module-map.md
fail=0
bad() { echo "FAIL: $1"; fail=1; }

[ -f "$doc" ] || { echo "FAIL: $doc does not exist"; exit 1; }

for s in "Modules" "Collisions" "Proposed refactors" "Rule breaks" "Library candidates"; do
  grep -qE "^## ([0-9]+\. )?$s" "$doc" || bad "missing section: $s"
done

# Inline backticked repo paths (fenced blocks are left out: proposed modules that
# do not exist yet are shown there, never in inline backticks).
paths=$(awk '/^```/{f=!f; next} !f' "$doc" | grep -o '`[^`]*`' | tr -d '`' |
  grep -E '^(src|docs|grinds|schemas|tests|public)/|^[A-Za-z0-9_.-]+\.(md|json|ts|js|html|yml)$' | sort -u)
n=0
for p in $paths; do
  n=$((n + 1))
  [ -e "$p" ] || bad "path does not exist: $p"
done
echo "checked $n backticked paths"

refactors=$(grep -cE '^### R[0-9]+' "$doc")
sizes=$(grep -cE '^\*\*Size:\*\*' "$doc")
fences=$(awk '/^### R[0-9]+/{r++} /^```ts/{if (r) c++} END{print c+0}' "$doc")
[ "$refactors" -ge 3 ] || bad "fewer than three refactors ($refactors)"
[ "$sizes" -eq "$refactors" ] || bad "sizes ($sizes) differ from refactors ($refactors)"
[ "$fences" -ge "$refactors" ] || bad "a refactor has no typed-signature block"

grep -q 'docs/module-map.md' README.md || bad "README does not link docs/module-map.md"

[ "$fail" -eq 0 ] && echo "module map OK" || exit 1
