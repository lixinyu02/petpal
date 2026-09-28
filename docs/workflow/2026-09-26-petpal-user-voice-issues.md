# 用户隔离与语音入口 Issues

- Date: 2026-09-26
- Complexity: L2
- Related design: [design](2026-09-26-petpal-user-voice-design.md)

## Task Overview

- Goal: 落地管理员建号、模型分配、用户隔离、TTS/ASR 配置入口和麦克风/摄像头/扬声器选择。
- Ordering rule: 同一跨层 issue 内分工，保持仅一项进行中。
- Current status: issue-5 done；0.3 产物与历史证据保留。

## Issue List

- [x] issue-5 多用户与语音配置

## issue-5

- ID: issue-5
- 标题: 用户身份、模型权限与预备语音设置
- 范围: 原子迁移、账号与会话、后端资源隔离、前端账号切换、管理员授权、语音设置、设备枚举/输入预览/输出自测、媒体生命周期及回归/交付说明
- 依赖: issue-4 done
- 验收标准: 跨用户不可读写/停止会话；模型授权有效；普通用户无主机 Codex；设置按用户持久化且密钥不回显；换账号清旧状态；语音配置预备状态明确；输入选择使用指定设备且退出释放，扬声器不支持路由时明确提示系统默认
- 状态: done
- 验证方式: 迁移/鉴权/授权/异步生命周期测试、构建、实际 UI 流程及发行资源核验
- commit: not possible - not a git repository

### 集成验证

- 冻结源码自动测试 116/116、TypeScript 和 Vite 生产构建通过；回执 `evidence/test-results-0.4.json`、`evidence/web-build-0.4.json`。
- Chrome 完成管理员→成员 A→成员 B→A，验证模型授权、默认模型和语音设置独立保存；测试音播放结束，391 CSS 像素手机布局无横向溢出。详见 `evidence/user-voice-acceptance-0.4.json`。
- 本轮没有启动真实摄像头/麦克风采集，也没有人工听音确认。设备选择约束、权限和生命周期的源码/测试证据不能替代物理设备验收。
- Windows 最终 EXE 运行、内置 CLI、ASAR 32 个资源/源文件比对和退出后进程清理通过；Android APK 签名、媒体 guard、可选硬件与资源比对通过；Ubuntu x64/ARM64 各 5,019 个文件全字节比对通过。Android 与 Ubuntu 实机运行未验证。
- 发行证据以 `docs/acceptance-0.4.md` 和各 final 回执为准；源码归档由白名单打包脚本生成，最终 release-manifest 对五个产物逐项匹配回执字节和 SHA-256。
