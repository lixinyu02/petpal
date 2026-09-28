# PetPal 0.5 桌面交付验收

日期：2026-09-28。范围：Windows x64、Ubuntu x64/ARM64 与源代码。Android 保留 0.4.0，本轮未重新构建 APK。目录不是 Git 仓库，未创建 commit。

## 本轮变化

- 内置真实 Codex CLI 0.143.0、OpenCLI 1.8.8，Electron 固定 39.8.10。桌面运行不依赖系统 Node/npm。
- 「电脑助手」设置提供独立 Responses API 模式、本机登录模式、音乐状态与操作、OpenCLI 档案选择/连接/断开和音乐官网入口。
- API 模式在 PetPal 数据目录隔离 Codex 配置、用户目录、工作区与线程 revision。密钥仅通过固定子进程环境注入；公开接口不返回密钥。更换 API 地址需要重填或清除旧密钥，更改配置后须新建工作会话。
- Windows 通过指定播放器的 GSMTC 会话，Ubuntu 通过 MPRIS 控制 QQ 音乐或网易云音乐。动作限定打开、播放、暂停、上一首和下一首；没有会话或缺少能力时拒绝操作，不回退到全局媒体键。
- OpenCLI 使用真实上游 daemon 和页面方法，要求官方 Browser Bridge。显式选择 Chrome 档案，每个页面持有独立租约；兼容的已有 daemon 可共享且不会被终止或重启。只读状态不会附接浏览器或启动播放器。

## 验证结果

最终全套 **169/169** 自动测试通过，TypeScript/Vite 生产构建通过。最后对播放器显式打开动作的窗口显示方式作单行修正后，PowerShell AST 及音乐/工具 **10/10** 针对性复验通过。三维渲染分块仍有 Vite 大于 500 kB 的体积提示，构建成功。

真实内置 Codex 0.143.0 连接了隔离的本地 Responses 模拟服务，完成 5 次请求：动态音乐工具请求、一次明确审批、一次模拟动作、结果回传、同线程恢复，以及额外文件写入被拒绝。状态探测没有发起模型请求。证据：`evidence/codex-api-live-0.5.json`、`evidence/backend-0.5-acceptance.md`。

CLI 请求中确认 shell/exec/write_stdin 和 goals 未开放；该固定版本仍提供 apply_patch/view_image，保持只读沙箱，API 模式的命令/文件提权审批被拒绝。没有声称移除了全部内建工具。

OpenCLI **17/17** 测试覆盖显式档案、同版本共享、逐页独立租约、进程身份变化拒绝、来源撤销、真实上游 snapshot/click/fill/key 脚本、取消不重试、输出限制、关闭所有租约的错误汇总和自有进程退出等待。真实 OpenCLI version/help 在内置 Electron Node 模式运行通过；生产依赖审计为 0 个漏洞。开发安装链仍报告 extract-zip 相关 high 告警，未通过扩大依赖升级掩盖，见 `evidence/npm-audit-0.5.json`。

Chrome 插件实际完成了 owner 电脑助手页面、空密钥测试配置保存/回读、未验证连接提示、恢复本机模式、媒体能力按钮和 OpenCLI 未连接状态验收。手机布局有效 CSS 宽度与 scrollWidth 都为 **391**，无横向溢出。截图为 `evidence/desktop-assistant-0.5.png` 和 `evidence/desktop-assistant-mobile-0.5.png`。

本机最初检测两款播放器已安装但没有媒体会话，之后只读状态检测到 QQ 音乐已有播放中的媒体会话，暂停和切歌能力随之启用；网易云音乐仍无会话。该播放由 PetPal 外部产生，本轮没有启动、暂停、切换或播放任何实际歌曲。

## 发行包

Windows 最终 EXE 已实际启动，双 CLI 可用、透明桌宠/两形象切换和退出清理通过，自有遗留进程为 0。从最终 EXE 双层解包后，**1,958 个文件**与冻结源核对通过，包括 OpenCLI 的 16 个依赖包、Codex 原生程序、新增 helper 和 22 项前端资源。最终包内 Electron 39.8.10 与 OpenCLI 1.8.8 版本命令实测通过，详见 `evidence/native/windows-0.5-final-verification.json`。

Ubuntu 两架构均完成归档审计：每包 **6,955/6,955 个文件**与冻结打包目录的长度/SHA-256 双向一致，7,546 个归档成员、6 个正确架构的 ELF、16 项应用源和 22 项前端文件通过。OpenCLI 依赖图为 17 个包、16 条依赖边、0 个缺失；许可证与核心运行文件完整，详见 `evidence/linux-package-audit-0.5.md`。这是包内容验收，Ubuntu 目标机 GUI 尚未验证。

| 产物 | 文件名 | 字节数 |
| --- | --- | ---: |
| Windows x64 | `PetPal-0.5.0-Windows-x64.exe` | 180,907,721 |
| Ubuntu x64 | `PetPal-0.5.0-Ubuntu-x64.tar.gz` | 274,694,082 |
| Ubuntu ARM64 | `PetPal-0.5.0-Ubuntu-arm64.tar.gz` | 269,011,196 |

Ubuntu 解压完整目录后运行 `./start-petpal.sh`；内置 `codex.sh` 和 `opencli.sh` 可用于版本检查。Windows 直接打开便携 EXE。源包由显式清单收集，不含运行数据或真实凭据，并对 ZIP 内每个文件独立读回比对。最终产物的长度和 SHA-256 以 `releases/release-manifest.json` 和 `SHA256SUMS.txt` 为准；manifest 只有在 Windows、Ubuntu 与源包验收门禁全部通过后生成。旧版安装包与验收快照保留。

## 适用边界

真实供应商 API、实际音乐控制、Chrome 音乐网站交互与 Ubuntu 图形桌面均未实机验证。本轮未附接或干扰用户已有 OpenCLI daemon。Windows 包未商业签名；Ubuntu X11/Wayland、ARM64 驱动和媒体接口需在目标机验证。没有安装、烧录或重启 RK3566 板卡。

OpenCLI 1.8.8 本身没有 QQ 音乐/网易云音乐专用 adapter；音乐网页入口利用其浏览器桥能力，不能绕过账号、会员、验证码或网页自动播放限制。OpenCLI 可能复用其分组内无活跃租约的空闲页；来源检查不是网络沙箱。取消不能撤销已发生的点击或媒体操作。

账号、语音和头像沿用现有功能；远程 TTS/ASR 仍为配置预备，Cubism Core/moc3 未集成。本次不新增这些功能的通过声明。详细使用方式见 [电脑音乐助手](desktop-music.md)。
