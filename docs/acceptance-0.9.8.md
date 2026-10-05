# PetPal 0.9.8 客户端验收

日期：2026-10-05。本轮构建与发布验收进行中，尚未发布。

## 本版内容

Cubism V12 自然眼睑、近期中央服务器、主题与动画、桌面生命周期和返回体验进入客户端。新增切换模式/历史/新对话的未发送内容保护，以及短屏导航与软键盘弹层适配。Windows EXE/ZIP、Ubuntu x64/ARM64、Android 与 Web 使用同一独立前端构建。

## 验证状态

- 前端与包工具修复、回归：进行中。
- 六个发布包：pending。
- Windows 真实启动与退出清理：pending。
- Android 证书、版本、完整 APK 读回：pending。
- Ubuntu ELF/权限/完整 tar 与依赖审计：pending。
- GitHub 和服务器更新、完整公网读回：pending。

## 证据边界

构建不使用生产 dist 作为输出。Windows 没有 Authenticode 签名；Android 沿用上一版开发证书。没有 Android/Ubuntu 目标设备时，包审计不视为真机验收。完整证据保存在 ignored `evidence/release-098-20261005/`；测试不调用真实模型、语音或操作用户软件。
