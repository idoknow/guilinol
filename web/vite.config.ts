import {defineConfig, type Plugin} from 'vite'
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
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
  }}, {name:'pwa-precache',closeBundle(){
    // 打包完成后扫 dist 目录生成清单：HTML 页面在 Vite 的 generateBundle 之后才落盘，
    // 在 generateBundle 里扫 bundle 会漏掉所有 .html，导致离线时无页面可回落。
    const dist = join(root,'dist')
    if(!existsSync(dist))return
    const sha = buildSha()
    const keep = /\.(?:js|css|html|webmanifest|png|svg|ico|webp)$/
    const walk = (dir: string, prefix = ''): string[] => readdirSync(dir,{withFileTypes:true}).flatMap(entry => {
      const rel = prefix ? prefix + '/' + entry.name : entry.name
      if(entry.isDirectory()) return entry.name === 'errors' ? [] : walk(join(dir,entry.name), rel)
      return keep.test(entry.name) ? ['/' + rel] : []
    })
    const files = [...new Set(walk(dist))]
    writeFileSync(join(dist,'precache-manifest.json'), JSON.stringify({build:sha,files}))
    const source = readFileSync(join(root,'web/sw.js'),'utf8').replace('__BUILD__', sha)
    writeFileSync(join(dist,'sw.js'), source)
    // 紧急回滚件：SW 出问题时把 dist/sw-kill.js 覆盖成 dist/sw.js 即可全量收回
    writeFileSync(join(dist,'sw-kill.js'), readFileSync(join(root,'web/sw-kill.js'),'utf8'))
  }}, {name:'error-pages',generateBundle(){
    // IDOK-420: self-contained error pages, copied byte-for-byte (no Vite HTML transform) to dist/errors/.
    // Edit via scripts/build-error-pages.mjs; the CDN copy is pushed from the ops repo.
    const dir=join(root,'web/errors')
    for(const file of readdirSync(dir).filter(name=>name.endsWith('.html')))
      this.emitFile({type:'asset',fileName:'errors/'+file,source:readFileSync(join(dir,file),'utf8')})
  }}],
  optimizeDeps: {exclude: ['@dimforge/rapier3d-compat']},
  build: {outDir: '../dist', emptyOutDir: true, rollupOptions: {input: {
    index: join(root,'web/index.html'), admin: join(root,'web/admin/index.html'),
    citizen: join(root,'web/id.html'), backpack: join(root,'web/backpack.html'),
  }}},
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // IDOK-204: the page compares this with /version.json to notice it is running a build that has since been replaced.
    __BUILD_SHA__: JSON.stringify((()=>{try{return buildSha()}catch{return ''}})()),
  },
})
