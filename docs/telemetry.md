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

离线 IP 目录存放在 PostgreSQL。准备已授权的 UTF-8 CSV，列为 prefix（IPv4/IPv6 CIDR）、country（两位国家码）、region（省）、city、isp。运行 `python3 deploy/postgres/ip2region_csv.py ipv4_source.txt > networks.csv` 可把 ip2region 的 IPv4 起止地址范围转换为该格式。在目标 glol 数据库上用 psql 的 `-X -v ON_ERROR_STOP=1 -f deploy/postgres/import-perf-network.sql < networks.csv` 导入。替换操作在同一事务内完成。首次导入前，省、市和运营商为空。

本地使用当前 world 发布包构建 dist。设置 `IP2REGION_SOURCE` 为实际 IPv4 数据文件的路径。若已设置 `DATABASE_URL`，验收脚本在该连接上创建独立的临时 schema 并在退出时删除；自托管 API 测试还会启动本机的 MinIO（可用 `MINIO_BIN` 指定可执行文件）。未提供连接时使用临时 Docker 服务。运行 `npm test`、`npm run check:api`、`npm run verify:telemetry`。端到端验收启动临时 PG、API、静态站和 Chromium，检查匿名鉴权、三条真实 IPv4 范围的省份和运营商匹配、步行与飞行、批次尺寸和三个管理员查询。仅检查浏览器数据契约可运行 `npm run verify:telemetry -- --browser-only`。


## 大陆探针

两份 CronJob 分别调度到广州和上海节点，每 15 分钟访问首页、manifest、五个固定 chunk 和 `GET /api/health`。健康检查仅确认 API 进程可应答。每个请求记录 DNS、TCP、TLS 阶段耗时、从开始到首字节及总耗时（ms），保留 HTTP 状态码，连接失败记为 0。每轮用 Pod UID 作为批次会话标识。探针通过同源接收接口上报 `context.source=probe`、节点名与八条事件，管理员可查询 `metric=probe.total`、`probe.ttfb`、`probe.dns`、`probe.tcp` 或 `probe.tls`，按 `group=node` 或 `group=target` 查看节点和目标的分布。浏览器继续加载现有 Umami，游戏遥测只发往本站。

## 会话、可靠性与漏斗

匿名浏览器上下文增加随机 UUID `vid`、首次访问 UTC 日期 `firstDay`、本次打开是否复用已存访客 ID 的 `returnVisit`（0/1）、主语言 `language`、来源类别 `referrer`（direct/search/social/internal/other）、`maxTextureSize` 和 0/1 的 `webgl2`。访客 ID 存在 localStorage 中，清除存储后生成新 ID。拒绝存储时仍采集会话。服务端按接收时间分桶。

| rows[].kind | 字段及口径 |
| --- | --- |
| session | 切后台和 pagehide 时的累计快照。total、visible 和 walkSeconds/driveSeconds/flySeconds/mapSeconds/menuSeconds 单位为秒。对应的 *Meters 为每秒采样位置的水平移动距离。teleports、mapOpens、grids 分别为传送、打开地图和不同网格数。计算时长取每个会话在区间内最后一份快照。 |
| vitals | lcp、fcp、inp 单位 ms，cls 无单位。隐藏时输出浏览器支持且已观测的指标。INP 取已观测交互最大耗时的第 98 百分位，CLS 取最大布局偏移窗口。 |
| failure / retry | 每次失败或重试一条，category 为 chunk/landmark/manifest。主动取消加载不计失败。 |
| error | count、errorKind（error/rejection/webgl/chunk）及 8 位十六进制 signature。签名只使用文件名和行号。没有来源位置时，同种错误合并为一组。 |
| funnel | step 为 loginOpen/loginSuccess/feedbackOpen/feedbackSuccess。首次可操作复用 playable 事件。 |

## 新版管理接口

路径前缀为 `/api/admin/`，GET 使用管理员会话，POST 同时需要同源 Origin。未登录返回 401，普通用户返回 403；错误体为 `{"error":{"code":"…","message":"…"}}`。统计接口的 from、to 沿用上文的半开区间。服务端时间为 ISO 时间字符串，账户和审计的 created_at 为 Unix 秒。

| 路径 | 参数 | 成功响应 |
| --- | --- | --- |
| overview | from,to | 每个 KPI 为一个键，对应 {current,previous}；previous 为前一等长区间。计数缺省 0，无样本的分位数或比率为 null。 |
| timeseries | from,to,metric,bucket,group | [{t,value,samples}]，t 为 UTC 桶起点，无样本桶省略。bucket 取 5m/1h/1d，默认 1h。group 为 device/region，设置后每行多一个 group，按区间样本量保留前六组。注册、反馈和服务端指标缺少设备和地区信息，分组查询时归入 unknown。 |
| breakdown | from,to,dim,metric | [{label,samples,sessions,p50,p95}]。dim 为 region/city/isp/device/os/browser/gpu/build/language/referrer/mode，缺省 device。metric 使用性能指标及分位后缀，缺省 fps.p50。两个分位数均返回。 |
| funnel | from,to | [{step,sessions}]，固定五步，按触发过该步的会话独立去重，包含零计数。 |
| errors | from,to | [{kind,signature,build,count,sessions,first,last}]，按次数降序取前 50 个签名与版本组合。旧的无签名事件只计入错误率。 |
| live | 无 | {online,modes,regions,server}。最近五分钟按每个会话最后的状态归类；modes/regions 含 mode、region、level 和人数 n。server 为 {minute,sample,errors5xx} 或 null，sample 字段同 perf/server。 |
| users | role,q,cursor | role 可传 admin 或 user。返回 {items,next_cursor}。 |
| POST users/:id/role | JSON {role} | {id,role}。仅可修改已验证邮箱，unverified/self_demotion/last_admin 返回 409。唯一管理员降级优先返回 last_admin。 |
| audit | cursor,target_type,target_id | {items,next_cursor}，每页 50 条，按 id 降序。每项含 id、actor_id、action、target_type、target_id、detail、created_at。action 为 role/status/start_ai/reply，detail 分别含 role、from/to、from/to、空对象。 |
| feedback/:id | 无 | 管理详情增加 allowed_transitions，每项为 {status,label,needs_message}。need_info/rejected/duplicate 要求说明；批准后由桥接进程入队。非法转换返回 409。 |
| stats | 无 | {total,verified,new_24h,feedback,pending}。feedback 为所有状态的计数，pending 为 submitted 加有未读用户消息的 need_info。 |

overview 和 timeseries 的 KPI 为 online、visitors、newVisitors、returnRate、sessions、durationAvg、durationP50、playableP50、playableP95、fpsP50、chunkP95、errorRate、contextLost、api5xxRate、registrations、feedback。online 为区间末五分钟内出现的会话数；无结束快照的会话参与会话计数。首次生成 ID 的会话计入新访客，回访率取区间内复用已存 ID 的去重访客数除以访客数；同日再次打开也算回访。旧版缺少 returnVisit 时按 UTC 日期判断。errorRate 按会话，api5xxRate 按请求，比例均为 0–1。timeseries 也支持上述 perf 表中所有 metric 及 lcp/cls/inp/fcp，追加 .p50 或 .p95 后缀，例如 api.login.p95。

按序执行 002 和幂等的 003-admin.sql。旧事件仍可用于已有指标；历史缺失的访客、会话快照、错误签名和管理员动作均无法追溯。审计从迁移开始记录，与实际写操作在同一事务提交。

加载失败和重试计数可在 timeseries 用 failure.chunk、failure.landmark、failure.manifest、retry.chunk、retry.landmark、retry.manifest 查询。会话各累计字段的性能分布可用 session.<字段>.p50 或 .p95。WebGL 能力字段在浏览器上下文内。确认开始 AI 制作仍写 approved，桥接脚本中继后写 queued。

003 迁移会从既有服务端分钟记录的 routes 自动计算请求总数和 5xx 总数。服务端自动回填已结束 UTC 日的 perf_session_day、perf_value_day；同一日的标记与摘要在一个事务中提交。概览、按设备/地区拆分及按日的 fps、playable、chunk 使用会话去重和按数值计数的分布做精确线性分位插值。半天区间、未完成回填的天以及其他维度查询原始事件。90 天的对照区间可能早于原始数据保留期。查看 500 万行 HTTP 验收的实测响应、时延和 PostgreSQL EXPLAIN 可运行 `node --import tsx scripts/analytics-bench.mjs plans.json`，需要与 verify:telemetry 相同的临时 PostgreSQL 环境。
