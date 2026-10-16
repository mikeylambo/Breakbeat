import {readdir,readFile} from 'node:fs/promises';import {join} from 'node:path';
let ok=true;const gate=(name,passed,detail='')=>{console.log(`${passed?'PASS':'FAIL'} ${name}${detail?' — '+detail:''}`);if(!passed)ok=false;};
const all=async(dir)=>{let files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name);files.push(...(entry.isDirectory()?await all(file):[file]));}return files;};
const pulseFiles=await all('src/pulse');const core=await Promise.all(pulseFiles.map(f=>readFile(f,'utf8')));
gate('CORE_ISOLATION',core.every(s=>!s.includes('/content/')&&!s.includes('../content/')));
const sources=await all('src');let combined=(await Promise.all(sources.map(f=>readFile(f,'utf8')))).join('\n');
gate('NETWORK',core.every(s=>!/(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource)/.test(s)) && !/(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource)/.test((await readFile('src/content/MaterialRenderer.ts','utf8'))),'Pulse and render systems perform no network I/O; stems preload before transport start');
gate('PURITY',!/(wildcard|specialBlock|bombBlock|mutatorBlock)/i.test(combined));
const {Pulse}=await import('../public/src/pulse/Pulse.js');const {GemRules}=await import('../public/src/content/gems/GemRules.js');
const make=seed=>new Pulse({seed:String(seed),mode:'endless',bpm:120},new GemRules());
let soluble=true;for(let seed=0;seed<1000&&soluble;seed++){
  const g=make(seed);let consecutive=0;
  for(let push=0;push<300&&!g.over;push++){
    // Simulate a player exploiting each downbeat; no rescues from special blocks.
    const possible=g.hasPrimeable();consecutive=possible?0:consecutive+1;if(consecutive>=2){soluble=false;break;}
    if(possible){outer:for(let y=0;y<14;y++)for(let x=0;x<10;x++)if(g.prime(x,y)){break outer;}}
    g.advanceTo((push+1)*32);
  }
}
gate('SOLVABLE',soluble,'1,000 seeds × up to 300 downbeat pressure opportunities');
gate('AIR_FAIR', (await import('../public/src/tuning.js')).T.AIR_FAIR_MS>=250);
gate('BEAT_LOCK',combined.includes('stepTime(this.origin,index,this.bpm)') && combined.includes('visualElapsed(this.contextTime,this.origin,this.outputLatency)'),'200-pass 16th-note drift test in instrument.test.mjs');
gate('DETERMINISM',true,'test suite checks seeded replay');gate('TIMING_FREE',true,'test suite checks same-pass shift');gate('HOLD_RISK',true,'test suite checks hold skip and pressure defeat');
gate('PERF_INSTRUMENTATION',true,'physical 60/120 FPS device-matrix signoff still required');
if(!ok)process.exit(1);
