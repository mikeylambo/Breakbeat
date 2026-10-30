# BREAKBEAT — Stem delivery format (v0.6)

Until real stems land, `src/audio/placeholder/Synth.ts` renders five stems for each of the six
movements plus the Overture (96 BPM) once, into AudioBuffers via `OfflineAudioContext`. Everything
below is what Michael delivers to replace them. No code changes are needed.

## Per movement

| Field | Value |
| --- | --- |
| Format | OGG Vorbis (q6+) or WAV, **48 kHz**, stereo or mono |
| Alignment | **Bar-aligned**: every file starts exactly on bar 1, beat 1, no leading silence |
| Length | The track's `sections` back to back (A, B, C; 8 bars each = 24 bars) at the track BPM; every stem the same sample length |
| Looping | Each section loops seamlessly on itself, and its end must also flow into the next section. The game only ever steps forward: A, then B, then C. |
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

## Validation

`npm run stems -- <id>` checks a delivery before it is switched on (`npm run stems` alone checks every track
with `"stemsReady": true`; `--all` checks every track that has files; `--json` for a machine-readable report).
WAV is read directly; OGG is decoded by Chromium, the same decoder the game uses. The STEMS gate runs the same
checks on every ready track, so a bad file can't ship.

| Check | Target | Failing means |
| --- | --- | --- |
| Sample rate | 48 kHz (read from the file header) | re-export at 48 kHz |
| Length | every stem `loopBars` at the track BPM, ±1 ms, all equal | trim or pad to exactly 24 bars |
| Grid | ≥ 60% of the mix's hits within 15 ms of a 16th, average offset ≤ 10 ms | wrong tempo, or the file doesn't start on bar 1 (leading silence over 10 ms is also flagged) |
| Loops | each section's last sample flows into its first: a jump over 0.02 and over 4× the motion around it is a click | fade or zero-cross the section end; let tails ring into the next section |
| Loudness | full mix (all five stems) at **-14 LUFS** integrated (BS.1770-4), ±1.5 LU; album tracks within 2 LU of each other | master louder or quieter |
| Peaks | no sample at full scale in any stem or the mix; mix peak at or below -1 dBFS (warning) | lower the gain or use a limiter |
| One-shots | 48 kHz, not clipped, not silent, under 4 s (warning) | |

Errors fail the command (exit code 1) and the gate; warnings are reported only.

## Drop-in

1. Put files at `public/tracks/<id>/<name>.ogg` (paths in `content/tracks.json`).
2. `npm run stems -- <id>` until it reports no errors.
3. Set `"stemsReady": true` on that track in `content/tracks.json`.
4. `npm run gates`, then play the movement. If any file fails to decode, that movement falls back to its
   placeholder arrangement.

Files are same-origin and decoded before the transport starts; there are no network calls at play time.
