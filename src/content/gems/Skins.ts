/**
 * BREAKBEAT — Skins as Pure Data (GDD Pages 4–5).
 * Emotional arc: Dawn -> Ascent -> Mania -> Overdrive -> Collapse -> Serenity -> Coda.
 * Each colour has its own block material & geometric relief per skin, never hue alone.
 */

export type BlockMaterialType =
  | 'brick'
  | 'glass'
  | 'crystal'
  | 'phosphor'
  | 'obsidian'
  | 'monolith';

export type SweepPersonaType =
  | 'blade'
  | 'rain'
  | 'prism'
  | 'scanbeam'
  | 'embers'
  | 'aurora'
  | 'invisible';

export interface ColorSwatch {
  name: string;
  fill: string;
  highlight: string;
  shadow: string;
  glow: string;
  rgb: [number, number, number];
  /** Distinct internal geometric relief pattern (0..4) for colour-vision accessibility */
  reliefPattern: 'courses' | 'chevron' | 'hopper' | 'triad' | 'radial';
}

export interface SkinDefinition {
  id: string;
  title: string;
  act: string;
  subtitle: string;
  bpm: number;
  keyName: string;
  rootMidi: number;
  scaleIntervals: readonly number[];
  colorCount: 4 | 5;
  riseBars: 1 | 2;
  quotaBlocks: number;
  material: BlockMaterialType;
  sweepPersona: SweepPersonaType;
  sweepColor: string;
  sweepSecondary: string;
  stageBgTop: string;
  stageBgBottom: string;
  wellSurface: string;
  gridHairline: string;
  bezelMetal: string;
  swatches: readonly ColorSwatch[];
  hapticPattern: {
    primeMs: number;
    holdMs: readonly number[];
    detonateMs: readonly number[];
  };
}

export const SKINS: readonly SkinDefinition[] = [
  {
    id: 'weathered-brick',
    title: 'WEATHERED BRICK',
    act: 'ACT I · DAWN',
    subtitle: 'Sunlit kilned masonry & warm brass blade',
    bpm: 104,
    keyName: 'D Dorian',
    rootMidi: 50,
    scaleIntervals: [0, 2, 3, 5, 7, 9, 10, 12],
    colorCount: 4,
    riseBars: 2,
    quotaBlocks: 110,
    material: 'brick',
    sweepPersona: 'blade',
    sweepColor: '#ffefc2',
    sweepSecondary: '#ff8c42',
    stageBgTop: '#121016',
    stageBgBottom: '#08070b',
    wellSurface: '#15131b',
    gridHairline: 'rgba(255, 226, 184, 0.055)',
    bezelMetal: '#25212e',
    swatches: [
      {
        name: 'Terracotta Kiln',
        fill: '#d9534f',
        highlight: '#ff8a84',
        shadow: '#782321',
        glow: '#ff6b66',
        rgb: [255, 107, 102],
        reliefPattern: 'courses'
      },
      {
        name: 'Ochre Sandstone',
        fill: '#e6a13c',
        highlight: '#ffd07b',
        shadow: '#7c5012',
        glow: '#ffbe55',
        rgb: [255, 190, 85],
        reliefPattern: 'chevron'
      },
      {
        name: 'Verdigris Copper',
        fill: '#3caea3',
        highlight: '#7be8dd',
        shadow: '#195751',
        glow: '#52e5d7',
        rgb: [82, 229, 215],
        reliefPattern: 'hopper'
      },
      {
        name: 'Tyrian Magenta',
        fill: '#c84b8f',
        highlight: '#ff88c9',
        shadow: '#681c47',
        glow: '#ff5eb5',
        rgb: [255, 94, 181],
        reliefPattern: 'radial'
      },
      {
        name: 'Cobalt Glaze',
        fill: '#4d7cfe',
        highlight: '#94b2ff',
        shadow: '#1e3988',
        glow: '#6e98ff',
        rgb: [110, 152, 255],
        reliefPattern: 'triad'
      }
    ],
    hapticPattern: { primeMs: 10, holdMs: [14, 24, 20], detonateMs: [20, 15, 30] }
  },
  {
    id: 'stained-glass',
    title: 'STAINED GLASS',
    act: 'ACT II · ASCENT',
    subtitle: 'Cathedral leaded panes & silver rain curtain',
    bpm: 114,
    keyName: 'F Minor',
    rootMidi: 53,
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10, 12],
    colorCount: 4,
    riseBars: 2,
    quotaBlocks: 130,
    material: 'glass',
    sweepPersona: 'rain',
    sweepColor: '#d8f3ff',
    sweepSecondary: '#56cfe1',
    stageBgTop: '#0b111c',
    stageBgBottom: '#05080f',
    wellSurface: '#0e1624',
    gridHairline: 'rgba(148, 218, 255, 0.06)',
    bezelMetal: '#1b263b',
    swatches: [
      {
        name: 'Rose Window',
        fill: '#e63966',
        highlight: '#ff85a6',
        shadow: '#6e142d',
        glow: '#ff5c8a',
        rgb: [255, 92, 138],
        reliefPattern: 'radial'
      },
      {
        name: 'Chartreuse Nave',
        fill: '#2ec4b6',
        highlight: '#80f5e9',
        shadow: '#125b54',
        glow: '#4ceadb',
        rgb: [76, 234, 219],
        reliefPattern: 'chevron'
      },
      {
        name: 'Amber Lantern',
        fill: '#f4a236',
        highlight: '#ffd885',
        shadow: '#7a490c',
        glow: '#ffbe4f',
        rgb: [255, 190, 79],
        reliefPattern: 'hopper'
      },
      {
        name: 'Amethyst Choir',
        fill: '#9b5de5',
        highlight: '#cfa5ff',
        shadow: '#462175',
        glow: '#b57cff',
        rgb: [181, 124, 255],
        reliefPattern: 'courses'
      },
      {
        name: 'Sapphire Clerestory',
        fill: '#3a86ff',
        highlight: '#8ecae6',
        shadow: '#173b7a',
        glow: '#5aa0ff',
        rgb: [90, 160, 255],
        reliefPattern: 'triad'
      }
    ],
    hapticPattern: { primeMs: 8, holdMs: [12, 20, 18], detonateMs: [16, 12, 26] }
  },
  {
    id: 'bismuth-crystal',
    title: 'BISMUTH CRYSTAL',
    act: 'ACT III · MANIA',
    subtitle: 'Iridescent hopper steps & prismatic laser',
    bpm: 124,
    keyName: 'G Minor',
    rootMidi: 55,
    scaleIntervals: [0, 2, 3, 5, 7, 8, 11, 12],
    colorCount: 4,
    riseBars: 2,
    quotaBlocks: 150,
    material: 'crystal',
    sweepPersona: 'prism',
    sweepColor: '#fff0ff',
    sweepSecondary: '#00f5d4',
    stageBgTop: '#110c1d',
    stageBgBottom: '#07050c',
    wellSurface: '#151024',
    gridHairline: 'rgba(210, 160, 255, 0.065)',
    bezelMetal: '#261d3a',
    swatches: [
      {
        name: 'Magenta Oxide',
        fill: '#f15bb5',
        highlight: '#ff9cda',
        shadow: '#751a52',
        glow: '#ff6ec7',
        rgb: [255, 110, 199],
        reliefPattern: 'hopper'
      },
      {
        name: 'Cyan Anodized',
        fill: '#00bbf9',
        highlight: '#7ce2ff',
        shadow: '#005073',
        glow: '#33d1ff',
        rgb: [51, 209, 255],
        reliefPattern: 'chevron'
      },
      {
        name: 'Gold Tarnish',
        fill: '#fee440',
        highlight: '#fff59e',
        shadow: '#7d6b08',
        glow: '#ffe95c',
        rgb: [255, 233, 92],
        reliefPattern: 'courses'
      },
      {
        name: 'Mint Iridescence',
        fill: '#00f5d4',
        highlight: '#9bfcf0',
        shadow: '#006b5c',
        glow: '#3dffdf',
        rgb: [61, 255, 223],
        reliefPattern: 'radial'
      },
      {
        name: 'Violet Lattice',
        fill: '#8338ec',
        highlight: '#c194ff',
        shadow: '#3b1178',
        glow: '#9d5cff',
        rgb: [157, 92, 255],
        reliefPattern: 'triad'
      }
    ],
    hapticPattern: { primeMs: 12, holdMs: [15, 18, 25], detonateMs: [24, 14, 34] }
  },
  {
    id: 'crt-phosphor',
    title: 'CRT PHOSPHOR',
    act: 'ACT IV · OVERDRIVE',
    subtitle: 'Shadow-mask aperture grille & cathode scanbeam',
    bpm: 134,
    keyName: 'A Minor',
    rootMidi: 57,
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10, 12],
    colorCount: 5,
    riseBars: 2,
    quotaBlocks: 170,
    material: 'phosphor',
    sweepPersona: 'scanbeam',
    sweepColor: '#ccffef',
    sweepSecondary: '#00ff9d',
    stageBgTop: '#07120e',
    stageBgBottom: '#030806',
    wellSurface: '#0a1914',
    gridHairline: 'rgba(80, 255, 190, 0.065)',
    bezelMetal: '#162b24',
    swatches: [
      {
        name: 'P1 Green Phosphor',
        fill: '#1dd38f',
        highlight: '#82ffcf',
        shadow: '#0a5e3e',
        glow: '#35ffa8',
        rgb: [53, 255, 168],
        reliefPattern: 'triad'
      },
      {
        name: 'P3 Amber Beam',
        fill: '#ff9f1c',
        highlight: '#ffd289',
        shadow: '#7d4500',
        glow: '#ffb444',
        rgb: [255, 180, 68],
        reliefPattern: 'courses'
      },
      {
        name: 'P22 Red Gun',
        fill: '#ff3366',
        highlight: '#ff8da9',
        shadow: '#7a0d29',
        glow: '#ff527d',
        rgb: [255, 82, 125],
        reliefPattern: 'chevron'
      },
      {
        name: 'P4 Cyan Trace',
        fill: '#2ec4f1',
        highlight: '#96e6ff',
        shadow: '#0e556e',
        glow: '#52d6ff',
        rgb: [82, 214, 255],
        reliefPattern: 'hopper'
      },
      {
        name: 'Flyback Violet',
        fill: '#c751ff',
        highlight: '#e6a6ff',
        shadow: '#59167a',
        glow: '#d475ff',
        rgb: [212, 117, 255],
        reliefPattern: 'radial'
      }
    ],
    hapticPattern: { primeMs: 9, holdMs: [10, 15, 22], detonateMs: [18, 12, 28] }
  },
  {
    id: 'molten-obsidian',
    title: 'MOLTEN OBSIDIAN',
    act: 'ACT V · COLLAPSE',
    subtitle: 'Volcanic glass fissures & rising flock of embers',
    bpm: 144,
    keyName: 'C Phrygian',
    rootMidi: 48,
    scaleIntervals: [0, 1, 3, 5, 7, 8, 10, 12],
    colorCount: 5,
    riseBars: 1,
    quotaBlocks: 190,
    material: 'obsidian',
    sweepPersona: 'embers',
    sweepColor: '#fff0d6',
    sweepSecondary: '#ff5400',
    stageBgTop: '#180b0b',
    stageBgBottom: '#0a0404',
    wellSurface: '#1e0e0e',
    gridHairline: 'rgba(255, 115, 64, 0.065)',
    bezelMetal: '#331818',
    swatches: [
      {
        name: 'Magma Vein',
        fill: '#ff4838',
        highlight: '#ff9d91',
        shadow: '#75150d',
        glow: '#ff6454',
        rgb: [255, 100, 84],
        reliefPattern: 'chevron'
      },
      {
        name: 'Sulfur Flare',
        fill: '#ffaa00',
        highlight: '#ffdf85',
        shadow: '#784b00',
        glow: '#ffc13b',
        rgb: [255, 193, 59],
        reliefPattern: 'hopper'
      },
      {
        name: 'Fumarole Teal',
        fill: '#2bbAA5',
        highlight: '#84f2e2',
        shadow: '#0f5248',
        glow: '#4ae0cb',
        rgb: [74, 224, 203],
        reliefPattern: 'courses'
      },
      {
        name: 'Cinder Rose',
        fill: '#e0458b',
        highlight: '#ff94c4',
        shadow: '#69143a',
        glow: '#ff63a8',
        rgb: [255, 99, 168],
        reliefPattern: 'radial'
      },
      {
        name: 'Basalt Indigo',
        fill: '#6c63ff',
        highlight: '#b0abff',
        shadow: '#282282',
        glow: '#8b84ff',
        rgb: [139, 132, 255],
        reliefPattern: 'triad'
      }
    ],
    hapticPattern: { primeMs: 14, holdMs: [18, 22, 30], detonateMs: [28, 18, 42] }
  },
  {
    id: 'serenity-monolith',
    title: 'SERENITY MONOLITH',
    act: 'ACT VI · SERENITY',
    subtitle: 'Carved alabaster stone & aurora silk sweep',
    bpm: 116,
    keyName: 'Eb Lydian',
    rootMidi: 51,
    scaleIntervals: [0, 2, 4, 6, 7, 9, 11, 12],
    colorCount: 5,
    riseBars: 2,
    quotaBlocks: 160,
    material: 'monolith',
    sweepPersona: 'aurora',
    sweepColor: '#f0fff8',
    sweepSecondary: '#72efdd',
    stageBgTop: '#0d141b',
    stageBgBottom: '#060a0e',
    wellSurface: '#121b24',
    gridHairline: 'rgba(180, 235, 225, 0.055)',
    bezelMetal: '#202d3a',
    swatches: [
      {
        name: 'Celadon Jade',
        fill: '#48bfe3',
        highlight: '#a0e4f7',
        shadow: '#1a5669',
        glow: '#6cd4f5',
        rgb: [108, 212, 245],
        reliefPattern: 'courses'
      },
      {
        name: 'Coral Limestone',
        fill: '#f27059',
        highlight: '#ffb0a1',
        shadow: '#75291c',
        glow: '#ff8773',
        rgb: [255, 135, 115],
        reliefPattern: 'radial'
      },
      {
        name: 'Gilded Travertine',
        fill: '#e9c46a',
        highlight: '#fae6b1',
        shadow: '#735b23',
        glow: '#f7d683',
        rgb: [247, 214, 131],
        reliefPattern: 'hopper'
      },
      {
        name: 'Seafoam Slate',
        fill: '#52b788',
        highlight: '#9ce6c2',
        shadow: '#1f543b',
        glow: '#6ed4a3',
        rgb: [110, 212, 163],
        reliefPattern: 'chevron'
      },
      {
        name: 'Lavender Quartz',
        fill: '#9d79d6',
        highlight: '#d3bef5',
        shadow: '#46306b',
        glow: '#b494eb',
        rgb: [180, 148, 235],
        reliefPattern: 'triad'
      }
    ],
    hapticPattern: { primeMs: 8, holdMs: [10, 20, 15], detonateMs: [16, 12, 24] }
  },
  {
    id: 'coda-blind',
    title: 'CODA · BY EAR',
    act: 'ACT VII · CODA',
    subtitle: 'The sweep is invisible — conduct the wall by ear alone',
    bpm: 128,
    keyName: 'D Minor',
    rootMidi: 50,
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10, 12],
    colorCount: 5,
    riseBars: 1,
    quotaBlocks: 200,
    material: 'monolith',
    sweepPersona: 'invisible',
    sweepColor: '#ffffff',
    sweepSecondary: '#ff4d6d',
    stageBgTop: '#09090e',
    stageBgBottom: '#040407',
    wellSurface: '#0d0d14',
    gridHairline: 'rgba(255, 255, 255, 0.045)',
    bezelMetal: '#1d1d2b',
    swatches: [
      {
        name: 'Crimson Pulse',
        fill: '#ff4d6d',
        highlight: '#ff99ac',
        shadow: '#781528',
        glow: '#ff6b86',
        rgb: [255, 107, 134],
        reliefPattern: 'courses'
      },
      {
        name: 'Solar Harmonic',
        fill: '#ffd166',
        highlight: '#ffe8ad',
        shadow: '#7a5c14',
        glow: '#ffdb80',
        rgb: [255, 219, 128],
        reliefPattern: 'hopper'
      },
      {
        name: 'Teal Resonance',
        fill: '#06d6a0',
        highlight: '#82f7d7',
        shadow: '#026349',
        glow: '#33ebb9',
        rgb: [51, 235, 185],
        reliefPattern: 'chevron'
      },
      {
        name: 'Azure Sub',
        fill: '#118ab2',
        highlight: '#7bd8f7',
        shadow: '#073f52',
        glow: '#38b2db',
        rgb: [56, 178, 219],
        reliefPattern: 'radial'
      },
      {
        name: 'Orchid Octave',
        fill: '#b565f2',
        highlight: '#dfb3ff',
        shadow: '#4e1e73',
        glow: '#c682ff',
        rgb: [198, 130, 255],
        reliefPattern: 'triad'
      }
    ],
    hapticPattern: { primeMs: 12, holdMs: [16, 20, 26], detonateMs: [22, 16, 32] }
  }
];

export function getSkinById(id: string): SkinDefinition {
  return SKINS.find(s => s.id === id) ?? SKINS[0]!;
}
