## 角色创建（捏人）设计 · IDOK-133

Rock 2026-11-22: the default look should be simple. After registering, players enter a page where they
customise their character. Make the people look Chinese and dress them in what young people in China
actually wear today.

### 1. 外观方向

参考广西街头日常穿着。角色采用原创低多边形几何、两到三档平涂明暗和深色外轮廓（`#1f2326`）。描边仅用于角色，以背面外扩生成，身体宽约 1.5 cm，随距离自然缩小。四肢略壮，肩线圆润，头身比约 1:6.5。男、女约 1.72 m 和 1.62 m，女性略收腰、胯略宽、肩窄约一成。

- 脸部用贴合脸面的顶点色短线表现眼眉，嘴唇保留一小块唇色，鼻子用一小块阴影。圆脸、鹅蛋脸和方下颌通过面宽、下颌轮廓区分。
- 五档肤色为 `#f3d7bf`、`#e9c3a1`、`#dcb08a`（默认）、`#c99772`、`#a97b58`。发色为黑、深棕、栗棕和灰棕。
- 发型露出额头，侧面让开脸颊。男款为寸头、微分碎盖、纹理烫、渐变短发、狼尾和中分。女款为长直发、高马尾、低丸子头、锁骨发、短狼尾和齐刘海短发。每款用 300–600 个顶点组成闭合的低多边形发簇。
- 首套穿搭都不背包，颜色中低饱和，无品牌标识。

| 穿搭 | 男款 | 女款 |
| --- | --- | --- |
| 基础（默认） | 米白长袖、黑直筒裤、小白鞋 | 同男款 |
| 夏天街头 | 白背心、深灰短裤、人字拖 | 白 T 恤、牛仔短裤、凉鞋 |
| 短袖 T 恤 | 灰蓝素 T、卡其短裤、运动鞋 | 素 T、及膝半身裙、运动鞋 |
| 防晒衣 | 浅蓝连帽防晒衣、黑运动裤、运动鞋 | 浅粉防晒衣、阔腿裤、运动鞋 |
| 通勤 | POLO 衫、西裤、黑皮鞋 | 衬衫、西装裤、平底鞋 |
| 校服 | 蓝白运动校服 | 同男款 |

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
  while a hat is worn. Neither body has a built-in backpack. All starter outfits leave the bag slot empty.
  The 1.72 m and 1.62 m bodies use flat colours and a back-face outline. Face contours
  follow the selected jaw, with eyes, brows and lips fitted to its surface.
  Clothes keep the zone-recolour approach of `outfits.ts`; the women's skirt is its own mesh.
- Budget: each body ≤ 7k vertices, each hairstyle ≤ 600 vertices, all assets ≤ 450 KB added in total.
  The creation page is its own lazy-loaded chunk, so first-frame time on the tour home page stays
  ≤ 1.05× the current main branch.
