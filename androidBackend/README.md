# Android 内置网易云 API

此目录提供独立于 Electron 的 Node 入口。只允许 Folia 网易云 transport 实际调用的路由；不启动上游的 CLI、Express server 或 main.js，不加载所有在线平台依赖，不提供通用代理、上传或解锁服务。

## 原生对接契约

- 用 Node **18.20.4** 调用 `index.cjs`。参数：`[node, <私有目录>/nodejs-project/index.cjs, <SecureRandom 生成的 64 位 hex token>]`。
- 固定监听 `127.0.0.1:39843`；端口占用时失败，不改绑 LAN，不偷偷连接已有服务。
- 所有请求，包括健康检查，都要求 `X-Folia-Token: <token>`。比较使用 `timingSafeEqual`；token 不落盘、不写日志、不进入 URL。
- `GET /health` 返回 HTTP 200 和 `{ status: 'starting' | 'running' | 'error', node, apiVersion, error, host, port }`。HTTP 200 **仅代表进程可达**，使用音乐 API 前要等 `status === 'running'`。初始化失败后 `POST /restart` 返回 202、异步重新初始化。
- 其余音乐路由与 `src/services/onlineMusic/netease/netease.ts` 的 JSON 契约一致。启动未完成时返回 503，未登记路由 404，错误 token 401。
- 请求从 `CapacitorHttp.request` 发起，不全局替换 WebView fetch。服务不为任意浏览器源开启 CORS。账号 cookie 当前仍由 Folia 原有 transport 放入 query，**不要记录请求 URL**。
- 设置 `FOLIA_DATA_DIR` 为应用私有持久目录；匿名 token、xeapi 公钥写在那里。入口会把 `TMPDIR/TMP/TEMP` 指向同一目录，因为上游按 `os.tmpdir()` 寻找这些文件。应用清数据后凭据缓存丢失属预期。
- 同一 Node VM 只创建一个 backend。native 管理线程与进程生命周期；JS 没有远程关闭接口。

## 打包

在主项目 `npm ci` 完成后运行（不另装依赖）：

```powershell
node androidBackend/pack.mjs
```

产物固定为 `androidBackend/assets/nodejs-project/`。原生构建应把**目录内的内容**作为 `nodejs-project` 资源复制。每次执行仅清理带有本脚本专用 manifest 的精确输出目录，再从当前安装树重建，避免陈旧文件混入。

脚本从主项目锁定的安装树复制网易核心的 121 个 JS 依赖包（实际清单见产物 `runtime-manifest.json`），不带 Electron、前端或其它平台依赖。上游包自身原文件保留，但只提供 allowlist 中的 handler，不加载 main/server。它的依赖声明虽然写 Node >=12，完整 CLI 的 yargs 18、上传链的 music-metadata 11 并不适合这个 Node 18 目标；因此不能用完整上游 require/main/server 替换这个入口。optional native canvas 不随 Windows 宿主打入 Android。

复用而非重写 major 的修复：

- `neteaseApiStartup.cjs`：xeapi 公钥缓存/刷新、匿名 token 刷新、IP 策略、二维码网络重试、二维码错误透传。
- `neteaseLoginIdentity.cjs`：二维码连接重置后在下一轮更新设备身份。
- 对应纯 Node 支持文件由 pack 脚本复制，不依赖 Electron APIs。

`/song/url/v1` 使用相同的网易 `/api/song/enhance/player/url/v1` xeapi 数据映射，绕开上游 handler 无条件加载的 `unblockmusic-utils`；只保留 Folia 当前使用的 standard/exhigh/lossless/hires，不提供 sky/vivid 或解锁。`freeTrialInfo` 与原回答保持一致，VIP/地区权限不绕过。

## 验证与边界

```powershell
<node18.20.4> androidBackend/compatibility.cjs
<node18.20.4> androidBackend/smoke.cjs --packed
```

- compatibility：无联网加载完整请求图、逐个加载 47 个 handler、实际构建 JSDOM。Node 18.20.4 Windows 实测全过，无 polyfill。
- smoke：隔离本地目录；验证健康鉴权、初始化、拒绝通用代理、匿名注册、搜索、本地二维码图。不会请求真实账号的登录、账号信息或凭据。报告输出不含 cookie；匿名缓存目录已忽略，不应打进 APK。
- 最终 Node 18.20.4 联网 smoke **全部通过**：匿名注册 HTTP 200 / code 200 / cookie 非空，随后搜索明确复用该匿名 cookie，HTTP 200 / code 200 / 返回 1 首；二维码图、健康鉴权、初始化均通过。报告 `smoke-node18.20.4-packed.json`。早先运行确实出现 HTTP 502 / ECONNRESET、匿名注册 code 400；Node 24 对照也出现搜索 502，不可归因于 Node 18。保留正确 cookie 流程和上游偶发网络失败重试都很重要。`running` 只代表本机协议层就绪，不保证每个上游请求成功。
- Windows Node 18 结果不等于 Android ABI、JNI、系统 CA、DNS/TLS、网络切换和锁屏生命周期已经通过。Android 真机仍需完成搜索、登录、歌单、播放与重启恢复验收。
- API 只返回网易 CDN 地址，不是音频代理；WebView 媒体 CORS、Range、重定向与后台播放由宿主另行解决。
- Promise 超时的兜底是 60 秒，普通 API 的底层网络超时设为 25 秒；用户退出/Activity 销毁不自动取消进行中的 Node 请求。
- 上游错误日志的直接 `[ERR]` 路径被脱敏，自己的 API 层不记录 URL、token 或 cookie。生产版不应把 native HTTP 全量日志打开。
