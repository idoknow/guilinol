import type * as THREE from 'three'
import type {Manifest} from '../world'
import type {Stream} from '../stream'
import type {Weather} from '../look/time'

// What the sightseeing layer (M4) needs from the viewer. main.ts builds it; play/* never reaches into main.
export interface Walker {
  active:boolean; yaw:number; position:THREE.Vector3
  hold(on:boolean):void; face(yaw:number,pitch?:number):void; showFigure(on:boolean):void
  /** Right-hand attachment point for hand-held gear (IDOK-182). */
  handAnchor?():THREE.Object3D
}
export interface Clock {hour:number; weather:Weather; flowing:boolean; goal:number|null; set(hour:number,weather?:Weather):void}
export interface Host {
  captureView():Promise<{view:import('../../../lib/feedback-contract').FeedbackView;shot:Blob}>
  setView(view:unknown):Promise<void>
  /** Camera pose + target as a FeedbackView, without the screenshot (IDOK-105 saver). */
  lastView():Promise<import('../../../lib/feedback-contract').FeedbackView>
  scene:THREE.Scene; camera:THREE.PerspectiveCamera; renderer:THREE.WebGLRenderer
  manifest:Manifest; stream:Stream; peaks:THREE.Group; clock:Clock
  walker():Walker|undefined
  /** Walk mode at x/z (searches nearby for footing). Loads the walker on first use. */
  walkTo(x:number,z:number,yaw:number,reason:string,name?:string):Promise<boolean>
  /** Leave walk mode; flight controls are suspended while `cinema` is on. */
  fly():void
  cinema:boolean
  /** Render one frame (mirror + scene) right now, for the shutter. */
  draw():void
  refreshMode():void
}
