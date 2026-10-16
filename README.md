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
- Web Audio conductor and in-key, on-sixteenth procedural synthesizer soundtrack. **These are placeholders for Michael's final multistem compositions.**
- Pressure / priming / holds / eight-neighbor overcharge / gravity / inward column closure / air-prime assist / resonance / chain scoring / progression and locally saved scores.
- Responsive 390 px portrait cabinet UI, rendered tile material glyphs, sweep, pause/results, colour-independent symbols, beat lights, mute, volume, reduced motion preference, flash limiter, strobe-free mode and haptics where supported.
- `npm run gates` for isolation, determinism, pure modes, solubility and other automated checks.

## Architecture

`src/pulse/` owns clocks-independent deterministic rules, and imports a **ContentRules interface only**. It does not import gems content. `src/content/gems/` supplies the first ruleset; `src/content/skins.ts` supplies data-driven themes. `src/pulse/Conductor.ts` reads `AudioContext.currentTime` as the authoritative time. `src/main.ts` owns input / menus / rendering / audio hooks. `src/tuning.ts` owns game balance.

## Production blockers / honest release status

This is a fully playable first browser build, not a certified commercial release. The provided archive contains no licensed original stems, so the soundtrack is procedurally synthesized. True per-stem mixing, real-device 120 FPS performance certification, cross-platform latency calibration, a hosted authoritative Daily leaderboard/one-attempt validation, service-worker offline precaching and QA on the target mobile device matrix remain. Duet / Remix / Quest mixed reality are explicitly post-v1 and not included.

No analytics, gameplay-time network calls or ads are present. The app does not register a service worker, so an online web hosting setup is needed for initial load.
