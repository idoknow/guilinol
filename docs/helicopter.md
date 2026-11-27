# 观光直升机资产接口

## 联机乘客校验

RT 每秒读取一次已确认的航班（`helicopter_queue` 关联登录 UID），不按位置包查询数据库。放行范围是服务端时钟对应的一小段三维航迹，含座位相对机身的偏移；不是整条航线或整个高空。没有座位的 `passenger` 声明不能授权移动。读库超时仍拒绝异常位置，但 `flight_unverified` 不计入自动封禁。观光排队心跳走 HTTP，机上的位置上报沿用原 WebSocket 节拍。

RT 镜像只包含 `rt/`。修改路线、高程或航班时钟后，运行 `node --import tsx scripts/bake-rt-flight.mjs` 同步 `rt/flight-paths.json`，再运行 `node rt/anti-cheat-test.mjs`。实乘检查：`npm run world:dev && npm run build && CHROMIUM=/usr/bin/chromium HELI_QUICK=1 HELI_RT_AUDIT=1 node scripts/heli-e2e.mjs`，使用本地临时账号、Postgres 和真实航班时钟，输出事件计数与下机前后 30 秒最大发包数。

机头沿本地 +Z，+Y 朝上，+X 为驾驶员左侧，单位为米。三个 GLB 共用原点及挂点。Vite 从仓库根目录的 `public/models/` 提供下列资产。

| 距离 | 模型 URL | 三角面 |
| --- | --- | ---: |
| 0–60 m，含蒙皮驾驶员和内饰 | `/models/helicopter_tour.glb` | 233,572 |
| 60–250 m，外观 | `/models/helicopter_tour_lod1.glb` | 6,484 |
| 250 m 以外，轮廓 | `/models/helicopter_tour_lod2.glb` | 1,280 |

## 运行时挂点

通过 `scene.getObjectByName(name)` 获取节点。下表中的坐标以 `airframe` 为基准。将节点的世界矩阵转换到角色父级的局部空间后，再驱动角色。

| 节点 | 用途 |
| --- | --- |
| `rotor_main` / `rotor_tail` | 主旋翼绕本地 Y、尾桨绕本地 X。叶片和桨毂随节点一起旋转。 |
| `rotor_blur_main` / `rotor_blur_tail` | 分别与上述节点同轴同心。加载后在首次渲染前隐藏两个盘节点。巡航高速显示盘并隐藏对应桨叶，减速时切回。 |
| `door_L` / `door_R` | 后排舱门的前缘铰链，关门时 rotation.y 为 0。左门开至 −1.38 rad，右门开至 +1.38 rad（约 79°）。舷窗、把手与门板共享枢轴。 |
| `step_L` / `step_R` | 左右踏板顶面中心，y = 0.56。 |
| `seat_pilot` | 前排右座的骨盆落点 (−0.52, 1.32, 0.84)。LOD0 自带驾驶员。 |
| `seat_pax_1` / `seat_pax_2` / `seat_pax_3` | 骨盆落点，+Z 朝前。依次为前左、后左、后右，y 均为 1.32。 |
| `hand_rest_pax_{1,2,3}_{L,R}` | 每个座位左右扶手顶面，供手掌 IK 使用。 |
| `cam_pax_1` | 前左座眼位 (0.52, 2.04, 0.90)。Three.js 相机默认看 −Z，初始朝向需对准机头 +Z。 |
| `skid_contact` | (0, 0, 0)，与滑橇底部同高的地面参考点。 |
| `nav_left` / `nav_right` / `nav_tail` / `nav_beacon` | 左红、右绿、尾白、顶部红色防撞灯。LOD2 保留挂点。 |

### 门与座位

三档模型的门节点都有 `extras.seats`，Three.js 加载后可读 `door.userData.seats`。门绕本地 Y 轴旋转。每个座位的本地 +Z 都沿机头方向。

| 门节点 | 座位节点 | 位置 | 开门弧度 |
| --- | --- | --- | ---: |
| `door_front_L` | `seat_pax_1` | 左前副驾 | −1.38 |
| `door_front_R` | `seat_pilot` | 右前驾驶员 | +1.38 |
| `door_L` | `seat_pax_2` | 左后乘客 | −1.38 |
| `door_R` | `seat_pax_3` | 右后乘客 | +1.38 |

### 桨叶与模糊盘

`rotor_main_blade_1..4` 和 `rotor_tail_blade_1..2` 分别是主、尾旋翼的直接子节点，枢轴在桨根。局部 +X 沿翼展向外，绕局部 Z 轴可做挥舞。请在加载时保存初始四元数，并在它之后乘以局部旋转。模糊盘随 GLB 内嵌高速贴图。中速和高速 PNG 分别为 `helicopter_blur_{main,tail}_{medium,high}.png`，与 GLB 同目录；四张图都使用直通 Alpha，UV 中心为轮毂。LOD0 用 EXT_meshopt_compression 压缩，未配置解码器的 GLTFLoader 可读取同一 GLB 内的回退数据。

LOD0 从 `public/avatar/figure.glb` 复制 Walker 的蒙皮、骨架和通用手指，使用原有 drive 坐姿。用机体场景作为 AnimationMixer 的根，在 `pilot_idle`、`pilot_startup`、`pilot_cruise`、`pilot_landing` 间交叉淡化。启动动作右手伸向开关后回握，建议单次播放，待机和巡航可循环。驾驶员和控制杆已经对位，无需再实例化 NPC。

## 重建与检查

在仓库根目录执行，PATH 需包含 gltfpack 1.0。铭文烘焙使用本机 Noto Sans CJK Regular 或 macOS 黑体，项目青绿腰线取自漓江水色 `#6c9c97`。字形随所选字体而异。

```sh
uv sync --locked
uv run --locked python pipeline/helicopter_tour.py
uv run --locked python pipeline/check_helicopter.py
```

在已安装 Chrome 的环境执行 `npm ci` 后运行 `node pipeline/helicopter_preview.mjs`，七个真实 GLB 视图（含桨尖近景和深色背景双旋翼高速档）输出到 `pipeline/helicopter_views/`。
