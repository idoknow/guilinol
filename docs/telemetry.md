# 网上桂林性能遥测

浏览器向同源的 `POST /api/t` 发送 JSON。默认全量采样，构建时通过 `VITE_TELEMETRY_SAMPLE_RATE` 设为 0–1。会话标识是每次打开页面生成的 UUID。每 30 秒发送一次，切到后台或离开页面时补发。单批 UTF-8 正文上限 3900 B，服务端流式拒绝超过 4096 B 的请求。每个来源 IP 每分钟最多 90 批。成功返回 204，格式错误返回 400，跨域返回 403，超限返回 413 或 429。

| 字段 | 含义和单位 |
| --- | --- |
| sid / context / rows | 本次访问的随机标识、设备与版本信息、事件列表 |
| build / world / quality | version.json 的 Git SHA、实际 manifest 字节的 SHA-256、渲染档位（当前固定 default） |
| device / os / browser / gpu | mobile 或 desktop、系统与浏览器类别、WebGL 公开的渲染器名 |
| memory / cores / width / height / dpr | 浏览器提供的内存档位 GiB、逻辑处理器数、屏幕 CSS 像素和像素比 |
| effectiveType / rtt / downlink | 浏览器提供的连接类型、估计 RTT 毫秒、估计下行 Mbps |
| navigation | dns、tcp、tls、ttfb 为阶段耗时 ms，dcl、load 为自导航起点算起的 ms |
| firstFrame / playable | 首帧提交、角色或相机可操作且附近目标瓦片均已加入场景的时间，距导航起点 ms |
| resource | 分类 manifest、chunk、landmark、basis、other。count 为请求数、bytes 为传输字节总和、cache 为 transferSize 等于 0 的比例、p50/p95 为批内请求耗时 ms。能读到响应头时按 cfCache 单列 |
| window | 10 秒窗口的 fps、frameP95（ms）、longFrames（大于 50 ms）、calls、triangles、geometries、textures、chunks、heap（字节） |
| chunk / teleport / switch / mapOpen / api | 请求至瓦片加入场景、传送、切换模式、地图首次绘制、API 资源请求耗时 ms。api 标记 login、feedback 或 other |
| error / contextLost | JS 错误或未处理的拒绝、WebGL context 丢失事件数 |
| mode / grid | walk、drive、fly、map、menu；地图投影的 x、z 各除以 250 m 向下取整，拼为两个整数。chunk 使用瓦片位置 |
| country / region / city / isp | 服务端最长前缀匹配结果；未覆盖的地区为空，国家可回退到可信 Cloudflare 对端的 CF-IPCountry |

请求体字段采用白名单。事件表不含用户账号、原始 IP、页面 URL、错误文本或精确相机坐标。IP 用于离线前缀查询和每分钟清空的内存限流表，限流键为进程随机密钥的 HMAC。原始事件保留 90 天。每日按 UTC 日期、world、device、kind 持久化样本数及主指标分位数，长期保留。服务端分钟汇总亦长期保留。

## 管理员查询

使用现有管理员会话 Cookie。时间参数 from（含）、to（不含）使用带时区的 ISO 8601，默认最近 24 小时，最长 90 天。响应为 JSON 对象，数组字段为 items。管理页 `/admin/?view=perf` 显示设备维度的原始结果。

| GET 路径 | 参数与结果 |
| --- | --- |
| /api/admin/perf | group 为 region、isp、device、gpu、build、world、mode，默认 device。metric 默认 fps，支持 frameP95、chunk、playable、firstFrame、teleport、switch、mapOpen、api、resource、dns、tcp、tls、ttfb、dcl、load、calls、triangles、geometries、textures、chunks、heap、longFrames、error、contextLost。resource.p50/p95/cache/bytes/count 查询各类资源批内值，api.login/feedback/other 按操作查询耗时。返回 label、samples、p50、p75、p95。样本是事件，resource 的样本是批内 p95 |
| /api/admin/perf/grid | 可按 world 精确筛选。返回 grid、visits（去重会话数）、fps_p50、chunk_p95（ms） |
| /api/admin/perf/server | 返回 minute 与 sample。routes 分路由模板和状态码记录 count、errors（HTTP ≥400）、p50/p95/p99（ms，直方图近似）。cpuCores 为进程占用核数，rss、heap、cgroupMemory 为字节，cgroupCpuUsec 为累计微秒，loopP99、pgP95、poolWaitP95 为 ms，poolWaiting 为采样时等待数，load 为 1/5/15 分钟负载，nginx 为当前连接数和累计请求数 |

## 自托管与验收

部署脚本对现有 PostgreSQL 执行幂等迁移 `deploy/postgres/002-telemetry.sql`。nginx 的 stub_status 监听同一 Pod 网络空间的 loopback:8081，API 每分钟采样。无需新增常驻容器。

离线 IP 目录存放在 PostgreSQL。准备已授权的 UTF-8 CSV，列为 prefix（IPv4/IPv6 CIDR）、country（两位国家码）、region（省）、city、isp。若已有经典 IPv4 v2 ip2region XDB（五列地区字段），运行 `python3 deploy/postgres/ip2region_csv.py ip2region.xdb > networks.csv` 可转换为该格式。在目标 glol 数据库上用 psql 的 `-X -v ON_ERROR_STOP=1 -f deploy/postgres/import-perf-network.sql < networks.csv` 导入。替换操作在同一事务内完成。首次导入前，省、市和运营商为空。

本地使用当前 world 发布包构建 dist。运行 `npm test`、`npm run check:api`、`npm run verify:telemetry`。端到端验收启动临时 PG、API、静态站和 Chromium，检查匿名鉴权、三个测试网段的匹配、步行与飞行、批次尺寸和三个管理员查询。仅检查浏览器数据契约可运行 `npm run verify:telemetry -- --browser-only`。
