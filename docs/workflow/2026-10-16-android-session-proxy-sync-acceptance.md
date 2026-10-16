# Android 登录、代理同步与闪退验收

## 已验证的开发候选

- 源码实现：`ca1c9f8`（issue-1），后续原生桥线程及回环兼容修复见 issue-2 提交。
- 最终候选：`0.9.13-dev.2`，Android versionCode 24，包名 `com.petpal.app`。
- APK：149292376 bytes，SHA256 `9b9a9f45b60248863f5434f0af006b36ff61eb3162bfc55f20f7e98eb4160626`。
- 真实环境：隔离 Android 16／API 36 x86_64 模拟器，412×960；真实 MainActivity、React 表单、Capacitor 插件、Keystore、Mihomo 和独立后端。
- 用户设备已确认为小米 17 Pro Max／Android 16。未连接该真机，不能把模拟器结果称为真机通过。

## 结果

1. 登录后 adb force-stop，再打开会自动验证并恢复同一账号；退出后再强关、重开不恢复。dev.2 重验登录、恢复、退出和清空四阶段均通过。
2. 断网时保留已加密会话，页面保持验证失败和重试状态，不解锁已认证功能。此阶段在 dev.1 验证，dev.2 的登录 JS／vault 代码相同。
3. 在实际 Android 设置界面从真实后端下载已分配的合成 Clash 文件，启用实际 Mihomo、修改节点及模式、开启自动启动；强关后重新打开，服务器来源、修订、本机模式与节点均恢复。实际 HTTP 回环链路通过，不使用假网络工厂。
4. 原生独立 Keystore／AtomicFile 三项、Mihomo 内核四项、真实 JS→Capacitor→主线程桥一项通过。
5. 定向 Node 131 项及登录提示 UI 2 项通过，包／源码审计回归 26 项通过；最终 Java 83 项零失败；TS、隔离 Vite、APK 构建和差异检查通过。
6. APK 完整读取、CRC、zipalign、原生主类闭包、Web 资产比对、Cubism／Mihomo 资产和许可、私有数据扫描通过；与正式 0.9.12 签名一致。公网开发包全量下载字节和 SHA256 一致。

## 实测发现并修复

- Android 合法私有目录别名被误判，导致代理无法绑定。
- Mihomo `/version` 先就绪，实际 Selector／provider 尚未加载，导致选择恢复过早。
- 原生代理插件的 bind／clear／文件导入从 Capacitor 工作线程读取 WebView，整 App 在 Android 16 登录阶段崩溃。统一在主线程验证，并增加真实桥测试；修复后登录与强关重开通过。
- 同 epoch 两次登录存在已落盘账号与页面账号不同的竞态；原生保存与身份发布现为串行事务。
- UI 旧事件跨账号、慢文件覆盖新文件／手写内容，以及动态 provider 默认节点不能保存的问题。
- 代理配置来源仍要求 HTTPS；独立增加规范 HTTP 回环 IP 支持，用于本机服务。没有放开局域网或公网 HTTP、订阅 HTTP 或通知策略。IPv6 HTTP 未做实际网络验收。

## 服务交付

后端新接口和 Web 管理入口已在 `https://magicdatou.top:44318` 上线。普通账号只读取管理员分配的配置，匿名访问返回 401。生产数据业务摘要、原有下载包、签名更新清单和 guardian 配置前后保持，服务及公网健康通过。

首轮静态入口替换遇到 PowerShell 的 File.Replace 空备份路径绑定问题，原页面入口保持；新后端健康。核验仅缺 index.html 后，改用经过独立测试的原子覆盖完成恢复，并完整回读 288 个 Web 文件及公网入口；没有再次重启后端，没有恢复旧数据库或删除旧资源。原始失败与恢复收据保留在私有 `.data` 中。

完整日志、截图、APK 审计及部署收据保存在私有 `.data/android-sync-*`。不将数据库、原始会话或配置文件提交到 Git。

## 新增正式发布请求

用户随后明确要求发布到正式链接。issue-3 准备正式安卓 `0.9.13`／versionCode 25，issue-4 完成官方安卓下载及签名升级清单发布；Windows／Ubuntu 保留已验收的 0.9.12，没有将旧包改名为新版本。

## 正式发布结果（2026-10-16）

- 源码冻结提交：`927840a4d2493a2a8c4e33f79782f137b6de8b73`，tag `v0.9.13`。正式发布后的文档提交不改变包对应的源码tag。
- GitHub：<https://github.com/lixinyu02/petpal/releases/tag/v0.9.13>，release ID 414528577，正式且为latest，六个附件均 uploaded。
- 官方APK：<https://magicdatou.top:44318/downloads/PetPal-0.9.13-Android-debug.apk>，149427224 bytes，SHA256 `15170b1339ad0bd1b10b68dc1ddca9ccbe0117267c9b04e750aae19e4cfa1912`。
- Web包：50878715 bytes，SHA256 `af903d15b95bf613acf73cba221e9d749b125e25405284ff3429eb3d957f8b58`。线上Web与后端为0.9.13。
- 正式APK通过版本、ZIP/CRC、许可、资产、私有数据扫描及与0.9.12的签名连续性检查；实际覆盖开发包后，退出、清空、登录、强关恢复和代理恢复五阶段在Android16/API36模拟器通过。可以覆盖安装，不需卸载原客户端。仍使用项目既有开发证书，不是应用商店签名。
- GitHub六文件在发布前全量回读，与准备文件逐字节hash/大小相等；发布后核对相同asset ID、digest、正式URL和tag源码。服务器`updates/`及正式根路径APK/Web均全量HTTPS回读，字节数和SHA相等。
- 两个正式更新源均以原有受信任密钥签名，sequence从14推进至15；发布后实读清单并验证签名。Android/Web13，Windows/Ubuntu12原URL和SHA逐字段保留。
- 本地和公网认证下载API均提供五个正式客户端包：Android13、Windows12 EXE/ZIP、Ubuntu12 x64/ARM64。各链接HEAD200且长度正确，旧安卓12直链404；匿名下载目录和代理配置API401。安装包文件保持公开下载。
- Chrome实际使用既有账号登录并打开正式下载中心，Android13、Windows12和“服务器直连”显示正确，GitHub备用链接正确；未提交聊天任务或修改账号偏好。
- 后端健康、guardian接管、Web冻结文件比对通过。业务数据及各业务字段摘要与部署前相同；没有回滚用户数据库、改账号权限或替换现有信任锚。

发布收据与全量校验证据位于私有 `.data/release-0.9.13/`：`github-proof.json`、`github-latest.json`、`live-updates-verified.json`、`production-final-1792124487795.json`、`production-process-1792124490247.json` 以及 `promotion/`。未将凭据、配置YAML、数据库或签名私钥放入仓库。

仍待真机验收：用户小米17 Pro Max／Android16的实际覆盖安装与运行；本轮未重新验收真实OpenAI套餐授权。
