import {readFile,writeFile} from 'node:fs/promises'

export async function saveMarketMask(page,output){
  const grid=JSON.parse(await readFile('.ops-docs/layout/dongxi-esri-grid.json','utf8'))
  const reference=await readFile('.ops-docs/layout/dongxi-esri-mask.png')
  const data=await page.evaluate(async ({grid,width,height})=>{
    const {stream}=window.viewer,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    const ctx=canvas.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,width,height);ctx.fillStyle='white'
    const factor=256*2**grid.zoom,rad=Math.PI/180,metres=111320*Math.cos(25.28*rad)
    function pixel(east,south){const latitude=25.28-south/110574;return [(110.3+east/metres+180)/360*factor-grid.pixel_origin[0],(1-Math.asinh(Math.tan(latitude*rad))/Math.PI)*factor/2-grid.pixel_origin[1]]}
    const tiles=[...stream.loaded];const positions=new Map(tiles.map(([tile,data])=>[`${tile.x},${tile.z}`,data.terrain]))
    function ground(east,south){const left=Math.floor(east/256)*256,top=Math.floor(south/256)*256;return (positions.get(`${left},${top}`)?.[Math.round((south-top)/4)*65+Math.round((east-left)/4)]??1600)/10}
    for(const [tile,data] of tiles)for(const [, ,rings] of data.rings){ctx.beginPath();for(const ring of rings){ring.forEach(([east,south],index)=>{const pt=pixel(tile.x+east/100,tile.z+south/100);if(index)ctx.lineTo(...pt);else ctx.moveTo(...pt)});ctx.closePath()}ctx.fill('evenodd')}
    const layers={base:canvas.toDataURL('image/png').split(',')[1]}
    for(const [entry,root] of stream.landmarks){
      if(!['wangcheng_market','wangcheng_mall','dongxixiang','zhuangyuan_gallery','zhengyang','jingjiang','shizijie'].includes(entry.id))continue
      ctx.fillStyle='black';ctx.fillRect(0,0,width,height);ctx.fillStyle='white';root.updateMatrixWorld(true)
      root.traverseVisible(node=>{
        if(!node.isMesh)return
        const geometry=node.geometry,pos=geometry.attributes.position,indices=geometry.index,uv=geometry.attributes.uv
        if(entry.id==='wangcheng_market' && node.material.name!=='A_surfaces')return
        if(['pave','ruinGlass'].includes(node.material.name))return
        const temp=node.matrixWorld.clone(),world=node.matrixWorld.clone()
        for(let instance=0;instance<(node.isInstancedMesh?node.count:1);instance++){
          if(node.isInstancedMesh){node.getMatrixAt(instance,temp);world.multiplyMatrices(node.matrixWorld,temp)}
          const matrix=world.elements
          for(let at=0;at<(indices?.count??pos.count);at+=3){
            if(node.material.name==='A_surfaces' && uv){const index=indices?indices.getX(at):at,texture=node.material.map;const col=Math.floor(4*(uv.getX(index)*texture.repeat.x+texture.offset.x)),row=Math.floor(4*(uv.getY(index)*texture.repeat.y+texture.offset.y));if(entry.id==='wangcheng_market'&&!((col===2&&row===0)||(col===0&&row===2)))continue;if(row===3&&(col===0||col===1))continue}
            const triangle=[]
            for(let corner=0;corner<3;corner++){const idx=indices?indices.getX(at+corner):at+corner,x=pos.getX(idx),y=pos.getY(idx),z=pos.getZ(idx);triangle.push([matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14]])}
            const [first,second,third]=triangle,east=(first[0]+second[0]+third[0])/3,south=(first[2]+second[2]+third[2])/3
            if(east < -750||east > -300||south < -300||south > -40||Math.min(first[1],second[1],third[1])<ground(east,south)+2.7)continue
            if(Math.abs((second[0]-first[0])*(third[2]-first[2])-(second[2]-first[2])*(third[0]-first[0]))<.012)continue
            ctx.beginPath();triangle.forEach(([east,,south],idx)=>{const pt=pixel(east,south);if(idx)ctx.lineTo(...pt);else ctx.moveTo(...pt)});ctx.closePath();ctx.fill()
          }
        }
      })
      layers[entry.id]=canvas.toDataURL('image/png').split(',')[1]
    }
    const combined=new Uint8ClampedArray(width*height*4);combined.fill(255)
    for(let i=0;i<combined.length;i+=4)combined[i]=combined[i+1]=combined[i+2]=0
    for(const source of Object.values(layers)){const image=new Image();image.src='data:image/png;base64,'+source;await image.decode();ctx.drawImage(image,0,0);const bytes=ctx.getImageData(0,0,width,height).data;for(let i=0;i<bytes.length;i+=4)combined[i]=combined[i+1]=combined[i+2]=Math.max(combined[i],bytes[i])}
    ctx.putImageData(new ImageData(combined,width,height),0,0);layers['roof-mask']=canvas.toDataURL('image/png').split(',')[1];return layers
  },{grid,width:reference.readUInt32BE(16),height:reference.readUInt32BE(20)})
  for(const [key,value] of Object.entries(data))await writeFile(`${output}/${key}.png`,Buffer.from(value,'base64'))
}
