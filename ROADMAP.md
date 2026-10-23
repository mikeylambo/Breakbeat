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
- [x] **Upload Your Own Beat** (My Beats; local only, nothing leaves the device):
  - [x] Decode, then detect tempo (autocorrelation plus a whole-song comb refine), downbeat and key.
        The tempo folds into the game range (174 plays as 87). A Tune panel nudges tempo (±0.05, ÷2,
        ×2, tap), the downbeat (a beat or 10 ms) and each section (4 bars), with a click-track preview.
  - [x] Pseudo-stems: Linkwitz–Riley crossovers split the song into the 5 layers (kick < 110 Hz < bass
        < 320 Hz < keys < 2.2 kHz < lead < 6.5 kHz < top), so chain rank opens it up from the low end.
  - [x] A/B/C picked by bar energy on phrase starts (manual override in Tune). Each loop point is
        crossfaded into the audio before it, so sections loop without a seam. The board seed is per run.
  - [x] Shelf in IndexedDB with a personal best per song. Sound effects follow the song's key. The world
        comes from the movement nearest in tempo.
  - [ ] Later: a world palette from the album art (ID3/MP4 tags), and a fixed seed per song as an option.
- [x] Gates: ANALYSER (under 0.5 ms a frame), beat detection unit tests (synthetic songs within 0.2 BPM,
      downbeat within 35 ms), BYO browser gate (offline, zero requests).

## v0.12: Competitive spine

The engine is deterministic: a seed plus an input log is a replay. That makes ghosts and leaderboards that
can't be cheated cheap to build, so use it.

- [x] **Input-log replays**: the engine logs every outside input (primes with their exact time, holds,
      movement changes, pressure switches, stall skips). Seed plus log re-simulates the run exactly
      (REPLAY_DETERMINISM: 200 bot runs; REPLAY browser gate: a clicked run with a stall).
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
