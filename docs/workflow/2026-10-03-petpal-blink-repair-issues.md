# V11 轻触眨眼修复 Issues

- Date: 2026-10-03
- Complexity: L1
- Related design: 2026-10-03-petpal-blink-repair-design.md
- Current status: done

## issue-1

- ID: issue-1
- 标题: 修复 V11 轻触时旧眼睑曲线叠加
- 范围: 原生运行时眼睑 ownership、真实 Core 回归和本任务跟踪文档
- 依赖: 0.9.7 冻结构建 2d5b654 保持
- 验收标准: 轻触仍有头/手动作；眼睑无旧 0.26 长停留；自然眨眼、嘴型、Wink 与旧模型兼容；模型资产和冻结包不变
- 状态: done
- 验证方式: 实际 V11 + 官方 Core 6.0.1 在修复前重现 3 个失败，其中连续低开度持续 1.033 秒，切换动作后旧开度仍为 0.26；修复后新增 5 项真实 Core 测试通过，人物/Cubism/交互相关 273/273、TypeScript、git diff --check 通过。已自审运行时改动仅 V11 TapHead 及淡出阶段；V10/导入模型、Wink、嘴型和头手动作回归通过。网页点击/412×960 视觉验收已完成；随后追加 V12 原生眼睑形状修复。
- commit: 与 V12 眼睑形状修复合并为 fix(issue-1): align Cubism eyelids and touch blinking

## 安装包边界

本次只修改运行时源码与测试。未改 public 下的模型资产、版本号、Release 文档或任何冻结包；Ubuntu 两包 SHA-256 再核对仍为 `f7e74bfcc652335198d5766cad6699b830e70e85f0871b43024086efc33d1242` / `31a44e86b1737a5de46c02a10a109f3028a4c3e43e4ae2dd2c53b6294b0b36e6`。只有之后从这次源码构建并部署的网页才包含修复，既有安装包不能视为已修复。

回归日志：`evidence/blink-repair-20261003/regression.log`。

## 后续验收完成

V11 运行时修复已实际部署和点击/触控验收；用户继续指出形状不自然后，又以独立 V12 模型修复闭合轮廓。两层修复已合并在线 Web，详细验收见 ../cubism/akari-natural-eyelids-acceptance.md。仍不改变冻结 0.9.7 客户端字节。
