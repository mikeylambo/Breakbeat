# BREAKBEAT release history

## 0.6.0: Presentation, Onboarding & Polish

**Preview:** https://breakbeat-kubbblqkd-mikeylambos-projects.vercel.app (branch `claude/v06-presentation`)

- **Landscape 16 × 10 wall**, one column per 16th. The stage is 844 × 390, letterboxed and safe-area aware. In portrait, a rotate card blocks play and pauses the game.
- **Engine**:
  - `coveredCols = sixteenth + 1`, with a boot assert.
  - Ahead/behind rule documented and tested.
  - Fixed: a group held while queued behind the blade now goes off Overcharged exactly 2 passes after it was primed.
  - New: All Clear (10,000 × combo, plus a 3-row refill), One Colour Left (3,000 × combo), danger levels, Overture mode, new telemetry.
- **PixiJS 8 renderer**:
  - Atlas-baked tile states (idle, lit, primed, held) and fused primed slabs with one perimeter outline.
  - Bloom on the glow layer only. It is device-adaptive: off on software GL, or after sustained frame misses.
  - Blade driven by the audio clock, with a wake.
  - Pooled shards and score pops, anticipation squash, hitstop, camera breath.
  - Held reticle with a HOLD ×2 chip, queued pip, hold ring.
  - All Clear and One Colour moments, a danger pulse, and a beat-line metronome.
- **Audio**:
  - The AudioContext is the only clock. It suspends when the tab is hidden; there is no catch-up shift.
  - Five-stem player: chain rank drives the layers, with one-beat ramps that land on the downbeat.
  - Predictive setInterval scheduler puts detonations exactly on their 16th.
  - Danger low-pass, All Clear duck plus sting, and held-group layer boosts.
  - Placeholder synth stems for six movements plus the Overture. Delivery format is in `AUDIO_STEMS.md`.
- **Screens**:
  - Title with the Odyssey tracklist and mastery badges.
  - Run HUD, pause sheet, settings, and results: best-pass replay loop, personal best, Coach "Practise next", and share pass (MP4/WebM with music, PNG fallback).
  - Movements morph on a downbeat when their quota is reached.
- **Overture**: three fixed-deal lessons, one stem per lesson, Skip always visible. It morphs straight into Movement 01. The air-prime lesson is shown once, in-run.
- **Accessibility**: flash intensity, strobe-free mode, reduced motion, colour assist, haptics plus haptic metronome, 85% tempo (score-normalised), audio offset, hide HUD (V), live-region announcements.
- **Gates (23, all green)**:
  - The original 10.
  - New: SWEEP_GRID, AHEAD_BEHIND, HOLD_BEHIND, ALL_CLEAR, ONE_COLOUR, AUDIO_SCHED, NO_BLUR, OVERTURE_FLOW.
  - Balance and deploy checks.
  - Browser: FRAME_HITCH (p99 16.8 ms), SCREENS (artifacts/screens/), NETWORK (all requests same-origin).

**Known limits**:
- `docs/look-target/` was not in the repo, so the polish pass matched the brief's written spec.
- FRAME_HITCH runs on CPU-rasterised Chromium at DPR 1, because this CI has no GPU.
- Mastery floors were rescaled for the bigger wall.
- Pressure starts when lesson 3 is dealt ("the wall keeps rising while you wait").

## 0.5.0 — Balance and Game Depth

- Pressure phase tuning: predictable two-to-one bar escalation (movement-aware in Odyssey), wall-pressure gauge, downbeat countdown and non-consuming deterministic preview of the incoming row. Every new row contains at least one ordinary legal pair.
- Scoring integrity: exact overlap resolution prevents double-counted tiles; resonance is awarded only for confirmed detonations, with stable cross-order settlement. Air ×1.25, held ×2, size curve and combo rules remain.
- Endless contract deck: four opt-in pure-rules skill goals (Resonance Relay, Overcharge Forge, Skyline Catch, Pressure Gauntlet), saved completion and separately categorized personal records; no special blocks or score boosts.
- Automated tuning: 40-seed scripted novice/intermediate/expert report in `BALANCE.md`, plus skill-gradient CI gate and 7 additional balance/fairness tests (29 total).
- Music intentionally deferred. Full interactive browser QA blocked in this environment; device performance and human balancing remain outstanding.


## 0.4.0 — Player Experience + Progression

**0.3 player experience:** Event-gated first-run lessons and replay tutorial; beat and danger status; assisted manual/automatic priming; screen-reader cell narration and keyboard assist; contrast and tempo options; settings accessible before starting; pause and recovery; improved score feedback; tonic game-over resolve, transitions, and mobile-safe branding. Daily enforces original speed and disables assists.

**0.4 mastery:** Schema-v2 save migration, Odyssey movement map and completion, local personal records split between assisted and pure scores, BPM-normalized scores, Bronze → Resonant mastery, Echo/Prism sweep-persona cosmetic unlocks, results card with survival time and strongest-pass display-only 3-second loop. Six new experience tests plus prior 16 game/audio tests pass. Vercel deployment verification is included. Original music remains deliberately deferred.

Important limits: Replay visually reconstructs captured board frames only, not video/audio. This is local progression, not a server-backed profile. Screen-reader gameplay has focused-keyboard announcements, not a complete nonvisual alternative; real-device accessibility/performance certification and original music remain unfinished.

## 0.2.0 — The Instrument Pass

1. Conductor: timestamped 16th-note effects, output latency–compensated rendering, 200-pass timing-grid tests, sustained chord voices, hold harmonics and an Overcharge drop.
2. Cascades: staged deterministic gravity and inward-column travel, genuine in-flight contact checks, 280 ms contact windows, queued air-primes that lock on landing, and pressure deferred only to the next downbeat if a fall is in progress.
3. Music: published manifest loader, phase-aligned looping multistem transport and chain-rank mixing, per-movement synthetic fallback arrangements, and `AUDIO_STEMS.md` for original compositions.
4. Feel: anticipation squash at sweepline contact, resonance-based 60 ms board impact, 2D debris and per-material lighting, subdued screen breath and per-skin haptic signatures. The visual sweep never pauses with impact hitstop.
5. Skins: six visually different material pipelines and six sweep personas (CODA intentionally invisible), rather than palette-only variants.
6. Checks: 16 automated tests, output asset validation, deterministic 1,000-seed solubility gate. Browser smoke test verified menu, session startup, priming and a scored clear.

Unfinished work: official stems, device/audio-loopback sync validation, authoritative Daily, production FPS certification, results replay, PWA offline and final tutorial/accessibility pass. All these remain independent from this milestone.

## 0.1.1 — Vercel-ready build

Pinned TypeScript dependency, lockfile, static output directory and deployment checks. Compiles successfully in clean CI environments.

## 0.1.0 — First playable

Seeded board, sweepline, group priming, Overcharge, gravity/collapse, four game modes, six movement placeholders, scores and basic interface.
