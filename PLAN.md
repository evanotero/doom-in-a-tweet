# Doom in a Tweet — Plan

Goal: post a tweet whose card is a playable DOOM (shareware, `doom1.wad` v1.9) running in WASM, inline in the X timeline.

## How the trick actually works

It's not really a hack. It's X's **Player Card**, which was meant for embedding external video players. When X crawls a
URL in a tweet and finds these meta tags, it renders `twitter:player` as an `<iframe>` inside the tweet. Whatever that
iframe serves runs inline, and it doesn't have to be a video.

Checked against the reference tweet (`x.com/jsnnsa/status/2108316577770959056` → `spawn.co/@tiger/dust-2-dm/play`):

```html
<meta name="twitter:card"          content="player"/>
<meta name="twitter:title"         content="Dust 2 DM v385 on Spawn"/>
<meta name="twitter:description"   content="..."/>
<meta name="twitter:image"         content="https://.../og-image.webp"/>   <!-- poster before click -->
<meta name="twitter:player"        content="https://www.spawn.co/embed/card/<id>"/>  <!-- the iframe src -->
<meta name="twitter:player:width"  content="480"/>
<meta name="twitter:player:height" content="480"/>
```

Response headers on their embed URL:

```
content-security-policy: frame-ancestors 'self' https://x.com https://*.x.com https://twitter.com https://*.twitter.com
cross-origin-resource-policy: cross-origin
```

So there are two pages:
1. **Share page** (`/`): the URL that goes in the tweet. It carries the meta tags, and a normal visitor who opens it
   gets the game full screen.
2. **Embed page** (`/embed/`): the iframe target. Just the game canvas plus a "click to play" overlay, with framing allowed
   only from x.com and twitter.com.

## Biggest risk: player card allowlisting

X used to require each domain to be **allowlisted** before player cards would render, and the Card Validator that handled
approvals was retired in 2022. spawn.co clearly works today, but we can't tell whether they're allowlisted or whether X
stopped enforcing it. **Phase 0 tests this before anything else is built.**

## Architecture

```
doom-in-a-tweet/
├─ engine/                  # git submodule: cloudflare/doom-wasm (Chocolate Doom → Emscripten, GPLv2)
├─ site/
│  ├─ index.html            # share page: meta tags + full-page player
│  ├─ embed/index.html      # iframe page: canvas + click-to-play overlay + touch controls
│  ├─ game/                 # build output: websockets-doom.js / .wasm, default.cfg
│  ├─ doom1.wad             # official shareware IWAD, unmodified (SHA-1 checked in CI)
│  ├─ poster.png            # twitter:image (title screen, 1280x800)
│  └─ _headers              # Cloudflare Pages header rules
└─ .github/workflows/deploy.yml   # emsdk build → copy artifacts → deploy
```

### Engine: `cloudflare/doom-wasm`
- Chocolate Doom ported to Emscripten with SDL2 (video, sound, music via SDL_mixer). Its default is local single-player.
- No pthreads/SharedArrayBuffer, so we **don't** need COOP/COEP. That matters because cross-origin isolation inside X's
  iframe can't work: the parent page would have to opt in too.
- Build: `emconfigure autoreconf -fiv && ac_cv_exeext=".html" emconfigure ./configure --host=none-none-none && emmake make`.
- This machine has no Emscripten or WSL distro, so **build in GitHub Actions** (ubuntu + `mymindstorm/setup-emsdk`).
  The build can also run locally later in WSL or Docker if needed.
- Changes to make in our fork:
  - Launch args: `-iwad doom1.wad -window -nogui -config default.cfg`, with networking off.
  - `default.cfg`: modern keys (WASD + arrows, Ctrl/Space fire, E use), `novert`, sensible volume.
  - Remove the multiplayer and websocket UI from their `index.html`. We'll write our own shell.
- Fallback if the build fights us: `mattiasgustavsson/doom-crt`-style single-file port, or a `doomgeneric` WASM port
  (smaller, but no sound).

### WAD: official shareware `doom1.wad` (v1.9)
- Get it from Debian's `doom-wad-shareware` package or id's original `doom19s.zip`. Commit it unmodified.
- In CI, verify the hash (expected v1.9 SHA-1 `5b2e249b9c5133ec987b3ea77596381dc0d6bc1d`; confirm against our copy).
- Distribution basis: id's shareware terms allow giving away the unmodified shareware episode, and Carmack confirmed the
  shareware WAD is freely distributable (quoted in Debian's copyright file). Ship it **byte-for-byte unmodified**, under
  its original name.
- GPL: the engine is GPLv2, so link the source repo from the share page.

### Hosting: Cloudflare Pages (recommended)
- Free, global CDN, serves `.wasm` with the correct MIME type and brotli compression, and supports a `_headers` file.
- GitHub Pages also works (it sends no `X-Frame-Options`), but it can't set CSP or cache headers.
- Domain: a subdomain like `doom.evanotero.com` (CNAME to Pages).
- `_headers`:
  ```
  /embed/*
    Content-Security-Policy: frame-ancestors 'self' https://x.com https://*.x.com https://twitter.com https://*.twitter.com
    Cross-Origin-Resource-Policy: cross-origin
  /game/*
    Cache-Control: public, max-age=31536000, immutable
  /doom1.wad
    Cache-Control: public, max-age=31536000, immutable
  ```
  Don't set `X-Frame-Options` anywhere under `/embed/`.

## Embed page UX: problems specific to running inside an X iframe

| Problem | Fix |
|---|---|
| Audio can't autoplay; keyboard needs focus | Full-bleed "CLICK TO PLAY" overlay. On click: resume `AudioContext`, `canvas.focus()`, start engine |
| Arrow keys and space scroll the X timeline | `preventDefault` on game keys while the canvas has focus. Clicking inside the iframe moves focus out of X |
| Lost focus when the user clicks outside | Show a "click to resume" overlay on `blur`, and pause using `visibilitychange` / `IntersectionObserver` |
| Pointer lock and fullscreen are likely blocked by X's iframe `allow`/sandbox | Make keyboard-only controls work by default. Offer a "↗ open full game" link to the share page |
| Mobile (X app webview) | On-screen touch D-pad + FIRE/USE/OPEN buttons, shown on `pointer: coarse` |
| Card size / aspect | `twitter:player:width=640`, `height=480` (4:3 matches Doom's aspect-corrected 320x200). The canvas scales to fit |
| Load time inside a feed | Fetch WAD + wasm only after the click (about 6 MB, about 2 MB brotli'd). Show a progress bar |
| Savegames | Try IDBFS, but expect storage to be partitioned or blocked in the third-party iframe. That isn't critical |
| X card cache (about 7 days) | Tweet a URL with a cache-busting query, e.g. `/?v=3` |

## Phases

**Phase 0: verify the card trick (about 1 hour, do first)**
1. Deploy a throwaway share page and embed page to Pages. The embed page is a "probe": an animated canvas plus a readout
   of what works inside the iframe (key events, AudioContext, pointer lock, fullscreen, localStorage/IndexedDB, gamepad,
   `document.referrer`, viewport size).
2. Post it from a test/protected account and check web, iOS and Android.
3. If no iframe appears, try a different domain or subdomain and check X's current card docs and dev forum for an
   allowlisting route before continuing.

**Phase 1: Doom builds and runs on the web**
1. Add `cloudflare/doom-wasm` as a submodule or fork, and add the GitHub Actions emsdk build.
2. Add `doom1.wad` with a hash check, `default.cfg`, and a minimal shell page. Test it locally with any static server.

**Phase 2: the embed shell**
1. Click-to-play overlay, focus and key capture, blur/pause, progress bar.
2. Responsive canvas, touch controls, and an "open full game" link.

**Phase 3: share page and polish**
1. Meta tags, poster image (title screen render), a GPL source link, and shareware credits ("DOOM © id Software").
2. Deploy, test on all three X clients, then post the real tweet.

## Open decisions
- Domain/subdomain to use (proposed `doom.evanotero.com`).
- Cloudflare Pages vs. Vercel vs. GitHub Pages (recommended: Cloudflare Pages).
- Public repo name (needed for GPL source link + Actions).
