# Live2D 动效迭代

- Date: 2026-10-02
- Complexity: L2
- Related design: 2026-10-02-petpal-cubism-polish-design.md
- Current status: issue-1 done

## issue-1

- ID: issue-1
- 标题: 原创角色颈肩拼接修复与动作、表情和口型过渡
- 范围: 连续 body 美术 / PSD / 新 authoring profile / MOC，动作 / 物理资产，runtime 参数合成、场景联动、验收与网页上线
- 依赖: 既有原创 MOC3、Core / Framework 已验收
- 验收标准: 中性姿态无脖子 / 领口硬直拼接与重复锁骨，组合姿态不明显脱节；TapHead / Greet 有独立真实动作；Idle 克制；动作与表情衔接自然；口型停止立即闭合；隐藏 / 休息 / 减少动态不回放旧动作；窄屏完整呈现；原资源及数据保留
- 状态: done
- 验证方式: 官方 Core / Framework 动作检查、相关回归、TS / 隔离构建、浏览器与公网资源读回
- commit: 本 issue 的 `fix(issue-1): repair Akari neck seam and smooth Cubism animation` 提交，实际 SHA 见 Git 日志

验收结果：连续颈肩源层和新 rig 已通过真实 Chrome 静态／互动／模拟口型视觉检查；111 项相关回归、TS、隔离构建、官方 Core 检查通过。Chrome 生命周期与 412×960、公网 HTTPS 登录通过，44 个公网资源读回一致，原子静态部署保持后端 PID／账号／token／下载包／升级清单。CMO3 官方 Editor 再导出、客户端打包与实体设备仍为明确边界，见 `docs/cubism/validation.md`。
