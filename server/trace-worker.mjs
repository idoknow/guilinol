import {parentPort,workerData} from 'node:worker_threads'
import {decodeImage} from './trace-image.mjs'

const {gray,width,height,key}=workerData
parentPort.postMessage(await decodeImage(gray,width,height,key))
