import * as THREE from 'three'
import {fetchAsset, type Tile} from './world'

export function lawnGrass(scene:THREE.Scene,tiles:Tile[]){
  const cells=new Map(tiles.filter(tile=>tile.grass).map(tile=>[`${tile.x},${tile.z}`,tile]))
  const buffers=new Map<Tile,Int32Array>(),pending=new Map<Tile,AbortController>()
  const near=new THREE.Vector2(), mobile=matchMedia('(pointer:coarse)').matches
  const geometry=new THREE.InstancedBufferGeometry()
  const positions:number[]=[]
  for(let leaf=0;leaf<3;leaf++){
    const angle=leaf*2*Math.PI/3, dx=Math.cos(angle),dz=Math.sin(angle)
    positions.push(-dz*.045,0,dx*.045,dz*.045,0,-dx*.045,dx*.12,1,dz*.12)
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  const offsets=new THREE.InstancedBufferAttribute(new Float32Array(4*6000),4).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('tuft',offsets);geometry.instanceCount=0
  const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{centre:{value:near},clock:{value:0},grass:{value:new THREE.Color(0x8aa37c)}},
    vertexShader:`attribute vec4 tuft;uniform vec2 centre;uniform float clock;varying float shade;
    void main(){float h=fract(tuft.w*31.71);float angle=tuft.w*6.283185;float fade=1.-smoothstep(42.,60.,distance(tuft.xz,centre));
    vec2 spread=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*position.xz;
    vec3 local=vec3(spread.x,position.y*mix(.15,.35,h),spread.y);
    local.x+=position.y*.029*sin(angle+clock*6.283185/(2.+2.*h));shade=mix(.8,1.12,position.y);
    gl_Position=projectionMatrix*modelViewMatrix*vec4(tuft.xyz+local*fade,1.);}`,
    fragmentShader:`uniform vec3 grass;varying float shade;void main(){gl_FragColor=vec4(grass*shade,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`})
  const mesh=new THREE.Mesh(geometry,material);mesh.name='lawn-grass';mesh.frustumCulled=false;mesh.visible=false;scene.add(mesh)
  let dirty=true,lastX=Infinity,lastZ=Infinity
  return (position:THREE.Vector3,seconds:number,enabled:boolean)=>{
    mesh.visible=enabled && geometry.instanceCount>0
    if(!enabled)return
    near.set(position.x,position.z);material.uniforms.clock.value=seconds
    if(!dirty && Math.hypot(position.x-lastX,position.z-lastZ)<3)return
    dirty=false;lastX=position.x;lastZ=position.z
    const needed=new Set<Tile>();let count=0
    for(let west=Math.floor((lastX-64)/256)*256;west<=lastX+64;west+=256){
      for(let north=Math.floor((lastZ-64)/256)*256;north<=lastZ+64;north+=256){
        const tile=cells.get(`${west},${north}`);if(!tile)continue
        needed.add(tile)
        const records=buffers.get(tile)
        if(!records){
          if(!pending.has(tile)){
            const controller=new AbortController();pending.set(tile,controller)
            void fetchAsset(tile.grass!,controller.signal).then(data=>new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()).then(data=>{
              if(!controller.signal.aborted){buffers.set(tile,new Int32Array(data));dirty=true}
            }).catch(()=>{}).finally(()=>{if(pending.get(tile)===controller)pending.delete(tile)})
          }
          continue
        }
        for(let offset=0;offset<records.length;offset+=mobile?6:3){
          const east=west+records[offset]/100,south=north+records[offset+1]/100,height=records[offset+2]/100
          if((east-lastX)**2+(south-lastZ)**2>64**2 || Math.abs(height-position.y)>65)continue
          const seed=((Math.imul(records[offset],19349663)^Math.imul(records[offset+1],83492791))>>>0)/4294967296
          offsets.setXYZW(count++,east,height,south,seed)
        }
      }
    }
    for(const tile of buffers.keys())if(!needed.has(tile))buffers.delete(tile)
    for(const [tile,controller] of pending)if(!needed.has(tile)){controller.abort();pending.delete(tile)}
    offsets.needsUpdate=true;geometry.instanceCount=count;mesh.visible=count>0
  }
}
