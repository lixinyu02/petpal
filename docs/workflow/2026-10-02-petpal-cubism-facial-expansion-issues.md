# Cubism V10 局部表情扩充 Issues

- Date: 2026-10-02
- Complexity: L2
- Related design: 2026-10-02-petpal-cubism-facial-expansion-design.md

## issue-1

- ID: issue-1
- 标题: 三套原生脸部表情与对话运行时接入
- 范围: 生成素材、局部 PSD、原生作者 profile、运行时、测试、网页验收与部署
- 依赖: 已完成 V9
- 验收标准: 新表情实际改变局部脸部；中性比例和旧层不变；眨眼口型兼容；Core/回归/Chrome/公网验证通过
- 状态: done
- 验证方式: PSD 14 层读回／旧11层像素保持；真实 Core 91 姿态及12表情眼口组合；289 项回归／TS／Vite；Chrome 六表情、实时切换、412×960与最终无缓存加载；201公网文件哈希一致。详见 ../cubism/facial-expressions-validation.md
- commit: 本文件所在 feat(issue-1) 提交（通过 git log -- 本文件定位）

## 自审

- [x] 新表情是实际局部素材和原生绑定，旧形象几何保持。
- [x] 旧模型兼容、表情互斥、口型优先和退出生命周期通过。
- [x] 新增 Core 冷下载超时修复有确定性回归与最终公网证据。
- [x] 只更改本 issue 文件，保留业务数据、服务进程、下载包和旧资源。
- [x] 来源、提示词、重建合同与未验收边界已记录。
