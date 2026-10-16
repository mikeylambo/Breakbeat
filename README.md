# BREAKBEAT

**You choose what breaks. The music chooses when.**

BREAKBEAT is a standalone browser-first rhythm-demolition puzzle game built from the supplied SLU Web Game Shell 1.02 concepts. The source repository of the shell is not modified, nor is a live copy or NPM download required. The `src/shell` directory includes a small subset of the uploaded shell's deterministic RNG and audio lifecycle primitives. The playable **Pulse** engine is native TypeScript and renderer-neutral.

## Run

Prerequisite: Node 20+. `npm ci` installs the pinned TypeScript compiler locally; no globally installed compiler is needed. There are no third-party runtime libraries.

```sh
npm ci
npm run build
npm run start
# visit http://localhost:4173
```

To develop: `npm run dev`; to verify: `npm run gates`.

## Deploy to Vercel

Import `mikeylambo/Breakbeat` as a new Vercel project (repository root `/`). The committed `vercel.json` configures the **Other** framework preset, **`npm ci`** install, **`npm run build && npm run verify:deploy`** build command, and **`public`** output directory. No environment variables, Node.js server, or Vercel Functions are needed: Vercel serves the compiled `public/index.html` and the referenced static assets.

Vercel project settings should not override the root directory to a nested folder. To reproduce the production pipeline locally, run:

```sh
npm ci
npm run build
npm run verify:deploy
npm run gates
```

## How to play

Tap a touching same-colour group of **2 or more** to prime it. The group locks, then detonates when the **next measure's sweepline** crosses it; taps are not timed. Multiple clears on a pass increase resonance. Long-press a primed group (300 ms) to **hold** it through one pass and overcharge its next blast. Cascading blocks create air-prime opportunities. A new pressure row pushes the wall upwards on every second downbeat cycle, then every cycle later in Endless/Odyssey. Exceed the danger line and the session ends.

Keyboard: **Arrow keys** select a tile, **Enter** or **Space** prime, **H** hold, **P** / **Esc** pause. Touch and mouse are supported. Headphones recommended.

## Included

- Four playable modes: six-track **Odyssey**, **Endless**, pressure-free **Zen**, and a locally seeded **Daily** with per-device one-attempt lock (not network-ranked).
- Deterministic `Pulse` game simulation and interchangeable `ContentRules`, with `GemRules` as the first content pack.
- Web Audio transport with latency-compensated sweep, timed keyed FX and real multi-stem gain mixing (see `AUDIO_STEMS.md`). Six distinctive synthesized arrangements remain **placeholders until the original multistem OST is supplied.**
- Pressure / priming / holds / eight-neighbor overcharge / audio-clock-staged gravity / inward column closure / real midfall contact priming / resonance / chain scoring / progression and locally saved scores.
- Responsive 390 px portrait cabinet UI, six material shaders, distinct sweep personas, debris, group lighting, anticipation, impact hitstop, pitched chords, pause/results, colour-independent symbols, beat lights, mute, volume, reduced motion preference, flash limiter, strobe-free mode and haptics where supported.
- `npm run gates` for isolation, determinism, pure modes, solubility and other automated checks.

## Architecture

`src/pulse/` owns clocks-independent deterministic rules, and imports a **ContentRules interface only**. It does not import gems content. `src/content/gems/` supplies the first ruleset; `src/content/skins.ts` supplies data-driven themes. `src/pulse/Conductor.ts` reads `AudioContext.currentTime` as the authoritative time. `src/main.ts` owns input / menus / rendering / audio hooks. `src/tuning.ts` owns game balance.

## Production blockers / honest release status

This is a playable 0.2.0 browser milestone, not a certified commercial release. The provided archive contains no licensed original stems, so the soundtrack is procedurally synthesized. Original track stems, acoustic/hardware audio-output calibration, real-device 120 FPS performance certification, cross-platform latency calibration, a hosted authoritative Daily leaderboard/one-attempt validation, service-worker offline precaching and QA on the target mobile device matrix remain. Duet / Remix / Quest mixed reality are explicitly post-v1 and not included.

No analytics or ads are present. Audio manifests and optional stems preload before a session, with no in-session network requests. The app does not register a service worker, so an online web hosting setup is needed for initial load.

## Instrument milestone (0.2.0)

The five systems from the first audit are implemented in this milestone: conductor math and output-latency compensation; real in-flight cascade input; stem transport with the current synth fallback; layered burst/held/anticipation effects; and six distinct visual themes with per-skin sweep and haptic identities. `AUDIO_STEMS.md` is the authoritative integration guide for final compositions. `npm run gates` validates 16 unit/integration checks and structure, but an audio-loopback test and physical phone frame profiling remain required for shipping guarantees.
