import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateProgress,rankFor,personaUnlock,recordResult,normalizedScore} from '../public/src/experience/Progression.js';
import {advanceLesson,LESSONS} from '../public/src/experience/Tutorial.js';
import {PassRecorder,replayFrameAt} from '../public/src/experience/Replay.js';
import {Pulse} from '../public/src/pulse/Pulse.js';
import {GemRules} from '../public/src/content/gems/GemRules.js';
test('legacy save migrates without losing unlocked movements and scores',()=>{
 const p=migrateProgress({unlocked:4,best:{'odyssey:ignition':5600},daily:{'2026-10-16':320}});
 assert.equal(p.version,2);assert.equal(p.unlocked,4);assert.deepEqual(p.completed,['0','1','2']);
 assert.equal(p.best['odyssey:ignition'],5600);assert.equal(p.records['odyssey:ignition'],undefined);
 assert.equal(p.tutorialComplete,false);assert.equal(p.persona,'blade');
});
test('bad/corrupted saves are clamped, no prototype-shape crash',()=>{
 const p=migrateProgress({unlocked:300,best:'wrong',daily:[],completed:['1',1],persona:'hyper'});
 assert.equal(p.unlocked,6);assert.deepEqual(p.best,{});assert.equal(p.persona,'blade');
 assert.deepEqual(migrateProgress(null).completed,[]);
});
test('tutorial cannot advance without actual relevant events, remains action-gated',()=>{
 let l='prime';l=advanceLesson(l,{kind:'burst',overcharged:false});assert.equal(l,'prime');
 l=advanceLesson(l,{kind:'prime',air:false});assert.equal(l,'sweep');
 l=advanceLesson(l,{kind:'hold'});assert.equal(l,'sweep');
 l=advanceLesson(l,{kind:'burst',overcharged:false});assert.equal(l,'hold');
 l=advanceLesson(l,{kind:'hold'});assert.equal(l,'overcharge');
 l=advanceLesson(l,{kind:'burst',overcharged:false});assert.equal(l,'overcharge');
 l=advanceLesson(l,{kind:'burst',overcharged:true});assert.equal(l,'air');
 l=advanceLesson(l,{kind:'prime',air:false});assert.equal(l,'air');
 l=advanceLesson(l,{kind:'prime',air:true});assert.equal(l,'complete');
 assert.ok(Object.values(LESSONS).every(x=>x.title&&x.body&&x.action));
});
test('mastery unlocks are cosmetic only and use highest local score',()=>{
 const p=migrateProgress(null);assert.equal(personaUnlock(p,'blade'),true);assert.equal(personaUnlock(p,'echo'),false);
 recordResult(p,'odyssey:ignition',{score:6000,bestPass:600,airPrimes:1,longestCombo:3,overcharges:1,survivalSeconds:90,date:'2026-10-16',assisted:false},null);
 assert.equal(rankFor(6000),'SILVER');assert.equal(personaUnlock(p,'echo'),true);assert.equal(personaUnlock(p,'prism'),false);
 p.best['zen:ignition']=15000;assert.equal(personaUnlock(p,'prism'),true);
 assert.equal(p.totalRuns,1);
});
test('personal best only replaces record on higher score and keeps separate assist category',()=>{
 const p=migrateProgress(null),base={score:200,bestPass:50,airPrimes:1,longestCombo:3,overcharges:1,survivalSeconds:90,date:'2026-10-16',assisted:false};
 assert.equal(recordResult(p,'endless:ignition',base,null).newRecord,true);
 assert.equal(recordResult(p,'endless:ignition',{...base,score:150},null).newRecord,false);
 recordResult(p,'endless:ignition:assisted',{...base,score:350,assisted:true},null);
 assert.equal(p.best['endless:ignition'],200);assert.equal(p.best['endless:ignition:assisted'],350);
 assert.equal(normalizedScore(1234,.8),987);assert.equal(normalizedScore(1234,1),1234);
});
test('best-pass reconstruction snapshots a playable board and loops safely',()=>{
 const g=new Pulse({seed:'record',mode:'endless',bpm:116},new GemRules());
 const r=new PassRecorder();g.advanceTo(0);r.capture(g.pass,g.step,0,g.board,g.groups);
 let point=null;for(let y=0;y<14&&!point;y++)for(let x=0;x<10;x++)if(g.rules.primeable(g.board,x,y).length){point={x,y};break;}
 assert.ok(point);g.prime(point.x,point.y);r.capture(g.pass,1,0,g.board,g.groups);
 g.advanceTo(31);assert.ok(g.stats.score>0);r.capture(g.pass,g.step,g.stats.score,g.board,g.groups,[120]);
 r.finish(g.stats.score);assert.ok(r.best?.frames.length>=2);assert.ok(r.best.score>0);
 const f=replayFrameAt(r.best,0),other=replayFrameAt(r.best,3000);assert.deepEqual(f,other);
 assert.equal(f.cells.length,140);r.reset();assert.equal(r.best,null);
});
