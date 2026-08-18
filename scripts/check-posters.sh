#!/usr/bin/env bash
#
# Fails if the tracked poster/gallery artefacts are stale, i.e. if regenerating
# them from the current source would produce different bytes.
#
# The README asks a human to run `npm run posters` and commit the result when
# the inputs change. That instruction was missed once already (ca926d5 changed
# the DRT normalisation and the microstructure rasteriser, and the derived
# images went out stale), which is why this exists.
#
# The check is only sound if generation is bit-reproducible, so it asserts that
# directly rather than assuming it: generate twice into separate directories and
# require the two to agree before comparing either against the tree. If that
# ever stops holding, this fails with a specific message instead of turning into
# an intermittently red build.
set -euo pipefail

cd "$(dirname "$0")/.."

if command -v sha256sum >/dev/null 2>&1; then
  hash_cmd() { sha256sum "$1" | cut -d' ' -f1; }
else
  hash_cmd() { shasum -a 256 "$1" | cut -d' ' -f1; }
fi

# relative path + hash for every file under a root, sorted
manifest() {
  local root=$1
  ( cd "$root" && find . -type f ! -name '.DS_Store' | sort | while read -r f; do
      printf '%s  %s\n' "${f#./}" "$(cd "$root" && hash_cmd "$f")"
    done )
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gen_a="$tmp/a"
gen_b="$tmp/b"

echo "Regenerating posters (pass 1)..."
VOLTAIRE_POSTER_OUT="$gen_a" npx tsx scripts/generate-posters.ts >/dev/null
echo "Regenerating posters (pass 2)..."
VOLTAIRE_POSTER_OUT="$gen_b" npx tsx scripts/generate-posters.ts >/dev/null

manifest "$gen_a" > "$tmp/a.txt"
manifest "$gen_b" > "$tmp/b.txt"

if ! diff -q "$tmp/a.txt" "$tmp/b.txt" >/dev/null; then
  echo
  echo "FAIL: poster generation is not deterministic."
  echo "Two runs of the same source produced different bytes:"
  diff "$tmp/a.txt" "$tmp/b.txt" | sed 's/^/  /'
  echo
  echo "This check cannot verify staleness until generation is reproducible."
  echo "Look for an unseeded RNG, a timestamp, or map/set iteration order."
  exit 1
fi

# Compare the generated tree against the tracked one. Only paths the generator
# actually writes are considered, so hand-authored files under public/ (favicon,
# robots.txt) are neither required nor flagged.
tracked="$tmp/tracked"
mkdir -p "$tracked"
( cd "$gen_a" && find . -type f | sed 's|^\./||' ) | while read -r rel; do
  if [ -f "public/$rel" ]; then
    mkdir -p "$tracked/$(dirname "$rel")"
    cp "public/$rel" "$tracked/$rel"
  fi
done

manifest "$tracked" > "$tmp/tracked.txt"

if diff -q "$tmp/a.txt" "$tmp/tracked.txt" >/dev/null; then
  echo "OK: $(wc -l < "$tmp/a.txt" | tr -d ' ') generated artefacts match the tracked tree."
  exit 0
fi

echo
echo "FAIL: tracked posters are stale."
echo
echo "These files differ from what the current source generates:"
join -j 1 <(cut -d' ' -f1,3 "$tmp/a.txt" | sort) <(cut -d' ' -f1,3 "$tmp/tracked.txt" | sort) 2>/dev/null \
  | awk '$2 != $3 { print "  changed: public/" $1 }'
comm -23 <(cut -d' ' -f1 "$tmp/a.txt" | sort) <(cut -d' ' -f1 "$tmp/tracked.txt" | sort) \
  | sed 's|^|  missing: public/|'
echo
echo "Run 'npm run posters' and commit the result."
exit 1
