# BREAKBEAT roadmap to 1.0

Shipped through v0.10: engine, renderer, audio clock, Overture, Odyssey (setlist screen), Endless/Zen/Daily,
Etudes and Tutorial drills, challenges, cosmetics, tabbed settings and accessibility, offline PWA, desktop
layout, blade-split logo, and record sleeves. All 20 tracks still play placeholder synth
stems (`stemsReady: false` everywhere). The plan below runs in order. The music lane runs alongside it.

## v0.11: Sound you can see

Listen mode and visualizers share one piece of plumbing (an `AnalyserNode` per stem on the StemPlayer bus),
so build them together. Upload Your Own Beat builds on that same plumbing.

- [x] **Stem analysers**: a per-stem analyser tap and a shared `AudioFeatures` frame (band energy, onset, beat
      phase from BeatClock). Computed once per frame and read by every view.
- [x] **Visualizers**: 4 presets (Horizon, Rings, Scope, Shatter) driven by the stems and the mix. They play
      behind the menus and, optionally, behind the wall in Zen. Strobe-free, reduced motion and flash
      intensity are respected. Listen mode runs them at full strength when it lands.
- [x] **Listen mode (Jukebox)**: the Overture plus every cleared movement, full mix, inside its world, with
      the visualizer at full strength. A stem mixer (mute, solo, live meters), an A/B/C section scrub,
      play-through with auto-advance (or Repeat One), a sleep timer, clean view, and media-key support.
- [ ] **Upload Your Own Beat** (local only; nothing leaves the device):
  - [ ] Decode the file, then detect BPM and downbeat offline (onset autocorrelation). Fold the tempo into
        88–150 BPM (halve or double), then confirm or nudge it with a tap-tempo sheet.
  - [ ] Pseudo-stems: split the mix into the 5 layers with band filters (kick < 120 Hz, bass, keys, lead, top),
        so chain rank still opens up the mix.
  - [ ] Detect A/B/C sections by energy (manual override allowed). Seed the board from a file hash, so one
        song always deals the same wall.
  - [ ] Cache the analysis plus a "My Beats" shelf in IndexedDB. Keep personal bests per song. Give it its own
        world palette, taken from the album art if there is any.
- [ ] Gates: ANALYSER_COST (under 0.5 ms a frame), BEAT_DETECT (fixture songs land within ±1 BPM and on the
      right downbeat), BYO_OFFLINE (no network).

## v0.12: Competitive spine

The engine is deterministic: a seed plus an input log is a replay. That makes ghosts and leaderboards that
can't be cheated cheap to build, so use it.

- [ ] **Input-log replays**: record `(pass, sixteenth, cell, action)` per run. Re-simulating the log must
      reproduce the exact score (REPLAY_DETERMINISM gate).
- [ ] **Ghost race**: your best Daily or movement run plays as a translucent second blade and score ticker.
- [ ] **Verified Daily leaderboard** (Supabase): the client submits seed + log, and an Edge Function
      re-simulates `PulseEngine` and accepts the server's score only. Show friends, global, and percentile.
- [ ] **Cloud save, opt-in**: a magic-link account, merging by the save schema version. The game stays fully
      playable signed out.
- [ ] **Shareable Etude codes**: an Etude editor (it reuses the Etude board format) with URL-encoded boards.
      That's player-made content with zero moderation, because the board lives in the link.

## v0.13: Platform and business

- [ ] **Distribution decision** (recommended: a Steam build via Tauri, plus a web demo).
  - Steam: Tauri wrapper, Steamworks achievements mapped from the challenge stars, Steam Deck verified.
  - Web demo: Overture + Act I, with an unlock code for the full game.
  - Mobile: a Capacitor wrapper later, with iOS silent-switch and audio-session handling.
- [ ] **Gamepad + remappable keys** (cursor-snap to groups; triggers prime and hold). This is needed for Deck.
- [ ] **Achievements** (~40), built from existing telemetry and challenge stars.
- [ ] **Error reporting**: a tiny `window.onerror` / unhandledrejection beacon, opt-in, no PII.
- [ ] **Localization scaffold**: string tables, plus EN/ES/PT-BR/JA/DE (JA needs a CJK font subset).

## v0.14: Depth and replay value

- [ ] **Practice mode**: loop any section of any movement at 70–100% tempo and repeat a pressure-row
      scenario. It pairs with Coach's "Practise next".
- [ ] **Remix (B-side) variants**: each movement gets a remix ruleset (inverted gravity, 5 colours from bar
      one, double-time pressure) for New Game+. That doubles the content without new music.
- [ ] **Mixtape mode**: a playlist of movements back to back, with bar-aligned crossfades. Score is cumulative.
- [ ] **Streamer / photo mode**: a chroma-key background, a big-score overlay, and a replay director that
      pauses, scrubs and frees the camera on the best-pass loop.

## Music lane (parallel, external)

- [ ] **Stem validator tool + gate** (build this first, so music can drop in at any time): checks sample rate,
      equal stem lengths, bar alignment against the BPM, seamless loop points (click detection), LUFS
      targets, and that no file is clipping.
- [ ] Commission or deliver the 20 tracks plus 6 one-shots per `MUSIC_BRIEF.md`. Drop each one in by flipping
      `stemsReady`.
- [ ] Sleeve art for the 19 movements that still use generated stand-ins (only Magma has real art).
- [ ] Mastering pass across all tracks so the loudness is even.

## Release candidate

- [ ] Real-device QA matrix: iPhone (Safari and PWA), mid-range Android, Steam Deck, and Bluetooth headphones
      (calibration presets for each device class).
- [ ] FRAME_HITCH on real GPUs at DPR 2–3. A 120 Hz pass on ProMotion screens.
- [ ] 10–20 human playtests with an opt-in telemetry export, then retune mastery floors and pressure timing
      against the scripted policies in `BALANCE.md`.
- [ ] Store kit: a 60 s trailer (the share pass can already capture it), capsule art, press kit, Steam page.
