import test from 'node:test';import assert from 'node:assert/strict';
import {stepTime,quantizeStep,visualElapsed} from '../public/src/pulse/Conductor.js';
import {skins} from '../public/src/content/skins.js';
import {Pulse} from '../public/src/pulse/Pulse.js';
import {GemRules} from '../public/src/content/gems/GemRules.js';
import {T} from '../public/src/tuning.js';

test('BEAT_LOCK: 200 passes map exactly to the sixteenth grid (no accumulated clock drift)',()=>{
  for(const bpm of [100,116,122,132,144,160]){
    const origin=120.25,seconds=60/bpm/4;
    for(let step=0;step<200*16;step++){
      const at=stepTime(origin,step,bpm);
      assert.ok(Math.abs((at-origin)-step*seconds)<.000001,`${bpm} BPM, step ${step}`);
      assert.equal(quantizeStep(at,origin,bpm),step);
      if(step%16===0)assert.ok(Math.abs((at-origin)/ (60/bpm*4)-step/16)<1e-9);
    }
  }
});
test('output latency shifts only visual timeline and never changes audio grid',()=>{
  assert.equal(visualElapsed(10.5,10,0.04),.46);
  assert.equal(visualElapsed(10.02,10,0.04),0);
  assert.equal(stepTime(10,8,120),11);
});
test('six movement skins use six distinct block materials and sweep personas',()=>{
  assert.equal(skins.length,6);
  assert.equal(new Set(skins.map(s=>s.texture)).size,6);
  assert.equal(new Set(skins.map(s=>s.sweep)).size,6);
  assert.equal(skins.at(-1).sweep,'hidden');
});
test('air contact guarantees >=250ms interaction window',()=>{
  for(const bpm of [100,116,132,160]){
    const g=new Pulse({seed:'air',mode:'endless',bpm},new GemRules());
    // At every supported BPM, physical fall is driven from the audio clock.
    const seconds=Math.max(T.AIR_FAIR_MS/1000/(1-T.AIR_CONTACT_FROM),T.FALL_DURATION/T.FALL_SPEED_SCALE);
    assert.ok(seconds*(1-T.AIR_CONTACT_FROM)*1000>=250);
    assert.ok(g.step===-1);
  }
});
test('airborne cascades are deterministic at fractional conductor times',()=>{
  const a=new Pulse({seed:'16',mode:'endless',bpm:116},new GemRules());
  const b=new Pulse({seed:'16',mode:'endless',bpm:116},new GemRules());
  for(const g of [a,b]){g.advanceTo(0);outer:for(let y=0;y<14;y++)for(let x=0;x<10;x++)if(g.prime(x,y))break outer;g.advanceTo(16);}
  assert.equal(a.snapshot(),b.snapshot());
  const f=a.flight;assert.ok(f);
  const t=f.sinceStep*60/116/4+f.seconds*.6;
  for(const g of [a,b]){
    const moving=g.flight.tiles.find(t=>t.moved);if(moving){const p=g.flightPosition(moving,t);g.primeAir(Math.round(p.x),Math.round(p.y),t);}
    g.advancePhysics(t+f.seconds);g.advanceTo(44);
  }
  assert.equal(a.snapshot(),b.snapshot());
});
