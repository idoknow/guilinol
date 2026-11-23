import {defineConfig, type Plugin} from 'vite'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string
const buildSha=()=>{
  try { return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim() }
  catch { return process.env.BUILD_SHA ?? 'local' } // 本地无 git 时仍可构建（version.json 仅作标识）
}

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
  plugins: [rapierExternalWasm(), {name:'deploy-version',configureServer(server){
    server.middlewares.use('/version.json',(_request,response)=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({sha:buildSha()}))})
  }, generateBundle(){
    const sha = buildSha()
    this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({sha})})
  }}],
  optimizeDeps: {exclude: ['@dimforge/rapier3d-compat']},
  build: {outDir: '../dist', emptyOutDir: true, rollupOptions: {input: {
    index: join(root,'web/index.html'), admin: join(root,'web/admin/index.html'),
    id: join(root,'web/id.html'),
  }}},
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
