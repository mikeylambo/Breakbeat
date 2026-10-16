/** Opt-in skill contracts. The blocks, board rules and base score never change. */
export const CHALLENGES = [
  {id:'relay',name:'RESONANCE RELAY',subtitle:'Conduct four distinct groups on one sweep.',metric:'maxPassGroups',target:4},
  {id:'forge',name:'OVERCHARGE FORGE',subtitle:'Land three successful held detonations.',metric:'overcharges',target:3},
  {id:'skyline',name:'SKYLINE CATCH',subtitle:'Air-prime three falling formations.',metric:'airPrimes',target:3},
  {id:'gauntlet',name:'PRESSURE GAUNTLET',subtitle:'Survive twelve pressure rises.',metric:'pressureRows',target:12}
] as const;
export type ChallengeId=typeof CHALLENGES[number]['id'];
export type ChallengeMetric=typeof CHALLENGES[number]['metric'];
export interface ChallengeStats {maxPassGroups:number;overcharges:number;airPrimes:number;pressureRows:number;}
export function challengeById(id:string|null|undefined){return CHALLENGES.find(c=>c.id===id)??null;}
export function challengeState(id:string|null|undefined,stats:ChallengeStats):{value:number;target:number;complete:boolean}|null{
  const challenge=challengeById(id);if(!challenge)return null;
  const value=Math.min(challenge.target,Math.max(0,stats[challenge.metric]));
  return {value,target:challenge.target,complete:value>=challenge.target};
}
