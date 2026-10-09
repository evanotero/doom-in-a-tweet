# DOOM in a tweet

The 1993 DOOM shareware episode, compiled to WebAssembly, playable inside a post on X.

X renders a **player card** (`twitter:card=player`) as an `<iframe>` of the `twitter:player` URL. That URL
here is `/embed/`, which serves a Doom player instead of a video. See [PLAN.md](PLAN.md) for the details.

## Layout

| Path | What |
|---|---|
| `engine/` | Vendored [cloudflare/doom-wasm](https://github.com/cloudflare/doom-wasm) (Chocolate Doom → Emscripten, GPLv2), plus a hand-written `config.h` and small input patches |
| `wad/doom1.wad` | Official shareware IWAD v1.9, unmodified (SHA-1 `5b2e249b9c5133ec987b3ea77596381dc0d6bc1d`, verified at build time) |
| `site/index.html` | Share page: the URL you tweet. It carries the card meta tags and plays full page |
| `site/embed/` | The iframe X loads inside the tweet |
| `site/player.js`, `player.css` | Player shell: click to play, loading progress, focus/pause, touch controls |
| `site/probe/` | Diagnostic card that reports what the X iframe allows (keys, audio, storage, …) |
| `site/_headers` | Cloudflare Pages headers. `frame-ancestors` only allows x.com and twitter.com |
| `build.sh` | Compiles the engine with `emcc` and assembles `dist/` |
| `scripts/make_poster.py` | Renders `site/poster.png` from the WAD's TITLEPIC |

## Build

```sh
source /path/to/emsdk/emsdk_env.sh
SITE_URL=https://doom.example.com ./build.sh   # → dist/
python -m http.server -d dist 8000
```

Changed a header? `rm -rf build/` first, because the incremental build only tracks `.c` files.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) builds on every push to `main` and deploys `dist/` to Cloudflare Pages
when these are set:

- secrets: `CLOUDFLARE_API_TOKEN` (Pages: Edit), `CLOUDFLARE_ACCOUNT_ID`
- variables (optional): `SITE_URL` (default `https://doom.evanotero.com`), `PAGES_PROJECT` (default `doom-in-a-tweet`)

## Tweeting it

1. Tweet `https://<site>/probe/` from a test account first to confirm X renders the iframe.
2. Then tweet `https://<site>/`. X caches cards for about 7 days, so add `?v=2` and so on to force a re-crawl.

## Credits

DOOM © 1993 id Software. The shareware `doom1.wad` is distributed unmodified. Engine: Chocolate Doom by Simon Howard
et al., with the WebAssembly port by Cloudflare, under GNU GPL v2 (see `engine/COPYING.md`). Not affiliated with
id Software or X.
