# BREAKBEAT 0.1.1 — Vercel deployment fix

- Declared/pinned TypeScript as a local build dependency; supplied a lockfile for reproducible Vercel `npm ci` installs.
- Declared Vercel static-site build and output configuration (`public/`).
- Added a deployment asset validator that fails on missing HTML assets, JS import targets and manifest icons.
- No gameplay mechanics changed.

# BREAKBEAT 0.1.0 — playable browser build

- Deterministic 10 × 14 gem wall with bottom pressure, beat-sweep and cascades
- Locked group priming, overcharge hold-through-one-pass, eight-neighbour area clearing
- Air-prime bonus, chained sweep scoring, progression, results
- Six synth-soundtracked theme movements, four single-player modes
- Accessible input and flashing preferences, responsive arcade-cabinet presentation
- Pure TypeScript implementation, no third-party runtime dependencies

## Unshipped dependencies
Original OST stems, hosted ranked Daily backend, certified device latency and performance matrix, service-worker PWA offline installability, replay capture, later mode waves.
