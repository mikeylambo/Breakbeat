/**
 * Etudes — hand-authored puzzles: a fixed board, a goal, and a pass limit. No pressure rows.
 * Tutorial "Try it" drills (content/drills.json) are the same shape with a `topic`.
 * DOM-free so the ETUDES gate can replay every authored solution against the real engine.
 */

import type { PulseEngine } from '../pulse/PulseEngine.js';
import type { PulseEvent } from '../pulse/types.js';

export interface EtudeGoal {
  type: 'allclear' | 'groups' | 'air' | 'score' | 'chain' | 'overcharge' | 'survive';
  value?: number;
}

export interface EtudeAction {
  /** Pass (1-based) whose start the action happens before; or an exact sim step */
  pass?: number;
  step?: number;
  col: number;
  row: number;
  hold?: boolean;
}

export interface EtudeDef {
  id: string;
  name: string;
  hint: string;
  goal: EtudeGoal;
  passes: number;
  charge?: number;
  board: number[][];
  solution: EtudeAction[];
  /** Tutorial drills: the Tutorial & Tips topic this drill belongs to */
  topic?: string;
  /** The wall rises every this many bars (absent = no pressure rows) */
  pressure?: number;
}

export function goalText(g: EtudeGoal): string {
  switch (g.type) {
    case 'allclear':
      return 'Clear the wall';
    case 'groups':
      return `${g.value} groups in one pass`;
    case 'air':
      return `Air-prime ${g.value}`;
    case 'chain':
      return `Chain ${g.value} passes`;
    case 'overcharge':
      return `Overcharge ${g.value ?? 1}`;
    case 'survive':
      return `Survive ${g.value} rising rows`;
    default:
      return `Score ${g.value}`;
  }
}

export type EtudeState = 'playing' | 'won' | 'lost';

export class EtudeRun {
  private readonly perBar = new Map<number, number>();
  state: EtudeState = 'playing';

  constructor(readonly def: EtudeDef) {}

  onEvent(ev: PulseEvent): void {
    if (ev.type === 'detonate') this.perBar.set(ev.bar, (this.perBar.get(ev.bar) ?? 0) + 1);
  }

  /** Passes the player has left (the current one included). */
  passesLeft(engine: PulseEngine): number {
    return Math.max(0, this.def.passes - Math.max(0, engine.currentBar - 1));
  }

  /** Call after each sim advance. */
  check(engine: PulseEngine): EtudeState {
    if (this.state !== 'playing') return this.state;
    const g = this.def.goal;
    const t = engine.telemetry;
    let won = false;
    if (g.type === 'allclear') won = t.allClears >= 1;
    else if (g.type === 'groups') for (const v of this.perBar.values()) won ||= v >= (g.value ?? 0);
    else if (g.type === 'air') won = t.airPrimesLanded >= (g.value ?? 1);
    else if (g.type === 'chain') won = t.longestCombo >= (g.value ?? 2);
    else if (g.type === 'overcharge') won = t.overchargesLanded >= (g.value ?? 1);
    else if (g.type === 'survive') won = !engine.gameOver && t.pressurePushes >= (g.value ?? 1);
    else won = t.score >= (g.value ?? 0);
    if (won) this.state = 'won';
    // Drills with a rising wall can top out
    else if (engine.gameOver) this.state = 'lost';
    // Out of passes once the bar after the last allowed pass begins and nothing is still falling
    else if (engine.currentBar > this.def.passes && engine.falling.size === 0) this.state = 'lost';
    return this.state;
  }
}
