# 四端体验与 0.9.8 正式客户端

- Date: 2026-10-05
- Complexity: L2
- Status: complete
- Baseline: local main `01289a987f1e11e177f19208fd0b89b5308b2bc0`，开工 clean。

## Background and Goals

用户要求继续优化四端并完成客户端打包。0.9.7 安装包仍含 V11；近期 V12、中央服务器、主题、动画、输入/返回与生命周期修复尚未进入包。本轮封装这些已完成能力，并修复已复现的草稿切换丢失及键盘/短窗布局问题。视觉继续暖白/墨绿，工作区与伙伴为中心；只增加操作所需的提示，保留原有轻量入场和菜单过渡，减少动效设置继续生效。

## Solution

1. 新对话、Chat/Agent、历史对话、伙伴主页的离开入口保护未发送文字/图片。需要丢弃时提供明确的继续编辑/丢弃切换弹层，不自动提交、存储、派发 Agent 或改变权限；忙态与未确认提交守卫保留。
2. 通用普通弹层按 visualViewport 的高度/偏移约束，在软键盘出现时内部可滚动；短窗口移动导航整体滚动，使下载/设置/账号可达。412×960、320×540 和更短窗口由 Chrome 验收。
3. 版本 0.9.8，Android versionCode 18，沿用当前 APK 证书和两源升级信任密钥。Windows EXE/ZIP、Ubuntu x64/ARM64 tar.gz、Android APK、Web ZIP 在独立目录构建；不会把线上 dist 作为构建输出。
4. 更新旧 Windows 打包验收工具，检查真实 Cubism V12 / v3 以及对应平台成员，独立输出/证据避免覆盖旧版。包内中央服务器、Codex/OpenCLI、MCP、模型与许可完整核对。
5. 全套串行回归和构建冻结后，归档完整读回、签名/摘要/来源检查，Windows 两包真实隔离启动。验证后的包发布为 stable，更新 GitHub 和服务器 signed manifest（sequence 10），下载页仅最新正式版、服务器优先。上一版公共文件可恢复移入私有回退目录，历史 GitHub Release 保留。

## Boundaries and Risks

不修改生产模型/API/账号授权、重试已有 Agent、调用上游 ASR/TTS 或操作用户软件，不触 RK3566/PSTX/相关 WSL。Windows默认启动验收只允许系统本地中文音色播放固定短句“你好，我是小伴。”并检查结束事件，不打开麦克风/摄像头或发送个人文本。生产只更新网页和下载资产；没有后端业务改动则不重启后端。签名私钥只在私有目录读取，不输出或提交。Windows 未提供 Authenticode，不宣称已签名；Android 保留开发证书以支持旧安装升级。没有 Android/Ubuntu 设备时，分别记录包审计与真实运行边界。

## Verification

实际 App handlers 回归、DOM/键盘焦点、CSS 视口和 Windows 工具合同测试；TypeScript、最终一次全套串行回归。Chrome 插件对本地隔离 UI 与正式下载页验收。Android APK v1/v2 与旧证书一致，ZIP CRC/完整网页字节/原生类及 privacy 检查；Ubuntu tar 完整字节、ELF/权限/GLIBC/native来源/依赖闭包；Windows EXE+完整解压 ZIP 真实启动、两个窗口 Cubism V12、登录/执行器/中央服务器/CLI状态和退出进程清理。发布前后两源五目标签名、sequence、版本、文件摘要及公网读回。

## Delivered

六个0.9.8正式包已发布，tag固定构建源码 `5205e7e544182a504647a7a2273908e40c0db2c7`，[GitHub Release](https://github.com/lixinyu02/petpal/releases/tag/v0.9.8) 为latest stable。Windows EXE与ZIP真实启动/重复启动/中央服务器配置和退出清理通过；Android与Ubuntu分别完成完整包审计，保留真机未验收边界。完整确认轮1933/1933通过，早期fixture失败未重现且原因未确定，没有修改协议或增加重试掩盖失败。

线上275项静态资源已部署，服务器下载优先、GitHub备用；两源五目标sequence10均通过。旧版13项公开下载可恢复归档，历史GitHub Release保留。Chrome实际412×960与320×320完成新版下载选择/短屏导航/登录门禁验收，截图和结构化记录保存在 `evidence/release-098-20261005/`。六包公网完整回读由原始GitHub Actions执行并明确归属，本机四metadata及服务器EXE完整回读另行保留。

生产后端没有业务代码改动或重启，health仍报告既有0.9.7进程且HTTPS200/ok。测试没有发送聊天、Agent或模型/语音配置写请求，仅登录和退出test会话；不声称生产数据全量快照对比或上游业务全面复验。详细证据、安装方式与已知限制见 `docs/acceptance-0.9.8.md`。
