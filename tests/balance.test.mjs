import test from 'node:test';
import assert from 'node:assert/strict';
import { Pulse } from '../public/src/pulse/Pulse.js';
import { GemRules } from '../public/src/content/gems/GemRules.js';
import { pressureCadence,pressureForecast,pressureBand,projectedResonance } from '../public/src/pulse/Balance.js';
import { CHALLENGES, challengeState } from '../public/src/pulse/Challenges.js';
import { migrateProgress, completeChallenge } from '../public/src/experience/Progression.js';

const make=(seed='audit', mode='endless', challenge=null)=>new Pulse({seed,mode,bpm:116,skinLevel:1,challenge},new GemRules());
const at=(g,x,y,type,group=null,id=y*10+x+1)=>g.board[y][x]={id,x,y,type,group};

test('pressure phases preserve zero Zen pressure and deterministic 2→1 cadence',()=>{
 assert.equal(pressureCadence('zen',300),0);
 assert.equal(pressureCadence('endless',1),2);assert.equal(pressureCadence('endless',21),2);assert.equal(pressureCadence('endless',22),1);
 assert.equal(pressureCadence('odyssey',18,1),2);assert.equal(pressureCadence('odyssey',18,6),1);
 assert.equal(pressureForecast('endless',1),2);assert.equal(pressureForecast('endless',2),1);
 assert.equal(pressureForecast('zen',200),null);
 assert.equal(pressureBand(12),'critical');assert.equal(pressureBand(9),'rising');assert.equal(pressureBand(4),'safe');
});
test('resonance projection ignores held and not-yet-ready groups',()=>{
 const groups=[{readyPass:2,state:'active'},{readyPass:2,state:'held'},{readyPass:3,state:'skipped'},{readyPass:2,state:'skipped'},{readyPass:2,state:'queued'}];
 assert.equal(projectedResonance(groups,2),2);
 assert.equal(projectedResonance(groups,3),3);
 assert.equal(projectedResonance(groups,2,4),4);
});
test('overlapping held blast and adjacent primed groups never award the same tile twice',()=>{
 const g=make('overlap');g.board=Array.from({length:14},()=>Array(10).fill(null));
 // Both groups have x=2 anchors so they are swept on the same sixteenth.
 at(g,2,10,0);at(g,2,11,0);at(g,2,9,1);at(g,3,9,1);
 g.advanceTo(0);
 const held=g.prime(2,10);assert.ok(held);assert.ok(g.hold(2,10));
 g.advanceTo(15); // held group skips Pass 1 when blade crosses x=2
 assert.equal(g.stats.groups,0,'held group waits for next sweep');
 g.advanceTo(16);
 const neighbor=g.prime(2,9);assert.ok(neighbor); // enters when the held group is due
 g.advanceTo(22);
 const bursts=g.drain().filter(e=>e.kind==='burst');
 const ids=bursts.flatMap(e=>e.ids);
 assert.equal(ids.length,new Set(ids).size,'each cleared tile contributes to at most one burst');
 assert.equal(g.stats.overcharges,1);
 assert.equal(g.stats.groups,1,'a completely consumed neighboring group awards no extra points');
 assert.equal(g.stats.overchargeTiles,4);
 assert.equal(bursts[0].resonance,1,'only a real detonation contributes to resonance');
 assert.equal(g.stats.maxPassGroups,1);
});
test('challenge contracts track play, do not introduce tiles or score bonuses',()=>{
 for(const challenge of CHALLENGES){
  const g=make('identical','endless',challenge.id),baseline=make('identical','endless');
  assert.equal(g.snapshot(),baseline.snapshot());
  assert.ok(challengeState(challenge.id,g.stats));
  const achieved={...g.stats,[challenge.metric]:challenge.target};
  assert.equal(challengeState(challenge.id,achieved).complete,true);
 }
 assert.equal(make('audit','daily','relay').challengeProgress,null);
 assert.equal(challengeState('invalid',make().stats),null);
});
test('completion records survive legacy saves and update best without duplicates',()=>{
 const save=migrateProgress({version:2,unlocked:4,best:{'endless:ignition':100}});
 assert.deepEqual(save.completedChallenges,[]);
 assert.deepEqual(save.challengeBest,{});
 assert.equal(completeChallenge(save,'relay',890).first,true);
 assert.equal(completeChallenge(save,'relay',500).first,false);
 assert.equal(completeChallenge(save,'relay',950).best,950);
 assert.deepEqual(save.completedChallenges,['relay']);
 assert.equal(migrateProgress(save).challengeBest.relay,950);
});
test('seeded generation provides an initial legal prime and only four ordinary block types',()=>{
 for(let i=0;i<500;i++){const a=make(`fairness-${i}`),b=make(`fairness-${i}`);
  assert.equal(a.snapshot(),b.snapshot());
  assert.equal(a.hasPrimeable(),true);
  assert.ok(a.board.flat().every(t=>!t||(t.type>=0&&t.type<4)));
 }
});

test('dimmed incoming row preview is an exact deterministic peek, without consuming RNG',()=>{
 for(let i=0;i<100;i++){
  const g=make(`preview-${i}`);g.advanceTo(16); // one bar before first pressure
  const before=g.snapshot();const row=g.previewNextRow();
  assert.equal(g.snapshot(),before,'preview does not advance RNG or mutate the board');
  assert.ok(row.some((v,n)=>n>0&&v===row[n-1]),'incoming row contains a normal same-colour pair');
  g.advanceTo(32);const pushed=g.drain().find(e=>e.kind==='pressure');
  assert.deepEqual(pushed?.row,row);
 }
});
