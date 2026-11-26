# r10 交警建模重做 · 组长指点清单

- 编写：克劳德（k1、k2）
- 日期：2026-11-25
- 老板拍板原话：「丑，你先让成员拉取最新版本的用户建模，然后匹配新版本的建模做交警建模。」

## 0. 一句话结论

交警必须和玩家**走同一条建模管线、用同一种画风**。现在的交警丑，并不是哪个配件做得不好，而是整套画风和玩家不一致：

- 脸是写实的皱纹贴图；
- 衣服用了法线贴图，还有高光；
- 没有描边；
- 手套是银灰色的"机械手"；
- 背心是发灰的橄榄绿。

玩家这边则是低多边形、粗描边、平涂软光。两人站在一起，看起来像是从两个游戏里拿出来的。

## 1. 最新玩家建模（已落盘）

- 来源：`origin/main` 的 7da42fff（#389「翻盖烟盒、手部动作与六款新烟品」）。
  - 2026-11-25 用 https 抓过远端，main 已到 98824aca，但此后 `public/avatar` 和 `pipeline/avatar_hands.py` 没有更新的提交。
- 已检出到本 worktree 的文件：
  - `/Users/pan-work/guilinol-xp-overnight/public/avatar/figure.glb`、`figure_m.glb`、`figure_f.glb`
  - `/Users/pan-work/guilinol-xp-overnight/public/avatar/creator-rig.bin`
  - `/Users/pan-work/guilinol-xp-overnight/pipeline/avatar_hands.py`
- 实际变化：只重做了**手指几何**。
  - 每节手指的截面在相邻两段之间共用，动画时不会裂缝。
  - 指根埋进掌心，形状收尖。
  - 拇指改为按自身朝向建截面。
  - **骨骼名称和层级不变**，所有挂点（`attach_*`、`hand_l/r`、`thumb_0x_*` 等）照常可用。
- 回归结果，全部通过：
  - `node --test web/src/walk/knockdown.test.mjs`：10/10（含 figure、figure_m、figure_f 三个模型的打印机和递单断言）
  - `npm run test:emote`：7/7
  - `node --test web/src/traffic-duty/handover/handover.test.mjs`：9/9
  - `npx tsc -p web --noEmit`：0 错
- 对交警的影响：手指更饱满。Carbon 原先给手指写的姿态（`buildOfficerRightGrip`、`plumpThumbsUpThumb`）要在新模型上重新看一遍：
  - 握旗时手指不能穿进旗杆；
  - 竖大拇指时，拇指不能被压扁成一片。

## 2. 唯一正确的调用顺序（Carbon 必须照抄）

玩家在 `web/src/walk/index.ts:340-421` 里是这样生成的，交警要一步不差地照搬：

```ts
const loaded = await characterModel(OFFICER_AVATAR)        // web/src/walk/character.ts:34，会顺带套用脸型和头发库
const fig = loaded.scene as THREE.Group
const rig = ensureAvatarRig(fig)                           // web/src/walk/avatar-rig.ts，统一朝 −Z、生成挂点
const outfit = styleCharacter(fig, rig, OFFICER_AVATAR)    // web/src/walk/character.ts:106，挂上描边、头发、五官和 starter 细节
outfit.applyEquipped(OFFICER_UNIFORM_OUTFIT, {ridingEbike: false, autoHelmetOnRide: false})  // 穿上制服（Neon 提供）
setCreatorExpression(fig, 'serious')                       // web/src/walk/creator-face.ts:267（Gemini 已落盘）
```

**红线：**

1. **禁止删除 creator 的任何节点。** `officer-look/index.ts` 里 `stripLegacyCharacterOverlays()` 要删掉的名单里，必须去掉这几项：`creator-body-outline`、`creator-outline`、`creator-hair`、`creator-face`。头发由大檐帽盖住，不能把头发删了再自己做一个。
2. **配件也走玩家的着色和描边：**
   - 新建的材质一律先过 `streetShading(mat, true)`（见 `web/src/walk/creator-ink.ts:4`）；
   - 网格一律 `addOutline(mesh, 0.004~0.008)`（见 `web/src/walk/creator-ink.ts:140`）；
   - 禁止使用法线贴图、高光贴图、metalness 大于 0.2 的材质。
3. **配件只留四样：** 对讲机、胸牌、白手套、哨链。手套要做成哑光白布手套，`#f2f2ee`，并加描边，不要做成银色金属。
4. **交警的待机姿势用玩家的 `idle` 动作做底，手势叠加在上面。** 动作片段在 `figure.glb` 里，walk 是靠 `model.animations.push(...source.animations)` 合进来的。现在交警左臂外张、肘部僵直，就是因为没有 idle 底。
5. **体型比例：** 交警缩放保持 `avatar.scale × 1.03`，比玩家高一点点就够了，别再额外拉长四肢。

## 3. 接口约定（并行开发的依据，谁也别改签名）

| 提供方 | 导出 | 位置 | 状态 |
|---|---|---|---|
| Neon | `OFFICER_UNIFORM_OUTFIT: EquippedOutfit`，包含 `top_traffic_police_shirt`、`bottom_police_trousers`、`hat_traffic_police_cap`，鞋可复用 `shoes_traffic_duty` | `web/src/game/catalog.ts:243`（制服三件套在 `NPC_ONLY_OUTFIT_ITEMS`）+ `web/src/walk/outfits.ts`（`vestMode`） | 已落盘（18:03），通过 |
| Gemini | `setCreatorExpression(root, 'neutral'\|'serious'\|'smile'\|'remind'\|'thumbs_up'): boolean` | `web/src/walk/creator-face.ts:267` | 已落盘（18:00） |
| Carbon | 消费以上两项；Neon 的接口到位之前，在本地写一个同签名的 stub 兜底 | `web/src/traffic-duty/npc-officer.ts`、`officer-look/` | 18:27 版已落盘：tsc 为 0，12.7k 面、9 个网格，v2 复审通过 |

## 4. 配色（Hy1 的 spec 出来后以 spec 为准；在那之前先用下面这组）

| 部位 | 色值 | 说明 |
|---|---|---|
| 衬衫主色 | `#9cc3e6` | 现在的浅蓝方向是对的，只需要换成平涂 |
| 衬衫袖口、领口 | `#1d2b45` | 藏青 |
| 裤子 | `#1a2233` | 和玩家执勤裤 `bottom_traffic_duty` 同一色系，稍微偏蓝 |
| 反光背心 | `#ccee1c` | 按 Hy1 spec：比志愿者的 `#d8ee1e` 略偏青绿，用来区分身份；绝不能用橄榄绿 |
| 背心反光条 | `#e8edf0` | 银白色 |
| 帽顶 | `#f4f5f2` | 白色 |
| 帽墙 | `#1d2b45` | 藏青 |
| 帽檐 | `#121417` | 黑色 |
| 手套 | `#f2f2ee` | 哑光 |
| 「桂林交警」字 | `#18253c` | 背后印四个大字（老板定稿），左胸配「交警」铭牌；都用 GLSL 叠层，不增加绘制调用 |

## 5. 预算与验收口径

- 节点结构上必须有：`creator-face`、`creator-hair`（可以被帽子遮住，但节点要在）、`creator-body-outline`。
- 三角面不超过 20k，绘制调用不超过 10。玩家目前是 11.3k 面、6 个网格；交警旧版是 17.1k 面、12 个网格。
- 6 个手势都不能穿模；握旗和竖大拇指要在新手指模型上复核。
- 和玩家同屏对照时：画风一致、肤色同一档、描边粗细一致。

## 6. 对照渲染工具（谁都可以跑，不碰 5176/4190）

```bash
cd /Users/pan-work/guilinol-xp-overnight/captures/duty-r10-officer-review
ESBUILD_BINARY_PATH=<本机 esbuild 二进制> bash render-review.sh v1
# 产出 v1-front / v1-q34 / v1-side / v1-back.png + v1-probe.json
# 画面从左到右：游戏里挂的交警 | 样板交警（纯玩家管线）| 玩家
```

脚本会自己起静态服务，跑完自动关闭。probe 会输出三个人的三角面数、网格数、是否有 creator 脸、头发、描边，以及身高；游戏里的交警如果运行时报错，错误会记在 `officerErr` 里，对照图照常出。

`review-entry.ts` 里的 `build()` 就是交警的最小正确实现，Carbon 可以直接照抄。逐人点评见 `/Users/pan-work/guilinol-xp-overnight/captures/duty-r10-officer-review/review.md`。

## 7. 错题本提醒（别再犯）

- k51：立绘里玩家头像偏暗、发灰，player 机位左手手指被拉长。Gemini 改立绘时要用新的手指模型复核。
- k51：line5 双人镜头必须真的拍进两个人。
- k59：e2e 截图要在姿态生效的窗口内抓拍。Hy2 拍表情和手势时，先锁定峰值帧再截图。
