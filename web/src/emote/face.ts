import type * as T from 'three'

/** `'laugh'` shows the painted laugh-face; `'base'` returns to whatever the player wore before. */
export type FaceKey = 'base' | 'laugh' | 'smile' | 'serious' | 'thumbs_up'
export type FaceCue = readonly [time: number, face: FaceKey]

type FaceApi = {
  set: (root: T.Object3D, expr: string) => boolean
  get: (root: T.Object3D) => string
}

// creator-face.ts uses extensionless imports that Node's strip-types loader cannot
// resolve, so it is only ever pulled in lazily inside the browser bundle.
let api: FaceApi | null = null
if (typeof document !== 'undefined') {
  import('../walk/creator-face')
    .then((m) => {
      api = {set: m.setCreatorExpression, get: m.getCreatorExpression}
    })
    .catch(() => {})
}

export function faceAt(cues: readonly FaceCue[], time: number): FaceKey {
  let face: FaceKey = 'base'
  // Indexed loop: runs every frame, so no iterator/destructuring garbage.
  for (let i = 0; i < cues.length; i++) {
    if (time < cues[i][0]) break
    face = cues[i][1]
  }
  return face
}

/**
 * Drives `creator-face` from emote cues. Only touches geometry when the requested face
 * changes, remembers the expression it replaced, and hands it back on `base`.
 */
export function emoteFace(root: T.Object3D) {
  let group: T.Object3D | null = null,
    rest: T.Object3D | null = null,
    laugh: T.Object3D | null = null
  let searched = false
  let shown: FaceKey = 'base'
  let saved: string | null = null,
    applied: string | null = null

  const attached = (node: T.Object3D | null) => {
    for (let n = node; n; n = n.parent) if (n === root) return true
    return false
  }
  function find() {
    rest = root.getObjectByName('rest-face') ?? null
    laugh = root.getObjectByName('laugh-face') ?? null
    group = rest?.parent?.name === 'creator-face' ? rest.parent : (root.getObjectByName('creator-face') ?? null)
    searched = true
  }
  // Remote players are clones: their face store lost its builder in the userData copy
  // and shares geometry with other players, so only the cheap visibility swap is safe.
  const expressive = () => !!api && !!group && typeof group.userData.creatorFaceStore?.front === 'function'

  function express(expr: string) {
    try {
      if (api!.set(group!, expr)) applied = expr
    } catch {
      applied = null
    }
  }
  function show(next: FaceKey) {
    if (next === 'laugh') {
      if (rest && laugh) {
        rest.visible = false
        laugh.visible = true
      }
    } else {
      if (rest && laugh && shown === 'laugh') {
        rest.visible = true
        laugh.visible = false
      }
      if (next === 'base') {
        // Leave the face alone if something else (duty look, story) re-dressed it meanwhile.
        if (saved !== null && applied !== null && expressive() && api!.get(group!) === applied) express(saved)
        saved = applied = null
      } else if (expressive()) {
        saved ??= api!.get(group!)
        if (applied !== next) express(next)
      }
    }
    shown = next
  }

  return {
    /** Call each frame with the cue for the current time; work happens only on change. */
    sync(next: FaceKey) {
      const node = rest ?? group
      if (shown !== 'base' && node && !attached(node)) {
        // Outfit rebuilds swap in a fresh, neutral face: adopt it and re-apply the cue.
        find()
        shown = 'base'
        saved = applied = null
      }
      if (next === shown && (next === 'base' || next === 'laugh' || applied === next || !expressive())) return
      if (!searched) find()
      show(next)
    },
    /** Look the face up again on the next change (new emote, possibly new outfit). */
    rescan() {
      if (shown === 'base') searched = false
    },
  }
}
