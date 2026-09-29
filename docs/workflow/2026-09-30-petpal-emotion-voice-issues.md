# 二次元表情与朗读联动 Issues

- Date: 2026-09-30
- Complexity: L2
- Related design: 2026-09-30-petpal-emotion-voice-design.md
- Current status: issue-39 done

## issue-39

- ID: issue-39
- 标题: 五类情绪表演与 TTS 节奏联动
- 范围: 表情选择与缓动、眼眉/嘴角/泪光/姿态渲染、同角色素材、TTS能力探测和真实联动验收、网页部署
- 依赖: issue-38 done
- 验收标准: 开心、伤心、难过、兴奋、害羞可辨别；真实朗读中表情/口型同步工作，停止与低动态边界正确；现有用户数据保持；说明上游声音情绪能力的实际边界
- 状态: done
- 验证方式: 75 项相关测试、TypeScript、隔离 Vite 构建；Chrome 五类实际 CosyVoice 流式朗读及 412×960 截图；DOM 回退、贴图缺失与减少动态；14 项公网资源哈希、6 项匿名 401 和完整生产状态保持。详见 acceptance 文档。
- commit: 本 issue 对应的 `feat(issue-39): add expressive anime emotions synced with speech` 提交
