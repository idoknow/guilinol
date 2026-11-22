import {defineConfig, type Plugin} from 'vite'
import {existsSync, readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string
const buildSha=()=>execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()

function rapierExternalWasm(): Plugin {
  const inlineBase64 = /oC\.toByteArray\("AGFzbQE[A-Za-z0-9+/=]+"\)(?:\.buffer)?/
  return {
    name: 'rapier-external-wasm',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('rapier3d-compat') || !id.endsWith('rapier.mjs')) return null
      if (!inlineBase64.test(code)) return null
      return {
        code: `import __rapierWasmUrl from './rapier_wasm3d_bg.wasm?url';\n` + code.replace(inlineBase64, '__rapierWasmUrl'),
        map: null,
      }
    },
  }
}

export default defineConfig({
  publicDir: '../public',
  plugins: [rapierExternalWasm(), {name:'world-preloads',transformIndexHtml(_,ctx){
    if(ctx.filename!==join(root,'web/index.html'))return []
    const chunks=Object.values(ctx.bundle??{}).filter(chunk=>chunk.type==='chunk')
    const main=chunks.find(chunk=>chunk.facadeModuleId?.endsWith('/src/main.ts'))
    const sizes:Record<string,number>={}
    function collect(file:string){const chunk=chunks.find(item=>item.fileName===file);if(!chunk||sizes[file])return
      sizes[file]=Buffer.byteLength(chunk.code);chunk.imports.forEach(collect)}
    if(main)collect(main.fileName)
    const engine={tag:'meta',attrs:{name:'engine-chunks',content:JSON.stringify(sizes)}}
    if(existsSync(join(root,'public/world/opening.bin')))return [engine,
      {tag:'link',attrs:{rel:'preload',as:'fetch',crossorigin:'',href:'./world/opening.bin',id:'opening-terrain'}},
    ]
    const file=join(root,'public/world/manifest.json')
    if(!existsSync(file))return []
    const world=JSON.parse(readFileSync(file,'utf8'))
    const files=['manifest.json',world.overview.texture.file,world.overview.packedUnderlay?.file??world.overview.underlay.file,
      world.peaks.sectorSize?'peaks-far.bin':world.peaks.file]
    return [engine,...files.map(asset=>({tag:'link',attrs:{rel:'preload',as:'fetch',crossorigin:'',href:'./world/'+asset}}))]
  }}, {name:'deploy-version',configureServer(server){
    server.middlewares.use('/version.json',(_request,response)=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({sha:buildSha()}))})
  }, generateBundle(){
    const sha = buildSha()
    this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({sha})})
  }}],
  optimizeDeps: {exclude: ['@dimforge/rapier3d-compat']},
  build: {outDir: '../dist', emptyOutDir: true, rollupOptions: {input: {
    index: join(root,'web/index.html'), admin: join(root,'web/admin/index.html'),
  }}},
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
