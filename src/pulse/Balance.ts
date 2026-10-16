import type { Mode } from '../tuning.js';

/** Pure, testable pressure dial. No gameplay assistance, special tiles or hidden randomness. */
export function pressureCadence(mode:Mode,pass:number,skinLevel=1):number{
  if(mode==='zen')return 0;
  // First movement: forgiving first act; later Odyssey movements accelerate earlier.
  const switchAt=mode==='odyssey' ? Math.max(16,26-Math.max(1,Math.min(6,skinLevel))*2) : 22;
  return pass>=switchAt ? 1 : 2;
}
/** Returns the number of bars until the next pressure row, based only on the pass. */
export function pressureForecast(mode:Mode,pass:number,skinLevel=1):number|null{
  if(mode==='zen')return null;
  // Count actual upcoming due passes rather than comparing bars to a threshold:
  // cadence may switch from 2 to 1 midway through a run.
  for(let p=Math.max(2,pass+1);p<=pass+4;p++){
    if((p-1)%pressureCadence(mode,p,skinLevel)===0)return p-pass;
  }
  return null;
}
export function pressureBand(occupied:number,rows=14):'safe'|'rising'|'critical'{
  const headroom=Math.max(0,rows-occupied);
  return headroom<=3?'critical':headroom<=6?'rising':'safe';
}
/** Reward multiple intentional groups rather than inadvertently including held / skipped groups. */
export function projectedResonance(groups:ReadonlyArray<{readyPass:number;state:string}>,pass:number,detonating=0):number{
  return Math.max(detonating,groups.filter(g=>g.readyPass<=pass && (g.state==='active'||g.state==='skipped')).length);
}
