#!/usr/bin/env bash
#
# Fails if the committed poster/gallery artefacts are stale — if regenerating
# them from the current source would produce different images.
#
# The README asks a human to run `npm run posters` and commit the result when
# the inputs change. That was missed once already (ca926d5 changed the DRT
# normalisation and the microstructure rasteriser, and the derived images went
# out stale), which is why this is enforced rather than requested.
#
# Images are compared by decoded pixels, not file bytes. png.ts deflates IDAT
# through node:zlib, a native library whose output differs between Node builds,
# so a byte comparison reports a difference every time the Node version moves
# while every pixel is identical. Measured: generating under Node 22 and Node 26
# on the same machine gives 27 files that differ byte-for-byte and zero that
# differ by a pixel. See scripts/artifact-digest.mjs.
#
# Reproducibility of the physics itself is asserted rather than assumed: two
# passes into separate directories must agree before either is compared against
# the tree, so a genuine loss of determinism reports as itself instead of as an
# intermittently red build.
set -euo pipefail

cd "$(dirname "$0")/.."

digest() { node scripts/artifact-digest.mjs "$1"; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Regenerating posters (pass 1)..."
VOLTAIRE_POSTER_OUT="$tmp/a" npx tsx scripts/generate-posters.ts >/dev/null
echo "Regenerating posters (pass 2)..."
VOLTAIRE_POSTER_OUT="$tmp/b" npx tsx scripts/generate-posters.ts >/dev/null

digest "$tmp/a" > "$tmp/a.txt"
digest "$tmp/b" > "$tmp/b.txt"

if ! diff -q "$tmp/a.txt" "$tmp/b.txt" >/dev/null; then
  echo
  echo "FAIL: poster generation is not deterministic."
  echo "Two runs of the same source produced different images:"
  diff "$tmp/a.txt" "$tmp/b.txt" | sed 's/^/  /'
  echo
  echo "This check cannot verify staleness until generation is reproducible."
  echo "Look for an unseeded RNG, a timestamp, or map/set iteration order."
  exit 1
fi

# Compare against the tracked tree, considering only paths the generator writes.
# Hand-authored files under public/ (favicon.svg, robots.txt) are neither
# required nor flagged.
tracked="$tmp/tracked"
while read -r rel _; do
  if [ -f "public/$rel" ]; then
    mkdir -p "$tracked/$(dirname "$rel")"
    cp "public/$rel" "$tracked/$rel"
  fi
done < "$tmp/a.txt"
mkdir -p "$tracked"
digest "$tracked" > "$tmp/tracked.txt"

if diff -q "$tmp/a.txt" "$tmp/tracked.txt" >/dev/null; then
  echo "OK: $(wc -l < "$tmp/a.txt" | tr -d ' ') generated artefacts match the tracked tree."
  exit 0
fi

echo
echo "FAIL: tracked posters are stale."
echo
echo "These differ from what the current source generates:"
join -j 1 <(sort "$tmp/a.txt") <(sort "$tmp/tracked.txt") \
  | awk '$2 != $3 { print "  changed: public/" $1 }'
comm -23 <(awk '{print $1}' "$tmp/a.txt" | sort) <(awk '{print $1}' "$tmp/tracked.txt" | sort) \
  | sed 's|^|  missing: public/|'
echo
echo "Run 'npm run posters' and commit the result."
exit 1
