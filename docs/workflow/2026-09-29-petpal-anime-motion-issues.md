# 二次元伙伴动作增强 Issues

- Date: 2026-09-29
- Complexity: L1
- Related design: 2026-09-29-petpal-anime-motion-design.md
- Goal: 先上线网页体验轻飘发梢与丰富表情
- Ordering rule: 顺序完成 issue，同一 issue 的独立模块可协作实现。
- Current status: issue-31 done，issue-32 in_progress

## issue-31

- ID: issue-31
- 标题: 发梢动画与自然表情
- 范围: 发束模块、表演控制器、WebGL/DOM 渲染与回归
- 依赖: issue-30 done
- 验收标准: 发根与面部稳定，左右发梢轻摆；开心／俏皮／关切可辨，过渡平滑，互动不伪造语音；休息、隐藏、减少动态及降级正确
- 状态: done
- 验证方式: 发束9项、表演最终20项通过；全量586项通过（新增最后1项表演测试另经定向验证），TS/Vite隔离构建通过。自审并修复DOM眉毛覆盖基础表情的问题；独立表情通道不干扰口型，未增加GPU贴图。
- commit: 本提交

## issue-32

- ID: issue-32
- 标题: Chrome 验收与网页预览部署
- 范围: 桌面／窄屏实际验收、必要修正、隔离构建、备份部署及记录
- 依赖: issue-31
- 验收标准: 实际页面动作与降级通过；保留账号与聊天，生产页面可访问；不更新安装包
- 状态: in_progress
- 验证方式: pending
- commit: pending
