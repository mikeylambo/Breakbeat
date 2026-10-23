/**
 * EtudeCode — a player-made Etude as a link. The board, goal and rules travel with the author's
 * own winning inputs (engine log events), packed into base64url. Sharing needs a solve, and
 * `verify` re-simulates that solve before anyone plays, so every shared puzzle is provably
 * solvable: no server and no moderation, the puzzle lives in the link.
 * DOM-free and content-free (rules are passed in), so Node tests and the game share it.
 */

import { PulseEngine } from '../pulse/PulseEngine.js';
import type { ContentRules, ReplayEvent } from '../pulse/types.js';
import { TUNING } from '../tuning.js';
import { EtudeRun, type EtudeDef, type EtudeGoal } from './Etude.js';
import { cleanName } from './text.js';

const VERSION = 1;
const GOALS: readonly EtudeGoal['type'][] = ['allclear', 'groups', 'air', 'score', 'chain', 'overcharge', 'survive'];
const MAX_EVENTS = 96;
/** Shared Etudes always use this seed, so pressure rows match the author's solve. */
export const SHARED_SEED = 'etude';
export const SHARED_COLORS = 4;

export interface SharedEtude {
  def: EtudeDef;
  /** Tempo the author solved it at (air-prime timing depends on it) */
  bpm: number;
  /** The author's winning inputs */
  solution: Extract<ReplayEvent, { k: 'p' | 'h' }>[];
}

// ---------------------------------------------------------------- bytes

class Writer {
  private readonly b: number[] = [];
  u8(v: number): void {
    this.b.push(v & 255);
  }
  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }
  f64(v: number): void {
    const d = new DataView(new ArrayBuffer(8));
    d.setFloat64(0, v);
    for (let i = 0; i < 8; i++) this.u8(d.getUint8(i));
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.b);
  }
}

class Reader {
  i = 0;
  constructor(private readonly b: Uint8Array) {}
  u8(): number {
    if (this.i >= this.b.length) throw new Error('short');
    return this.b[this.i++]!;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  f64(): number {
    const d = new DataView(new ArrayBuffer(8));
    for (let k = 0; k < 8; k++) d.setUint8(k, this.u8());
    return d.getFloat64(0);
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i]! << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < u.length ? B64[(n >> 6) & 63]! : '') + (i + 2 < u.length ? B64[n & 63]! : '');
  }
  return s;
}

function fromB64(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bad char');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

function checksum(u: Uint8Array, n = u.length): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < n; i++) h = Math.imul(h ^ u[i]!, 0x01000193);
  return (h >>> 0) & 0xffff;
}

// ---------------------------------------------------------------- encode / decode

/** Bottom-aligned rows that hold any tile (an empty top is not stored). */
function trimmed(board: readonly (readonly number[])[]): number[][] {
  const rows = board.map(r => Array.from({ length: TUNING.BOARD_COLS }, (_, c) => r[c] ?? -1));
  while (rows.length && rows[0]!.every(k => k < 0)) rows.shift();
  return rows;
}

export function encodeEtude(e: SharedEtude): string {
  const d = e.def;
  const w = new Writer();
  w.u8(VERSION);
  w.u8(Math.max(0, GOALS.indexOf(d.goal.type)));
  w.u16(Math.max(0, Math.min(65535, Math.round(d.goal.value ?? 0))));
  w.u8(d.passes);
  w.u8(d.charge ?? 0);
  w.u8(d.pressure ?? 0);
  w.u16(Math.round(e.bpm * 10));
  const name = new TextEncoder().encode(cleanName(d.name, 'Etude').slice(0, 24));
  w.u8(name.length);
  for (const b of name) w.u8(b);
  const hint = new TextEncoder().encode(cleanName(d.hint, '').slice(0, 60));
  w.u8(hint.length);
  for (const b of hint) w.u8(b);
  const rows = trimmed(d.board);
  w.u8(rows.length);
  // 3 bits a cell: 0 = empty, 1..5 = colour 0..4
  let acc = 0;
  let bits = 0;
  for (const r of rows)
    for (const k of r) {
      acc = (acc << 3) | (k < 0 ? 0 : Math.min(5, k + 1));
      bits += 3;
      while (bits >= 8) {
        bits -= 8;
        w.u8(acc >> bits);
      }
    }
  if (bits) w.u8(acc << (8 - bits));
  const sol = e.solution.slice(0, MAX_EVENTS);
  w.u8(sol.length);
  for (const ev of sol) {
    const hasT = ev.k === 'p' && ev.t !== undefined;
    w.u8((ev.k === 'h' ? 1 : 0) | (hasT ? 2 : 0));
    w.u16(ev.s + 1);
    w.u8((ev.c & 15) | ((ev.r & 15) << 4));
    if (hasT) w.f64((ev as { t: number }).t);
  }
  const body = w.bytes();
  const sum = checksum(body);
  return toB64(Uint8Array.from([...body, sum >> 8, sum & 255]));
}

/** Decodes a code; throws with a short reason on anything malformed. */
export function decodeEtude(code: string): SharedEtude {
  const all = fromB64(code.trim());
  if (all.length < 12) throw new Error('That etude code is incomplete.');
  const n = all.length - 2;
  if (checksum(all, n) !== ((all[n]! << 8) | all[n + 1]!)) throw new Error('That etude code is damaged.');
  const r = new Reader(all.subarray(0, n));
  if (r.u8() !== VERSION) throw new Error('That etude was made by a newer version.');
  const type = GOALS[r.u8()];
  if (!type) throw new Error('Unknown goal.');
  const value = r.u16();
  const passes = r.u8();
  const charge = r.u8();
  const pressure = r.u8();
  const bpm = r.u16() / 10;
  if (passes < 1 || passes > 8 || bpm < 60 || bpm > 200 || charge > 1 || pressure > 4) throw new Error('That etude has impossible rules.');
  const txt = (): string => {
    const len = r.u8();
    const b = new Uint8Array(len);
    for (let i = 0; i < len; i++) b[i] = r.u8();
    return new TextDecoder().decode(b);
  };
  const name = cleanName(txt(), 'Etude').slice(0, 24);
  const hint = cleanName(txt(), '').slice(0, 60);
  const rowCount = r.u8();
  if (rowCount < 1 || rowCount > TUNING.BOARD_ROWS) throw new Error('That etude has no wall.');
  const cells = rowCount * TUNING.BOARD_COLS;
  const board: number[][] = [];
  let acc = 0;
  let bits = 0;
  const flat: number[] = [];
  while (flat.length < cells) {
    if (bits < 3) {
      acc = ((acc << 8) | r.u8()) & 0xffff;
      bits += 8;
    }
    bits -= 3;
    const v = (acc >> bits) & 7;
    if (v > 5) throw new Error('Bad cell.');
    flat.push(v - 1);
  }
  for (let i = 0; i < rowCount; i++) board.push(flat.slice(i * TUNING.BOARD_COLS, (i + 1) * TUNING.BOARD_COLS));
  const count = r.u8();
  const solution: SharedEtude['solution'] = [];
  for (let i = 0; i < count; i++) {
    const f = r.u8();
    const s = r.u16() - 1;
    const cr = r.u8();
    const c = cr & 15;
    const row = cr >> 4;
    if (c >= TUNING.BOARD_COLS || row >= TUNING.BOARD_ROWS) throw new Error('Bad move.');
    if (f & 1) solution.push({ k: 'h', s, c, r: row });
    else if (f & 2) solution.push({ k: 'p', s, c, r: row, t: r.f64() });
    else solution.push({ k: 'p', s, c, r: row });
  }
  const def: EtudeDef = {
    id: `shared-${code.slice(-10)}`,
    name,
    hint: hint || goalHint(type),
    goal: type === 'allclear' ? { type } : { type, value },
    passes,
    board,
    solution: []
  };
  if (charge) def.charge = charge;
  if (pressure) def.pressure = pressure;
  return { def, bpm, solution };
}

function goalHint(t: EtudeGoal['type']): string {
  return t === 'allclear' ? 'Leave nothing standing.' : 'Made by a player. Solved by them, too.';
}

/** The engine a shared Etude plays on (also the one its solution is checked on). */
export function etudeEngine(def: EtudeDef, bpm: number, rules: ContentRules): PulseEngine {
  const e = new PulseEngine(
    { seed: SHARED_SEED, mode: 'etude', bpm, colorCount: SHARED_COLORS, riseBars: def.pressure ?? 2, pressureEnabled: !!def.pressure, fixedDeal: def.board },
    rules
  );
  e.charge = def.charge ?? 0;
  return e;
}

/** Re-simulates the author's solution: true when it wins within the pass limit. */
export function verify(e: SharedEtude, rules: ContentRules): boolean {
  const engine = etudeEngine(e.def, e.bpm, rules);
  const run = new EtudeRun(e.def);
  const feed = (): void => {
    for (const ev of engine.events) run.onEvent(ev);
    engine.events.length = 0;
  };
  let i = 0;
  const limit = (e.def.passes + 2) * TUNING.SIXTEENTHS_PER_BAR;
  for (let step = -1; step <= limit && run.state === 'playing'; step++) {
    if (step >= 0) {
      engine.advanceToStep(step);
      feed();
      if (run.check(engine) !== 'playing') break;
    }
    for (; i < e.solution.length && e.solution[i]!.s <= Math.max(step, -1); i++) {
      const ev = e.solution[i]!;
      if (ev.k === 'p') engine.primeAt(ev.c, ev.r, ev.t);
      else engine.holdAt(ev.c, ev.r);
      feed();
    }
  }
  return run.state === 'won';
}

/** The author's inputs from a finished engine (primes and holds only). */
export function solutionOf(engine: PulseEngine): SharedEtude['solution'] {
  return engine.log.filter((x): x is SharedEtude['solution'][number] => x.k === 'p' || x.k === 'h');
}
