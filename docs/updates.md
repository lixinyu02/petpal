# 软件内更新与 GitHub 发布

0.6.0 源码已提供四端更新入口、清单验证和离线签名工具。本轮没有发布正式 0.6.0 安装包或 `petpal-update.json` 更新源，也没有生成项目的真实发布密钥。下面是维护者未来发布时执行的步骤，示例路径不表示相应文件已经存在。

Windows 0.6.0 正式包尚未生成。此前的 0.4 / 0.5 安装包没有本轮新增的更新入口，不能直接通过旧 0.5 UI 升级；首次使用需要手动构建、安装或部署包含更新功能的版本。启动 0.6.0 源码、生成示例配置或初始化 GitHub 仓库，都不代表已经完成生产发布。

## 四端的实际行为

| 客户端 | 更新目标 / 文件 | 下载后的行为 |
| --- | --- | --- |
| Windows x64 | `windows-x64` / `portable-exe` | 重新验证清单、文件和当前主账号，关闭旧后台并打开新版便携 EXE；旧 EXE 保留，不声称覆盖安装成功。 |
| Ubuntu x64 / ARM64 | `ubuntu-x64`、`ubuntu-arm64` / `tar.gz` | 校验后在文件管理器中定位归档。用户退出旧版，解压到新目录并运行 `start-petpal.sh`；应用不会执行归档脚本、提权或覆盖旧目录。 |
| Android | `android` / `apk` | 检查包名、APK 签名、版本与 SHA-256，用户点击后按需允许此来源安装，再交给系统安装器确认。交接不等于安装完成。 |
| Web | `web` / `web-zip` | GitHub 新版用于发布提示。只有当前网页来源的 `version.json` 显示已部署新版，才提供刷新；有未发送草稿时先提示。浏览器不替换服务端程序。 |

Ubuntu 的 AppImage / deb 打包配置不属于当前更新协议支持的安装格式。Windows 和 Ubuntu 的更新包同时携带后端、Codex 与 OpenCLI。Android / Web 连接个人服务，不能在本机后台运行桌面 Codex CLI。

## 配置客户端信任

打开「连接与设置 → 软件更新」。服务管理员填写公开 GitHub 仓库，例如 `lixinyu02/petpal`，以及发布者提供的 **Ed25519 SPKI PEM 公钥**，包含 `BEGIN PUBLIC KEY` 和 `END PUBLIC KEY` 两行。普通登录用户可查看公开配置并检查更新，只有主账号可修改发布源；桌面安装也限定本机主账号。

公钥为空时不会发出更新网络请求。应用不接收 GitHub Token，发布源目前只支持公开 GitHub Releases。更换仓库或公钥会改变配置 revision，使旧检查和下载失效。签名私钥、Android keystore 和账号令牌都不应填到此处。

更新清单固定取自：

```text
https://github.com/<owner>/<repo>/releases/latest/download/petpal-update.json
```

只允许同仓库 GitHub Releases 与官方 `release-assets.githubusercontent.com` 的受限重定向。请求不携带个人服务的 Bearer 或 Cookie。404 表示该仓库尚无可用清单；错误签名、清单过期或不支持的平台不会变成可安装结果。

## 一次性生成发布密钥

使用 Node.js 22+，在项目目录显式运行：

```sh
node scripts/sign-update.mjs keygen --out-dir .release-private
```

这会生成 `.release-private/update-private.pem` 和 `.release-private/update-public.pem`，仅输出公钥文件路径。目录参数必填；任一目标文件已存在就拒绝，绝不覆盖已有发布身份。导入模块、构建应用和运行签名命令都不会自动创建密钥。

私钥是未加密 PKCS#8 PEM，应由维护者离线保管和备份。POSIX 新目录为 0700、私钥为 0600；Windows 继承目录 ACL，请放在发布者专用目录。`.release-private/` 与 `*.pem` 已被 Git 忽略；不要强制加入 Git 或上传到 Release。公钥可以另行公开供用户核对。Android APK 的 keystore 是另一套签名身份，不能用此 Ed25519 私钥代替。

## 构建待发布文件

先统一 `package.json` / lock、服务版本和 Android `versionName`；Android `versionCode` 必须比已安装版本增加。清单工具只读取文件和配置，不替维护者修改产品版本或签署 APK。

```sh
npm ci
npm test
npm run build
```

Windows x64 便携包在 Windows 构建：

```sh
npm run desktop:win
```

Ubuntu 两种架构的归档使用项目脚本；依赖和验证细节见 [Linux 打包](linux-packaging.md)：

```sh
node scripts/linux-package.mjs x64 arm64
node scripts/linux-verify.mjs
```

Android 需要 JDK 21 / Android SDK。现有 `scripts/build-android.ps1` 与 `scripts/build-android.sh` 生成 **debug APK**，用于构建和调试。正式更新应使用 Android Studio 的签名 APK 流程或维护者自己的 release signing 配置，使用与已安装应用**相同的 keystore**，将签名后的文件放入 `releases/android/`。本源码没有附带 release keystore，也没有预设可用的正式签名配置。

Android 插件要求 `applicationId=com.petpal.app`、签名集合完全一致、`versionCode` 严格增加，而且 `versionName` / `versionCode` 与清单一致。更换开发机的 debug keystore 或换为另一把 release key，不能直接更新此前安装的 APK。签名工具不会将 debug APK 转换为正式 APK，也不会通过读取文件名推断 Android 的实际版本；发布前请用 Android 构建工具核对实际包信息与签名。

Web 在构建后把 `dist/` 的**内容**压入 ZIP。例如 PowerShell：

```powershell
New-Item -ItemType Directory -Force releases/web | Out-Null
Compress-Archive -Path dist/* -DestinationPath releases/web/PetPal-0.6.0-Web.zip
```

各端构建通过后应分别验收。跨平台归档校验不能代替 Ubuntu 图形环境或 Android 手机上真正运行、安装的测试。

## 从实际文件生成签名清单

编辑 [update-release.example.json](update-release.example.json)，填写本次的仓库、已准备好的 tag、递增 sequence、未来的 UTC 过期时间和实际文件。

- `artifacts[].file` 相对**配置文件所在目录**解析，也可填写绝对路径。示例放在 `docs/`，所以使用 `../releases/`。
- 每个 target 最多一个文件；只列出本次确实发布的平台。文件名必须唯一，仅使用英文字母、数字、点、横线和下划线，扩展名须匹配平台。
- 稳定版本只接受 `X.Y.Z`，不接受 `v` 前缀、预发布标记或前导零。Android 另需 `versionCode`，范围 1 至 2,100,000,000；其他 target 不能填该字段。
- 工具流式读取实际文件计算 `bytes` / SHA-256；不接受配置提供 URL、哈希、大小或执行命令。文件范围是 1 byte 至 2 GiB，读取过程中变化会失败。
- URL 自动生成 `https://github.com/<repository>/releases/download/<tag>/<basename>`，发布时资产名称必须保持一致。release ID 为 `<target>-<version>`，format 由 target 固定决定。

```sh
node scripts/sign-update.mjs sign --config docs/update-release.example.json --key .release-private/update-private.pem --out releases/petpal-update.json
```

输出前会使用应用的 `verifyUpdateEnvelope` 进行自验证。输出文件已存在就拒绝；修改发布材料后使用新的输出位置，并在上传前明确选择新的文件。工具没有联网、上传或调用 `gh` 的步骤，输出收据只包含公开文件路径、仓库、sequence、大小、摘要和公钥指纹。

清单 envelope 是 `{schemaVersion:1,payload,signature}`；payload 是 UTF-8 JSON 原始字节的 base64url，signature 是对这些字节做的 Ed25519 签名。解码后的内容为：

```text
{ product:'petpal', channel:'stable', sequence, issuedAt, expiresAt,
  releases:[{ id, target, version, versionCode?, url, sha256, bytes, notes, format }] }
```

`issuedAt` 由签名工具生成。服务端先验签，再解析并检查每个字段；整个 envelope 最大 128 KiB。以公钥指纹和 stable 通道保存最高 sequence 与 payload hash，拒绝更低序号，以及同序号的不同内容。**每次重新签名或延长过期时间都使用更大的 sequence**，包括安装包不变的情况；工具离线运行，无法替代发布者维护这个序号记录。删除公钥或切换到同公钥的另一仓库不会清除客户端的防回滚记录。

## 上传 GitHub Releases

以下示例要求已完成发布审查、相应 Git tag 已推送，且列出的五个安装包和 `releases/release-notes.md` 均已准备好。缺少的平台应同时从配置与命令移除。先创建草稿并复核资产名，公钥通过维护者可信渠道单独提供：

```powershell
gh release create v0.6.0 --repo lixinyu02/petpal --verify-tag --draft `
  --title "PetPal 0.6.0" --notes-file releases/release-notes.md `
  releases/desktop/PetPal-0.6.0-Windows-x64.exe `
  releases/ubuntu/PetPal-0.6.0-Ubuntu-x64.tar.gz `
  releases/ubuntu/PetPal-0.6.0-Ubuntu-arm64.tar.gz `
  releases/android/PetPal-0.6.0-Android.apk `
  releases/web/PetPal-0.6.0-Web.zip `
  releases/petpal-update.json
```

检查所有下载资产与签名时使用的文件逐字一致后，发布草稿并设为 latest：

```sh
gh release edit v0.6.0 --repo lixinyu02/petpal --draft=false --latest
```

应用只会为低于清单版本的客户端显示更新。同为 0.6.0 的客户端不会因为这个示例 feed 出现升级提示。不要覆盖已发布版本的安装包；需要修正时发布新版本并增加 sequence。

Web ZIP 上传后仍需管理员把对应 `dist/` 静态资源及 `version.json` 一起部署到站点；有后端变更时还需部署匹配的服务器版本。GitHub Releases 不会自动替换个人服务。先确认站点确实在提供新版，再由网页刷新载入。

## 本轮验证范围

`node --test tests/sign-update.test.mjs tests/updates.test.mjs` 使用操作系统临时目录和临时密钥，覆盖签名、实际文件哈希、五目标格式、错误密钥、覆盖保护、越界文件、versionCode、过期、回滚与取消。没有生成项目发布私钥、上传正式 feed、安装测试文件或发布二进制。
