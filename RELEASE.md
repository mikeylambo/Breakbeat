# BREAKBEAT release history

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
