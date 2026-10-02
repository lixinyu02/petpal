# 软件内更新

0.9.7 已正式发布 Windows x64、Ubuntu x64 / ARM64、Android 与 Web 五个更新目标；下载中心另保留同版本 Windows ZIP。可选择 GitHub Releases 或可信 HTTPS 服务器源。[GitHub 正式版](https://github.com/lixinyu02/petpal/releases/tag/v0.9.7) 为 latest，服务器源同步上线。

两份清单均为 stable / sequence 9，各自沿用原发布公钥。已用实际更新服务验证两源五目标从 0.9.6 升级至 0.9.7，当前 Web 0.9.7 返回已最新；版本、完整包 SHA-256 与 Android versionCode 17 一致。十项 GitHub 资产完整字节读回，六个服务器包已通过真实完整字节读取及摘要校验；归档后另外以 HEAD 检查旧路径 404 和新包长度，HEAD 不替代完整读回。Windows 未做 Authenticode 签名；Android 沿用原开发证书。更新清单签名不能替代平台签名。

网页随后增加的 V12 眨眼修复未写入已冻结的 0.9.7 安装包，详见 [安装包验收](acceptance-0.9.7.md) 与 [网页模型验收](cubism/akari-natural-eyelids-acceptance.md)。

## 历史版本与信任配置

0.6.1 首个公开发行版提供 Windows x64 便携 EXE、Web 静态 ZIP、`petpal-update.json` 签名更新清单、公钥及校验摘要，下载见 [GitHub Release v0.6.1](https://github.com/lixinyu02/petpal/releases/tag/v0.6.1)。本版没有 Ubuntu / Android 安装包。以下构建与发布命令是维护者的流程示例，示例路径不代表对应平台已发布。

此前的 0.4 / 0.5 安装包没有更新入口，首次使用应手动下载包含更新功能的版本。0.6.1 发行包不内置个人服务配置或发布源信任；管理员在软件更新设置中填写 `lixinyu02/petpal` 和[发布公钥](petpal-update-public-key.txt)。公钥 SPKI DER 的 SHA-256 指纹为 `5e649530901ba590d7ed894e74c3f77e29f34e0ca0ac4c5a5bfe1dfefa300d6c`。首份清单 sequence 为 1，有效期到 `2027-09-28T00:00:00Z`；同版本客户端不会显示升级。

## 四端的实际行为

| 客户端 | 更新目标 / 文件 | 下载后的行为 |
| --- | --- | --- |
| Windows x64 | `windows-x64` / `portable-exe` | 重新验证清单、文件和当前主账号，关闭旧后台并打开新版便携 EXE；旧 EXE 保留，不声称覆盖安装成功。 |
| Ubuntu x64 / ARM64 | `ubuntu-x64`、`ubuntu-arm64` / `tar.gz` | 校验后在文件管理器中定位归档。用户退出旧版，解压到新目录并运行 `start-petpal.sh`；应用不会执行归档脚本、提权或覆盖旧目录。 |
| Android | `android` / `apk` | 检查包名、APK 签名、版本与 SHA-256，用户点击后按需允许此来源安装，再交给系统安装器确认。交接不等于安装完成。 |
| Web | `web` / `web-zip` | GitHub 或服务器清单用于发布提示。只有当前网页来源的 `version.json` 显示已部署新版，才提供刷新；有未发送草稿时先提示。浏览器不替换服务端程序。 |

Ubuntu 的 AppImage / deb 打包配置不属于当前更新协议支持的安装格式。Windows 和 Ubuntu 的更新包同时携带后端、Codex 与 OpenCLI。Android / Web 连接个人服务，不能在本机后台运行桌面 Codex CLI。

## 配置客户端信任

打开「连接与设置 → 软件更新」，选择「更新来源」，填写对应地址与发布者提供的 **Ed25519 SPKI PEM 公钥**，包含 `BEGIN PUBLIC KEY` 和 `END PUBLIC KEY` 两行。普通登录用户可查看公开配置并检查更新，只有主账号可修改发布源；桌面安装也限定本机主账号。

| 来源 | 配置字段与填写内容 | 对应公钥 |
| --- | --- | --- |
| GitHub Releases | `source: "github"`；`repository: "lixinyu02/petpal"`，`manifestUrl` 留空 | 保留原 [GitHub 发布公钥](petpal-update-public-key.txt) |
| 服务器 | `source: "server"`；`manifestUrl: "https://magicdatou.top:44318/downloads/updates/petpal-update.json"` | 填入该服务器的独立 [update-public.pem](https://magicdatou.top:44318/downloads/updates/update-public.pem) 内容 |

服务器发布身份与 GitHub 发布身份独立。切换来源时须同时使用该来源对应的公钥；**不能把 GitHub 公钥用于服务器清单，或把服务器公钥用于 GitHub 清单**。原 GitHub 公钥和私钥继续保留，切回 GitHub 时重新填写原公钥。公钥地址便于取得内容，首次信任仍应通过维护者提供的可信渠道核对；应用不会自动下载并信任远端公钥。

旧设置缺少 `source` 时迁移为 `github`，缺少 `manifestUrl` 时迁移为空字符串，原仓库、公钥、revision 和防回滚记录保留。服务器模式仍保存 `repository` 字段以便切回 GitHub，但该字段不决定服务器资产的允许范围。

公钥为空时不会发出更新网络请求。两种来源都不需要 GitHub Token，请勿填写签名私钥、Android keystore 或账号令牌。更新请求不携带个人服务的 Bearer 或 Cookie，也不会在失败时自动改用另一来源。

### GitHub 地址规则

GitHub 清单固定取自：

```text
https://github.com/<owner>/<repo>/releases/latest/download/petpal-update.json
```

只允许同仓库 GitHub Releases 与官方 `release-assets.githubusercontent.com` 的受限重定向。

### 服务器地址与目录规则

服务器清单必须使用可信证书的 HTTPS，最后一段精确为 `petpal-update.json`；允许 `44318` 等显式端口，不允许端口 0。清单、安装包和重定向地址不能包含用户名或密码、查询、片段、百分号编码、反斜杠、重复斜杠、`.` / `..` 路径段、空白或非 ASCII 路径。每段使用 `[A-Za-z0-9][A-Za-z0-9._+-]*`。

资产和所有重定向必须保持清单的 **同 origin（协议、主机和端口）**，并位于清单所在目录或其子目录。此处允许 `/downloads/updates/PetPal-0.9.1-Windows-x64.exe` 与 `/downloads/updates/archive/file.exe`，拒绝 `/downloads/other/file.exe`、换端口或跳转到另一主机。清单的重定向目标仍须以 `petpal-update.json` 结尾。安全的相对重定向可以使用，`../file.exe`、`./file.exe` 或 `//host/file.exe` 不可使用。

更新目录应提供无需登录的静态文件，清单与资产不依赖 Cookie、Bearer 或带签名查询参数的下载链接。404 表示当前来源尚无可用清单；错误签名、清单过期或不支持的平台不会变成可安装结果。

### 配置变化与防回滚

`source`、`manifestUrl`、`repository` 或 `publicKey` 任一内容发生变化，后端都会生成新的配置 `revision`，取消旧检查并使旧下载结果失效。保存时前端携带读取到的 revision；遇到配置冲突请点击「重新读取」，然后重新检查更新。下载与安装前继续核对来源、清单和 revision，不能沿用切源前的检查结果。

防回滚记录按 **公钥 SPKI 指纹 + stable 通道** 保存最高 sequence 和 payload hash，独立于仓库、来源和清单地址。切源、换 URL、清空公钥或服务重启都不会清除已有记录；同公钥下更低 sequence、同 sequence 的不同 payload 均被拒绝。不同公钥各自保留记录，切回旧公钥时仍遵守它原先的最高序号。配置 revision 用于处理来源变化，不能代替清单的递增 sequence。

## 一次性生成发布密钥

使用 Node.js 22+，在项目目录显式运行：

```sh
node scripts/sign-update.mjs keygen --out-dir .release-private
```

这会生成 `.release-private/update-private.pem` 和 `.release-private/update-public.pem`，仅输出公钥文件路径。目录参数必填；任一目标文件已存在就拒绝，绝不覆盖已有发布身份。导入模块、构建应用和运行签名命令都不会自动创建密钥。

私钥是未加密 PKCS#8 PEM，应由维护者离线保管和备份。POSIX 新目录为 0700、私钥为 0600；Windows 继承目录 ACL，请放在发布者专用目录。`.release-private/` 与 `*.pem` 已被 Git 忽略；私钥不要强制加入 Git、上传到 Release 或放进公开服务器目录。公钥可以另行公开供用户核对。Android APK 的 keystore 是另一套签名身份，不能用此 Ed25519 私钥代替。

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

GitHub 发布编辑 [update-release.example.json](update-release.example.json)，填写本次的仓库、已准备好的 tag、递增 sequence、未来的 UTC 过期时间和实际文件。省略 `source` 时签名工具兼容旧配置并按 GitHub 处理；也可明确写 `"source": "github"`。

- `artifacts[].file` 相对**配置文件所在目录**解析，也可填写绝对路径。示例放在 `docs/`，所以使用 `../releases/`。
- 每个 target 最多一个文件；只列出本次确实发布的平台。文件名必须唯一，仅使用英文字母、数字、点、横线和下划线，扩展名须匹配平台。
- 稳定版本只接受 `X.Y.Z`，不接受 `v` 前缀、预发布标记或前导零。Android 另需 `versionCode`，范围 1 至 2,100,000,000；其他 target 不能填该字段。
- 工具流式读取实际文件计算 `bytes` / SHA-256；不接受配置提供 URL、哈希、大小或执行命令。文件范围是 1 byte 至 2 GiB，读取过程中变化会失败。
- GitHub URL 自动生成 `https://github.com/<repository>/releases/download/<tag>/<basename>`；服务器 URL 从 `manifestUrl` 所在目录与文件 basename 生成，发布时资产名称必须保持一致。release ID 为 `<target>-<version>`，format 由 target 固定决定。

```sh
node scripts/sign-update.mjs sign --config docs/update-release.example.json --key .release-private/update-private.pem --out releases/petpal-update.json
```

输出前会使用应用的 `verifyUpdateEnvelope` 进行自验证。输出文件已存在就拒绝；修改发布材料后使用新的输出位置，并在上传前明确选择新的文件。工具没有联网、上传或调用 `gh` 的步骤，输出收据只包含公开文件路径、来源、仓库、服务器清单地址（如适用）、sequence、大小、摘要和公钥指纹。

清单 envelope 是 `{schemaVersion:1,payload,signature}`；payload 是 UTF-8 JSON 原始字节的 base64url，signature 是对这些字节做的 Ed25519 签名。解码后的内容为：

```text
{ product:'petpal', channel:'stable', sequence, issuedAt, expiresAt,
  releases:[{ id, target, version, versionCode?, url, sha256, bytes, notes, format }] }
```

`issuedAt` 由签名工具生成。服务端先验签，再解析并检查每个字段；整个 envelope 最大 128 KiB。以公钥指纹和 stable 通道保存最高 sequence 与 payload hash，拒绝更低序号，以及同序号的不同内容。**每次重新签名或延长过期时间都使用更大的 sequence**，包括安装包不变的情况；工具离线运行，无法替代发布者维护这个序号记录。GitHub 与服务器资产 URL 不同，签名 payload 也不同，不能修改旧清单 URL 后沿用原签名；同一公钥下也不能沿用相同序号。独立的服务器密钥使用自己的序号记录。

## 发布到 HTTPS 服务器

服务器源使用 [update-server-release.example.json](update-server-release.example.json)。`source` 与 `manifestUrl` 是 **JSON 配置字段**，不是 `sign` 命令行参数；服务器配置不要求 GitHub tag，`repository` 可保留用于兼容。示例仅列出准备好的 Windows 与 Web 文件，不代表所有平台都已重新打包。发布前按实际文件修改 artifacts，按该服务器密钥的发布记录选择更大的 sequence，并设置未来的 UTC expiresAt。

首次创建服务器的独立发布身份时显式运行以下命令；已有密钥时直接复用，不要为每次发布重新生成，也不要覆盖原 GitHub 身份：

```sh
node scripts/sign-update.mjs keygen --out-dir .release-private/server-updates
```

冻结待发布文件后，使用服务器私钥签名；输出路径必须尚不存在：

```sh
node scripts/sign-update.mjs sign --config docs/update-server-release.example.json --key .release-private/server-updates/update-private.pem --out releases/server-updates/petpal-update.json
```

该工具按配置文件所在目录解析 `artifacts[].file`，从实际文件计算长度和 SHA-256，并自动生成 `https://magicdatou.top:44318/downloads/updates/<basename>`。它不会上传文件或配置 Web 服务。将实际安装包和公开 `update-public.pem` 放到对应 HTTPS 目录，逐字核对文件后再发布 `petpal-update.json`，避免先出现清单而文件尚未上传；私钥留在私有目录。

```text
https://magicdatou.top:44318/downloads/updates/
  petpal-update.json
  update-public.pem
  PetPal-0.9.1-Windows-x64.exe
  PetPal-0.9.1-Web.zip
```

以上两资产与示例配置对应；若加入 Ubuntu 或 Android，将它们的真实文件同时加入签名配置和公开目录。镜像既有原生包时保持内容和版本不变，不把来源适配描述为已经进入旧包。服务器清单与公钥配置切换完成后，登录网页检查所选来源、清单签名和实际下载文件。Web ZIP 同样需要独立部署到站点，发布清单不会替换后端或自动安装客户端。

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

## 签名工具测试与发布验证

`node --test tests/sign-update.test.mjs tests/updates.test.mjs` 使用操作系统临时目录和临时密钥，覆盖签名、实际文件哈希、五目标格式、错误密钥、覆盖保护、越界文件、versionCode、过期、回滚与取消。这些测试本身不会创建生产密钥或发布二进制。0.6.1 发布另行生成并保护项目签名身份，核对已验收 EXE、Web ZIP、更新清单及上传资产；详细状态见 [发布记录](workflow/2026-09-28-petpal-release-061-issues.md)。
