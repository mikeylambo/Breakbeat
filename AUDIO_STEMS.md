# BREAKBEAT — Stem delivery format (v0.6)

Until real stems land, `src/audio/placeholder/Synth.ts` renders five stems for each of the six
movements plus the Overture (96 BPM) once, into AudioBuffers via `OfflineAudioContext`. Everything
below is what Michael delivers to replace them. No code changes are needed.

## Per movement

| Field | Value |
| --- | --- |
| Format | OGG Vorbis (q6+) or WAV, **48 kHz**, stereo or mono |
| Alignment | **Bar-aligned**: every file starts exactly on bar 1, beat 1, no leading silence |
| Length | Exactly `loopBars` bars at the track BPM (see `content/tracks.json`); every stem the same sample length |
| Looping | Seamless: the last sample must flow into the first (render tails back into bar 1) |
| Stem names | `kick`, `bass`, `keys`, `lead`, `top`, exactly |

Stems enter with chain rank: rank 0 = kick + bass, 1 = + keys, 2 = + lead, 3 = + top, 4 = full mix level.
Held (Overcharged) groups add the next layer for the pass they detonate on. In the Overture the stems
enter one per lesson: kick, then bass, keys, lead.

## One-shots

| Name | Use |
| --- | --- |
| `prime-0` … `prime-3` | Prime tone per colour (Amber, Magenta, Azure, Jade). Record in **C**; the game pitches them to the track key with `playbackRate`. |
| `detonate` | A group goes off (on its 16th). |
| `hold` | A group is held. |
| `over` | An Overcharged detonation. |
| `allclear` | All Clear sting (plays one beat after the drums duck). |
| `slide` | Pressure row pushes up. |

## Drop-in

1. Put files at `public/tracks/<id>/<name>.ogg` (paths in `content/tracks.json`).
2. Set `"stemsReady": true` on that track in `content/tracks.json`.
3. `npm run gates`, then play the movement. If any file fails to decode, that movement falls back to its
   placeholder arrangement.

Files are same-origin and decoded before the transport starts; there are no network calls at play time.
