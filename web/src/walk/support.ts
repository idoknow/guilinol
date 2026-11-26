import type {createPhysics} from './physics'
import {walkConfig as cfg} from './config'

export function playerSupport(sim:Awaited<ReturnType<typeof createPhysics>>){
  function supportAt(x:number,z:number,refY:number){
    const deck=sim.surface(x,z,'deck',refY+.35,1.4)
    const validDeck=deck&&deck.y<=refY+.35?deck:null
    const bridge=sim.surface(x,z,'bridgeSurface',refY+.55,1.8)
    const validBridge=bridge&&bridge.slope<=cfg.slope?bridge:null
    const lm=sim.surface(x,z,'landmark',refY+.35,1.4)
    const validLm=lm&&lm.y<=refY+.35&&lm.slope<=cfg.slope?lm:null
    let elevated=validDeck
    if(validBridge&&(!elevated||validBridge.y>elevated.y))elevated=validBridge
    if(validLm&&(!elevated||validLm.y>elevated.y))elevated=validLm
    return elevated??sim.surface(x,z,'sidewalk')??sim.surface(x,z,'road')??sim.surface(x,z,'ground')
  }
  function carSupportAt(x:number,z:number,refY:number){
    const deck=sim.surface(x,z,'deck',refY+.55,1.8)
    const validDeck=deck&&deck.y<=refY+.55?deck:null
    const lm=sim.surface(x,z,'landmark',refY+.55,1.8)
    const validLm=lm&&lm.y<=refY+.55&&lm.slope<=cfg.slope?lm:null
    const bridgeHit=validDeck&&validLm?(validLm.y>validDeck.y?validLm:validDeck):(validDeck??validLm)
    return bridgeHit??sim.surface(x,z,'road',refY+.55,1.8)??sim.surface(x,z,'road')??sim.surface(x,z,'ground')??sim.surface(x,z,'sidewalk')
  }
  return {supportAt,carSupportAt}
}
