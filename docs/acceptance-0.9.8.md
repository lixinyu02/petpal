# PetPal 0.9.8 客户端验收

日期：2026-10-05。客户端构建、本机验收、GitHub 正式发布、包的完整公网回读、两源更新清单、旧包归档与 Chrome 在线入口终验已完成。Android/Ubuntu 真机、外部设备连接桌面中央服务器与上游业务全面复验不在本次已完成范围内。

冻结源码：`5205e7e544182a504647a7a2273908e40c0db2c7`。六个发布包使用同一独立前端构建，未以生产 `dist` 作为构建输出。原始日志、失败记录和实际回执保存在 ignored `evidence/release-098-20261005/`。

## 本版内容

Cubism V12 自然眼睑、中央服务器设置、主题与动画、桌面生命周期和返回体验进入客户端。新增切换模式、历史和新对话的未发送内容保护，以及短屏导航与软键盘弹层适配。3D 小猫默认关闭，保留可选能力。Windows 和 Ubuntu 携带 Codex CLI、OpenCLI 与电脑控制运行资源；Android 和 Web 使用后端的远程 Agent，不内置桌面 CLI。

桌面客户端可在中央服务器设置中开放本机后端的监听端口、设置对外 HTTPS 地址，并保存下次启动恢复的配置。开放前要求账号已有密码；公网 HTTPS 仍由部署的证书与反向代理提供，填写地址本身不生成证书或开放路由器、防火墙。

包内版本：Electron `39.8.10`、Codex CLI `0.143.0`、OpenCLI `1.8.8`；Windows 电脑控制 Zavora `7.4.0`。默认人物为 `akari-cubism-v12`，使用真实 Cubism Core `6.0.1`。

## 六个冻结发布包

下表是实际本地包的完整字节数与 SHA-256，不代表该包已完成所有目标设备或公网验收。来源：`public-preparation.json`，并与各平台实际包回执绑定。

| 文件 | Bytes | SHA-256 |
| --- | ---: | --- |
| PetPal-0.9.8-Windows-x64.exe | 220895153 | `9e5196ccf4a7b46ceb1321a3a30cc1bed45a65fc09c5d56f7ec28eb69a346def` |
| PetPal-0.9.8-Windows-x64.zip | 373172953 | `888c3ff1cdaf87f631f412e12909d81979425a30d6e54c6408088dd33e1682e6` |
| PetPal-0.9.8-Ubuntu-x64.tar.gz | 343816876 | `33f96c9c1afc56e5627f767077f6dda4eee94956815ae886b1d0c364116d3196` |
| PetPal-0.9.8-Ubuntu-arm64.tar.gz | 338009066 | `08239f64027c340949bbaf8058912539cd9f2831c48c61a36b1542aad44a6a04` |
| PetPal-0.9.8-Android-debug.apk | 60710187 | `ace78c97e508179a98610c431e0de8e2885934df143ccf72830e1f99177610ec` |
| PetPal-0.9.8-Web.zip | 55926844 | `f1acd8b7657a6724556d99834ac866b0a42ff57f4311716208c3b2c14a88d7cf` |

## 验证状态

### 前端与回归：完成

- App handler `53/53`、Windows 包工具 `22/22`、APK 工具 `8/8`、Android Java `65/65` 与 TypeScript 检查通过；完整串行确认轮为 `1933/1933`，无失败或跳过。
- 首轮完整回归为 `1932/1933`，其中一个重复 Chat 提交 fixture 未收到 `done`。原文件 `8/8`、30 轮单例和 15 轮完整文件（120 个用例）均未复现。首次错误事件的原因仍未知；未据此添加生产重试、放宽协议或修改原断言。保留 `full-regression.log`、`full-regression-confirm.log`、`chat-agent-api-diagnostic-receipt.json` 与诊断副本。
- Chrome 插件在隔离本地页面验证 `412×960`、`320×540` 无横向溢出，`320×320` 设置底部可达；继续编辑保留草稿、丢弃后切模式与触屏 Enter 换行通过。
- 软键盘验证为编写的 `visualViewport` 模拟：420px 可用高度、180px offset 时弹层跟随可视区且可滚动。它不是安卓实体软键盘验收。证据：`chrome-local-ux.json` 与截图。

### Windows EXE / ZIP：真实本机启动完成

- 在隔离的 profile、HOME、AppData、Codex 工作目录和 TEMP 下，清空继承的 provider 凭据及 Electron/便携启动开关。两包均完成登录门禁、默认人物加载、Cubism 交互、休息/唤醒、可选小猫能力、后端健康与本机执行器在线注册验证；退出后本轮自有进程为 0，环境已恢复。
- 两包分别以同一隔离 profile 顺序启动两次均通过。记录的 EXE wrapper 生命周期约 `124.9 / 118.6` 秒，ZIP 约 `12.2 / 7.7` 秒；这些时间含测试与退出流程，不是首屏基准。单文件 EXE 每次启动有解压成本，需要更快打开时可保留 ZIP 解压目录并运行 `PetPal.exe`。
- EXE 完整读回有 5,047 项字节比对，其中前端 275 项；最终 1,272 个冻结输入未改变。ZIP 完整 CRC/内容读取 10,873 项，10,872 项运行资源与最终 EXE payload 相等，另含入口说明。10 项已知私有值扫描未命中；许可证及原生运行闭包保留。
- 两次 ZIP 原始完整 smoke 在人物 gesture 阶段失败。系统真实光标位置与合成按压位置不一致触发可信 `pointerleave`，生产逻辑正确取消手势。仅验收 harness 将系统光标移入同一人物 canvas 后，原完整断言全部通过并恢复原光标；未修改产品事件处理或放宽断言。两次失败的 `error.json`、日志和截图保留于 `windows-zip-smoke-first-failed/`、`windows-zip-smoke-second-failed/`，修正证据为 `windows-cursor-align.json`。
- 主要回执：`windows-exe-smoke.json`、`windows-zip-smoke.json`、`windows-exe-repeat.json`、`windows-zip-repeat.json`、`windows-exe-readback.json`、`windows-zip-private-audit.json` 与 `windows-final-verification.json`。

### Windows 中央服务器：包内实测完成，外部设备待验收

EXE 和 ZIP 均从实际设置 UI 完成配置、关闭应用、第二次启动恢复与禁用。验证了密码门禁、匿名与 bootstrap 凭据拒绝、密码登录、连接同一后端实例、端口冲突回滚、对外 HTTPS origin 热更新、`412×960` 布局、重新启动后登录前恢复监听，以及禁用中央服务器后 loopback 后端继续可用。所有本轮自有进程最终为 0。

证据：`windows-exe-central.json`、`windows-zip-central.json`、汇总 `windows-central-smoke.json`。测试监听 `0.0.0.0` 的临时端口，并通过本机 loopback 请求验证；尚未由其他手机/电脑经过局域网或防火墙完成连接。这不能代表用户实际公网转发、远程 Agent 任务或外部设备访问已经验收。

### Android APK：包审计完成，真机待验收

- `com.petpal.app`，versionCode `18`、minSdk `23`、targetSdk `35`；`zipalign` 与 v1/v2 签名校验通过。使用与 0.9.7 相同的开发证书，证书 SHA-256 为 `8ae49ee6b09900eee2e2996a0c4ecd659f94631f81b64c5df7fb53935835713c`。
- 完整读取并验证 718 个 APK 条目的 CRC，前端 275 项与冻结构建相同，另比对 2 个 Capacitor bridge 文件。APK 内真实 Core 执行、MOC 一致性、20 项模型资源、22 参数、16 drawable 和 2 个虹膜 mask 通过。
- 检查通知服务、返回/悬浮层与更新类存在；无桌面 CLI/服务器运行时、运行测试 fixture 或远程页面替换。10 项已知私有值扫描未命中。
- 未安装到 Android 真机，未验证实体麦克风、相机、音频设备、通知/省电限制、悬浮窗或实体返回键。证据：`android-apk-audit.json`、签名/zipalign 日志与 `android-build-source-review.json`。

### Ubuntu x64 / ARM64：完整包审计完成，真机待验收

- 两个 tar.gz 各验证 12,860 项完整归档内容，检查 ELF 架构、可执行权限、依赖及原生模块闭包。当前电脑控制 native 所需 GLIBC 版本为 `2.34`；Ubuntu 22.04 基线满足该版本要求，但未执行 Linux GUI runtime。
- 两包均含 Codex `0.143.0`、OpenCLI `1.8.8`、MCP SDK `1.31.0`、Cubism V12 与 Core；包内模型及运行资源和冻结来源逐字节匹配。Core 的实际执行位于验收主机，不能替代 Ubuntu GUI 渲染验证。
- OpenCLI 静态导入闭包及 23 个公开查询模块的宿主导入通过；目录包含 25 个查询网站、23 个公开查询命令与 46 个浏览器查询命令。此轮没有网络查询、真实 Agent 任务或 Linux 上的浏览器/软件操作。
- 每包扫描 11,404 个 payload 文件，10 项已知私有值未命中；未复制生产私有数据或覆盖生产前端。
- 证据：`ubuntu-package-audit.json`、`linux-package-x64-0.9.8.json`、`linux-package-arm64-0.9.8.json`、`ubuntu-query-import-closure.json` 与 `ubuntu-private-values-scan.json`。无 Ubuntu x64/ARM64 目标设备实测，不将包审计写成真机通过。

### Web 归档：完成

完整解开 Web.zip 后，其全部 275 项资源与冻结构建逐字节相同，审计前后包与构建均未改变。证据：`web-archive-artifact-audit.json` 与 `web-archive-audit.json`。在线静态页面、下载目录和更新源的切换归入下方发布验收。

## 正式发布与在线入口验收：完成

- 六个包已完成服务器 stage，状态 200 且服务器端摘要与冻结包一致，见 `server-stage.json`。stage 回执不等同于从公网完整下载六包。
- 本机已从 `https://magicdatou.top:44318/downloads/PetPal-0.9.8-Windows-x64.exe` 完整读回 220,895,153 bytes，SHA-256 匹配；TLS 校验开启、无重定向、无凭据、只读。其余本机下载流已停止以避免争用公网带宽，未写成全部本机回读通过。证据：`server-readback-PetPal-0.9.8-Windows-x64.exe.json`、`server-readback-local-scope.json`。
- 原始 GitHub Actions run `37270998208`（attempt 1、push event、固定 reviewed candidate）成功完成六包服务器 mirror 完整字节及 GitHub 官方 asset CDN 完整字节回读，总包体积 1,392,531,079 bytes；每项 bytes/hash 与上表相等，18 项完整 body/最终 asset ID 事件核对通过。四项 metadata 在本机经官方 API/CDN 完整回读，未将 Bearer 转发到 CDN。证据：`github-transfer/cloud-verification-37270998208.json`、`server-packages-full-readback.json` 与 `github-transfer/metadata-readback.json`。六包的这一完整公网验证发生在云端，不能写成本机读取六包。
- mirror 回执中的 URL、TLS 默认校验、无凭据和禁止重定向事实来自审查后的冻结 runner；原始日志提供 byte/hash 事件，并未输出 origin URL 或 HTTP status 字段。回执明确保留这两个事实来源的区别。
- GitHub [v0.9.8 正式版](https://github.com/lixinyu02/petpal/releases/tag/v0.9.8) 已为 stable/latest，release ID `403398605`，draft/prerelease 均为 false，tag 指向冻结源码 `5205e7e544182a504647a7a2273908e40c0db2c7`。发布前后 10 个 asset ID 未改变；正式状态、摘要与 sequence `10` 更新签名核对通过。证据：`github-publication.json`、`github-release-acceptance.json`。
- 生产静态前端已部署 275 项，并完成 HTTPS index 验证；保留部署前备份与下载清单，未重启后端。证据：`static-deployment.json`。
- 服务器 updater promote 的第一次预检因 ignored 发布 helper 错误要求 GitHub 与服务器两源的独立 key 相等而阻断，失败发生在写入前。helper 已按两源各自的可信 key、签名与 payload 修复，并经独立 peer 对 cross-key/cross-source 的拒绝复验；未修改客户端或降低验签要求。随后原子 promote 完成，保留旧清单备份。证据：`server-promote.json`。
- GitHub 和服务器更新源的 Windows x64、Ubuntu x64、Ubuntu ARM64、Android、Web 五个目标均返回 0.9.8、sequence `10` 与冻结摘要；Android versionCode 为 `18`。当前已经为 0.9.8 时，两源均不提示重复升级。验证读取源时未修改生产 provider/用户配置，见 `live-update-sources.json`。
- 按计划将 13 个旧 0.9.7 公共文件移至 `.data/release-archive/0.9.8-1791184023999`，完整摘要保留且可恢复；公共目录保留 15 个当前文件。旧路径 HTTP 404、当前路径 HTTP 200 通过，未删除文件，GitHub 历史 Release 保留。证据：`latest-only-archive-plan.json`、`latest-only-archive.json`。
- Chrome 插件实际打开 `https://magicdatou.top:44318/?chat=1` 并刷新后，下载页仅显示最新正式 0.9.8，优先服务器下载并提供 GitHub 备用。Windows 默认 ZIP，实际切换 EXE；Ubuntu x64/ARM64 切换均显示对应新包链接，选择项随后恢复。`412×960` 的页面与 body scrollWidth 均为 412，无横向溢出。
- `320×320` 下整段导航可滚动（内容 444px）；下载、设置、账号入口滚动后的底部分别为 206.5/248.5/308px。实际点击账号入口、弹层边界与退出登录后的门禁通过，最后恢复 viewport 并退出账号。没有发起模型/Agent 请求、开启媒体设备或重复下载包。证据：`chrome-production-098.json`、`chrome-production-downloads-412x960.png`。
- 捕获窗口中有 7 条 error，均为浏览器扩展来源；部署后两条为 Zotero 扩展消息。在该捕获范围内未观察到新的应用错误，但不宣称浏览器全局零错误。
- 公网 HTTPS health 为 200/`ok=true`。此次只切换静态网页、客户端包和公开更新清单，未重启既有业务后端；运行中的后端仍报告版本 `0.9.7`，不能写成后端 runtime 已升级到 0.9.8。`static-deployment.json` 记录 `onlyStatic=true`、`backendRestarted=false` 与保留下载清单，归档仅处理计划中的 13 个下载文件。
- 本轮 Chrome/API 操作没有发送聊天/Agent 请求或模型/语音配置写请求，仅建立、退出 test 登录会话。未对生产聊天、用户配置和任务做全量快照比对，也未重测真实上游 ASR/TTS/Agent；因此数据保持按上述操作范围表述，不宣称生产业务已完成全部端到端复验。

## 证据边界

Windows 两种分发均为 Authenticode `NotSigned`；Android 为开发证书签名。更新清单的 Ed25519 签名与操作系统安装包信任是不同验证，不能相互替代。

本轮真实 Windows 启动使用包内 runtime 和隔离数据；Codex 在线注册/进程可用不等于真实模型任务成功。未调用上游模型、ASR 或 CosyVoice，未打开麦克风/相机，未执行 OpenCLI 网站、音乐或用户应用控制任务。完整 smoke 经授权仅包含固定短句“你好，我是小伴。”的本机系统 TTS 事件探针；它不证明上游音色、流式朗读或端到端语音聊天已经验收，见 `native-speech-acceptance-scope.json`。

首次 fixture 未复现的错误、两次 ZIP gesture 失败、没有 Android/Ubuntu 目标设备、中央服务器没有外部设备验收以及云端/本地回读范围均保留，不以后续通过抹去这些边界。
