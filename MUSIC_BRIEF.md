# BREAKBEAT Vol. 01: music brief

**Target:** $14.99 premium. **20 tracks**: the Overture, three Acts of 6 movements, and a Coda. That's roughly 60–75 minutes of music, with every track in its own genre. Tile colours never change, so the music and each movement's background carry the variety.

## Format (per track)

- **Stems:** 5, named `kick`, `bass`, `keys`, `lead`, `top`. They enter with chain rank: kick + bass first, then keys, lead and top.
- **Sections:** **A / B / C, 8 bars each** (24 bars total), back to back in **one file per stem**.
  - The game loops A, then steps to B, then to C as the player moves through the movement (by quota, or every 16 bars in Zen).
  - It always changes on a section boundary and never goes backwards.
  - **A** is the intro or sparse groove, **B** is the full groove, **C** is the peak.
  - Each section must loop seamlessly on itself, and flow from its end into the next section.
  - The Overture is a single 8-bar section.
- **Files:** OGG or WAV, 48 kHz, bar-aligned, all stems the same length.
- **One-shots:** 6, as listed in `AUDIO_STEMS.md`.
- **Tempo:** the grid needs one column per 16th note, so keep every track between **88 and 150 BPM**. Write faster genres in half-time against the grid.

## Tracklist

| # | Track | Act | BPM | Key | Genre | Direction |
| --- | --- | --- | --- | --- | --- | --- |
| 00 | Overture | 0 | 96 | C | overture | Gentle, inviting. Kick-only intro; each lesson adds bass, keys, lead. Must resolve warmly into Ignition. |
| 01 | Ignition | I | 116 | C | house | Deep/tech house. Warm Rhodes stabs, rolling bassline, confident and friendly. The 'this is the game' track. |
| 02 | Glasswork | I | 108 | F | garage | UK garage / 2-step. Shuffled hats, chopped vocal-ish synth stabs, glassy plucks. |
| 03 | Lattice | I | 124 | G | techno | Hypnotic techno. Rumbling sub, metallic percussion, one evolving arp. |
| 04 | Phosphor | I | 120 | A | synthwave | Synthwave / outrun. Gated snare, big saw pads, neon arpeggio lead. |
| 05 | Tidewater | I | 112 | D | afro | Afro house. Polyrhythmic percussion, marimba/kalimba lead, joyful. |
| 06 | Arc Light | I | 128 | E | electro | Electro. 808 kick pattern, robotic bass, vocoder-flavoured lead. Act I finale energy. |
| 07 | Paper Moon | II | 88 | Eb | lofi | Lo-fi hip hop. Swung drums, dusty keys, jazz chords. A breather. |
| 08 | Brass Tacks | II | 104 | Bb | jazz | Nu-jazz / broken beat. Walking bass, brushed hats, horn-section stabs. |
| 09 | Breakwater | II | 132 | D | breaks | Big beat / breakbeat. Chopped breaks, acid line, rowdy. |
| 10 | Halflight | II | 140 | F | halftime | Half-time / future bass. Heavy space, wide supersaws, emotional drop. |
| 11 | Still Water | II | 100 | Ab | ambient | Ambient / downtempo. Long pads, sparse kick (Zen mode's home). Deep calm. |
| 12 | Velvet Rope | II | 122 | G | disco | Nu-disco. Octave bass, string swells, filtered loops. Act II finale, euphoric. |
| 13 | Magma | III | 136 | E | industrial | Industrial techno. Distorted kick, clanging metal, pressure. |
| 14 | Footwork | III | 150 | C | footwork | Footwork / juke at 150-160. Stuttering kicks, vocal-chop lead. Tense, fast. |
| 15 | Neon Trap | III | 142 | F# | trap | Trap. Rolling hats, 808 slides, dark bell melody. |
| 16 | Prism | III | 146 | A | hyperpop | Hyperpop / glitch. Bright, maximal, pitched chops, sugar-rush. |
| 17 | Jungle Gym | III | 148 | G | jungle | Jungle / DnB feel at 148-150 (or 174 written half-time against the grid). Amen-style breaks, reese bass. |
| 18 | Overdrive | III | 150 | D | techno | Peak-time hard techno. The hardest track; relentless, euphoric. |
| 19 | Coda | Coda | 126 | C | coda | Return of Ignition's motif, triumphant and orchestral-electronic. The ending. |

## Arc

- **Act I (Ignition), club fundamentals, 108–128 BPM.** Teach the groove, 4 colours.
- **Act II (Drift), texture and swing, 88–140 BPM.** The 5th colour arrives; tempo varies more.
- **Act III (Fracture), speed and pressure, 136–150 BPM.** Pressure rows rise every bar.
- **Coda:** the motif returns, and the ending lands.

The placeholder synth already plays each track's genre grid, so the arc can be play-tested before the real stems arrive.
