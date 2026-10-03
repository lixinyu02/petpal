# 加载与交互优化 Issues

- Date: 2026-10-03
- Complexity: L1
- Current status: done

## issue-1

- ID: issue-1
- 标题: 精简原生角色加载并优化触控模型选择
- 范围: Cubism/备用加载边界、静态占位、模型菜单焦点与小屏按钮
- 依赖: main 5cfd38c；上一轮 1593/1593 回归
- 验收标准: 成功路径不启动备用 GPU 或表情资源；备用与共享动作正常；触控不抢搜索焦点，键盘仍可操作；Chrome 窄屏无溢出
- 状态: done
- 验证方式: baseline/优化后构建依赖图、真实 Chrome、组件/生命周期回归、TypeScript
- commit: 本文件所属 perf(issue-1) 提交（完成实现、回归、Chrome 与公网部署）

验证结果：TypeScript/生产构建通过，52/52 聚焦与 1603/1603 完整回归通过；真实 Chrome 原生 GPU 创建/峰值 2/2 → 1/1，原生静态 JS 889,067 → 345,785 bytes（61.11% 减少）。412×960 无横向溢出、触控不抢搜索焦点、关闭按钮 44×44；context loss 按需备用、sleep 保持、局部恢复与唤醒通过。16 项公网资源完整哈希比对通过。验证范围与测量限制见同名 design。

隔离证据目录：ignored `evidence/avatar-performance-20261003/`。保持 0.9.7 正式包与标签不变。
