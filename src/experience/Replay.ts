import type { Tile,Group } from '../pulse/Pulse.js';
import type { ReplayData,ReplayFrame } from './Progression.js';
/** A tiny, deterministic, display-only reconstruction of the run's strongest pass. */
export class PassRecorder{
  private pass=0;private startScore=0;private lastStep=-1;private frames:ReplayFrame[]=[];
  best:ReplayData|null=null;
  reset():void{this.pass=0;this.startScore=0;this.lastStep=-1;this.frames=[];this.best=null;}
  capture(pass:number,step:number,score:number,board:(Tile|null)[][],groups:Map<number,Group>,bursts:number[]=[]):void{
    if(pass<=0)return;
    if(this.pass!==pass){this.finish(score);this.pass=pass;this.startScore=score;this.lastStep=-1;this.frames=[];}
    if(this.lastStep===step&&bursts.length===0)return;
    this.lastStep=step;
    const cells=board.flat().map(t=>!t?-1:t.type+(t.group===null?0:(groups.get(t.group)?.held?8:4)));
    this.frames.push({step:step%16,cells,blasts:bursts});
    if(this.frames.length>80)this.frames.shift();
  }
  finish(totalScore:number):void{
    if(!this.pass)return;
    const score=Math.max(0,totalScore-this.startScore);
    if(score>(this.best?.score||0)&&this.frames.length){this.best={score,frames:this.frames.map(f=>({...f,cells:[...f.cells],blasts:[...f.blasts]}))};}
  }
}
export function replayFrameAt(replay:ReplayData,elapsedMs:number):ReplayFrame|undefined{
  const frames=replay.frames;if(!frames.length)return undefined;
  return frames[Math.floor(((elapsedMs%3000)+3000)%3000/3000*frames.length)];
}
