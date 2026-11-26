# 桂林十字街地下商业街 B1 · 材质贴图与合规来源清单

- **源码模块**：[web/src/shizijie/look/](../../src/shizijie/look)
- **版权规范**：严格执行 [docs/style.md](../../../docs/style.md)、[docs/refpack.md](../../../docs/refpack.md) 与 [docs/shizijie/idok-385-method.md](../../../docs/shizijie/idok-385-method.md) 红线——百度全景与 B 站视频帧**仅本地读配色、尺度与构造，绝不裁切入库**；仅收编 `CC0` Wikimedia 参考图及 **100% 程序化原创 `CC0-1.0` PBR 与 `wayfinding` 数据驱动灯箱图集**，**零现实商业品牌商标**。

## 一、资源预算与图集控制

- 招牌/导视图集张数：**2 张**（`atlas <= 2 sheets`：`atlas-signs-albedo.png` 1024×512 + `atlas-wayfinding-albedo.png` 1024×512，均为 1:1 像素密度自发光共享贴图）
- `web/public/shizijie` 打包资产占用：**1,927,774 B（1.84 MiB <= 8 MiB）**
- 纹理 GPU 显存总计：raw **6,250,496 B（5.96 MiB）** / mipmapped **8,334,007 B（7.95 MiB <= 8 MiB）**
- 实拍参考底图：`refs/` 下 5 张 Wikimedia CC0/PD 地标图（仅归档留存，运行时不上传 GPU）。

## 二、贴图资产清单

| 文件 | 分类 | 尺寸 | 硬盘 (B) | GPU Mip (B) | 协议 | 说明 |
|---|---|---|---:|---:|---|---|
| [textures/atlas-signs-albedo.png](./textures/atlas-signs-albedo.png) | `atlas-albedo` | 1024×512 | 292,959 | 2,796,203 | `CC0-1.0` | 十字街地下街 30 槽位高反差降饱和 1:1 原创店招/出口/防滑合批图集（含亮黄警示防滑牌、逃生人像与防渗边距） |
| [textures/atlas-wayfinding-albedo.png](./textures/atlas-wayfinding-albedo.png) | `atlas-wayfinding` | 1024×512 | 95,101 | 2,796,203 | `CC0-1.0` | 数据驱动天花板悬挂多栏灯箱图集（1024×512 128px行高 400px/m，全高超粗纯白汉字+42×宽距数字+2栏自适应排布） |
| [textures/tile-terrazzo-albedo.png](./textures/tile-terrazzo-albedo.png) | `albedo` | 256×256 | 104,247 | 349,526 | `CC0-1.0` | 老区环廊抛光紧实柔边盐椒花水磨石地砖（含 1px 骨料间细矿物点噪） |
| [textures/tile-terrazzo-normal.png](./textures/tile-terrazzo-normal.png) | `normal` | 128×128 | 8,666 | 87,382 | `CC0-1.0` | 水磨石深砖缝、板块微倾阶跃与骨料法线 |
| [textures/tile-terrazzo-roughness.png](./textures/tile-terrazzo-roughness.png) | `roughness` | 64×64 | 3,645 | 21,846 | `CC0-1.0` | 半抛光地面低粗糙度贴图（0.11..0.19 砖面 vs 0.78 砖缝） |
| [textures/tile-corridor-albedo.png](./textures/tile-corridor-albedo.png) | `albedo` | 256×256 | 89,279 | 349,526 | `CC0-1.0` | 主通道抛光芝麻灰盐椒花岗岩方砖（细灰拼缝+高对比斑晶） |
| [textures/tile-corridor-normal.png](./textures/tile-corridor-normal.png) | `normal` | 128×128 | 4,533 | 87,382 | `CC0-1.0` | 走廊花岗岩板块微倾与沟缝法线贴图 |
| [textures/tile-corridor-roughness.png](./textures/tile-corridor-roughness.png) | `roughness` | 64×64 | 2,891 | 21,846 | `CC0-1.0` | 走廊抛光石砖低粗糙度反射贴图（0.10..0.17） |
| [textures/ceiling-grid-albedo.png](./textures/ceiling-grid-albedo.png) | `albedo` | 256×128 | 4,733 | 174,763 | `CC0-1.0` | 银白拉丝铝合金吊顶主板与纤细稀疏条形嵌灯（占比约 10.6%，去除黑框方块感） |
| [textures/ceiling-grid-emissive.png](./textures/ceiling-grid-emissive.png) | `emissive` | 256×128 | 293 | 174,763 | `CC0-1.0` | 纤细条形嵌灯柔和自发光遮罩（占比约 10.6%） |
| [textures/ceiling-grid-roughness.png](./textures/ceiling-grid-roughness.png) | `roughness` | 64×64 | 3,316 | 21,846 | `CC0-1.0` | 铝扣板半哑光与灯框压条粗糙度贴图 |
| [textures/light-strip.png](./textures/light-strip.png) | `albedo` | 64×32 | 227 | 10,923 | `CC0-1.0` | 门楣灯槽柔和自发光灯带渐变贴图 |
| [textures/shutter-silver-albedo.png](./textures/shutter-silver-albedo.png) | `albedo` | 128×256 | 8,578 | 174,763 | `CC0-1.0` | 镀锌银灰波纹卷帘门（底部含橡胶封条与锁盒） |
| [textures/shutter-cream-albedo.png](./textures/shutter-cream-albedo.png) | `albedo` | 128×256 | 8,781 | 174,763 | `CC0-1.0` | 暖米灰烤漆波纹卷帘门（底部含封条与锁盒） |
| [textures/shutter-normal.png](./textures/shutter-normal.png) | `normal` | 64×128 | 503 | 43,691 | `CC0-1.0` | 卷帘门弧形波纹法线贴图（0 重复上传） |
| [textures/shutter-roughness.png](./textures/shutter-roughness.png) | `roughness` | 64×128 | 225 | 43,691 | `CC0-1.0` | 卷帘门金属拉丝粗糙度（0 重复上传） |
| [textures/stair-granite-albedo.png](./textures/stair-granite-albedo.png) | `albedo` | 256×256 | 35,664 | 349,526 | `CC0-1.0` | 梯井侧墙与下部 1.04m 廊道深青灰纹路花岗岩护墙裙 |
| [textures/stair-granite-roughness.png](./textures/stair-granite-roughness.png) | `roughness` | 64×64 | 4,876 | 21,846 | `CC0-1.0` | 半抛光深花岗岩墙裙与梯壁粗糙度贴图 |
| [textures/stair-tread-albedo.png](./textures/stair-tread-albedo.png) | `albedo` | 128×256 | 14,608 | 174,763 | `CC0-1.0` | 28级踏步花岗岩与降饱和防滑警示前缘 |
| [textures/stair-tread-normal.png](./textures/stair-tread-normal.png) | `normal` | 64×128 | 12,563 | 43,691 | `CC0-1.0` | 楼梯防滑沟槽法线贴图 |
| [textures/wall-corridor-albedo.png](./textures/wall-corridor-albedo.png) | `albedo` | 256×256 | 13,677 | 349,526 | `CC0-1.0` | 地下上半墙暖白无机矿物质饰面与 1.4m 竖向勾缝（直接搭配 1.04m 深石材 dadoSpecs 使用） |
| [textures/wall-corridor-normal.png](./textures/wall-corridor-normal.png) | `normal` | 64×64 | 8,781 | 21,846 | `CC0-1.0` | 墙面矿物质细腻灰泥、竖缝与不锈钢腰线凹凸法线 |
| [textures/wall-corridor-roughness.png](./textures/wall-corridor-roughness.png) | `roughness` | 64×64 | 2,732 | 21,846 | `CC0-1.0` | 墙体哑光无机漆与拉丝不锈钢腰线粗糙度 |
| [textures/canopy-glass-albedo.png](./textures/canopy-glass-albedo.png) | `albedo` | 64×64 | 2,467 | 21,846 | `CC0-1.0` | 四角梯井斜坡雨棚灰蓝夹胶玻璃纯不透明RGB基准色 |

## 三、Wikimedia CC0 / PD 保留参考照片（仅归档）

- [refs/wikimedia-cc0-nanfang-plaza.jpg](./refs/wikimedia-cc0-nanfang-plaza.jpg) · `CC0` · https://upload.wikimedia.org/wikipedia/commons/9/9b/%E6%A1%82%E6%9E%97%E5%8D%97%E6%96%B9%E5%A4%A7%E5%8E%A6.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- [refs/wikimedia-cc0-weixiaotang-plaza.jpg](./refs/wikimedia-cc0-weixiaotang-plaza.jpg) · `CC0` · https://upload.wikimedia.org/wikipedia/commons/8/8d/%E5%A4%A7%E5%95%86%E9%9B%86%E5%9B%A2%E6%A1%82%E6%9E%97%E5%BE%AE%E7%AC%91%E5%A0%82%E5%95%86%E5%8E%A6.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- [refs/wikimedia-cc0-wangcheng-plaza.jpg](./refs/wikimedia-cc0-wangcheng-plaza.jpg) · `CC0` · https://upload.wikimedia.org/wikipedia/commons/4/4c/%E6%A1%82%E6%9E%97%E7%8E%8B%E5%9F%8E%E5%95%86%E5%8E%A6_01.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- [refs/wikimedia-cc0-dongxi-alley-09.jpg](./refs/wikimedia-cc0-dongxi-alley-09.jpg) · `CC0` · https://upload.wikimedia.org/wikipedia/commons/a/af/%E6%A1%82%E6%9E%97%E4%B8%9C%E8%A5%BF%E5%B7%B7_09.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- [refs/wikimedia-cc0-dongxi-alley-10.jpg](./refs/wikimedia-cc0-dongxi-alley-10.jpg) · `CC0` · https://upload.wikimedia.org/wikipedia/commons/6/69/%E6%A1%82%E6%9E%97%E4%B8%9C%E8%A5%BF%E5%B7%B7_10.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original

## 四、纯色/风格参考源索引（未入库）

- `baidu_shizijie_center_S` · `Proprietary (Baidu Map Street View; visual reference only, NOT redistributed)` · https://map.baidu.com/?panoid=0900680012230602155105882AV
- `baidu_jiefang_west` · `Proprietary (Baidu Map Street View; visual reference only, NOT redistributed)` · https://map.baidu.com/?panoid=0900680012230602170749135AV
- `baidu_jiefang_east_E` · `Proprietary (Baidu Map Street View; visual reference only, NOT redistributed)` · https://map.baidu.com/?panoid=09006800121806201057502578A
- `baidu_nw_nanfang` · `Proprietary (Baidu Map Street View; visual reference only, NOT redistributed)` · https://map.baidu.com/?panoid=0900680012230602170738643AV
- `baidu_ne_zhengyang` · `Proprietary (Baidu Map Street View; visual reference only, NOT redistributed)` · https://map.baidu.com/?panoid=0900680012230603085845305AV
- `baidu_se_wenhua_W` · `Proprietary (Baidu Map Street View; visual reference only, NOT redistributed)` · https://map.baidu.com/?panoid=09006800121806051002338908A
- `baidu_sw_weixiaotang` · `Proprietary (Baidu Map Street View; visual reference only, NOT redistributed)` · https://map.baidu.com/?panoid=0900680012230602170113610AV
- `baidu_zhengyang_north` · `Proprietary (Baidu Map Street View; visual reference only, NOT redistributed)` · https://map.baidu.com/?panoid=09006800121806201054135408A
- `bilibili_BV1GuW9zJEQT_03:52` · `Reference-Only (Bilibili User Video Videoshot; visual proportion reference only, NOT redistributed)` · https://www.bilibili.com/video/BV1GuW9zJEQT
- `wikimedia_Xiufeng_panoramio_4` · `CC BY 3.0` · https://upload.wikimedia.org/wikipedia/commons/c/c2/Xiufeng%2C_Guilin%2C_Guangxi%2C_China_-_panoramio_%284%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- `wikimedia_East_West_Alley_49041010817` · `CC BY 2.0` · https://upload.wikimedia.org/wikipedia/commons/9/93/East-West_Alley_89748-Guilin_%2849041010817%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
