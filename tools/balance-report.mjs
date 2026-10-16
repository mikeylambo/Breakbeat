/** Deterministic comparison of three declared policies, not a human-play claim. */
import { Pulse } from '../public/src/pulse/Pulse.js';
import { GemRules } from '../public/src/content/gems/GemRules.js';
const seeds=Number(process.argv[2]||40),passes=Number(process.argv[3]||42);
function available(g){const groups=[],seen=new Set();for(let y=13;y>=0;y--)for(let x=0;x<10;x++){
 const ids=g.rules.primeable(g.board,x,y);if(!ids.length||seen.has(ids[0]))continue;
 ids.forEach(id=>seen.add(id));groups.push({x,y,size:ids.length});
 }return groups.sort((a,b)=>b.size-a.size||a.y-b.y||a.x-b.x);
}
function simulate(seed,policy){const g=new Pulse({seed:`balance-v0.5:${seed}`,mode:'endless',bpm:116},new GemRules());
 for(let step=0;step<passes*16&&!g.over;step++){
   g.advanceTo(step);
   if(g.flight){if(policy==='expert'){
     const now=step*60/116/4;
     if(g.flightProgress(now)>=.55){for(const f of g.flight.tiles.filter(f=>f.moved&&!f.group)){
       const pos=g.flightPosition(f,now);if(g.primeAir(Math.round(pos.x),Math.round(pos.y),now))break;
     }}
   }continue;}
   if(step%16!==0)continue;
   if(policy==='novice'&&g.pass%3!==1)continue;
   if(policy==='intermediate'&&g.pass%2!==1)continue;
   const budget=policy==='novice'?1:policy==='intermediate'?2:4;
   for(let n=0;n<budget;n++){
    const candidates=available(g);if(!candidates.length)break;
    // Novices pick the first visible group rather than optimizing for size.
    const choice=policy==='novice'?candidates[candidates.length-1]:candidates[0];
    if(!g.prime(choice.x,choice.y))break;
    if(policy==='expert'&&g.pass%4===2&&n===0)g.hold(choice.x,choice.y);
   }
 }
 return {score:g.stats.score,passes:g.stats.passes,pressure:g.stats.pressureRows,groups:g.stats.groups,peak:g.stats.maxPassGroups,over:g.stats.overcharges,air:g.stats.airPrimes};}
const report={version:'0.5.0',seeds,passes,policies:{}};
for(const policy of ['novice','intermediate','expert']){
 const runs=Array.from({length:seeds},(_,i)=>simulate(i,policy)),mean=k=>Math.round(runs.reduce((sum,r)=>sum+r[k],0)/runs.length);
 report.policies[policy]={meanScore:mean('score'),meanPasses:mean('passes'),meanPressureRows:mean('pressure'),meanGroups:mean('groups'),meanMaxGroupsPass:mean('peak'),meanOvercharges:mean('over'),meanAirPrimes:mean('air'),minimumScore:Math.min(...runs.map(r=>r.score)),maximumScore:Math.max(...runs.map(r=>r.score))};
}
console.log(JSON.stringify(report,null,2));
