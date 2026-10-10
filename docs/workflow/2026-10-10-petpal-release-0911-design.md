# PetPal 0.9.11 正式客户端发布

- Date: 2026-10-10
- Complexity: L2
- Status: in_progress

## Background

用户要求发布包含最近性能与稳定性优化的新版客户端。当前正式版为 0.9.10；当前源码已完成聊天/人物加载优化、无损纹理缩小、轻量预览、空闲后台轮询暂停与认证语音状态复用。

## Goal

从同一冻结源码构建 Windows 便携 EXE/目录 ZIP、Ubuntu x64/ARM64 tar.gz、Android APK、Web ZIP。正式版本 0.9.11，Android versionCode21，GitHub 和服务器 stable sequence13。同步软件内更新与服务器优先下载，下载中心只显示最新正式版。

## Solution

issue-1 同步版本、验证包装合同并提交冻结来源。issue-2 内允许平台构建/审计并行。使用全新隔离构建目录，禁止消费生产 dist 或复制私有数据。完整校验包体、来源资源、CLI/native 架构、许可证、APK 签名连续性及已知私有值。Windows 完成真实启动；其他平台缺少目标设备时保持静态审计边界。

沿用现有 Android signer 和两个 Ed25519 更新信任锚，不升级第三方运行时。发布前绑定六包大小、SHA-256、来源提交及审计回执。先上传并校验草稿，再发布 stable/latest。服务器包与签名更新清单分阶段切换，旧公开包精确移入私有可恢复备份；保留 GitHub 历史版。

服务升级前刷新真实 PID、创建时间、命令及监听身份，确认所有账号无活动任务/流/队列；备份状态，使用 guardian 所有权维护标记和既有启动脚本精确重启。验证非动态业务字段与配置保留、health0.9.11。Chrome 验收登录下载和移动布局。

## Risks and Boundaries

公网大文件传输可能失败；保留每次结果并先对账再恢复。Windows 未有商业 Authenticode，Android 沿用开发证书。清单签名与平台签名分别报告。不得触碰 RK3566 固件、路由器或其他工程，不把归档审计写成目标设备运行成功。

## Verification Plan

版本/包装/更新/下载与本轮性能相关回归，tsc 和隔离 Vite。六包完整读取、冻结资源比较、敏感数据扫描，Windows 原生启动与退出清理，APK zipalign/apksigner/版本与旧 signer 比较，Ubuntu ELF/全包完整性与模式检查。两源清单验签及实际升级发现，发布资产身份/字节验证，服务器下载完整字节回读。重启后状态保留及 Chrome 最新下载验收。
