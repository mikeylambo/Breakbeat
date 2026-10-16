import { DeterministicRng, stableHashString } from '../shell/DeterministicRNG.js';
import { T, resonance, type Mode } from '../tuning.js';
import type { ContentRules } from './ContentRules.js';

export interface Tile { id: number; x: number; y: number; type: number; group: number | null; }
export type GroupState = 'queued' | 'active' | 'skipped' | 'held';
export interface Group { id: number; tiles: number[]; state: GroupState; air: boolean; held: boolean; readyPass: number; }
export type Event =
  | { kind: 'prime'; ids: number[]; air: boolean; groupId: number }
  | { kind: 'hold'; ids: number[]; groupId: number }
  | { kind: 'burst'; ids: number[]; x: number; y: number; overcharged: boolean; points: number; groupId: number }
  | { kind: 'cascade'; ids: number[] }
  | { kind: 'pressure'; row: number[] }
  | { kind: 'score'; value: number }
  | { kind: 'end' };
export interface Stats { score: number; bestPass: number; longestCombo: number; overcharges: number; airPrimes: number; groups: number; passes: number; }
export interface PulseConfig { seed: string; mode: Mode; bpm: number; }
/** Pure, deterministic rules: no DOM, timers, sound, fetch, or presentation imports. */
export class Pulse {
  board: (Tile | null)[][] = [];
  groups = new Map<number, Group>();
  stats: Stats = { score: 0, bestPass: 0, longestCombo: 0, overcharges: 0, airPrimes: 0, groups: 0, passes: 0 };
  pass = 0; step = -1; combo = 0; over = false; events: Event[] = []; falling = new Set<number>();
  private rng: DeterministicRng; private nextTile = 1; private nextGroup = 1;
  private passScore = 0; private passKills = 0;
  constructor(public readonly config: PulseConfig, public readonly rules: ContentRules) {
    this.rng = new DeterministicRng(stableHashString(config.seed));
    this.board = Array.from({length:T.BOARD_ROWS},()=>Array<Tile|null>(T.BOARD_COLS).fill(null));
    const rows = this.rng.int(T.INIT_MIN_ROWS, T.INIT_MAX_ROWS);
    for(let y = T.BOARD_ROWS - rows; y < T.BOARD_ROWS; y++) this.fillRow(y);
    this.ensurePairs();
  }
  private makeTile(x:number,y:number,type:number):Tile { return {id:this.nextTile++,x,y,type,group:null}; }
  private fillRow(y:number):number[] {
    const types = this.rules.spawnRow(this.rng,T.BOARD_COLS);
    types.forEach((type,x)=>this.board[y]![x]=this.makeTile(x,y,type));
    return types;
  }
  private ensurePairs():void {
    const bottom = this.board[T.BOARD_ROWS - 1]!;
    if (!this.hasPrimeable()) bottom[1]!.type=bottom[0]!.type;
  }
  hasPrimeable():boolean {
    for(let y=0;y<T.BOARD_ROWS;y++) for(let x=0;x<T.BOARD_COLS;x++)
      if(this.rules.primeable(this.board,x,y).length)return true;
    return false;
  }
  getTile(id:number):Tile|undefined {
    for(const row of this.board)for(const t of row)if(t?.id===id)return t;
    return undefined;
  }
  /** Input is intent, committed to the NEXT pass: never a reflex/timing judgment. */
  prime(x:number,y:number,air=false):number|null {
    if(this.over)return null;
    const ids=this.rules.primeable(this.board,x,y);
    if(!ids.length)return null;
    const id=this.nextGroup++;
    for(const tileId of ids)this.getTile(tileId)!.group=id;
    this.groups.set(id,{id,tiles:ids,state:'queued',air,held:false,readyPass:this.pass+1});
    this.events.push({kind:'prime',ids,air,groupId:id});
    if(air)this.stats.airPrimes++;
    return id;
  }
  hold(x:number,y:number):boolean {
    const tile=this.board[y]?.[x];const group=tile?.group==null?undefined:this.groups.get(tile.group);
    if(!group || group.held || (group.state!=='queued' && group.state!=='active'))return false;
    group.held=true;group.state='held';this.events.push({kind:'hold',ids:group.tiles,groupId:group.id});return true;
  }
  /** Step values are absolute elapsed 16ths. Each is processed exactly once, in order. */
  advanceTo(absoluteStep:number):void {
    if(this.over)return;
    for(let s=this.step+1;s<=absoluteStep;s++){
      if(s%T.SIXTEENTHS===0)this.startPass();
      this.cross(s%T.SIXTEENTHS);
      this.step=s;
      if(this.over)break;
    }
  }
  private startPass():void {
    if(this.pass>0)this.finishPass();
    this.pass++;this.stats.passes=this.pass;
    if(this.config.mode!=='zen' && this.pass>1 && (this.pass-1)%this.pressureBars()===0)this.pushPressure();
    if(this.over)return;
    for(const g of this.groups.values())if(g.readyPass<=this.pass){
      if(g.state==='queued')g.state='active';
    }
    if(this.config.mode==='zen' && this.countTiles()<T.ZEN_REPLENISH_ROWS*T.BOARD_COLS)this.pushPressure();
  }
  private pressureBars():number { return this.pass>=22?1:T.RISE_BARS; }
  private pushPressure():void {
    if(this.board[0]!.some(Boolean)){this.over=true;this.events.push({kind:'end'});return;}
    for(let y=0;y<T.BOARD_ROWS-1;y++){
      this.board[y]=this.board[y+1]!;
      for(const t of this.board[y]!)if(t)t.y=y;
    }
    this.board[T.BOARD_ROWS-1]=Array(T.BOARD_COLS).fill(null);
    const row=this.fillRow(T.BOARD_ROWS-1);
    this.events.push({kind:'pressure',row});
    // A new pressure row cannot make the wall impossible to interact with.
    this.ensurePairs();
  }
  private cross(substep:number):void {
    const covered = ((substep+1)*T.BOARD_COLS)/T.SIXTEENTHS;
    const toDetonate:Group[]=[];
    for(const g of this.groups.values()){
      if(g.readyPass>this.pass)continue;
      if(g.state==='skipped' && this.pass<g.readyPass)continue;
      if(g.state==='queued')continue;
      const positions=g.tiles.map(id=>this.getTile(id)).filter((t):t is Tile=>!!t);
      if(!positions.length){this.groups.delete(g.id);continue;}
      const left=Math.min(...positions.map(t=>t.x));
      if(left>=covered)continue;
      if(g.held && g.state==='held'){
        g.state='skipped';g.readyPass=this.pass+1;continue;
      }
      toDetonate.push(g);
    }
    if(!toDetonate.length)return;
    const resonanceFactor=resonance(this.expectedGroupsForPass(toDetonate));
    const comboFactor=Math.min(T.COMBO_CAP,1+Math.max(0,this.combo)*T.COMBO_STEP);
    const allRemove=new Set<number>();
    const burstEvents:Event[]=[];
    for(const g of toDetonate){
      const remaining=g.tiles.filter(id=>this.getTile(id));
      if(!remaining.length){this.groups.delete(g.id);continue;}
      const ids=g.held?this.rules.expandClear(this.board,remaining):remaining;
      const anchor=this.getTile(remaining[0]!)!;
      ids.forEach(id=>allRemove.add(id));
      const points=Math.round(this.rules.scoreGroup(ids.length)*resonanceFactor*comboFactor*(g.air?T.AIR_MULT:1)*(g.held?T.OVERCHARGE_MULT:1));
      this.stats.score+=points;this.passScore+=points;this.stats.bestPass=Math.max(this.stats.bestPass,this.passScore);this.passKills++;this.stats.groups++;
      if(g.held)this.stats.overcharges++;
      burstEvents.push({kind:'burst',ids,x:anchor.x,y:anchor.y,overcharged:g.held,points,groupId:g.id});
      this.groups.delete(g.id);
    }
    // Expanded explosions may eat another primed group. Invalidate it as well.
    for(const g of [...this.groups.values()])if(g.tiles.some(id=>allRemove.has(id))){
      g.tiles=g.tiles.filter(id=>!allRemove.has(id));
      if(!g.tiles.length)this.groups.delete(g.id);
    }
    for(const row of this.board)for(let x=0;x<row.length;x++){
      if(row[x] && allRemove.has(row[x]!.id))row[x]=null;
    }
    const moved=this.rules.collapse(this.board);
    this.board=moved.board;
    this.falling=new Set(moved.moved);
    this.events.push(...burstEvents,{kind:'cascade',ids:moved.moved},{kind:'score',value:this.stats.score});
  }
  private expectedGroupsForPass(current:Group[]):number {
    const available=[...this.groups.values()].filter(g=>g.readyPass<=this.pass && !['held','queued'].includes(g.state));
    return Math.max(current.length,available.length);
  }
  private finishPass():void {
    if(this.passKills){this.combo++;this.stats.longestCombo=Math.max(this.stats.longestCombo,this.combo);}
    else this.combo=0;
    this.stats.bestPass=Math.max(this.stats.bestPass,this.passScore);
    this.passScore=0;this.passKills=0;
  }
  countTiles():number {return this.board.flat().filter(Boolean).length;}
  snapshot():string {
    return JSON.stringify({board:this.board.map(r=>r.map(t=>t?[t.id,t.type,t.group]:null)),groups:[...this.groups.values()].sort((a,b)=>a.id-b.id),stats:this.stats,pass:this.pass,step:this.step,combo:this.combo,over:this.over});
  }
  drain():Event[]{const e=this.events;this.events=[];return e;}
}
