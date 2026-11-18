import * as THREE from 'three'
import {look} from './config'

// 石桥: the GL03 deck is a top surface only. Give it a stone colour and a fascia hanging from every
// open edge so bridges read as solid slabs from the bank. Visual only — collision stays the deck.
const top = new THREE.Color(), side = new THREE.Color()
export const bridgeMaterial = new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,side:THREE.DoubleSide})

export function bridgeGeometry(deck:Float32Array) {
  top.set(look.bridgeTop); side.set(look.bridgeSide)
  const key = (at:number)=>`${Math.round(deck[at]*20)},${Math.round(deck[at+1]*20)},${Math.round(deck[at+2]*20)}`
  const edges = new Map<string,[number,number,number]>()
  for(let tri=0;tri<deck.length/9;tri++) for(let corner=0;corner<3;corner++) {
    const a = tri*9+corner*3, b = tri*9+(corner+1)%3*3, ka = key(a), kb = key(b)
    const id = ka<kb?`${ka}|${kb}`:`${kb}|${ka}`, seen = edges.get(id)
    if(seen) seen[2]++; else edges.set(id,[a,b,1])
  }
  const open = [...edges.values()].filter(edge=>edge[2]===1)
  const positions = new Float32Array(deck.length+open.length*18), colors = new Float32Array(positions.length)
  positions.set(deck)
  for(let at=0;at<deck.length;at+=3) top.toArray(colors,at)
  let out = deck.length
  const depth = look.bridgeDepth
  for(const [a,b] of open) {
    const ax=deck[a],ay=deck[a+1],az=deck[a+2],bx=deck[b],by=deck[b+1],bz=deck[b+2]
    for(const [x,y,z] of [[ax,ay,az],[bx,by-depth,bz],[bx,by,bz],[ax,ay,az],[ax,ay-depth,az],[bx,by-depth,bz]]) {
      positions[out]=x;positions[out+1]=y;positions[out+2]=z;side.toArray(colors,out);out+=3
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3))
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
  geometry.computeVertexNormals()
  return geometry
}
