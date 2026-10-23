# 真实 Cubism 人物计数优化对照

- 日期：2026-10-23。
- 关联：`2026-10-23-deep-fluidity-design.md`／`issues.md` 的 issue2。
- 基线详见 `2026-10-23-avatar-fluidity-baseline.md`。本文只报告指定工作负载下实际 DOM／几何工作减少，不宣称 GPU FPS、功耗或首帧速度改善。

## 实现与一致性

本轮只改单次 pointer／refresh 操作内共享 rect，以及 Cubism 连续诊断数值100ms采样。异步 tap／hold／hover 的验证重新测量；重入操作有独立缓存，操作结束释放。内部 `frames`、模型 update／render 仍逐帧执行。首两帧及 phase、action、gesture、expression、motionGroup 等语义变化立即发布，隐藏／恢复使连续数值缓存失效。

没有改 transform／refresh 顺序、命中区域、绘制节拍、DPR、纹理、抗锯齿、模型动作或 loader。没有引入跨事件或跨帧几何缓存，没有做 transform 投影。

前后均使用同一生产构建夹具、官方 Core、真实 V12 MOC 与纹理，静态 loopback 提供，无 HMR／账号／上游服务。基线产品 HEAD 为 `a44330eb92a1b27f2caca2442e64ea22dbe78530`；after 构建时 HEAD 为 issue1 的 `38e365d41c98e7e59f5db83e02a63184aaefdb47`，产品优化尚未提交，以收据中的实际源码摘要识别该候选，不能声称 after 为干净 HEAD 构建。

`avatar-after-comparison.json` 完整核对34个源码输入，仅4个运行时文件不同：`CubismScene.tsx`、`scene-loop.mjs`、`interaction.mjs`、`gesture-feedback.mjs`。性能夹具 TSX／CSS 与基线摘要相同，HTML 与 issue1 提交逐字相同；60个模型、Core、Framework、预览、CSS、Three等冻结资源按名称／长度／完整 SHA256 相同。

## Chrome 六轮 after 原始结果

主代理独占 Chrome，通过同样 DOM 按钮依次采3轮静置、3轮固定指针。六轮全部前台可见、真实 `cubism`、`valid=true`、`errors=[]`。DPR1.5、drawing buffer1350×752、MOC版本5／Core版本100663297，与基线一致；`modelDelayMs=0`。全部资源与结果保存在独立 `avatar-after/`，未覆盖基线。

| 场景 | 轮次 | 时长 ms | 诊断帧计数增量 | rAF 回调 | rect 读取 | data 属性变更 | style 属性变更 | 全部属性变更 | 指针事件 | 窗内长任务 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 静置 | 1 | 10000.4 | 300 | 1592 | 0 | 219 | 0 | 219 | 0 | 0 |
| 静置 | 2 | 10000.4 | 300 | 1600 | 0 | 201 | 0 | 201 | 0 | 0 |
| 静置 | 3 | 10005.0 | 299 | 1600 | 0 | 235 | 0 | 235 | 0 | 0 |
| 固定指针 | 1 | 10001.6 | 301 | 1599 | 2948 | 556 | 1164 | 1722 | 1201 | 0 |
| 固定指针 | 2 | 10001.6 | 302 | 1600 | 2948 | 570 | 1165 | 1737 | 1201 | 0 |
| 固定指针 | 3 | 10000.4 | 299 | 1597 | 2948 | 556 | 1164 | 1722 | 1201 | 0 |

固定指针与基线相同，为120Hz目标的合成 `PointerEvent`，均1201次、`trustedPointerEvents=0`，覆盖头→手→头→离开路径。它验证真实组件的输入与反馈代码，不代表物理输入或真实 CSS `:hover` 验收。

## 三轮中位数对照

| 指标／每个约10秒窗口 | 基线 | after | 计数变化 |
| --- | ---: | ---: | ---: |
| 静置 data 属性变更 | 640 | 219 | 减少65.78% |
| 指针 data 属性变更 | 1523 | 556 | 减少63.49% |
| 指针 rect 读取 | 4362 | 2948 | 减少32.42% |
| 指针全部属性变更 | 2690 | 1722 | 减少35.99% |
| 指针 style 属性变更 | 1165 | 1164 | 基本保持 |

这是同夹具下对真实调用／变更记录的短时对照。微表情周期在连续采样中的起点未逐帧对齐，不将三轮差异解释成固定每帧姿态配对。rAF 仍约1600次／10秒，没有降低其调度或人物绘制节拍；style 工作基本保持，符合本轮保留视觉行为的范围。

after 的 `renderFrames` 属性本身已按诊断节拍发布。窗口边界可带来约±3帧偏差，因此301／302不表示超过30FPS，299也不据此解释为实际丢帧。确定性实际 TSX frame 测试另验证300次回调仍完成300次 runtime.update／render。此计数与浏览器实际显示／GPU FPS不同。

首次就绪记录仍留在原报告中：基线单次导航2442.4ms，after 单次导航1154.3ms。两次不是受控冷启动重复试验，shader缓存、宿主机时序等没有被隔离，本轮没有改加载链，**不将该差异作为首帧收益**。

所有样本均0个窗内长任务，API在本机受支持；口径是条目 `startTime` 落入采样窗。它不能证明 GPU／合成线程无工作、无边界跨窗任务、无卡顿或耗电下降。

## 测试与自审

- 定向4文件67／67通过，无失败／跳过：scene-loop、companion-interaction、gesture-feedback、avatar-scene-handoff。
- 新用例覆盖首两帧立即可见、100ms格式化门禁、语义即时、恢复失效、时间回退／浮点边界、单操作复用、异步手势重测、重入隔离，以及实际 TSX frame 的逐帧 update／render保持。
- diff检查通过。主代理报告统一 TypeScript 与生产构建已通过；未为本轮追加庞大端到端矩阵。
- 自审未见跨帧热点缓存、改变手势冷却／延迟、取消原始 update／render 或改动画资产的路径。没有修改性能夹具字节来制造计数差异。

## 证据与清理

- 基线累计六轮：`.data/deep-fluidity-20261023/avatar-baseline/reports/report-1792760651640-6.json`，SHA256 `9d19f2304296b2ee8163fe2549831bc466e333d143605e45597c667652f7b383`。
- after累计六轮：`.data/deep-fluidity-20261023/avatar-after/reports/report-1792765435306-6.json`，SHA256 `593444f7539fe8d04b9d3065c81e2c6ceb4835413cec25d87b59004e314a306b`。
- after构建收据 SHA256：`24ff3482b41479842dd5829b0cde2745b7a48f1f7678784e6f768baf20f0d5b4`。
- 源码／夹具／资产比对：`.data/deep-fluidity-20261023/avatar-after-comparison.json`；初始源码检查为 `avatar-issue2-source-check.json`。
- 主代理采样完成后已将测量标签页转到 `about:blank`。仅在核对 PID、startTicks、Node路径、脚本命令与监听归属后停止本轮静态服务70520（4546）及97996（4547）；两端口均确认无监听。
- 停止收据：`.data/deep-fluidity-20261023/avatar-static-cleanup.json`。全部冻结资源、日志和报告保留；未触碰生产4318服务、业务状态、正式下载、版本或信任清单。

本轮完成共享人物前端的确定性回归及本机 Chrome 对照，不扩大为安卓真机、GPU／功耗或长期内存验收。
