import assert from 'node:assert/strict'
import {readFileSync, rmSync} from 'node:fs'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'

const bundleDir = await mkdtemp(join(tmpdir(), 'glol-duty-story-test-'))
const bundleFile = join(bundleDir, 'story-sut.mjs')
process.once('exit', () => {
  try {
    rmSync(bundleDir, {recursive: true, force: true})
  } catch {
    // ignore
  }
})

await build({
  stdin: {
    contents: `
      export * from './web/src/traffic-duty/story/index.ts'
      export {
        facialFeatures,
        setCreatorExpression,
        getCreatorExpression,
        CREATOR_EXPRESSIONS,
        normalizeCreatorExpression,
      } from './web/src/walk/creator-face.ts'
      export {ensureAvatarRig} from './web/src/walk/avatar-rig.ts'
      export {defaultAvatar, hairColors, skinTones} from './lib/avatar.ts'
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: bundleFile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  plugins: [
    {
      name: 'resolve-workspace-three',
      setup(buildCtx) {
        buildCtx.onResolve({filter: /^three(\/.*)?$/}, args => ({
          path: import.meta.resolve(args.path),
          external: true,
        }))
      },
    },
  ],
  logLevel: 'silent',
})

after(async () => {
  await rm(bundleDir, {recursive: true, force: true})
})

async function loadAvatarScene(file = 'figure_m') {
  const bytes = await readFile(`public/avatar/${file}.glb`)
  let data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  if (file !== 'figure') {
    const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)))
    const bin = await readFile(`public/avatar/${doc.buffers[0].uri}`)
    delete doc.buffers[0].uri
    const json = Buffer.from(JSON.stringify(doc))
    const length = (json.length + 3) & ~3
    const packed = Buffer.alloc(28 + length + bin.length)
    bytes.copy(packed, 0, 0, 20)
    packed.writeUInt32LE(packed.length, 8)
    packed.writeUInt32LE(length, 12)
    packed.fill(0x20, 20, 20 + length)
    json.copy(packed, 20)
    packed.writeUInt32LE(bin.length, 20 + length)
    packed.write('BIN\0', 24 + length)
    bin.copy(packed, 28 + length)
    data = packed.buffer
  }
  const {scene} = await new GLTFLoader().parseAsync(data, '')
  return scene
}

const {
  createDutyStoryDirector,
  createDutyStoryCameraController,
  createDutyStoryPortraitManager,
  computeDutyShotPose,
  computePlayerOutfitSignature,
  isPlaceholderPortrait,
  buildOffDutyStoryBeat,
  resolveDutySettlement,
  PORTRAIT_W,
  PORTRAIT_H,
  DUTY_STORY_BEATS,
  DUTY_STORY_SHOT_IDS,
  OFFICER_PORTRAIT_EXPRESSIONS,
  getDutyStoryBeat,
  PORTRAIT_STUDIO_CONFIG,
  LEGACY_PORTRAIT_STUDIO_CONFIG,
  evaluatePortraitShadingLuminance,
  computePortraitCameraPose,
  measureRigFingerProportions,
  facialFeatures,
  setCreatorExpression,
  getCreatorExpression,
  CREATOR_EXPRESSIONS,
  ensureAvatarRig,
  defaultAvatar,
  hairColors,
  skinTones,
} = await import(pathToFileURL(bundleFile).href)

test('briefing_intro branches cleanly, hands over whistle + flag only on grantGear line, and completes with accepted=true', () => {
  assert.equal(DUTY_STORY_BEATS.length, 2)
  assert.equal(getDutyStoryBeat('briefing_intro').lines.length, 6)

  const gearEvents = []
  const completeEvents = []
  const director = createDutyStoryDirector({
    mountDom: false,
    onGearHandover: gear => gearEvents.push(gear),
    onComplete: payload => completeEvents.push(payload),
  })

  try {
    assert.equal(director.isActive(), false)
    assert.equal(director.hasCompletedBriefing(), false)
    assert.equal(director.open(), true)
    assert.equal(director.isActive(), true)
    assert.equal(director.getSnapshot().beatId, 'briefing_intro')
    assert.equal(director.getSnapshot().lineIndex, 0)
    assert.equal(gearEvents.length, 0)

    // Line 0 -> 1 -> 2 (choice line)
    assert.equal(director.advance(), true)
    assert.equal(director.advance(), true)
    assert.equal(director.getSnapshot().lineIndex, 2)
    // Cannot plain-advance across a choice line
    assert.equal(director.advance(), false)
    assert.equal(gearEvents.length, 0)

    // Choose full briefing branch ('ask_rules' -> line 3)
    assert.equal(director.choose('ask_rules'), true)
    assert.equal(director.getSnapshot().lineIndex, 3)
    assert.equal(gearEvents.length, 0)

    // Line 3 -> 4 (still no gear yet)
    assert.equal(director.advance(), true)
    assert.equal(director.getSnapshot().lineIndex, 4)
    assert.equal(gearEvents.length, 0)

    // Line 4 -> 5 (grantGear: true -> hands over whistle + flag!)
    assert.equal(director.advance(), true)
    assert.equal(director.getSnapshot().lineIndex, 5)
    assert.equal(gearEvents.length, 1)
    assert.deepEqual(gearEvents[0], {hasWhistle: true, hasFlag: true})
    assert.equal(completeEvents.length, 0)

    // Final advance completes dialogue & confirms duty start
    assert.equal(director.advance(), true)
    assert.equal(director.isActive(), false)
    assert.equal(director.hasCompletedBriefing(), true)
    assert.equal(completeEvents.length, 1)
    assert.equal(completeEvents[0].accepted, true)
    assert.equal(completeEvents[0].skipped, false)
    assert.deepEqual(completeEvents[0].gear, {hasWhistle: true, hasFlag: true})
  } finally {
    director.dispose()
  }
})

test('cancel() and repeat decline close dialogue without granting gear or accepting duty', () => {
  const gearEvents = []
  const completeEvents = []
  const cancelEvents = []
  const director = createDutyStoryDirector({
    mountDom: false,
    onGearHandover: gear => gearEvents.push(gear),
    onComplete: payload => completeEvents.push(payload),
    onCancel: id => cancelEvents.push(id),
  })

  try {
    // Cancel mid-intro -> zero gear, zero completion
    assert.equal(director.open('briefing_intro'), true)
    assert.equal(director.advance(), true)
    assert.equal(director.cancel(), true)
    assert.equal(director.isActive(), false)
    assert.equal(director.hasCompletedBriefing(), false)
    assert.equal(gearEvents.length, 0)
    assert.equal(completeEvents.length, 0)
    assert.deepEqual(cancelEvents, ['briefing_intro'])

    // Ready-now fast branch still hands over gear and completes
    assert.equal(director.open('briefing_intro'), true)
    director.advance()
    director.advance()
    assert.equal(director.choose('ready_now'), true)
    assert.equal(gearEvents.length, 1)
    assert.equal(director.advance(), true)
    assert.equal(completeEvents.length, 1)
    assert.equal(completeEvents[0].accepted, true)

    // Subsequent open() defaults to briefing_repeat; declining does NOT grant gear or start duty
    assert.equal(director.open(), true)
    assert.equal(director.getSnapshot().beatId, 'briefing_repeat')
    assert.equal(director.choose('repeat_decline'), true)
    assert.equal(gearEvents.length, 1, 'declining repeat shift must not trigger new gear handover')
    assert.equal(director.advance(), true)
    assert.equal(completeEvents.length, 2)
    assert.equal(completeEvents[1].accepted, false)
    assert.deepEqual(completeEvents[1].gear, {hasWhistle: false, hasFlag: false})
  } finally {
    director.dispose()
  }
})

test('every beat line specifies a valid GTA shot and covers wide/officer/player/two camera angles', () => {
  const validShots = new Set(DUTY_STORY_SHOT_IDS)
  for (const beat of DUTY_STORY_BEATS) {
    assert.ok(beat.lines.length > 0, `${beat.id} must have lines`)
    for (let i = 0; i < beat.lines.length; i++) {
      const line = beat.lines[i]
      assert.ok(validShots.has(line.shot), `${beat.id}[${i}] missing valid shot (got ${line.shot})`)
    }
  }
  const introShots = new Set(getDutyStoryBeat('briefing_intro').lines.map(l => l.shot))
  for (const requiredShot of ['wide', 'officer', 'player', 'two']) {
    assert.equal(introShots.has(requiredShot), true, `briefing_intro must include ${requiredShot} shot`)
  }
})

test('camera controller frames front-of-officer close-up, reverse player OTS, clamps to bridge railings, and restores camera 1:1', () => {
  // Officer stands at (-265.2, 151.85, 27.6) looking along (-0.707, -0.707) toward player at (-267.2, 151.85, 25.6)
  const anchor = {
    npcPos: [-265.2, 151.85, 27.6],
    npcYaw: Math.PI / 4,
    npcHead: [-265.2, 153.52, 27.6],
    playerPos: [-267.2, 151.85, 25.6],
  }
  const officerShot = computeDutyShotPose('officer', anchor)
  // Camera must sit in front of officer toward player (-X, -Z), never behind officer's back
  assert.ok(officerShot.position[0] < anchor.npcPos[0], 'officer close-up camera must be on player-facing front side (X)')
  assert.ok(officerShot.position[2] < anchor.npcPos[2], 'officer close-up camera must be on player-facing front side (Z)')

  const playerShot = computeDutyShotPose('player', anchor)
  const twoShot = computeDutyShotPose('two', anchor)
  assert.notDeepEqual(officerShot.position, playerShot.position)
  assert.notDeepEqual(playerShot.position, twoShot.position)

  // Standing beside south parapet (~z=+29.2) must keep 'two' & 'wide' cameras inside bridge corridor toward open roadway
  const nearSouthRail = computeDutyShotPose('two', {
    npcPos: [-265.2, 151.85, 29.2],
    npcYaw: 0.7,
    npcHead: [-265.2, 153.52, 29.2],
    playerPos: [-267.0, 151.85, 28.4],
  })
  assert.ok(nearSouthRail.position[2] < 29.2, 'camera beside south parapet must pull northward into open bridge roadway')

  const camera = {
    position: {
      x: -271.5,
      y: 154.2,
      z: 21.8,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      },
    },
    quaternion: {
      x: 0.11,
      y: -0.22,
      z: 0.03,
      w: 0.96,
      set(x, y, z, w) {
        this.x = x
        this.y = y
        this.z = z
        this.w = w
      },
    },
    fov: 56,
    lookAtCalls: 0,
    lookAt() {
      this.lookAtCalls += 1
    },
    updateProjectionMatrix() {},
  }

  const rig = createDutyStoryCameraController()
  rig.begin(camera)
  rig.setShot('officer', anchor, camera)
  for (let i = 0; i < 40; i++) rig.step(1 / 60, anchor, camera)
  assert.ok(camera.lookAtCalls > 0)
  assert.notEqual(camera.fov, 56)

  const restored = rig.end(camera)
  assert.ok(restored)
  assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [-271.5, 154.2, 21.8])
  assert.deepEqual([camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w], [0.11, -0.22, 0.03, 0.96])
  assert.equal(camera.fov, 56)
  assert.equal(rig.getState().restoreCount, 1)
  assert.equal(rig.isActive(), false)
})

test('portrait manager provides >=4 officer expressions, rejects SVG placeholders, and refreshes player portrait on outfit change', async () => {
  assert.ok(OFFICER_PORTRAIT_EXPRESSIONS.length >= 4)
  for (const requiredExpr of ['serious', 'smile', 'remind', 'thumbs_up']) {
    assert.equal(OFFICER_PORTRAIT_EXPRESSIONS.includes(requiredExpr), true)
  }
  assert.equal(isPlaceholderPortrait('data:image/svg+xml,<svg></svg>'), true)
  assert.equal(isPlaceholderPortrait('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAA='), false)

  let currentOutfit = {top: 'top_hoodie', bottom: 'bot_jogger', shoes: 'shoe_sneaker', hat: '', bag: ''}
  let officerRenderCount = 0
  const playerRenderCalls = []

  const portraits = createDutyStoryPortraitManager({
    getPlayerAvatar: () => ({body: 'm', skin: 2, face: 1, brows: 0, eyes: 0, hair: 'm_crop', hairColor: 0, look: 'basic'}),
    getPlayerOutfit: () => currentOutfit,
    renderOfficerPortraits: async () => {
      officerRenderCount += 1
      return {
        serious: 'data:image/png;base64,OFF_SERIOUS_123456',
        smile: 'data:image/png;base64,OFF_SMILE_12345678',
        remind: 'data:image/png;base64,OFF_REMIND_1234567',
        thumbs_up: 'data:image/png;base64,OFF_THUMBS_1234567',
      }
    },
    renderPlayerPortrait: async (outfitKey, _avatar, equipped) => {
      playerRenderCalls.push({outfitKey, equipped})
      return `data:image/png;base64,PLAYER_${equipped.top}_${equipped.hat || 'none'}_${playerRenderCalls.length}`
    },
  })

  try {
    const first = await portraits.ensureReady()
    assert.equal(officerRenderCount, 1)
    assert.equal(playerRenderCalls.length, 1)
    assert.equal(isPlaceholderPortrait(first.player), false)
    for (const expr of OFFICER_PORTRAIT_EXPRESSIONS) {
      assert.equal(isPlaceholderPortrait(first.officer[expr]), false)
    }

    // Equip different outfit & hat -> outfit signature changes and player portrait automatically refreshes
    const sigBefore = computePlayerOutfitSignature(null, currentOutfit)
    currentOutfit = {top: 'top_guochao_pankou', bottom: 'bot_wide', shoes: 'shoe_canvas', hat: 'hat_rider_helmet', bag: ''}
    const sigAfter = computePlayerOutfitSignature(null, currentOutfit)
    assert.notEqual(sigAfter, sigBefore)

    const refreshed = await portraits.refreshPlayerIfChanged()
    assert.ok(refreshed)
    assert.equal(officerRenderCount, 1, 'officer portraits remain cached when player outfit changes')
    assert.equal(playerRenderCalls.length, 2)
    assert.notEqual(refreshed.player, first.player)
    assert.equal(refreshed.player.includes('top_guochao_pankou'), true)
  } finally {
    portraits.dispose()
  }
})

test('director syncs live camera shots, restores camera + zero player displacement on skip/cancel, and exposes dual portrait URLs', async () => {
  const playerPos = {x: -267.4, y: 151.88, z: 25.4}
  const camera = {
    position: {x: -270, y: 153.5, z: 22.0, set(x, y, z) { this.x = x; this.y = y; this.z = z }},
    quaternion: {x: 0.05, y: -0.15, z: 0.01, w: 0.98, set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w }},
    fov: 54,
    lookAt() {},
    updateProjectionMatrix() {},
  }
  const seenExpressions = []
  const manager = createDutyStoryPortraitManager({
    renderOfficerPortraits: async () => ({
      serious: 'data:image/png;base64,OFF_SERIOUS_123456',
      smile: 'data:image/png;base64,OFF_SMILE_12345678',
      remind: 'data:image/png;base64,OFF_REMIND_1234567',
      thumbs_up: 'data:image/png;base64,OFF_THUMBS_1234567',
    }),
    renderPlayerPortrait: async () => 'data:image/png;base64,PLAYER_PORTRAIT_123456',
  })

  const director = createDutyStoryDirector({
    mountDom: false,
    camera,
    portraitManager: manager,
    getPlayerPos: () => playerPos,
    getOfficerAnchor: () => ({
      npcPos: [-265.2, 151.85, 27.6],
      npcYaw: Math.PI / 4,
      npcHead: [-265.2, 153.5, 27.6],
    }),
    onOfficerExpression: expr => seenExpressions.push(expr),
  })

  try {
    await director.refreshPortraits()
    assert.equal(director.open(), true)
    assert.equal(director.getSnapshot().currentShot, 'wide')
    assert.equal(director.getSnapshot().portraitsReady, true)
    assert.equal(isPlaceholderPortrait(director.getSnapshot().officerPortraitUrl), false)
    assert.equal(isPlaceholderPortrait(director.getSnapshot().playerPortraitUrl), false)

    director.step(1 / 30)
    director.advance()
    assert.equal(director.getSnapshot().currentShot, 'player')
    director.advance()
    assert.equal(director.getSnapshot().currentShot, 'officer')
    assert.ok(seenExpressions.includes('smile'))

    assert.equal(director.skip(), true)
    assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [-270, 153.5, 22.0])
    assert.equal(camera.fov, 54)
    assert.deepEqual(playerPos, {x: -267.4, y: 151.88, z: 25.4})
  } finally {
    director.dispose()
    manager.dispose()
  }
})

test('openOffDuty settlement quotes cited count, total fine, 10% share, stacked multi-violation commentary, covers officer/player/two shots, and triggers onSettled strictly once on finish/skip and 0 on cancel', () => {
  assert.ok(PORTRAIT_W >= 512 && PORTRAIT_H >= 576, 'portraits must render at high resolution (>=512x576)')

  const beat = buildOffDutyStoryBeat({
    citedCount: 7,
    totalFineYuan: 560,
    stackedCount: 2,
    stackedFineYuan: 160,
  })
  assert.equal(beat.id, 'off_duty')
  const allText = beat.lines.map(l => l.text).join('\n')
  assert.equal(allText.includes('7'), true, 'settlement text must include ticket count')
  assert.equal(allText.includes('560'), true, 'settlement text must include total fines')
  assert.equal(allText.includes('10%'), true, 'settlement text must include 10% rate')
  assert.equal(allText.includes('56'), true, 'settlement text must include 56 yuan reward')
  assert.equal(beat.lines.some(l => l.text.includes('数罪并罚') && l.text.includes('2')), true, 'must include dedicated 数罪并罚 commentary line')

  const zeroBeat = buildOffDutyStoryBeat({citedCount: 0, totalFineYuan: 0, stackedCount: 0})
  assert.equal(zeroBeat.lines.some(l => l.text.includes('数罪并罚')), true)
  assert.equal(resolveDutySettlement({totalFineYuan: 320}).rewardYuan, 32)

  const shots = new Set(beat.lines.map(l => l.shot))
  for (const requiredShot of ['officer', 'player', 'two']) {
    assert.equal(shots.has(requiredShot), true, `off_duty must use ${requiredShot} shot`)
  }

  const settledEvents = []
  const gearEvents = []
  const cancelEvents = []
  const director = createDutyStoryDirector({
    mountDom: false,
    onGearHandover: g => gearEvents.push(g),
    onCancel: id => cancelEvents.push(id),
  })

  try {
    // 1. Cancel closes cleanly without triggering onSettled
    assert.equal(
      director.openOffDuty({citedCount: 4, totalFineYuan: 240, stackedCount: 1}, p => settledEvents.push(p)),
      true,
    )
    assert.equal(director.getSnapshot().beatId, 'off_duty')
    assert.equal(director.advance(), true)
    assert.equal(director.cancel(), true)
    assert.equal(director.isActive(), false)
    assert.equal(settledEvents.length, 0, 'cancel must not trigger onSettled')
    assert.deepEqual(cancelEvents, ['off_duty'])

    // 2. Skip mid-dialogue settles strictly once with skipped=true
    assert.equal(
      director.openOffDuty({citedCount: 4, totalFineYuan: 240, stackedCount: 1}, p => settledEvents.push(p)),
      true,
    )
    assert.equal(director.skip(), true)
    assert.equal(director.skip(), false)
    assert.equal(director.isActive(), false)
    assert.equal(settledEvents.length, 1, 'skip must trigger onSettled strictly once')
    assert.equal(settledEvents[0].skipped, true)
    assert.equal(settledEvents[0].settlement.rewardYuan, 24)

    // 3. Natural advance completion settles strictly once with skipped=false and zero extra gear handover
    assert.equal(
      director.openOffDuty({citedCount: 7, totalFineYuan: 560, stackedCount: 2, stackedFineYuan: 160}, p =>
        settledEvents.push(p),
      ),
      true,
    )
    let guard = 0
    while (director.isActive() && guard++ < 12) {
      assert.equal(director.advance(), true)
    }
    assert.equal(director.isActive(), false)
    assert.equal(settledEvents.length, 2, 'natural completion must trigger onSettled strictly once')
    assert.equal(settledEvents[1].skipped, false)
    assert.equal(settledEvents[1].settlement.citedCount, 7)
    assert.equal(settledEvents[1].settlement.totalFineYuan, 560)
    assert.equal(settledEvents[1].settlement.rewardYuan, 56)
    assert.equal(gearEvents.length, 0, 'off_duty must not re-trigger gear handover')
  } finally {
    director.dispose()
  }
})

test('story files obey compliance & Mountain-Seal CSS guards (zero placeholders, no KeyF, no forbidden terms, no gradients, no backdrop-filter, --ui-serif only)', () => {
  const dir = new URL('./', import.meta.url)
  const forbidden = new RegExp('\\u884c\\u653f\\u5904\\u7f5a|\\u6263\\u5206|\\u8b66\\u5fbd|\\u8b66\\u53f7')
  for (const file of ['script.ts', 'director.ts', 'camera-shots.ts', 'portraits.ts', 'index.ts', 'dialogue.css']) {
    const src = readFileSync(new URL(file, dir), 'utf8')
    assert.equal(forbidden.test(src), false, `story/${file} must not contain forbidden terms`)
    assert.equal(/OFFICER_PORTRAIT_SVG|PLAYER_PORTRAIT_SVG/.test(src), false, `story/${file} must not retain legacy SVG portraits`)
    assert.equal(/event\.code\s*===?\s*['"]KeyF['"]/.test(src), false, `story/${file} must not bind private KeyF`)
    assert.equal(/linear-gradient|radial-gradient/.test(src), false, `story/${file} must not use gradients`)
    assert.equal(/\p{Emoji_Presentation}/u.test(src), false, `story/${file} must not contain emojis`)
    if (file === 'dialogue.css') {
      assert.equal(src.includes('--ui-serif'), true)
      assert.equal(/backdrop-filter/.test(src), false, 'story/dialogue.css must use solid jade without backdrop-filter')
      assert.equal(/PingFang|sans-serif|monospace/.test(src), false, 'story/dialogue.css must use --ui-serif only')
    }
  }
})

test('k8: setCreatorExpression switches 5 expressions in-place with pairwise distinct geometry, 0 extra draw calls, and bit-exact neutral baseline', async () => {
  assert.deepEqual([...CREATOR_EXPRESSIONS], ['neutral', 'serious', 'smile', 'remind', 'thumbs_up'])

  for (const [file, body] of [
    ['figure_m', 'm'],
    ['figure_f', 'f'],
  ]) {
    const scene = await loadAvatarScene(file)
    let skinned = null
    scene.traverse(n => {
      if (!skinned && n instanceof THREE.SkinnedMesh) skinned = n
    })
    assert.ok(skinned, `${file}.glb must contain a SkinnedMesh`)

    const avatar = {...defaultAvatar(), body}
    const faceGroup = facialFeatures(skinned.geometry, avatar)
    assert.equal(getCreatorExpression(faceGroup), 'neutral')

    const countMeshes = root => {
      let total = 0
      let visible = 0
      root.traverse(n => {
        if (n instanceof THREE.Mesh) {
          total += 1
          if (n.visible) visible += 1
        }
      })
      return {total, visible}
    }

    const baseCounts = countMeshes(faceGroup)
    assert.equal(baseCounts.total, 2, 'creator-face must contain only rest-face + hidden laugh-face')
    assert.equal(baseCounts.visible, 1, 'creator-face must draw exactly 1 visible mesh (0 added draw calls)')

    const restMesh = faceGroup.getObjectByName('rest-face')
    assert.ok(restMesh instanceof THREE.Mesh)
    const restGeo = restMesh.geometry
    const initPos = Float32Array.from(restGeo.getAttribute('position').array)
    const initCol = Float32Array.from(restGeo.getAttribute('color').array)
    // 8 ribbons (2 eyes + 2 lids + 2 brows + 1 nose + 1 lip) * 19 steps * 3 rows = 456 vertices
    assert.equal(restGeo.getAttribute('position').count, 456)
    assert.equal(restGeo.index.count, 1728)

    // Independent bit-exact reference of pre-r10 unmodified facialFeatures() neutral geometry & colors
    const refPos = []
    const refCol = []
    const srcPos = skinned.geometry.getAttribute('position')
    const srcIdx = skinned.geometry.index
    const refTris = []
    for (let i = 0; i < srcIdx.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(srcPos, srcIdx.getX(i))
      if (a.y < 1.54 || a.y > 1.69 || Math.abs(a.x) > 0.11 || a.z < 0) continue
      refTris.push(
        new THREE.Triangle(
          a,
          new THREE.Vector3().fromBufferAttribute(srcPos, srcIdx.getX(i + 1)),
          new THREE.Vector3().fromBufferAttribute(srcPos, srcIdx.getX(i + 2)),
        ),
      )
    }
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1))
    const hit = new THREE.Vector3()
    const refFront = (x, y) => {
      ray.origin.set(-x, 1.56849 + y, 0.3)
      let z = 0
      for (const tr of refTris) if (ray.intersectTriangle(tr.a, tr.b, tr.c, false, hit)) z = Math.max(z, hit.z)
      return 0.0114245 - z
    }
    const refRibbon = (color, point) => {
      const pigment = new THREE.Color(color)
      for (let i = 0; i <= 18; i++)
        for (let j = 0; j < 3; j++) {
          const [x, y, lift] = point(i / 18, j / 2)
          refCol.push(pigment.r, pigment.g, pigment.b)
          refPos.push(x, y, refFront(x, y) - lift)
        }
    }
    for (const side of [-1, 1]) {
      const eyeY = 0.065
      const halfWidth = avatar.eyes === 3 ? 0.009 : 0.0075 + 0.001 * avatar.eyes
      const eyeH = avatar.eyes === 3 ? 0.0165 : 0.011 + 0.001 * avatar.eyes
      refRibbon('#302622', (t, v) => {
        const angle = Math.PI * t
        return [side * (0.034 - halfWidth * Math.cos(angle)), eyeY + (v - 0.5) * eyeH * Math.sin(angle), 0.0018]
      })
      refRibbon('#4a352b', (t, v) => [
        side * (0.034 + (2 * t - 1) * (halfWidth + 0.002)),
        eyeY + 0.005 + (0.003 + 0.0016 * v) * Math.sin(Math.PI * t),
        0.0015,
      ])
      refRibbon(new THREE.Color(hairColors[avatar.hairColor]), (t, v) => [
        side * (0.018 + 0.041 * t),
        0.082 +
          [0.001, 0.01, 0.003, 0.001][avatar.brows] * Math.sin(Math.PI * t) +
          [0, -0.002, -0.012, 0.007][avatar.brows] * t +
          [0.003, 0.004, 0.005, 0.0062][avatar.brows] * v * Math.sin(Math.PI * t) ** (avatar.brows === 3 ? 0.2 : 0.4),
        0.0016,
      ])
    }
    refRibbon(new THREE.Color(skinTones[avatar.skin]).lerp(new THREE.Color('#885d49'), 0.45), (t, v) => [
      (t - 0.5) * 0.019,
      0.03 + 0.005 * (1 - t) * v,
      0.0014,
    ])
    refRibbon(new THREE.Color(skinTones[avatar.skin]).lerp(new THREE.Color('#994e48'), 0.52), (t, v) => {
      const arc = Math.sin(Math.PI * t)
      return [
        (0.5 - t) * 0.041,
        0.002 + 0.0015 * (2 * t - 1) ** 2 + arc * (v - 0.5) * (0.009 + 0.002 * Math.sin(2 * Math.PI * t) ** 2),
        0.0018,
      ]
    })
    const expectedPos = new Float32Array(refPos)
    const expectedCol = new Float32Array(refCol)
    for (let i = 0; i < expectedPos.length; i++) {
      assert.equal(Object.is(initPos[i], expectedPos[i]), true, `${file} initial neutral pos[${i}] differs from pre-r10 baseline`)
      assert.equal(Object.is(initCol[i], expectedCol[i]), true, `${file} initial neutral col[${i}] differs from pre-r10 baseline`)
    }

    const snapshots = {}
    for (const expr of CREATOR_EXPRESSIONS) {
      assert.equal(setCreatorExpression(faceGroup, expr), true, `${file} failed setCreatorExpression(${expr})`)
      assert.equal(getCreatorExpression(faceGroup), expr)
      assert.equal(restMesh.geometry, restGeo, 'setCreatorExpression must update BufferGeometry in-place')
      const counts = countMeshes(faceGroup)
      assert.deepEqual(counts, baseCounts, `switching to ${expr} must add 0 meshes / 0 draw calls`)
      snapshots[expr] = Float32Array.from(restGeo.getAttribute('position').array)
      // Verify brows stay cleanly beneath police cap brim (y <= 0.092)
      if (expr !== 'neutral') {
        let maxY = -Infinity
        for (let k = 1; k < snapshots[expr].length; k += 3) {
          if (snapshots[expr][k] > maxY) maxY = snapshots[expr][k]
        }
        assert.ok(maxY <= 0.092, `${file} ${expr} brow maxY=${maxY.toFixed(4)} rises too high into cap brim`)
      }
    }

    // Switching back to neutral must restore bit-for-bit exact initial player geometry & colors
    assert.equal(setCreatorExpression(faceGroup, 'neutral'), true)
    const restoredPos = restGeo.getAttribute('position').array
    const restoredCol = restGeo.getAttribute('color').array
    for (let i = 0; i < initPos.length; i++) {
      assert.equal(Object.is(restoredPos[i], initPos[i]), true, `${file} neutral pos[${i}] drifted`)
      assert.equal(Object.is(restoredCol[i], initCol[i]), true, `${file} neutral col[${i}] drifted`)
    }

    // All 10 pairs across 5 expressions must have strictly distinct vertex geometry (> 2mm displacement)
    for (let i = 0; i < CREATOR_EXPRESSIONS.length; i++) {
      for (let j = i + 1; j < CREATOR_EXPRESSIONS.length; j++) {
        const aName = CREATOR_EXPRESSIONS[i]
        const bName = CREATOR_EXPRESSIONS[j]
        const a = snapshots[aName]
        const b = snapshots[bName]
        let maxDelta = 0
        for (let k = 0; k < a.length; k++) {
          const d = Math.abs(a[k] - b[k])
          if (d > maxDelta) maxDelta = d
        }
        assert.ok(
          maxDelta > 0.002,
          `${file} expressions ${aName} vs ${bName} must differ geometrically (>2mm, got ${(maxDelta * 1000).toFixed(2)}mm)`,
        )
      }
    }
  }
})

test('k8: portrait studio lighting is brighter than legacy config (fixes dark/grey player portrait) and camera frames head + cap cleanly', () => {
  assert.ok(
    PORTRAIT_STUDIO_CONFIG.exposure > LEGACY_PORTRAIT_STUDIO_CONFIG.exposure,
    'r10 studio exposure must exceed legacy dark baseline',
  )
  assert.ok(PORTRAIT_STUDIO_CONFIG.hemiIntensity > LEGACY_PORTRAIT_STUDIO_CONFIG.hemiIntensity)
  assert.ok(PORTRAIT_STUDIO_CONFIG.keyIntensity > LEGACY_PORTRAIT_STUDIO_CONFIG.keyIntensity)

  const normals = [
    [0, 0.1, 0.995],
    [-0.35, 0.12, 0.93],
    [0.42, 0.08, 0.90],
    [0.65, -0.05, 0.76],
  ]
  let legacySum = 0
  let nextSum = 0
  let sampleCount = 0
  for (const hex of skinTones) {
    const col = new THREE.Color(hex)
    const albedo = [col.r, col.g, col.b]
    for (const n of normals) {
      const legacyLum = evaluatePortraitShadingLuminance(LEGACY_PORTRAIT_STUDIO_CONFIG, albedo, n)
      const nextLum = evaluatePortraitShadingLuminance(PORTRAIT_STUDIO_CONFIG, albedo, n)
      assert.ok(nextLum > legacyLum, `skin ${hex} normal ${n.join(',')} must be brighter (${nextLum.toFixed(4)} > ${legacyLum.toFixed(4)})`)
      legacySum += legacyLum
      nextSum += nextLum
      sampleCount += 1
    }
  }
  const legacyAvg = legacySum / sampleCount
  const nextAvg = nextSum / sampleCount
  assert.ok(
    nextAvg >= legacyAvg * 1.08,
    `portrait average luminance must lift >=8% over legacy (${nextAvg.toFixed(4)} vs ${legacyAvg.toFixed(4)})`,
  )

  const hexLum = hex => {
    const c = new THREE.Color(hex)
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  }
  assert.ok(hexLum(PORTRAIT_STUDIO_CONFIG.backdropCenterHex) > hexLum(LEGACY_PORTRAIT_STUDIO_CONFIG.backdropCenterHex))
  assert.ok(hexLum(PORTRAIT_STUDIO_CONFIG.backdropMidHex) > hexLum(LEGACY_PORTRAIT_STUDIO_CONFIG.backdropMidHex))
  assert.ok(hexLum(PORTRAIT_STUDIO_CONFIG.backdropEdgeHex) > hexLum(LEGACY_PORTRAIT_STUDIO_CONFIG.backdropEdgeHex))

  const cases = [
    {kind: 'officer', headY: 1.62, topY: 1.90, expr: 'serious'},
    {kind: 'officer', headY: 1.62, topY: 1.96, expr: 'smile'},
    {kind: 'officer', headY: 1.62, topY: 1.92, expr: 'remind'},
    {kind: 'officer', headY: 1.62, topY: 1.92, expr: 'thumbs_up'},
    {kind: 'player', headY: 1.60, topY: 1.79},
    {kind: 'player', headY: 1.60, topY: 1.92},
  ]
  for (const c of cases) {
    const pose = computePortraitCameraPose(c.kind, c)
    const cam = new THREE.PerspectiveCamera(pose.fov, PORTRAIT_W / PORTRAIT_H, 0.1, 20)
    cam.position.set(pose.position[0], pose.position[1], pose.position[2])
    cam.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2])
    cam.updateMatrixWorld(true)

    const crown = new THREE.Vector3(0, c.topY, 0).project(cam)
    const face = new THREE.Vector3(0, c.headY, 0).project(cam)
    const collar = new THREE.Vector3(0, c.headY - 0.26, 0).project(cam)
    assert.ok(crown.y >= 0.50 && crown.y <= 0.92, `${c.kind}/${c.expr ?? 'base'} crown ndc.y=${crown.y.toFixed(3)} out of safe range`)
    assert.ok(face.y >= -0.15 && face.y <= 0.45, `${c.kind}/${c.expr ?? 'base'} face ndc.y=${face.y.toFixed(3)} out of safe range`)
    assert.ok(collar.y >= -0.95 && collar.y <= -0.15, `${c.kind}/${c.expr ?? 'base'} collar ndc.y=${collar.y.toFixed(3)} out of safe range`)
  }
})

test('k8: #389 figure_m and figure_f finger lengths remain in normal human proportions (rest & portrait pose)', async () => {
  for (const file of ['figure_m', 'figure_f']) {
    const scene = await loadAvatarScene(file)
    const rig = ensureAvatarRig(scene)
    const restReport = measureRigFingerProportions(scene)

    // Apply portrait arm/hand pose and verify zero finger stretching
    rig.joints.Hips?.rotation.set(0, 0, 0)
    rig.joints.Torso?.rotation.set(0.02, 0.04, 0)
    rig.joints.Head?.rotation.set(0.02, -0.05, 0.02)
    rig.joints.ArmL?.rotation.set(0.04, 0, -0.05)
    rig.joints.ForearmL?.rotation.set(0.18, 0, 0)
    rig.joints.ArmR?.rotation.set(0.04, 0, 0.05)
    rig.joints.ForearmR?.rotation.set(0.18, 0, 0)
    rig.syncPose()
    const posedReport = measureRigFingerProportions(scene)

    for (const [label, rep] of [
      ['rest', restReport],
      ['posed', posedReport],
    ]) {
      assert.ok(rep.bodyHeightM >= 1.55 && rep.bodyHeightM <= 1.95, `${file} ${label} bodyHeightM=${rep.bodyHeightM}`)
      assert.ok(rep.leftForearmM >= 0.22 && rep.leftForearmM <= 0.34, `${file} ${label} leftForearmM=${rep.leftForearmM}`)
      assert.ok(rep.rightForearmM >= 0.22 && rep.rightForearmM <= 0.34, `${file} ${label} rightForearmM=${rep.rightForearmM}`)
      for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        const lLen = rep.leftLengths[f]
        const rLen = rep.rightLengths[f]
        assert.ok(lLen >= 0.06 && lLen <= 0.145, `${file} ${label} left ${f}=${lLen}m abnormal`)
        assert.ok(rLen >= 0.06 && rLen <= 0.145, `${file} ${label} right ${f}=${rLen}m abnormal`)
      }
      assert.ok(
        rep.maxFingerToHeightRatio <= 0.085,
        `${file} ${label} maxFingerToHeightRatio=${rep.maxFingerToHeightRatio} exceeds normal human ratio`,
      )
      assert.ok(
        rep.maxLeftRightDeltaM < 0.005,
        `${file} ${label} L/R finger asymmetry ${rep.maxLeftRightDeltaM}m too high`,
      )
    }
  }
})

test('k8: line5 two-shot genuinely frames BOTH officer and player cleanly inside 16:9 viewport across talk distances', () => {
  const intro = getDutyStoryBeat('briefing_intro')
  assert.equal(intro.lines[5].shot, 'two', 'briefing_intro line5 must use shot=two')
  assert.equal(intro.lines[5].grantGear, true)

  const scenarios = [
    {
      label: 'close-2m',
      npcPos: [-265.2, 151.85, 27.6],
      npcYaw: Math.PI / 4,
      npcHead: [-265.2, 153.52, 27.6],
      playerPos: [-266.8, 151.85, 26.4],
    },
    {
      label: 'default-3.05m',
      npcPos: [-265.2, 151.85, 27.6],
      npcYaw: Math.PI / 4,
      npcHead: [-265.2, 153.52, 27.6],
      playerPos: [-267.8, 151.85, 26.0],
    },
    {
      label: 'wide-4.5m',
      npcPos: [-265.2, 151.85, 27.6],
      npcYaw: Math.PI / 4,
      npcHead: [-265.2, 153.52, 27.6],
      playerPos: [-269.4, 151.85, 26.0],
    },
  ]

  for (const sc of scenarios) {
    const pose = computeDutyShotPose('two', sc)
    const cam = new THREE.PerspectiveCamera(pose.fov, 16 / 9, 0.1, 200)
    cam.position.set(pose.position[0], pose.position[1], pose.position[2])
    cam.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2])
    cam.updateMatrixWorld(true)

    const [nx, ny, nz] = sc.npcPos
    const [px, py, pz] = sc.playerPos
    const offHead = new THREE.Vector3(nx, ny + 1.65, nz).project(cam)
    const offChest = new THREE.Vector3(nx, ny + 1.25, nz).project(cam)
    const plyHead = new THREE.Vector3(px, py + 1.65, pz).project(cam)
    const plyChest = new THREE.Vector3(px, py + 1.25, pz).project(cam)

    for (const [tag, p] of [
      ['officerHead', offHead],
      ['officerChest', offChest],
      ['playerHead', plyHead],
      ['playerChest', plyChest],
    ]) {
      assert.ok(p.z >= -1 && p.z <= 1, `${sc.label} ${tag} behind/outside clip plane (z=${p.z.toFixed(3)})`)
      assert.ok(
        Math.abs(p.x) <= 0.72,
        `${sc.label} ${tag} ndc.x=${p.x.toFixed(3)} exceeds safe inner two-shot bounds`,
      )
      assert.ok(
        p.y >= -0.35 && p.y <= 0.85,
        `${sc.label} ${tag} ndc.y=${p.y.toFixed(3)} outside safe vertical band`,
      )
    }
    const horizSep = Math.abs(offHead.x - plyHead.x)
    assert.ok(horizSep >= 0.25, `${sc.label} officer & player overlap too closely in two-shot (sep=${horizSep.toFixed(3)})`)

    // Verify player OTS chest-up framing keeps head centered cleanly inside viewport
    const pPose = computeDutyShotPose('player', sc)
    const pCam = new THREE.PerspectiveCamera(pPose.fov, 16 / 9, 0.1, 200)
    pCam.position.set(pPose.position[0], pPose.position[1], pPose.position[2])
    pCam.lookAt(pPose.lookAt[0], pPose.lookAt[1], pPose.lookAt[2])
    pCam.updateMatrixWorld(true)
    const pHead = new THREE.Vector3(px, py + 1.62, pz).project(pCam)
    assert.ok(pHead.z >= -1 && pHead.z <= 1 && Math.abs(pHead.x) <= 0.45 && pHead.y >= -0.1 && pHead.y <= 0.65)
  }
})
