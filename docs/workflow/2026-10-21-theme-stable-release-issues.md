# UI主题与正式发布 Issues

- Date: 2026-10-21
- Complexity: L2
- Related design: 2026-10-21-theme-stable-release-design.md

## issue-1

- ID: issue-1
- 标题: 四端深浅色/响应式优化并发布正式客户端
- 范围: 经验证的主题与布局修复、统一版本、四端包及x64/arm64、正式发布/升级清单、网页后端部署和验收。
- 依赖: none
- 验收标准: 核心页面日夜主题文字/控件清晰，无手机横溢/遮挡；平台功能保留；正式包及签名升级源可用，业务与私有配置保留；运行/静态/模拟器证据边界明确。
- 状态: done
- 验证方式: 主题/权限/语音等80项、Linux闭包与隐私100项、桌面主题92项和Windows闭包16项已通过。完整3586项中3578通过/6条件跳过/2本机超时；超时所属真实CLI审查文件单独复跑9通过/1条件跳过，覆盖原2项。Chrome已实测1366×900、412×960、360×640、393×852、960×412日夜主题及手机模型搜索/权限弹层；无横溢，权限控件44px。Web归档306文件全量回读通过。Android、Windows、Ubuntu包及正式发布验收详见verification。
- 发布验收: GitHub Release 418674946 已正式设为 latest；唯一 CI 39469583282 首次运行成功，十资产完整回读；服务器六包完整 HTTPS 回读、catalog 仅展示0.9.14、两源 sequence16 签名与原公钥、网页后端0.9.14及业务/代理/旧下载保留均通过。Windows 双包真实启动与主题持久化、Android API36模拟器、Ubuntu x64 WSLg通过；Android真机与Ubuntu ARM64完整桌面未验收。细节见同日期 verification。
- commit: 7b8f84f5b3962efaebbacb3d5af72cecdc790e59（产品）；发布验收文档提交见 Git 历史，产品 tag 不重指。
