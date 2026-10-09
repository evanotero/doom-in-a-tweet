// Doom player shell, shared by /embed/ (the iframe X loads) and / (the share page).
//
// Usage: <div id="doom" class="doom-player" data-poster="/poster.png" data-full-url="/"></div>
//        <script src="/player.js"></script>
//
// Nothing heavy is fetched until the user clicks play. That matters inside a timeline,
// and the click also gives us the user activation needed for audio and keyboard focus.
(function () {
    "use strict";

    const root = document.getElementById("doom");
    const GAME_DIR = "/game/";
    // -warp 1 1 -skill 3: drop straight into E1M1 on Hurt Me Plenty (Esc still opens the menu).
    const ENGINE_ARGS = ["-iwad", "doom1.wad", "-window", "-nogui", "-nomusic", "-config", "default.cfg", "-skill", "3", "-warp", "1", "1"];

    const params = new URLSearchParams(location.search);
    const isTouch = params.has("touch") || window.matchMedia("(pointer: coarse)").matches;
    const isEmbed = window.self !== window.top;
    if (isTouch) root.classList.add("is-touch");

    // --- capture every AudioContext the engine creates so we can resume it on input ---
    const audioContexts = [];
    for (const name of ["AudioContext", "webkitAudioContext"]) {
        const Orig = window[name];
        if (!Orig) continue;
        window[name] = class extends Orig {
            constructor(...args) {
                super(...args);
                audioContexts.push(this);
            }
        };
    }
    let muted = false;
    const resumeAudio = () =>
        !muted && audioContexts.forEach((ctx) => ctx.state === "suspended" && ctx.resume().catch(() => {}));

    // --- DOM ---
    root.innerHTML = `
        <canvas id="canvas" tabindex="0" oncontextmenu="event.preventDefault()"></canvas>
        <div class="doom-overlay is-start" data-overlay>
            <div class="doom-play-btn" data-play-icon></div>
            <div class="doom-label" data-label>Click to play DOOM</div>
            <div class="doom-sublabel" data-sublabel>${
                isTouch ? "Shareware episode · touch controls" : "Shareware episode · WASD/arrows · Space/Ctrl fire · E use"
            }</div>
            <div class="doom-progress" data-progress hidden><div></div></div>
        </div>
        <div class="doom-corner">
            <button type="button" data-mute title="Mute / unmute">🔊</button>
            <button type="button" data-fullscreen title="Fullscreen" hidden>⛶</button>
            <a data-full href="${root.dataset.fullUrl || "/"}" target="_blank" rel="noopener" title="Open full game" ${
                isEmbed ? "" : "hidden"
            }>↗ full game</a>
        </div>
        <div class="doom-touch" data-touch></div>
    `;
    const $ = (sel) => root.querySelector(sel);
    const canvas = $("#canvas");
    const overlay = $("[data-overlay]");
    const label = $("[data-label]");
    const sublabel = $("[data-sublabel]");
    const progress = $("[data-progress]");
    const progressBar = progress.firstElementChild;
    const playIcon = $("[data-play-icon]");

    if (root.dataset.poster) overlay.style.setProperty("--poster", `url("${root.dataset.poster}")`);

    function showOverlay(text, sub, opts = {}) {
        overlay.hidden = false;
        overlay.classList.toggle("is-start", !!opts.start);
        label.textContent = text;
        sublabel.textContent = sub || "";
        sublabel.hidden = !sub;
        playIcon.hidden = !opts.icon;
        progress.hidden = !opts.progress;
    }

    // --- canvas sizing: fit 4:3 inside the player, integer-ish crisp scaling ---
    function fitCanvas() {
        const w = root.clientWidth;
        const h = root.clientHeight;
        const scale = Math.min(w / 4, h / 3);
        canvas.style.setProperty("width", `${Math.floor(scale * 4)}px`, "important");
        canvas.style.setProperty("height", `${Math.floor(scale * 3)}px`, "important");
    }
    new ResizeObserver(fitCanvas).observe(root);
    fitCanvas();

    // --- synthetic keyboard input (touch controls + releasing stuck keys) ---
    const KEYS = {
        ArrowUp: { key: "ArrowUp", keyCode: 38 },
        ArrowDown: { key: "ArrowDown", keyCode: 40 },
        ArrowLeft: { key: "ArrowLeft", keyCode: 37 },
        ArrowRight: { key: "ArrowRight", keyCode: 39 },
        ControlRight: { key: "Control", keyCode: 17 },
        KeyE: { key: "e", keyCode: 69 },
        KeyY: { key: "y", keyCode: 89 },
        Escape: { key: "Escape", keyCode: 27 },
        Enter: { key: "Enter", keyCode: 13 },
        ShiftLeft: { key: "Shift", keyCode: 16 },
    };

    function sendKey(type, code) {
        const k = KEYS[code];
        const ev = new KeyboardEvent(type, { key: k.key, code, bubbles: true, cancelable: true });
        // keyCode/which can't be set through the constructor, and SDL still reads them.
        Object.defineProperty(ev, "keyCode", { get: () => k.keyCode });
        Object.defineProperty(ev, "which", { get: () => k.keyCode });
        Object.defineProperty(ev, "charCode", { get: () => 0 });
        document.dispatchEvent(ev);
    }

    // Track physically held keys so we can release them if focus leaves mid-press
    // (otherwise the marine keeps running after you click back into X).
    const held = new Map();
    window.addEventListener("keydown", (e) => e.isTrusted && held.set(e.code, e), true);
    window.addEventListener("keyup", (e) => e.isTrusted && held.delete(e.code), true);
    function releaseHeldKeys() {
        for (const [code, orig] of held) {
            const ev = new KeyboardEvent("keyup", { key: orig.key, code, bubbles: true, cancelable: true });
            Object.defineProperty(ev, "keyCode", { get: () => orig.keyCode });
            Object.defineProperty(ev, "which", { get: () => orig.keyCode });
            document.dispatchEvent(ev);
        }
        held.clear();
    }

    // Keep game keys from scrolling the page (share page) / anything around the canvas.
    const GAME_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab", "Backspace"]);
    window.addEventListener(
        "keydown",
        (e) => {
            if (state === "running" && GAME_KEYS.has(e.code)) e.preventDefault();
            resumeAudio();
        },
        { capture: true }
    );

    // --- touch controls ---
    function buildTouchControls() {
        const touch = $("[data-touch]");
        const S = 46; // dpad pitch
        const buttons = [
            // [label, code, class, css position]
            ["▲", "ArrowUp", "dpad", `left:${12 + S}px; bottom:${12 + S * 2}px`],
            ["◀", "ArrowLeft", "dpad", `left:12px; bottom:${12 + S}px`],
            ["▶", "ArrowRight", "dpad", `left:${12 + S * 2}px; bottom:${12 + S}px`],
            ["▼", "ArrowDown", "dpad", `left:${12 + S}px; bottom:12px`],
            ["FIRE", "ControlRight", "act", "right:14px; bottom:44px"],
            ["USE", "KeyE", "act", "right:80px; bottom:14px"],
            ["MENU", "Escape", "sys", "left:10px; top:8px"],
            ["ENTER", "Enter", "sys", "left:66px; top:8px"],
            ["Y", "KeyY", "sys", "left:128px; top:8px"],
        ];
        for (const [text, code, cls, pos] of buttons) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = cls;
            b.textContent = text;
            b.style.cssText = pos;
            const down = (e) => {
                e.preventDefault();
                resumeAudio();
                if (b.classList.contains("is-down")) return;
                b.classList.add("is-down");
                sendKey("keydown", code);
            };
            const up = (e) => {
                e.preventDefault();
                if (!b.classList.contains("is-down")) return;
                b.classList.remove("is-down");
                sendKey("keyup", code);
            };
            b.addEventListener("pointerdown", down);
            b.addEventListener("pointerup", up);
            b.addEventListener("pointercancel", up);
            b.addEventListener("pointerleave", up);
            touch.appendChild(b);
        }
    }
    if (isTouch) buildTouchControls();

    // --- corner buttons ---
    const muteBtn = $("[data-mute]");
    muteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        muted = !muted;
        muteBtn.textContent = muted ? "🔇" : "🔊";
        audioContexts.forEach((ctx) => (muted ? ctx.suspend() : ctx.resume()).catch(() => {}));
        canvas.focus();
    });

    const fsBtn = $("[data-fullscreen]");
    if (document.fullscreenEnabled || document.webkitFullscreenEnabled) fsBtn.hidden = false;
    fsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const req = root.requestFullscreen || root.webkitRequestFullscreen;
        if (document.fullscreenElement) document.exitFullscreen();
        else req && Promise.resolve(req.call(root)).catch(() => (fsBtn.hidden = true));
        canvas.focus();
    });

    // --- loading ---
    async function fetchWithProgress(url, expectedSize, onBytes) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        if (!res.body) {
            const buf = new Uint8Array(await res.arrayBuffer());
            onBytes(buf.length);
            return buf;
        }
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            onBytes(value.length);
        }
        const out = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) {
            out.set(c, off);
            off += c.length;
        }
        return out;
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error(`failed to load ${src}`));
            document.body.appendChild(s);
        });
    }

    let state = "idle"; // idle | loading | running | paused | exited | error

    async function start() {
        state = "loading";
        showOverlay("Loading…", "", { progress: true });

        try {
            const manifest = await (await fetch("/manifest.json", { cache: "no-cache" })).json();
            let loaded = 0;
            const v = `?v=${manifest.version}`;
            // The WAD is shipped gzipped (4.2 MB -> 1.8 MB) since Cloudflare won't compress it
            // for us. Browsers without DecompressionStream get the plain file instead.
            const gz = typeof DecompressionStream === "function";
            const wadFile = gz ? manifest.files.wadgz : manifest.files.wad;
            const total = manifest.files.wasm.size + wadFile.size;
            const tick = (n) => {
                loaded += n;
                progressBar.style.width = `${Math.min(100, (loaded / total) * 100).toFixed(1)}%`;
            };
            let [wasmBinary, wad] = await Promise.all([
                fetchWithProgress(GAME_DIR + "doom.wasm" + v, manifest.files.wasm.size, tick),
                fetchWithProgress(GAME_DIR + wadFile.name + v, wadFile.size, tick),
            ]);
            if (wad[0] === 0x1f && wad[1] === 0x8b) {
                const stream = new Blob([wad]).stream().pipeThrough(new DecompressionStream("gzip"));
                wad = new Uint8Array(await new Response(stream).arrayBuffer());
            }
            const cfg = await (await fetch(GAME_DIR + "default.cfg" + v)).text();

            label.textContent = "Starting…";

            window.Module = {
                canvas,
                wasmBinary,
                noInitialRun: true,
                locateFile: (path) => GAME_DIR + path + v,
                preRun: [
                    () => {
                        Module.FS.writeFile("/doom1.wad", wad);
                        Module.FS.writeFile("/default.cfg", cfg);
                    },
                ],
                onRuntimeInitialized: () => {
                    state = "running";
                    root.classList.add("is-running");
                    overlay.hidden = true;
                    fitCanvas();
                    canvas.focus();
                    resumeAudio();
                    Module.callMain(ENGINE_ARGS);
                },
                print: (t) => console.log(t),
                printErr: (t) => console.warn(t),
                onExit: () => {
                    state = "exited";
                    root.classList.remove("is-running");
                    showOverlay("Thanks for playing", "Click to play again", { icon: true });
                },
                onAbort: (what) => fail(what),
            };
            await loadScript(GAME_DIR + "doom.js" + v);
        } catch (err) {
            fail(err);
        }
    }

    function fail(err) {
        console.error(err);
        state = "error";
        root.classList.remove("is-running");
        showOverlay("Something broke", String((err && err.message) || err).slice(0, 140) + " · click to retry", {});
    }

    overlay.addEventListener("click", () => {
        resumeAudio();
        if (state === "idle") start();
        else if (state === "paused") resume();
        else if (state === "exited" || state === "error") location.reload();
    });

    // --- focus handling: pause overlay when the user clicks out (back into X) ---
    function pause() {
        if (state !== "running") return;
        state = "paused";
        releaseHeldKeys();
        showOverlay("Paused", "Click to resume", { icon: true });
    }
    function resume() {
        state = "running";
        overlay.hidden = true;
        canvas.focus();
        resumeAudio();
    }
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", () => document.hidden && pause());
    // iOS only unlocks audio from touchend/click, not pointerdown.
    for (const type of ["touchend", "click"]) root.addEventListener(type, resumeAudio, { passive: true });
    root.addEventListener("pointerdown", () => {
        resumeAudio();
        if (state === "running") canvas.focus();
    });
})();
