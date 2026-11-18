import {cp} from 'node:fs/promises'
await cp('node_modules/three/examples/jsm/libs/basis','public/basis',{recursive:true})
