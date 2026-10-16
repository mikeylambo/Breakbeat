/** Event-driven learning; a step advances only after the requested action happens. */
export type Lesson = 'prime'|'sweep'|'hold'|'overcharge'|'air'|'complete';
export type LearningEvent = {kind:'prime';air:boolean}|{kind:'burst';overcharged:boolean}|{kind:'hold'};
export const LESSONS:Record<Lesson,{title:string;body:string;action:string}>={
  prime:{title:'01 / BUILD A CHORD',body:'Tap two or more touching, matching tiles to prime them. No timing judgment.',action:'PRIME A GROUP'},
  sweep:{title:'02 / RELEASE ON THE BEAT',body:'Watch the sweep play your selected group. You choose what; the music chooses when.',action:'WATCH A CLEAR'},
  hold:{title:'03 / RISK THE NEXT PASS',body:'Prime another group, then hold it for 300 ms to skip a sweep.',action:'HOLD A PRIMED GROUP'},
  overcharge:{title:'04 / FEEL THE DROP',body:'A held group detonates on its following pass and clears diagonal neighbors.',action:'WATCH AN OVERCHARGE'},
  air:{title:'05 / CATCH THE FALL',body:'After a clear, tap a touching pair while it falls. Look for the air-contact prompt.',action:'AIR-PRIME A FALLING PAIR'},
  complete:{title:'YOU ARE THE CONDUCTOR',body:'Create several groups in one pass to build resonance. Keep your chain alive.',action:'LESSONS COMPLETE'}
};
const order:Lesson[]=['prime','sweep','hold','overcharge','air','complete'];
export function advanceLesson(current:Lesson,event:LearningEvent):Lesson{
  const matches=current==='prime'&&event.kind==='prime'&&!event.air||
    current==='sweep'&&event.kind==='burst'||current==='hold'&&event.kind==='hold'||
    current==='overcharge'&&event.kind==='burst'&&event.overcharged||
    current==='air'&&event.kind==='prime'&&event.air;
  return matches?order[Math.min(order.length-1,order.indexOf(current)+1)]!:current;
}
