#!/usr/bin/env bash
# Checks docs/best-practices-audit.md: one row per line of the vault's PWA checklist plus the 2026-10-09
# rules, every row has a status and evidence, every fail has a fix and a size, every `path:line` it cites
# exists, the ranked list has at most ten stories each with a runnable check, and the README links it.
# Run from the repo root: bash docs/check-best-practices-audit.sh
set -u
doc=docs/best-practices-audit.md
checklist="${PWA_CHECKLIST:-$HOME/millwright-vault/seats/builder/pwa-best-practices/checklist.md}"
fail=0
bad() { echo "FAIL: $1"; fail=1; }
trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; s="${s%"${s##*[![:space:]]}"}"; printf %s "$s"; }

[ -f "$doc" ] || { echo "FAIL: $doc does not exist"; exit 1; }

# One checklist row (C01...) per [ ] line of the vault checklist.
if [ -f "$checklist" ]; then
  want=$(grep -c '^\[ \]' "$checklist")
  have=$(grep -cE '^\| C[0-9]+ \|' "$doc")
  [ "$have" -eq "$want" ] || bad "checklist rows ($have) differ from [ ] lines in checklist.md ($want)"
else
  echo "note: $checklist not found; row count against the vault skipped"
fi

# The six rules added 2026-10-09 (R01...R06) are present.
rules=$(grep -cE '^\| R[0-9]+ \|' "$doc")
[ "$rules" -ge 6 ] || bad "fewer than six 2026-10-09 rule rows ($rules)"

# Every row: ID | Rule | Status | Evidence | Fix | Size.
rows=0
while IFS= read -r line; do
  rows=$((rows + 1))
  line=${line//\\|/}   # an escaped pipe inside a cell is not a column break
  [ "$(tr -cd '|' <<<"$line" | wc -c)" -eq 7 ] || bad "a row does not have six cells: ${line:0:40}"
  IFS='|' read -r _ id _rule status evidence fix size _ <<<"$line"
  id=$(trim "$id"); status=$(trim "$status"); evidence=$(trim "$evidence"); fix=$(trim "$fix"); size=$(trim "$size")
  case "$status" in pass | fail | n/a) ;; *) bad "$id: status is '$status', not pass, fail or n/a" ;; esac
  [ -n "$evidence" ] || bad "$id: no evidence"
  if [ "$status" = fail ]; then
    [ -n "$fix" ] && [ "$fix" != "-" ] || bad "$id: a fail row has no fix"
    [ -n "$size" ] && [ "$size" != "-" ] || bad "$id: a fail row has no size"
  fi
done < <(grep -E '^\| (C|R)[0-9]+ \|' "$doc")
echo "checked $rows rows"

# Every cited path:line exists (the file, and the line within it).
cites=0
for c in $(grep -o '`[^`]*`' "$doc" | tr -d '`' | grep -E '^[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+(-[0-9]+)?$' | sort -u); do
  cites=$((cites + 1))
  file=${c%%:*}; span=${c#*:}; last=${span##*-}
  if [ ! -f "$file" ]; then bad "cited file does not exist: $c"; continue; fi
  total=$(wc -l <"$file")
  [ "$last" -le "$total" ] || bad "cited line past the end of the file: $c ($total lines)"
done
echo "checked $cites file:line citations"

# The ranked list: at most ten stories, each with a check that can be run.
stories=$(grep -cE '^### F[0-9]+' "$doc")
checks=$(grep -cE '^\*\*Check:\*\*' "$doc")
[ "$stories" -ge 1 ] || bad "no ranked fix stories"
[ "$stories" -le 10 ] || bad "more than ten fix stories ($stories)"
[ "$checks" -eq "$stories" ] || bad "checks ($checks) differ from stories ($stories)"

grep -q 'docs/best-practices-audit.md' README.md || bad "README does not link docs/best-practices-audit.md"

[ "$fail" -eq 0 ] && echo "best-practices audit OK" || exit 1
