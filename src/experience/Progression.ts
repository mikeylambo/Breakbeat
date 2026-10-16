/** Versioned local-only player history. No server authority is implied. */
export const RANKS = ['BRONZE','SILVER','GOLD','PLATINUM','RESONANT'] as const;
export type Rank = typeof RANKS[number];
export type Persona = 'blade'|'echo'|'prism';
export interface ReplayFrame { step:number; cells:number[]; blasts:number[]; }
export interface ReplayData { score:number; frames:ReplayFrame[]; }
export interface PersonalRecord { score:number; bestPass:number; longestCombo:number; overcharges:number; airPrimes:number; survivalSeconds:number; date:string; assisted:boolean; }
export interface Progress {
  version:2; unlocked:number; best:Record<string,number>; daily:Record<string,number>;
  records:Record<string,PersonalRecord>; replays:Record<string,ReplayData>; completed:string[];
  tutorialComplete:boolean; persona:Persona; totalRuns:number;
}
export const DEFAULT_PROGRESS:Progress={version:2,unlocked:1,best:{},daily:{},records:{},replays:{},completed:[],tutorialComplete:false,persona:'blade',totalRuns:0};
export function migrateProgress(raw:unknown):Progress{
  if(!raw||typeof raw!=='object')return structuredClone(DEFAULT_PROGRESS);
  const x=raw as Partial<Progress>;
  const dict=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const out:Progress={...structuredClone(DEFAULT_PROGRESS),
    unlocked:Math.max(1,Math.min(6,Math.floor(Number(x.unlocked)||1))),
    best:dict(x.best)?Object.fromEntries(Object.entries(x.best).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)&&v>=0)): {},
    daily:dict(x.daily)?Object.fromEntries(Object.entries(x.daily).filter(([,v])=>typeof v==='number'&&Number.isFinite(v))):{},
    records:dict(x.records)?x.records as Record<string,PersonalRecord>:{},
    replays:dict(x.replays)?x.replays as Record<string,ReplayData>:{},
    completed:Array.isArray(x.completed)?x.completed.filter(v=>typeof v==='string'):[],
    tutorialComplete:x.tutorialComplete===true,
    persona:['blade','echo','prism'].includes(x.persona??'')?x.persona!:'blade',
    totalRuns:Math.max(0,Math.floor(Number(x.totalRuns)||0))};
  // An old save kept its Odyssey unlocks but did not yet track completed movements.
  if(!out.completed.length&&out.unlocked>1)out.completed=Array.from({length:out.unlocked-1},(_,i)=>String(i));
  return out;
}
export function rankFor(score:number):Rank {return score>=55000?'RESONANT':score>=26000?'PLATINUM':score>=12000?'GOLD':score>=5000?'SILVER':'BRONZE';}
export function rankIndex(rank:Rank):number{return RANKS.indexOf(rank);}
export function personaUnlock(progress:Progress,persona:Persona):boolean{
  if(persona==='blade')return true;
  const best=Math.max(0,...Object.values(progress.best),...Object.values(progress.records).map(r=>Number(r.score)||0));
  return best >= (persona==='echo'?5000:12000);
}
export function normalizedScore(raw:number,bpmScale:number):number{
  return Math.max(0,Math.round(raw*Math.max(.75,Math.min(1.25,bpmScale))));
}
export function recordResult(progress:Progress,key:string,record:PersonalRecord,replay:ReplayData|null):{newRecord:boolean;rank:Rank}{
  progress.totalRuns++;
  const previous=progress.records[key];const previousBest=Math.max(previous?.score??0,progress.best[key]??0);const newRecord=(!previous&&progress.best[key]===undefined)||record.score>previousBest;
  if(newRecord){progress.records[key]=record;progress.best[key]=record.score;if(replay?.frames.length)progress.replays[key]=replay;}
  else progress.best[key]=Math.max(progress.best[key]||0,record.score);
  return {newRecord,rank:rankFor(record.score)};
}
