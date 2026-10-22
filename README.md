# BREAKBEAT

**You choose what breaks. The music chooses when.**

A landscape rhythm-demolition puzzle for phones and desktop. Tap a same-colour group of 2+ to prime it; the
blade crossing the wall on the music detonates it. Hold to overcharge. The audio clock is the only clock.

## Run

Node 20+.

```sh
npm ci
npm run dev        # builds and serves http://localhost:4173
npm run gates      # every gate: types, unit tests, engine gates, balance, deploy check, browser gates
```

Browser gates (FRAME_HITCH, SCREENS, NETWORK) use Playwright + Chromium; install once with
`npx playwright install chromium`. Screens land in `artifacts/screens/`.

## Layout

| Path | What |
| --- | --- |
| `src/pulse/` | Pulse engine: deterministic sweep/prime/hold sim, BeatClock (audio clock) |
| `src/content/gems/` | Gem rules (primeable groups, collapse, Overcharge blast, scoring) |
| `src/render/` | PixiJS 8 renderer: Stage, TileAtlas, WallView, BladeView, FxView, ReplayView |
| `src/audio/` | AudioEngine, StemPlayer, SfxPlayer, Scheduler (setInterval lookahead), MusicDirector, placeholder synth |
| `src/ui/` | DOM screens over the canvas: title card (Splash), main menu (Title), Odyssey setlist, Tutorial & Tips (with Try it drills, `content/drills.json`), Run HUD (Lumines-style panel + Charge gauge), Pause, Results, Settings, Rotate, Overture, input. `MenuList` is the shared keyboard + mouse menu |
| `src/meta/` | Save, Settings, Coach (practise next) |
| `src/platform/` | Storage, haptics, lifecycle, share — same interfaces as Web-Game-Shell (see its README) |
| `content/` | `tracks.json` (movements, stems, quotas), `overture.json` (lesson boards) |
| `tools/` | `gates.mjs`, `browser-gates.mjs`, `check-balance.mjs`, `bundle.mjs`, `serve.mjs` |

Stem delivery format: `AUDIO_STEMS.md`. Release notes: `RELEASE.md`.

## Deploy

Vercel, repository root, using the committed `vercel.json` (`npm ci`, `npm run build && npm run verify:deploy`,
output `public/`). Static only: fonts and audio are bundled, there are no network calls at play time.
