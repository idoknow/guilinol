## 角色创建（捏人）设计 · IDOK-133

Rock 2026-11-22: the default look should be simple. After registering, players enter a page where they
customise their character. Make the people look Chinese and dress them in what young people in China
actually wear today.

### 1. 外观方向（调研结论）

The current figure reads as Japanese mainly because of its anime-style bowl cut, its bangs and its
long, narrow face. New rules for the look:

- **Head and face**: a slightly rounder, flatter face; a low nose bridge; small, narrow eyes (single or
  inner double eyelids, no big anime eyes); straight brows. Hair has to be shaped like real
  hairstyles, not an anime helmet.
- **Skin, 5 tones** (warm, light-yellow to wheat): `#f3d7bf` `#e9c3a1` `#dcb08a` `#c99772` `#a97b58`.
  The default is the second tone.
- **Hair colour, 4 options**: black `#1b1a1a` (default), dark brown `#2e2219`, chestnut `#4a3022`,
  greyish brown `#5a4b44`.
- **Men's hairstyles (6)**: buzz cut, textured side-parted crop (微分碎盖), textured perm, short faded
  sides, wolf-cut mullet, middle part. These follow the 2025 men's hairstyle ranking: wolf-cut mullet,
  side-parted crop, textured perm, buzz cut.
- **Women's hairstyles (6)**: long straight black hair, high ponytail, low bun, collarbone-length hair,
  short wolf cut, short hair with blunt bangs.
- **Starter outfits (6)**. They follow the 2024–25 trends: city outdoor / shell jackets, athleisure,
  new Chinese style (新中式) and intellectual chic. No real brand logos.
  1. **基础** (default): plain off-white long-sleeve top, black straight trousers, white trainers. Nothing else.
  2. **运动休闲**: grey hoodie, black track pants with side stripes, running shoes.
  3. **城市户外**: shell jacket (muted green / khaki), cargo trousers, hiking shoes.
  4. **新中式**: men wear a stand-collar shirt with frog buttons plus straight trousers; women wear a
     cardigan with frog buttons plus a horse-face skirt (马面裙, a pleated skirt) and white trainers.
  5. **通勤知识风**: shirt with a knit vest and slacks; women may wear a long skirt.
  6. **校园**: white shirt or hoodie, light-blue jeans, canvas shoes.

  Colours stay mid-to-low saturation so the figure blends with the 青绿山水 (green-and-blue landscape)
  scenery and doesn't look like a cosplay outfit.

Sources: Xinhua and Beijing Youth Daily on new Chinese style and shell jackets (2025); Jing Daily, Gen Z
core trends 2025; the Maigoo 2025 men's hairstyle ranking.

### 2. 流程

```
注册 → 验证邮箱 → 【创建角色】 → 进场动画 → 游戏（出生点）
登录且无外形的老用户 → 首次进入游戏前弹一次【创建角色】（可跳过=默认外形）
我的账号 / 衣柜 → 「修改外形」→【创建角色】（编辑模式，不扣费）
```

Page steps (the tabs can be clicked in any order; the bottom primary button follows the step order):

1. **体型**: 男 / 女. Switching re-picks the matching default hairstyle and outfit.
2. **样貌**: skin tone (5), face shape (3: round / oval / square jaw), brows (3), eyes (3).
3. **发型**: 6 hairstyles plus 4 hair colours.
4. **穿搭**: the 6 starter outfits from above. These are free starter clothes. Shop items keep going
   through the existing wardrobe.
5. **确认**: shows the nickname (from registration). The 「进入桂林」 button finishes.

Global actions: 「随机」 (a random combination; the button spins once like a die), 「重置」, and 「跳过」
(the first-time creation only).

### 3. 界面

- **Desktop**: the left 60% is the stage and the right 40% is the panel. The stage background is a
  vertical gradient from pale mist green `#dfe8e3` to `#c9d8d2`, with a faint low-poly karst-hill
  silhouette at the bottom (8% opacity). The character stands on a light-grey disc platform.
- **Mobile (390×844)**: the stage is the top 52%. The bottom is a draggable sheet with icon tabs at
  the top and a 3-column option grid.
- **Option cards**: 3D thumbnails of the head or full body, rendered offline in the same visual style
  and generated into sprite sheets by the pipeline. The selected card gets a 2px `#20998d` border and
  a ✓.
- **Typography and colour**: follow `docs/ui.md`. Panel `#f7f5f0`, text `#2b3036`, primary button
  `#20998d`.
- **Camera**: the 体型 / 穿搭 tabs frame the full body. The 样貌 / 发型 tabs push in to a
  head-and-shoulders close-up (0.45 s ease-out). Dragging rotates the character, with inertia.
  Double-click resets the view.

### 4. 动效（全部 ≤ 400 ms，`prefers-reduced-motion` 时只保留淡入淡出）

| 时机 | 动效 |
|---|---|
| Entering the page | Stage fades in, camera dollies in 0.6 s. The character plays idle and turns 25° once to face the camera. Panel slides in from the right (from the bottom on mobile), 0.3 s. |
| Switching tabs | Option grid slides horizontally with a 180 ms crossfade. The camera move starts at the same time. |
| Choosing an option | Card scales 0.96 → 1 (120 ms). Changed part of the character: colour fades over 200 ms; a model swap (hair/clothes) pops 0.9 → 1.04 → 1 in 180 ms. Choosing an outfit plays a short glance-down "look at my clothes" pose (0.8 s). |
| Randomise | Die icon spins 360°. All slots switch in sequence, 60 ms apart. |
| Finishing | Character waves (new 1.2 s `wave` clip). The camera pulls out and the scene fades to white (0.6 s), then fades into the spawn point. |

### 5. 数据与接口

- `glol.avatar.v1`, saved in `player_saves` alongside the wardrobe:
  `{v:1, body:'m'|'f', skin:0..4, face:0..2, brows:0..2, eyes:0..2, hair:'m_buzz'|..., hairColor:0..3, look:'basic'|..., createdAt}`.
  A missing value means no character has been created yet, which triggers the first-time creation flow.
- Starter outfits map to the existing `EquippedOutfit`. They are default-owned and free, and they
  don't interfere with the shop's ownership logic.
- Rendering: the man and the woman are two base meshes (`figure_m.glb` / `figure_f.glb`) that **share
  the 66-bone skeleton**, so walk/idle/vehicle poses and `pipeline/avatar_walk.py` are reused directly.
  Hair is a separate rigid mesh attached to `attach_head`, the same mechanism as hats; it is hidden
  while a hat is worn. Face features are recoloured through vertex colours or swapped head meshes.
  Clothes keep the zone-recolour approach of `outfits.ts`; the women's skirt is its own mesh.
- Budget: each body ≤ 7k vertices, each hairstyle ≤ 900 vertices, all assets ≤ 450 KB added in total.
  The creation page is its own lazy-loaded chunk, so first-frame time on the tour home page stays
  ≤ 1.05× the current main branch.
