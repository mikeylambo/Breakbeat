# BREAKBEAT — Stem Integration Contract (0.2.0)

Original musical masters have not yet been supplied. The game defaults to six tempo/key-aware **synthetic arrangements**, one per movement. This is a working integration path for original multi-stem tracks, not a claim that the original OST is bundled.

## Drop-in workflow

1. Render 4–5 **phase-aligned stereo WAV or high-quality OGG** loops for a movement, at its declared BPM and key. All stems start at bar 1; export every stem to exactly the same duration and use gapless codec settings. Naming is your choice.
2. Place files in `public/audio/<track-id>/`, e.g. `public/audio/ignition/drums.ogg` and `public/audio/ignition/lead.ogg`.
3. Edit **`public/content/tracks.json`** (`content/tracks.json` in the source tree is the artist-facing reference). The runtime deliberately loads the published copy. Each `stems` entry is `{ "id": "...", "src": "./audio/ignition/drums.ogg", "rank": 0, "gain": 0.75 }`. Use ranks **0** (base) to **4** (highest rank). At least one rank-0 base stem is required; use one for every optional harmonic layer you want to enable.
4. Preserve `bpm`, `key`, `offsetMs`, `loopStartBar`, `loopEndBar` in metadata. The first bar is `1`; an end bar of `16` means 16 full bars, not a marker at the start of bar 16. Each recorded loop should be at least as long as its declared end bar.
5. Test looping in the browser, then run `npm run gates` and the device-latency matrix. Avoid tracks with inconsistent embedded leading silence. Do not commit private or unlicensed stems.

Example (`public/content/tracks.json` excerpt):

```json
{
  "id": "ignition",
  "bpm": 116,
  "key": "A minor",
  "offsetMs": 0,
  "stems": [
    { "id": "base", "src": "./audio/ignition/base.ogg", "rank": 0, "gain": 0.75 },
    { "id": "perc", "src": "./audio/ignition/perc.ogg", "rank": 1, "gain": 0.65 },
    { "id": "bass", "src": "./audio/ignition/bass.ogg", "rank": 2, "gain": 0.65 },
    { "id": "harmony", "src": "./audio/ignition/harmony.ogg", "rank": 3, "gain": 0.65 },
    { "id": "lead", "src": "./audio/ignition/lead.ogg", "rank": 4, "gain": 0.6 }
  ],
  "loopStartBar": 1,
  "loopEndBar": 16,
  "skin": "ignition"
}
```

**Engine behavior:** Assets are requested and decoded *before* the AudioContext transport starts. Each stem uses a common Web Audio `origin`, synchronized buffer start, and loop markers. Chain rank ramps the corresponding gain smoothly. Overcharge temporarily adds one extra rank and releases it after the bar. Long-pressing a primed group also adds a held octave to its sustained chord. All keyed sound effects schedule on sixteenth boundaries; missed deadlines recover on the next boundary rather than firing off-grid.

If any audio stem fails to decode or load, the whole movement falls back to its synthesized arrangement. A console warning identifies the failed asset. `fetch()` is not called once the conductor transport is running.

## Latency/performance signoff still required

The displayed sweep uses Web Audio time minus `AudioContext.outputLatency + baseLatency`. This compensates for reported output buffering; it does **not** measure physical device/acoustic latency. Verify perceived alignment on target iOS, Android, desktop and Bluetooth devices. The current 200-pass timing test validates schedule mathematics but is **not** an oscilloscope/audio-loopback timing measurement. The production 60/120 FPS and sound-output synchronization targets remain device QA tasks.
