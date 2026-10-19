# Folia for Android

把桌面版 [Folia](https://github.com/chthollyphile/folia-major) 的界面与歌词动画原样装进一个 APK：
前后端都在手机本地进程里跑，不加载远程网页，也不需要额外的服务器地址。

- 上游版本：folia-major 0.7.20（提交 `d7bce036affb645bb407cff5409a53f0bffeb9f4`）
- 许可：AGPL-3.0（与上游一致，见 [LICENSE](LICENSE)）
- 这是**非官方**移植，不是上游发布的 Android 版本

## 它是怎么工作的

| 部分 | 做法 |
| --- | --- |
| 界面 | Capacitor 8 打包原始 React 应用，歌词动画、主题、插件系统都是上游代码 |
| 在线音乐 | JNI 嵌入 Node.js Mobile 18.20.4，在应用进程内 `127.0.0.1` 上提供网易云接口 |
| 播放 | WebView 里的音频仍是唯一音源，原生前台服务只做通知栏、锁屏与音频焦点 |
| AI 主题 | 由内置 Node 进程调用**你自己**配置的模型，密钥只留在本机 |

## 功能与限制

能用：网易云搜索 / 扫码登录 / 歌单 / 歌词与全部歌词动画、主题、插件、AI 生成主题、
横竖屏切换、通知栏与锁屏控制。

不能或有限：本地音乐库（桌面用的是文件系统访问 API）、桌面壁纸、托盘、Discord 状态、
系统级均衡器；仅集成网易云一家平台。锁屏播放依赖 Android 前台服务，强制停止应用后不会自愈。

## 安装

从 [Releases](../../releases) 下载 `Folia-*-android.apk`，允许浏览器或文件管理器安装未知应用。
要求 Android 7.0（API 24）及以上、64 位 ARM 设备（安装包同时含 x86_64）。

这是用 debug 密钥签名的侧载包，不是商店发行版。

## 配置 AI 模型

默认不带任何密钥，AI 主题生成需要你自己填：

1. 打开 **设置 → 外观 → 最下面「AI 模型（主题生成）」**
2. 「常用服务商」里选 OpenAI / DeepSeek / Kimi / 智谱 / SiliconFlow / OpenRouter，
   会自动填好接口地址和模型名；也可以直接手填任意 OpenAI 兼容地址
3. 填自己的 API Key，点「测试连接」，然后保存

地址填基址（`https://api.deepseek.com/v1`）或完整地址（`.../chat/completions`）都可以，
应用会在请求时补齐路径。密钥保存在应用私有目录（`noBackupFilesDir`），不写日志、不上传，
导出设置或备份时不会带出去。

## 自己构建

需要 Node.js ≥ 24、JDK 21、Android SDK platform 36、NDK `27.2.12479018`、CMake `3.22.1`。

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
npm ci --ignore-scripts --no-audit --no-fund

# 准备 Node.js Mobile 运行库（见下），然后：
node androidBackend/pack.mjs
npm run build:android:web
npx cap sync android
.\android\gradlew.bat -p android :app:assembleDebug -PnodejsMobileDir=C:/toolchains/nodejs-mobile
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

Node.js Mobile 固定用 capawesome 的 `v18.20.4-capawesome.3`：
<https://github.com/capawesome-team/nodejs-mobile/releases/download/v18.20.4-capawesome.3/nodejs-mobile-v18.20.4-capawesome.3-android.zip>
（SHA-256 `0a8d094d3f60bcd3b8ff0ad98e4aafeeb59c933fbf53af82eb7cdeab015c503f`）。
解压后必须包含 `include/node/` 与 `bin/arm64-v8a/libnode.so`、`bin/x86_64/libnode.so`。

## 许可与致谢

界面、歌词动画、主题与插件系统来自 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)，
其作者与贡献者拥有这些部分的版权。本仓库只是把它们移植到 Android，并按 AGPL-3.0 同样开源；
再分发时请保留 [LICENSE](LICENSE) 与上游署名。上游 README 保留在 [README.upstream.md](README.upstream.md)。
