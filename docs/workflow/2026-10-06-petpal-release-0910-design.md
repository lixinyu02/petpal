# PetPal 0.9.10 正式客户端重打

- Date: 2026-10-06
- Complexity: L2
- Status: completed

## Background

现有正式客户端为 0.9.9；网页与后端已加入语音打断、Chat 主动接收 Agent 结果、对话归档／重命名／删除和账号项目分类。用户要求将当前功能重打进客户端。

## Goal

从同一冻结源码构建并发布 Windows EXE/ZIP、Ubuntu x64/ARM64 tar.gz、Android APK 与 Web ZIP。版本 0.9.10，Android versionCode 20，两个更新源的 stable sequence 12。下载中心只显示最新正式客户端，优先服务器下载。

## Non-goals

不升级第三方运行时，不改变账号／模型／网络设置，不改 RK3566 固件或其他工程。无实体 Android／Ubuntu 设备时不宣称真机验收。

## Solution

先同步 package/lock/Android 版本，补全新增运行模块的包装审计合同并验证；提交 issue-1 作为唯一源码冻结点。issue-2 内从隔离前端产物构建六包，平台子任务可以并行，发布前完成包完整性、模块及许可证、敏感值检查和 Windows 原生启动验证。

记录每包 SHA-256、大小、冻结 Git SHA 和 Android 签名连续性。GitHub 与服务器分别沿用现有 Ed25519 信任锚；清单五个更新目标，Windows ZIP 为额外下载项。先准备和验证六包再发布正式版及升级清单。服务器静态与下载文件阶段化切换，旧下载移入私有可逆备份，GitHub 历史版本及本机构建保留。

后端升级前重读运行 PID 和所有账号的活动任务／流／队列，保留私有状态及服务设置备份；只在空闲窗口精确重启本服务并检查业务数据和健康状态。Chrome 插件验收登录下载与更新，检查 412×960 的移动布局。

## Impact

改动版本字段、必要打包验证合同和发布文档；生产服务将升级到 0.9.10。Windows 仍支持免安装 EXE 与解压目录版；Android 保持现有开发签名可覆盖更新。

## Risks

公网上传可能依赖当前本机代理；沿用进程级代理，不修改全局设置。Windows 未有商业 Authenticode，Android 使用原有开发证书，与更新清单验签分开报告。包构建不得使用生产 dist 或将 .data、真实凭据放入包内。生产重启不得用共享控制台 Ctrl+C 或宽泛进程终止。

## Verification Plan

版本和包装合同相关回归、TypeScript、隔离 Vite；六包全量读取与哈希、源文件比对、许可证和私有值扫描；Windows EXE/ZIP 原生 smoke 和退出清理；APK zipalign／签名／上一版本证书比对；Ubuntu ELF 架构和依赖归档审计。发布清单与两源签名、服务器/GitHub 实际字节回读，最新正式版身份及旧公共路径归档检查。Chrome 验收正式下载与登录门禁；如缺真实设备，明确保留该验证边界。
