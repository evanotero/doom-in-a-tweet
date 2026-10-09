#!/usr/bin/env bash
# Builds the Doom engine to WebAssembly and assembles the deployable site in dist/.
#
#   ./build.sh            # needs emcc on PATH (source emsdk_env.sh first)
#   EMCC=/path/emcc ./build.sh
#
# Output: dist/ (static site, ready for Cloudflare Pages / any static host)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENGINE="$ROOT/engine"
OBJ="$ROOT/build/obj"
DIST="$ROOT/dist"
EMCC="${EMCC:-emcc}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"

WAD_SHA1="5b2e249b9c5133ec987b3ea77596381dc0d6bc1d" # official shareware doom1.wad v1.9

echo "==> Verifying doom1.wad"
actual="$(sha1sum "$ROOT/wad/doom1.wad" | cut -d' ' -f1)"
if [ "$actual" != "$WAD_SHA1" ]; then
    echo "doom1.wad SHA-1 mismatch: got $actual, want $WAD_SHA1" >&2
    exit 1
fi

# The emscripten ports (SDL2, SDL2_mixer, SDL2_net) are pulled in by these flags at
# compile and link time.
PORTS=(-sUSE_SDL=2 -sUSE_SDL_MIXER=2 -sUSE_SDL_NET=2)

CFLAGS=(
    -O3
    "${PORTS[@]}"
    -I"$ENGINE" -I"$ENGINE/src" -I"$ENGINE/src/doom"
    -I"$ENGINE/textscreen" -I"$ENGINE/opl" -I"$ENGINE/pcsound"
    -Wno-everything
)

LDFLAGS=(
    -O3
    "${PORTS[@]}"
    -sASYNCIFY
    -sINITIAL_MEMORY=64MB
    -sALLOW_MEMORY_GROWTH=0
    -sFORCE_FILESYSTEM=1
    -sINVOKE_RUN=0
    -sEXIT_RUNTIME=1
    -sERROR_ON_UNDEFINED_SYMBOLS=0
    -sEXPORTED_RUNTIME_METHODS=FS,callMain
    -lwebsocket.js
)

# Sources: the whole engine minus platform-specific/unused files.
EXCLUDE='(i_main_win|w_file_win32|opl_linux|opl_obsd|opl_win32|pcsound_bsd|pcsound_linux|pcsound_win32|z_native|d_dedicated|net_dedicated)\.c$'
mapfile -t SOURCES < <(
    cd "$ENGINE" && find src opl pcsound textscreen -name '*.c' | grep -Ev "$EXCLUDE" | sort
)

echo "==> Compiling ${#SOURCES[@]} files with $JOBS jobs"
mkdir -p "$OBJ"
export EMCC ENGINE OBJ
export CFLAGS_STR="${CFLAGS[*]}"
printf '%s\n' "${SOURCES[@]}" | xargs -P "$JOBS" -I{} bash -c '
    src="{}"
    out="$OBJ/${src//\//_}.o"
    if [ ! -f "$out" ] || [ "$ENGINE/$src" -nt "$out" ]; then
        "$EMCC" $CFLAGS_STR -c "$ENGINE/$src" -o "$out" || exit 255
    fi
'

echo "==> Linking"
mkdir -p "$DIST/game"
"$EMCC" "${OBJ}"/*.o "${LDFLAGS[@]}" -o "$DIST/game/doom.js"

echo "==> Assembling site"
cp -r "$ROOT/site/." "$DIST/"
cp "$ROOT/wad/doom1.wad" "$DIST/game/doom1.wad"

# Absolute URLs are required in the card meta tags.
SITE_URL="${SITE_URL:-https://doom.evanotero.com}"
SOURCE_URL="${SOURCE_URL:-https://github.com/evanotero/doom-in-a-tweet}"
find "$DIST" -name '*.html' -exec sed -i \
    -e "s#__SITE_URL__#${SITE_URL%/}#g" \
    -e "s#__SOURCE_URL__#${SOURCE_URL}#g" {} +

# manifest.json: decompressed sizes for the progress bar, plus a content hash used as
# ?v= so /game/* can be cached immutably.
size() { wc -c < "$1" | tr -d ' '; }
VERSION="$(cat "$DIST/game/doom.js" "$DIST/game/doom.wasm" "$DIST/game/doom1.wad" "$DIST/game/default.cfg" | sha1sum | cut -c1-12)"
cat > "$DIST/manifest.json" <<EOF
{
  "version": "$VERSION",
  "files": {
    "wasm": { "size": $(size "$DIST/game/doom.wasm") },
    "wad": { "size": $(size "$DIST/game/doom1.wad") }
  }
}
EOF

ls -la "$DIST" "$DIST/game"
echo "==> Done: $DIST"
