import { DeterministicRng, stableHashString } from '../shell/DeterministicRNG.js';
import { T, resonance, type Mode } from '../tuning.js';
import type { ContentRules } from './ContentRules.js';

export interface Tile { id: number; x: number; y: number; type: number; group: number | null; }
export type GroupState = 'queued' | 'active' | 'skipped' | 'held' | 'airborne';
export interface Group { id: number; tiles: number[]; state: GroupState; air: boolean; held: boolean; readyPass: number; }
interface Timed { atStep: number; }
export type Event = Timed & (
  | { kind: 'prime'; ids: number[]; air: boolean; groupId: number; type: number }
  | { kind: 'hold'; ids: number[]; groupId: number; type: number }
  | { kind: 'burst'; ids: number[]; x: number; y: number; overcharged: boolean; points: number; groupId: number; type: number; resonance: number }
  | { kind: 'cascade'; ids: number[]; durationSeconds: number }
  | { kind: 'land'; ids: number[] }
  | { kind: 'pressure'; row: number[] }
  | { kind: 'score'; value: number }
  | { kind: 'end' });
export interface Stats { score: number; bestPass: number; longestCombo: number; overcharges: number; airPrimes: number; groups: number; passes: number; }
export interface PulseConfig { seed: string; mode: Mode; bpm: number; }
export interface FlyingTile { id:number; type:number; group:number|null; fromX:number; fromY:number; toX:number; toY:number; moved:boolean; }
export interface Flight { sinceStep:number; seconds:number; tiles:FlyingTile[]; }

/** Entirely deterministic game rules. No DOM, WebAudio or presentation dependencies. */
export class Pulse {
  board: (Tile | null)[][] = [];
  groups = new Map<number, Group>();
  stats: Stats = { score: 0, bestPass: 0, longestCombo: 0, overcharges: 0, airPrimes: 0, groups: 0, passes: 0 };
  pass = 0; step = -1; combo = 0; over = false; events: Event[] = [];
  flight: Flight|null = null;
  private landing: (Tile|null)[][]|null = null;
  private rng: DeterministicRng; private nextTile = 1; private nextGroup = 1;
  private passScore = 0; private passKills = 0;
  private pressureDebt = false;
  constructor(public readonly config: PulseConfig, public readonly rules: ContentRules) {
    this.rng = new DeterministicRng(stableHashString(config.seed));
    this.board = Array.from({length:T.BOARD_ROWS},()=>Array<Tile|null>(T.BOARD_COLS).fill(null));
    const rows = this.rng.int(T.INIT_MIN_ROWS, T.INIT_MAX_ROWS);
    for(let y=T.BOARD_ROWS-rows;y<T.BOARD_ROWS;y++)this.fillRow(y);
    this.ensurePairs();
  }
  private get stepSeconds():number{return 60/this.config.bpm/4;}
  private makeTile(x:number,y:number,type:number):Tile{return {id:this.nextTile++,x,y,type,group:null};}
  private fillRow(y:number):number[]{const types=this.rules.spawnRow(this.rng,T.BOARD_COLS);types.forEach((type,x)=>this.board[y]![x]=this.makeTile(x,y,type));return types;}
  private ensurePairs():void{if(!this.hasPrimeable()&&!this.flight){const b=this.board[T.BOARD_ROWS-1]!;if(b[0]&&b[1])b[1]!.type=b[0]!.type;}}
  hasPrimeable():boolean{for(let y=0;y<T.BOARD_ROWS;y++)for(let x=0;x<T.BOARD_COLS;x++)if(this.rules.primeable(this.board,x,y).length)return true;return false;}
  getTile(id:number):Tile|undefined{for(const row of this.board)for(const t of row)if(t?.id===id)return t;return this.landing?.flat().find(t=>t?.id===id)??undefined;}
  prime(x:number,y:number,air=false):number|null{
    if(air)return this.primeAir(x,y,this.step*this.stepSeconds);
    if(this.over||this.flight)return null;
    const ids=this.rules.primeable(this.board,x,y);if(!ids.length)return null;
    return this.queueGroup(ids,false);
  }
  private queueGroup(ids:number[],air:boolean):number{
    const id=this.nextGroup++,type=this.getTile(ids[0]!)!.type;
    for(const tileId of ids){
      const tile=this.getTile(tileId);if(tile)tile.group=id;
      if(this.landing)for(const row of this.landing)for(const landed of row)if(landed?.id===tileId)landed.group=id;
    }
    if(this.flight)for(const f of this.flight.tiles)if(ids.includes(f.id))f.group=id;
    this.groups.set(id,{id,tiles:ids,state:air?'airborne':'queued',air,held:false,readyPass:this.pass+1});
    this.events.push({kind:'prime',ids,air,groupId:id,type,atStep:this.step});
    if(air)this.stats.airPrimes++;
    return id;
  }
  /** Progress derives from the conductor's clock, not wall-clock frame time. */
  flightProgress(atSeconds:number):number{
    if(!this.flight)return 1;
    return Math.max(0,Math.min(1,(atSeconds-this.flight.sinceStep*this.stepSeconds)/this.flight.seconds));
  }
  flightPosition(tile:FlyingTile,atSeconds:number):{x:number;y:number}{
    const p=this.flightProgress(atSeconds);
    // Tiles travel and make visible contact BEFORE the interaction window opens.
    // The second phase is the landing's gentle settle, keeping a full 280ms to tap.
    const travel=Math.min(1,p/T.AIR_CONTACT_FROM),smooth=1-Math.pow(1-travel,2);
    const settle=p>T.AIR_CONTACT_FROM?Math.sin((p-T.AIR_CONTACT_FROM)/(1-T.AIR_CONTACT_FROM)*Math.PI)*.05:0;
    return {x:tile.fromX+(tile.toX-tile.fromX)*smooth,y:tile.fromY+(tile.toY-tile.fromY)*smooth-settle};
  }
  /** Air groups are checked against actual in-flight positions AND future landing contact.
      The active contact window lasts at least 300 ms at the supported 100-160 BPM. */
  primeAir(x:number,y:number,atSeconds:number):number|null{
    const flight=this.flight,landing=this.landing;
    if(!flight||!landing||this.over)return null;
    const p=this.flightProgress(atSeconds);
    if(p<T.AIR_CONTACT_FROM||p>1)return null;
    const candidates=flight.tiles.filter(t=>t.moved&&!t.group);
    const selected=candidates.find(t=>{const pos=this.flightPosition(t,atSeconds);return Math.abs(pos.x-x)<.57&&Math.abs(pos.y-y)<.57;});
    if(!selected)return null;
    const occupied=landing[selected.toY]?.[selected.toX];if(!occupied||occupied.group!==null)return null;
    const ids=this.rules.primeable(landing,selected.toX,selected.toY);
    if(ids.length<2||!ids.some(id=>candidates.some(t=>t.id===id)))return null;
    // Require a visibly adjacent same-type tile to be in contact as it falls.
    const others=flight.tiles.filter(t=>ids.includes(t.id)&&t.id!==selected.id);
    const center=this.flightPosition(selected,atSeconds);
    if(!others.some(t=>{const v=this.flightPosition(t,atSeconds);return Math.abs(center.x-v.x)+Math.abs(center.y-v.y)<1.65;}))return null;
    return this.queueGroup(ids,true);
  }
  hold(x:number,y:number):boolean{
    const tile=this.board[y]?.[x]??this.landing?.[y]?.[x];const group=tile?.group==null?undefined:this.groups.get(tile.group);
    if(!group||group.held||!['queued','active'].includes(group.state))return false;
    group.held=true;group.state='held';this.events.push({kind:'hold',ids:group.tiles,groupId:group.id,type:tile!.type,atStep:this.step});return true;
  }
  advancePhysics(atSeconds:number):void{if(this.flight&&this.flightProgress(atSeconds)>=1)this.land();}
  private land():void{
    if(!this.flight||!this.landing)return;
    const flight=this.flight;this.board=this.landing;this.landing=null;this.flight=null;
    for(const g of this.groups.values())if(g.state==='airborne')g.state='queued';
    this.events.push({kind:'land',ids:flight.tiles.filter(t=>t.moved).map(t=>t.id),atStep:this.step});
    this.ensurePairs();
  }
  /** Deterministic 16th-note simulation; wall-clock input is never used. */
  advanceTo(absoluteStep:number):void{
    if(this.over)return;
    for(let s=this.step+1;s<=absoluteStep;s++){
      this.step=s;this.advancePhysics(s*this.stepSeconds);
      if(s%T.SIXTEENTHS===0)this.startPass();
      if(!this.flight)this.cross(s%T.SIXTEENTHS);
      if(this.over)break;
    }
  }
  private startPass():void{
    if(this.pass>0)this.finishPass();
    this.pass++;this.stats.passes=this.pass;
    const pressureDue=this.config.mode!=='zen'&&this.pass>1&&(this.pass-1)%this.pressureBars()===0;
    if(pressureDue&&this.flight)this.pressureDebt=true;
    else if((pressureDue||this.pressureDebt)&&!this.flight){this.pushPressure();this.pressureDebt=false;}
    if(this.over)return;
    for(const g of this.groups.values())if(g.readyPass<=this.pass&&g.state==='queued')g.state='active';
    if(this.config.mode==='zen'&&!this.flight&&this.countTiles()<T.ZEN_REPLENISH_ROWS*T.BOARD_COLS)this.pushPressure();
  }
  private pressureBars():number{return this.pass>=22?1:T.RISE_BARS;}
  private pushPressure():void{
    if(this.board[0]!.some(Boolean)){this.over=true;this.events.push({kind:'end',atStep:this.step});return;}
    for(let y=0;y<T.BOARD_ROWS-1;y++){this.board[y]=this.board[y+1]!;for(const t of this.board[y]!)if(t)t.y=y;}
    this.board[T.BOARD_ROWS-1]=Array(T.BOARD_COLS).fill(null);
    const row=this.fillRow(T.BOARD_ROWS-1);this.events.push({kind:'pressure',row,atStep:this.step});this.ensurePairs();
  }
  private cross(substep:number):void{
    const covered=((substep+1)*T.BOARD_COLS)/T.SIXTEENTHS,toDetonate:Group[]=[];
    for(const g of this.groups.values()){
      if(g.readyPass>this.pass||g.state==='queued'||g.state==='airborne')continue;
      const tiles=g.tiles.map(id=>this.getTile(id)).filter((t):t is Tile=>!!t);
      if(!tiles.length){this.groups.delete(g.id);continue;}
      if(Math.min(...tiles.map(t=>t.x))>=covered)continue;
      if(g.held&&g.state==='held'){g.state='skipped';g.readyPass=this.pass+1;continue;}
      toDetonate.push(g);
    }
    if(!toDetonate.length)return;
    const resonanceCount=this.expectedGroupsForPass(toDetonate);
    const factor=resonance(resonanceCount),comboFactor=Math.min(T.COMBO_CAP,1+this.combo*T.COMBO_STEP);
    const removed=new Set<number>(),bursts:Event[]=[];
    for(const g of toDetonate){
      const remaining=g.tiles.filter(id=>this.getTile(id));if(!remaining.length){this.groups.delete(g.id);continue;}
      const ids=g.held?this.rules.expandClear(this.board,remaining):remaining,anchor=this.getTile(remaining[0]!)!;
      ids.forEach(id=>removed.add(id));
      const points=Math.round(this.rules.scoreGroup(ids.length)*factor*comboFactor*(g.air?T.AIR_MULT:1)*(g.held?T.OVERCHARGE_MULT:1));
      this.stats.score+=points;this.passScore+=points;this.stats.bestPass=Math.max(this.stats.bestPass,this.passScore);this.passKills++;this.stats.groups++;
      if(g.held)this.stats.overcharges++;
      bursts.push({kind:'burst',ids,x:anchor.x,y:anchor.y,overcharged:g.held,points,groupId:g.id,type:anchor.type,resonance:resonanceCount,atStep:this.step});
      this.groups.delete(g.id);
    }
    for(const g of [...this.groups.values()])if(g.tiles.some(id=>removed.has(id))){g.tiles=g.tiles.filter(id=>!removed.has(id));if(!g.tiles.length)this.groups.delete(g.id);}
    const from=new Map<number,{x:number;y:number;type:number;group:number|null}>();
    for(const row of this.board)for(let x=0;x<row.length;x++){
      const tile=row[x];if(!tile)continue;
      if(removed.has(tile.id))row[x]=null;else from.set(tile.id,{x:tile.x,y:tile.y,type:tile.type,group:tile.group});
    }
    // Collapse happens on a copy. Tiles continue to exist at their intermediate positions
    // until the conductor advances enough audio time for their physically staged landing.
    const copy=this.board.map(row=>row.map(t=>t?{...t}:null));
    const moved=this.rules.collapse(copy);this.landing=moved.board;
    const tiles=moved.board.flat().filter((t):t is Tile=>!!t).map(t=>{
      const old=from.get(t.id)!;return {id:t.id,type:t.type,group:t.group,fromX:old.x,fromY:old.y,toX:t.x,toY:t.y,moved:old.x!==t.x||old.y!==t.y};
    });
    const durationSeconds=Math.max(T.AIR_FAIR_MS/1000/(1-T.AIR_CONTACT_FROM),T.FALL_DURATION/T.FALL_SPEED_SCALE);
    this.flight={sinceStep:this.step,seconds:durationSeconds,tiles};
    this.events.push(...bursts,{kind:'cascade',ids:moved.moved,durationSeconds,atStep:this.step},{kind:'score',value:this.stats.score,atStep:this.step});
  }
  private expectedGroupsForPass(current:Group[]):number{
    const available=[...this.groups.values()].filter(g=>g.readyPass<=this.pass&&!['held','queued','airborne'].includes(g.state));
    return Math.max(current.length,available.length);
  }
  private finishPass():void{
    if(this.passKills){this.combo++;this.stats.longestCombo=Math.max(this.stats.longestCombo,this.combo);}else this.combo=0;
    this.stats.bestPass=Math.max(this.stats.bestPass,this.passScore);this.passScore=0;this.passKills=0;
  }
  countTiles():number{return this.board.flat().filter(Boolean).length;}
  snapshot():string{return JSON.stringify({board:this.board.map(r=>r.map(t=>t?[t.id,t.type,t.group]:null)),flight:this.flight,landing:this.landing?.map(r=>r.map(t=>t?[t.id,t.type,t.group]:null)),groups:[...this.groups.values()].sort((a,b)=>a.id-b.id),stats:this.stats,pass:this.pass,step:this.step,combo:this.combo,over:this.over,pressureDebt:this.pressureDebt});}
  drain():Event[]{const events=this.events;this.events=[];return events;}
}
