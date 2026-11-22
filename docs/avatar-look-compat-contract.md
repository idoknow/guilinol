# 角色画风融合渲染与跨模块接口契约（Neon 交付）

本文档定义 `feat/avatar-look-compat-neon` 为后续模型升级（Hy1）、动作升级（Hy2）、实机 QA（Gbot）及主干集成（Gemini）建立的渲染标准与跨模块兼容契约。

## 1. 模块边界与零冲突设计
- 新增渲染模块：[web/src/look/avatar-look.ts](../web/src/look/avatar-look.ts)
  - 零动态光源（0 `PointLight`/`SpotLight`），单次着色器变体缓存，与 `look/atmosphere.ts` 共享 `atmo` 统一变量。
  - 分区材质响应（`aAvatarSurface`：`0=SKIN` 暖色 SSS 终止线包绕、去塑料感反照率校准；`1=HAIR` 压深防发灰 + 顶面光泽；`2=FABRIC` 微织物肌理与低光强反射；`3=ACCESSORY` 鞋靴/护具脆度；头盔可选 `glossyShell`）。
  - 昼夜雨雾耦合：复用 `look/night.ts` 同款 22 m 路灯网格与临街霓虹补光（`uAvatarLamp` / `uAvatarNeon`），雨天按 `uRain` 同步湿暗布料/发丝并增加肩部与鞋面顶光湿润高光。
  - 脚底软接触影（`createAvatarContactShadow`）：1 Draw Call 过程径向衰减贴花，**直接挂在 `scene` 而非 `figure` 子树**，绝不污染 `boat.ts` 的 `Box3().setFromObject(figure, true)` 船舱/桥底净空测量；随跳跃离地高度平滑衰减、蹲姿扩张、晴天低太阳微拉长、雨雾/夜间柔化、上车/上船/摔车自动隐藏。
- 新增跨模块兼容桥：[web/src/walk/avatar-compat.ts](../web/src/walk/avatar-compat.ts)
  - **零修改 `web/src/walk/avatar-rig.ts`**（避免与 Hy2 动作分支合并冲突）。
- 升级换装控制器：[web/src/walk/outfits.ts](../web/src/walk/outfits.ts)
  - 现有 `CityWalker` 保持 100% 比特兼容（`legacy_color0`），同时支持新配色单网格 `COLOR_0`（`bone_color0`）及多网格/多材质语义槽位（`named_parts` / `material_slots`）；帽子/头盔/背包同步接入 `applyAvatarStyleMaterial`。
- 轻量接入：[web/src/walk/index.ts](../web/src/walk/index.ts)
  - 暴露 `probe().avatarLook`、`probe().avatarCompat` 及 `walker.avatarCompat` 供自动化门禁与实机验收读取。

## 2. 给 Hy1（`public/avatar/figure.glb` 新人物建模）的无缝接入契约
新 GLB 替换 `public/avatar/figure.glb` 时满足以下任一组合即可零改动直接跑通全部系统：
1. **骨骼命名**：推荐继续使用 UE Mannequin 骨骼名（`pelvis` / `spine_01~03` / `neck_01` / `head` / `clavicle_l/r` / `upperarm_l/r` / `lowerarm_l/r` / `hand_l/r` / `thigh_l/r` / `calf_l/r` / `foot_l/r` / `ball_l/r`）；若导出为 Mixamo（`mixamorig*`）、Blender Rigify（`DEF-*`）或标准名（`Hips`/`LeftUpLeg`/`LeftFoot`），`normalizeAvatarSkeletonForRig()` 会在 `ensureAvatarRig()` 前自动归一化骨骼与对应 `AnimationClip.tracks`。
2. **朝向与身高**：站立高度自动校准到 `TARGET_STANDING_HEIGHT_M = 1.695 m`（兼容 `pipeline/vessel-bounds.json`：`rowboat.head=1.28` / `raft.head=1.31` / `boat.head=1.57`），建议导出站立净高在 `1.65 ~ 1.85 m` 区间，绑定姿势脚底贴近 `Y = 0`（支持任意 `bindMinY`）。
3. **材质与 IDOK-125 换装分区（三选一自动识别）**：
   - 方案 A（推荐多网格/多材质）：网格或材质名包含 `skin`/`face`/`hair`（**永久锁定不被换装染色**）、`top`/`jacket`/`shirt`、`bottom`/`pants`、`shoes`/`boots`、可选 `pack`/`backpack`（背自定义包时自动隐藏），支持纯色或 UV 贴图 + `roughnessMap`（若提供 `roughnessMap`，着色器保留 65% 美术贴图变化并叠加雨湿响应）。
   - 方案 B（新配色单网格 `COLOR_0`）：自动启用 `bone_color0` 骨骼+高度语义分区，强制锁定头部/五官/头发/手部与裸露前臂。
   - 方案 C（兼容现版 `CityWalker` 10 色板）：继续走 `legacy_color0` 全量无损路径。
4. **性能预算红线**：三角面 `<= 24,000 tris`、角色自身网格 `<= 6` 个 Draw Call、0 动态光源，确保飞行首屏资源增量 `+0 B`、步行总 Draw Calls 严格留在 `detail-budget`（`<= 86`）以内。

## 3. 给 Hy2（`avatar-rig.ts` 动作升级）的协作约定
- 本分支未改动 `web/src/walk/avatar-rig.ts`，合并时 0 冲突。
- `walk/index.ts` 已在 `ensureAvatarRig()` 之前执行 `normalizeAvatarSkeletonForRig()`，在其之后执行 `buildRobustFootProbes()` 与 `installAvatarStyleShading()`；Hy2 新增骨骼动画或程序化呼吸/眨眼/摆臂叠加无需额外适配，脚底接触影与 `liveSoleLocalY()` 会实时跟随更新。
- 载具/船只净空测量通过 `updateAllAvatarSkeletons(figure)` 覆盖全部 `SkinnedMesh`。

## 4. 给 Gbot（实机多角度验收）的探针字段
步行模式下通过 `window.viewer.walk.probe()` 可直接读取：
- `avatarLook`: `{ contactShadow: { visible, opacity, scaleX, scaleZ, y }, styledMaterials, surfaceAttrApplied, night, rain }`
- `avatarCompat`: `{ schema, meshCount, triangleCount, bindHeightM, appliedScale, standingHeightM, footProbeCount, soleOffsetM, outfitStrategy, vesselBoundsClearanceOk, perfBudgetOk, warnings }`
- 验收标准：`avatarCompat.warnings.length === 0`，`Math.abs(footSink) < 0.04`，`stats.calls <= 86`，昼/黄昏/雨/夜与换装/跳跃接触影均无报错、无塑料发灰或悬空漂浮。
