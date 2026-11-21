export interface GameState {
  mode:'foot'|'ebike'|'bike'|'car'|'boat'|'fly'
  vehicle:{kind:string;id:string;speedKmh:number;gear?:'D'|'R'|'N';damage:number}|null
  money:number
  wanted:0|1|2|3|4|5
  mission:{id:string;title:string;step:string;target?:[number,number];timer?:number}|null
  zone:{quiet:boolean;name?:string}
}
export type GameEvent={type:'mission:start'|'mission:done'|'fine'|'crash'}
type Listener=(state:Readonly<GameState>,changed:Set<keyof GameState>)=>void
const listeners=new Set<Listener>()
let state:GameState={mode:'fly',vehicle:null,money:0,wanted:0,mission:null,zone:{quiet:false}}
export function getState():Readonly<GameState>{return state}
export function onState(fn:Listener){listeners.add(fn);fn(state,new Set(Object.keys(state) as (keyof GameState)[]));return ()=>{listeners.delete(fn)}}
export function emit(event:GameEvent){window.dispatchEvent(new CustomEvent('game:event',{detail:event}))}
export function updateTravel(mode:GameState['mode'],vehicle:GameState['vehicle'],name?:string){
  const changed=new Set<keyof GameState>()
  if(state.mode!==mode)changed.add('mode')
  if(state.vehicle?.id!==vehicle?.id||state.vehicle?.speedKmh!==vehicle?.speedKmh||state.vehicle?.gear!==vehicle?.gear)changed.add('vehicle')
  if(state.zone.name!==name)changed.add('zone')
  if(!changed.size)return
  state={...state,mode,vehicle,zone:{quiet:!!name,name}}
  for(const listener of listeners)listener(state,changed)
}
