# 四端更新接口与公开 GitHub 仓库

- Date: 2026-09-28
- Complexity: L2
- Status: approved by task scope

## Background / Goal

用户要求 Web、Android、Ubuntu、Windows 都准备软件内更新接口，选择 GitHub Releases，并明确要求把当前源码初始化 Git、推送公开 GitHub。拟用当前认证账号的 `lixinyu02/petpal`（已确认不存在）。本轮接口版本 0.6.0，旧 0.4/0.5 包保持原样。

## Contract

更新源设置为公开 GitHub `owner/repo` 和 Ed25519 发布公钥，不接收 GitHub token。配置由服务 owner 修改；登录用户可以检查其客户端版本。默认仓库为 lixinyu02/petpal，未配置公钥时明确显示更新源未启用。不会伪造已发布清单。

清单 envelope 为 `{schemaVersion:1,payload:<base64url UTF8 JSON>,signature:<base64url Ed25519>}`，payload 为 `{product:'petpal',channel:'stable',sequence,issuedAt,expiresAt,releases:[{id,target,version,versionCode?,url,sha256,bytes,notes,format}]}`。target 为 windows-x64 / ubuntu-x64 / ubuntu-arm64 / android / web；format 为 portable-exe / tar.gz / apk / web-zip。稳定版本按数值三段比较；Android 有正整数 versionCode。GitHub 同仓库 Releases 资产 URL 必须 HTTPS、无凭据，允许受限次数跳到官方 release-assets.githubusercontent.com，绝不转发用户 Bearer/Cookie。清单限 128KiB、文件限 2GiB，有超时和取消。

验签后解析和检查过期、目标/格式、长度与哈希。相同公钥/channel 保存 sequence 与 payload hash 防回滚/同序号替换，配置 revision 使旧下载失效。后端 `GET/PATCH /api/updates/config`、`POST /api/updates/check {target,currentVersion}`；返回已验证 release 和配置 revision，无任意 URL 下载代理。createPetServer 暴露内部 updates service 给 Electron。

## Platform behavior

- 共用设置页提供当前版本、GitHub 更新源、检查、说明、下载进度/取消与安装交接。明确区分已发布、下载完成、交给安装器和安装成功。
- Electron 通过固定 IPC 使用自身真实 app version/platform；主进程从内部 service 取得已验证发布项、固定私有目录下载，实际长度/SHA-256 校验、临时文件 rename；renderer 不能传任意 URL/路径执行。Windows portable 打开校验后的新版程序，需要释放旧实例锁；保留旧版，不假称覆盖安装。Ubuntu tar.gz 校验后定位文件并展示解压启动说明，不执行任意 tar 脚本或提权。为未来 AppImage/安装器保留 format 扩展，但本轮只接真实现有包格式。
- Android Capacitor 插件使用真实 package version/versionCode；下载仅接受已检查的 GitHub Releases APK 元数据，流式限额/sha256，安装前再验 APK applicationId、严格增加的 versionCode 和现有安装签名一致；固定私有缓存 FileProvider。未知来源权限只在用户点击安装时请求，随后由系统安装器确认，不静默安装。禁止从外部网页调用原生桥。APK 同签名门禁是 Android 端的独立可信检查。
- Web 版本常量由构建注入，同时输出 `version.json`。只有当前页面来源实际部署的版本改变才出现刷新更新；GitHub 有新版而服务器未部署时说明等待部署。刷新前保留/提示未发送文本，不声称浏览器能替换服务主机二进制。

## Release / Git

提供 GitHub 发布清单生成与 Ed25519 签名脚本、schema/example/操作文档。签名私钥不入源码，不自动上传 GitHub Secrets；未来发布时由维护者提供。当前用户授权公开源码，不表示必须立即发布未签名更新清单。Git 仅加入可公开源文件、原创素材、构建配置、测试与文档；不加入运行数据、下载缓存、证据原始日志、安装包或凭据。仓库本地使用 GitHub noreply 身份，不改全局 git config。

## Risks / validation

更新会交接可执行代码，必须把可信清单与实际文件绑定，阻止错平台/降级/超限/哈希不符/取消后执行。测试使用临时密钥与本地模拟下载，绝不替换当前运行工具或安装软件来验证。Chrome 验收设置和 Web 刷新提示；Android 编译及包签名逻辑测试，Windows main/preload 主进程边界测试，Ubuntu仅归档交接测试。公开推送前按白名单及秘密扫描复核 staged 文件与 git history。最后读取 GitHub repo/commit 确认 public 和远端 SHA。
