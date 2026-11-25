// IDOK-350: road-graph build + A* off the main thread. The worker fetches atlas.bin itself (HTTP-cached by the
// map), so nothing big crosses postMessage and the ~0.3–1 s graph build never stalls a frame.
import {buildRouteGraph,findRoute,type RouteGraph,type RouteMode,type RouteRoad} from './route'

export type RouteRequest = {id:number; url:string; fx:number; fz:number; tx:number; tz:number; mode:RouteMode}
export type RouteReply = {id:number; route:ReturnType<typeof findRoute>; buildMs:number; searchMs:number; error?:string}

let graph:Promise<{g:RouteGraph,ms:number}>|undefined
async function load(url:string) {
  const response = await fetch(url)
  if(!response.ok||!response.body) throw Error(`atlas HTTP ${response.status}`)
  const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json() as {roads:RouteRoad[]}
  const start = performance.now(), g = buildRouteGraph(data.roads)
  return {g,ms:performance.now()-start}
}
self.onmessage = async (event:MessageEvent<RouteRequest>)=>{
  const q = event.data
  try {
    graph ??= load(q.url)
    const {g,ms} = await graph
    const start = performance.now(), route = findRoute(g,q.fx,q.fz,q.tx,q.tz,q.mode)
    ;(self as unknown as Worker).postMessage({id:q.id,route,buildMs:ms,searchMs:performance.now()-start} satisfies RouteReply)
  } catch(error) {
    graph = undefined
    ;(self as unknown as Worker).postMessage({id:q.id,route:null,buildMs:0,searchMs:0,error:String(error)} satisfies RouteReply)
  }
}
