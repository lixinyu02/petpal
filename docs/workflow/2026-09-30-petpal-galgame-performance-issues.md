# 二次元台词演出 Issues

- Date: 2026-09-30
- Complexity: L2
- Related design: 2026-09-30-petpal-galgame-performance-design.md
- Current status: issue-40 done；此前 TTS 服务恢复仍待外部管理条件

## issue-40

- ID: issue-40
- 标题: Galgame 风格表情与单次动作演出
- 范围: 新表情、台词动作控制器、WebGL/DOM 渲染、同角色素材、浏览器验收和网页部署
- 依赖: issue-39 源码交付完成
- 验收标准: 新表情与动作可区分，不因逐字更新反复触发，不覆盖口型；手机和降级仍显示同一角色；生产数据保持；语音服务实际结果单独说明
- 状态: done
- 验证方式: 230 项综合回归、最终笑眼修复 9 项回归、TypeScript、隔离构建、Chrome 桌面/412×960/降级/缺贴图/低动态、公网资源哈希与六项匿名门禁通过。详见 ../galgame-performance-acceptance.md；真实 ASR 3/3 通过，TTS 未恢复单独记录。
- commit: 本 issue 的 feat(issue-40) 提交
