# Android 运行时（Capacitor + 内嵌 Node）

这一层把 Web UI 和内嵌 Node 后端装进同一个 APK，不加载远程站点。

## 组成

- `MainActivity` 注册 `FoliaRuntime` / `FoliaPlayer` / `FoliaDisplay` 三个插件。
  `FoliaRuntime.start()` 只有在带 token 的 `/health` 报 `running` 之后才返回 `{ port, token }`。
- `FoliaNodeRuntime` 把 `assets/nodejs-project` 拷到 `noBackupFilesDir/folia-runtime/project`，
  再进入 JNI `node::Start`；数据目录是 `noBackupFilesDir/folia-data`（`HOME` / `FOLIA_DATA_DIR`）。
- `PlaybackService` 是真正的前台服务（`mediaPlayback`）：持有 MediaSession 与通知，
  请求音频焦点；音频本身仍由 WebView 播放，服务只镜像状态并回传播放/暂停/上一首/下一首。
- `FoliaDisplayPlugin` 负责横竖屏锁定与读取当前方向。

## 构建

```powershell
node androidBackend/pack.mjs
npm run build:android:web
npx cap sync android
.\android\gradlew.bat -p android :app:assembleDebug -PnodejsMobileDir=C:/toolchains/nodejs-mobile
```

需要 JDK 21、Android SDK platform 36、NDK `27.2.12479018`、CMake `3.22.1`、Gradle wrapper 8.14.3、AGP 8.13.0。
`local.properties` 由本机生成，已被忽略。

若本机 HTTPS 代理根证书只装在 Windows 证书库、不在 JDK 里，构建时加
`$env:JAVA_TOOL_OPTIONS='-Djavax.net.ssl.trustStoreType=Windows-ROOT'`（用系统证书库，不关闭校验）。

只跑 `:app:` 的任务：Cordova 子工程的 `androidTest` 会与本工程的 Kotlin 版本冲突。

## 安全与生命周期

- 每个进程生成 32 字节 `SecureRandom` token（64 个十六进制字符），只存在进程内存里，
  通过 `argv[2]` 传给 Node，不写偏好设置、不写日志。
- 后端只绑 `127.0.0.1:39843`，**所有**路由（含 `/health`）都要 `X-Folia-Token`。
- 明文网络只允许 `127.0.0.1`；其它域名必须 HTTPS；WebView 混合内容保持关闭，
  渲染进程显式走 `CapacitorHttp`，没有全局 fetch 拦截。
- 应用备份关闭。Node 负载是受信任的应用代码，与应用同权限运行，不在独立沙箱里。
- 端口 39843 由前后端约定写死；被别的应用占用时启动失败，不会降级成无鉴权服务。
- Node 18 已 EOL，正式发行前应升级运行时并重跑 Android 兼容测试。

## 已知限制

本地音乐库（桌面用文件系统访问 API）、桌面壁纸、托盘、Discord 状态没有 Android 实现；
只集成网易云一家平台。强制停止应用后后台播放不会自愈，需要重新打开。
