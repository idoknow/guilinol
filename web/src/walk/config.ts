export const walkConfig = {
  height:1.7, radius:.29, walk:4, run:9, jump:1.2, gravity:-20, slope:Math.PI/4,
  step:.4, snap:.32, collisionRadius:384, peakRadius:600, search:64,
  // Camera (M2 look): figure stays small, scenery fills the frame (docs/style.md 原则 6).
  near:4.5, far:11, zoomMin:2.5, zoomMax:22, sensitivity:.003, pitch:.3,
  gate:{x:-588,z:-212,yaw:Math.PI},
}
