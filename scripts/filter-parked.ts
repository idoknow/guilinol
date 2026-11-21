import {readFileSync} from 'node:fs'
import {vehicleForbiddenAt} from '../web/src/game/car-free'

const spawns:Record<string,number[][]>=JSON.parse(readFileSync(0,'utf8'))
for(const kind of Object.keys(spawns))spawns[kind]=spawns[kind].filter(([east,,south])=>!vehicleForbiddenAt(east,south))
process.stdout.write(JSON.stringify(spawns))
