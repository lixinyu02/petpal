# 小伴原创 Cubism Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-cubism-design.md

## Task Overview

- Goal: 原创分层模型与真实 Cubism 渲染，复用现有语音情绪和触摸。
- Ordering rule: 本 issue 内并行美术、编译器与渲染独立子任务。
- Current status: issue-73 done；网页已上线，客户端保持现有安装包。

## Issue List

- [x] issue-73 原创完整 Cubism 模型与共享场景

## issue-73

- ID: issue-73
- 标题: 创建原创 Cubism 资产并接入四端共享渲染
- 范围: imagegen 分层素材、PSD/MOC3 编译、官方 Framework/Core 适配、参数桥和浏览器验收
- 依赖: issue-72 已完成
- 验收标准: 真 MOC3 通过 Core 检查与渲染；情绪/眨眼/头发/视线/口型/触摸正常；无 Core 和无 WebGL2 安全降级；412×960 不拥挤；保留客户端旧包
- 状态: done
- 验证方式: 素材/hash/PSD 审计、独立编译、Core 版本/一致性、相关自动回归、TS/build、Chrome 与公网读回
- commit: feat(issue-73): add original Cubism companion

验收：官方 Core 35 姿态／负例、实际 authoring 入口重建、完整回归 1300/1300、TS／build／源码包检查、Chrome 生命周期／严格 CSP／CSS 412×960、公网真实 CosyVoice 与停止闭嘴、32 资源 hash 读回。见 `docs/cubism/validation.md`。CMO3 官方 Editor 与客户端实机未验收；本轮未重打包或更新签名清单。
