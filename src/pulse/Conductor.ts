/** Web Audio is the clock. Rendering and sim sample its timeline, not a JS metronome. */
export class Conductor {
  private ctx: AudioContext | null = null;
  private origin = 0; private lastScheduled = -1; private paused = true;
  private interval = 0; private rank = 0; private volume = .7;
  bpm = 124; key = 0; muted = false;
  get ready(): boolean { return !!this.ctx; }
  get running(): boolean { return !!this.ctx && !this.paused; }
  get contextTime(): number { return this.ctx?.currentTime ?? 0; }
  get beatSeconds():number {return 60/this.bpm;}
  get stepSeconds():number {return this.beatSeconds/4;}
  get elapsed():number {return Math.max(0,(this.ctx?.currentTime ?? this.origin)-this.origin);}
  get absoluteStep():number {return Math.floor(this.elapsed/this.stepSeconds + 1e-6);}
  get sweep():number {return (this.elapsed%(this.beatSeconds*4))/(this.beatSeconds*4);}
  get latencyMs():number {return Math.round(((this.ctx?.outputLatency??0)+(this.ctx?.baseLatency??0))*1000);}
  async start(bpm:number,key=0):Promise<void> {
    await this.stop();
    this.ctx = new AudioContext({latencyHint:'interactive'});
    await this.ctx.resume(); this.bpm=bpm;this.key=key;
    this.origin=this.ctx.currentTime+.095;this.lastScheduled=-1;this.paused=false;
    this.interval=window.setInterval(()=>this.schedule(),25);
    this.schedule();
  }
  async stop():Promise<void> {
    if(this.interval)window.clearInterval(this.interval);this.interval=0;
    const old=this.ctx;this.ctx=null;this.paused=true;
    if(old)await old.close().catch(()=>{});
  }
  async setPause(paused:boolean):Promise<void>{
    if(!this.ctx||this.paused===paused)return;
    this.paused=paused;
    if(paused)await this.ctx.suspend();else {await this.ctx.resume();this.schedule();}
  }
  setRank(rank:number):void {this.rank=Math.min(4,rank);}
  setVolume(volume:number):void {this.volume=Math.max(0,Math.min(1,volume));}
  private hz(semitones:number):number{return 220*Math.pow(2,(semitones+this.key)/12);}
  private tone(at:number,hz:number,duration:number,gain:number,wave:OscillatorType='sine',cutoff=0):void{
    const ctx=this.ctx;if(!ctx||this.muted)return;
    const osc=ctx.createOscillator(),amp=ctx.createGain();osc.type=wave;osc.frequency.setValueAtTime(hz,at);
    if(cutoff)osc.frequency.exponentialRampToValueAtTime(Math.max(50,hz*cutoff),at+duration);
    amp.gain.setValueAtTime(.0001,at);
    amp.gain.exponentialRampToValueAtTime(Math.max(.0001,gain*this.volume),at+.009);
    amp.gain.exponentialRampToValueAtTime(.0001,at+duration);
    osc.connect(amp).connect(ctx.destination);osc.start(at);osc.stop(at+duration+.015);
  }
  private noiseKick(at:number,gain:number):void{
    const ctx=this.ctx;if(!ctx||this.muted)return;
    const osc=ctx.createOscillator(),amp=ctx.createGain();osc.type='sine';
    osc.frequency.setValueAtTime(130,at);osc.frequency.exponentialRampToValueAtTime(43,at+.14);
    amp.gain.setValueAtTime(gain*this.volume,at);amp.gain.exponentialRampToValueAtTime(.0001,at+.19);
    osc.connect(amp).connect(ctx.destination);osc.start(at);osc.stop(at+.2);
  }
  private schedule():void{
    if(!this.ctx||this.paused)return;
    const ctx=this.ctx, horizon=ctx.currentTime+.12;
    while(this.origin+(this.lastScheduled+1)*this.stepSeconds<horizon){
      const index=++this.lastScheduled,at=this.origin+index*this.stepSeconds;
      if(at<ctx.currentTime-.015)continue;
      const beat=index%16;
      if(beat%4===0)this.noiseKick(at,beat===0?.18:.10);
      if(beat===4||beat===12)this.tone(at,185,.085,.053,'triangle',.55);
      if(beat%2===0)this.tone(at,this.hz(22),.04,.009+(this.rank*.005),'square');
      if(this.rank>=1 && beat%4===2)this.tone(at,this.hz([0,3,7,10][Math.floor(index/16)%4]!),.18,.032,'triangle');
      if(this.rank>=2 && beat===0)this.tone(at,this.hz(-12+[0,5,3,7][Math.floor(index/16)%4]!),1,.045,'sine');
      if(this.rank>=3 && beat%4===3)this.tone(at,this.hz(12+((index*7)%12)),.07,.02,'triangle');
    }
  }
  /** Quantize effects to next future 16th. No input timing penalty. */
  effect(kind:'prime'|'hold'|'burst'|'over'|'slide'|'error',color=0):void {
    const ctx=this.ctx;if(!ctx||this.paused)return;
    const step=Math.ceil((ctx.currentTime-this.origin+.002)/this.stepSeconds);
    const at=Math.max(ctx.currentTime+.003,this.origin+step*this.stepSeconds);
    const notes=[0,3,7,10,14];
    if(kind==='prime')this.tone(at,this.hz(notes[color]??0),.35,.075,'sine');
    if(kind==='hold')this.tone(at,this.hz((notes[color]??0)+12),.65,.07,'triangle');
    if(kind==='burst'){this.noiseKick(at,.10);this.tone(at,this.hz((notes[color]??0)+12),.22,.065,'triangle',.46);}
    if(kind==='over'){this.noiseKick(at,.27);this.tone(at,this.hz((notes[color]??0)-12),.72,.10,'sawtooth',.68);}
    if(kind==='slide')this.tone(at,this.hz(-5),.1,.02,'sine',.7);
    if(kind==='error')this.tone(at,this.hz(-7),.1,.025,'triangle');
  }
}
