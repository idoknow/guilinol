import {createServer} from 'vite'
import {chromium} from 'playwright'
import {mkdir} from 'node:fs/promises'

const directory=process.argv[2]??'captures/ronghu-ferry'
await mkdir(directory,{recursive:true})
const server=await createServer({root:'.',configFile:false,publicDir:'public',server:{host:'127.0.0.1',port:0},plugins:[{
  name:'ferry-review',configureServer(server){server.middlewares.use('/review',(_,response)=>{
    response.setHeader('content-type','text/html');response.end('<style>*{margin:0}</style><script type="module" src="/capture-ferry.js"></script>')})},
  resolveId(id){if(id==='/capture-ferry.js')return id},load(id){if(id==='/capture-ferry.js')return `
    import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
    import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
    import {vehicleModel} from '/web/src/walk/vehicle-model.ts';
    const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1100,630);document.body.append(renderer.domElement);
    const scene=new T.Scene();scene.background=new T.Color(0xe8f0f1);
    const basis=new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').detectSupport(renderer);
    const {scene:model}=await new GLTFLoader().setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder).loadAsync('/landmarks/ronghu.glb');
    scene.add(model);model.traverse(mesh=>{if(/^(collision|lod[12])/.test(mesh.name))mesh.visible=false});
    scene.add(new T.HemisphereLight(0xffffff,0xd5cfc2,2));const sun=new T.DirectionalLight(0xfff6e5,2);sun.position.set(4,8,-3);scene.add(sun);
    const boat=vehicleModel('boat');boat.position.set(-604.1,148.1-151.69,220-122.129);boat.rotation.y=Math.PI/2;scene.add(boat);
    const water=new T.Mesh(new T.PlaneGeometry(150,150),new T.MeshStandardMaterial({color:0x5d9392}));water.rotation.x=-Math.PI/2;
    water.position.copy(boat.position);scene.add(water);
    const camera=new T.PerspectiveCamera(33,1100/630,.1,120);
    window.draw=diagonal=>{camera.position.set(-604.1+(diagonal?23:36),diagonal?6:2.2,88+(diagonal?23:0));camera.lookAt(-604.1,-.8,88);renderer.render(scene,camera)};`
  }}]})
let browser
try{
  await server.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:1100,height:630}});page.on('pageerror',console.error)
  await page.goto(`${server.resolvedUrls.local[0]}review`);await page.waitForFunction(()=>typeof window.draw==='function',null,{timeout:90000})
  for(const [name,angle] of [['side',false],['diagonal',true]]){await page.evaluate(angle=>window.draw(angle),angle);await page.screenshot({path:`${directory}/${name}.png`})}
}finally{await browser?.close();await server.close()}
