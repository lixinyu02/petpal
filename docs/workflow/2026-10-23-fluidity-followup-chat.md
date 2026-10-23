# 深度流畅性第二轮：聊天完整输入缓存对照

- Date: 2026-10-23
- Issue: fluidity-followup issue-2
- Status: 实现与同条件交错测量完成；真实 DOM、平台集成与发布由主代理另行验收

## 结论

本轮针对上一轮仍存在的逐行 props 分配和浅比较，增加完整共享输入快路；没有调整模型、视觉、消息内容或更新节奏。两种策略的组中位 render 总耗时和 dispatch→commit P50/P95 均改善：reduced 的 render **279.30→246.70ms（-11.67%）**，full **276.40→252.20ms（-8.76%）**；P50 分别 **3.30→3.00ms** 和 **3.30→3.10ms**。这是同宿主短时合成负载结果，不外推全部场景。

第一对 reduced 样本反而变慢：render 198.60→263.50ms、commit P50 2.40→3.50ms、P95 3.40→4.90ms、Max 5.60→7.30ms。full 第三对 Max 5.90→6.70ms 也回退。组中位的 reduced 单次 render Max 4.70→4.80ms（+2.13%）；full 的调度迟到 P50 1.90→2.30ms（+21.05%）、流式 rAF 最大间隔 12.50→18.80ms（+50.40%）。所有样本原样保留，未选择性剔除，不能称每一轮或所有指标都更快。辅助指标的迟到、rAF、Long Task 变化完整列于后文，不将其隐去或解释为真实屏幕 FPS。

## 实现与源边界

`ChatMessages` 使用 rest 参数捕获除会话/消息外的完整输入，模块级纯投影生成行 props；helper 每轮只对全部输入浅比较一次，不维护依赖白名单。输入、投影函数、元素工厂和 Message 引用均相同时直接复用旧条目；否则仍比较所有实际 props，包括回调。输入或投影变化而输出恰好相同时更新候选元数据，工厂变化必重建元素。仍由 layout effect 发布已提交快照，不写 render 中共享缓存。

单一 flat keyed sibling、唯一 ID 防护、不可变 Message 语义、惰性重排查找与 ID 序列复用均保留。没有按索引分块、丢帧或虚拟卸载历史行。

计数回归中 1000 行首次挂载＋100 次尾部更新，投影实际调用 **1100 次**；此前每轮无条件投影为 **101000 次**。相同字段的新输入对象额外调用 0 次。整个列表仍做 O(N) ID/消息扫描，不声称整体为 O(1)。定向 Node 82/82、TypeScript exit 0、diff 检查通过；回归新增字段增删/undefined、NaN/-0、所有回调、投影/工厂变更、输出等价时元数据更新、失败和放弃候选保护。Node 不是浏览器 DOM 状态验收的替代品。

- before: `.data/fluidity-followup-20261023/chat-before`；build `09274c19-91e3-4614-a3fa-7028c5793b4d`；Git `a3834f9fa00d4946a1861e09301065d86532cb19`；sourceDigest `9c5da6161cb1bb33223976cd36cdb8d0282c2bab399084c2a07d8f1756155f09`。
- after: `.data/fluidity-followup-20261023/chat-after`；build `25c33294-b772-4c4a-a9c4-73db46792320`；Git `048a2524566c40690ed1ee4715ac96fe7263fb19`；sourceDigest `9e097f836cf8ad901beb539db3868e34bf7f19f54f3fa420cded905603cb95ec`。
- 两侧均 1950 项实际构建输入，仅 `src/ChatMessages.tsx` 与 `src/chat-element-cache.mjs` SHA 改变，其余 **1948 项逐 SHA 相同**；性能 fixture.tsx/css/index.html、React、Markdown/OpenUI 依赖均保持。
- 源摘要重新计算匹配；两侧各 13 项冻结输出全部重新读字节数及 SHA 匹配。类型声明/测试的修改不在性能 bundle 输入中。Git HEAD 差异包含正常 issue-1 文档提交，不当成运行输入漂移。
- 完整未舍入指标、逐项输入、资源验证清单、原始报告 SHA 和采样映射：`.data/fluidity-followup-20261023/comparison.json`；复核脚本 `summarize-chat.mjs`。脚本以新建方式输出，不能无检查覆盖历史收据。
- 汇总脚本首次因两条变化路径的数组次序断言失败，尚未输出收据；改为比较排序后的路径集合后完整执行成功。这是汇总器断言次序问题，未修改任何性能原始样本，也不计为产品或浏览器失败。

## 条件与计算

真实产品 ChatMessages、Markdown、动效、useChatScroll、CSS，以及 React production profiling renderer。1000 条合成历史、100 次尾部追加、固定 50ms 输入截止时间并等待实际提交；稳定回调与共享属性；模块及字体预热，每次新 React root，滚动 follow。Chrome 155／Windows，CSS 2560×1140、DPR 1.5。全部 12 轮 valid=true、visible/focused、无视口变化或疑似 1Hz 限帧，100 次提交、1000 行、最终 100 段按序内容和跟随均正确。

按原始 createdAt 严格得到 B-R1/A-R1/B-R2/A-R2/B-R3/A-R3/B-F1/A-F1/B-F2/A-F2/B-F3/A-F3。每侧每模式三轮，记录所有较慢样本；它优于分组先后采样的控制，但仍受 JIT、温度、宿主负载影响，未做显著性或长期分布推断。浏览器由主代理唯一操作；报告本身不含 CDP focus-emulation 开关，关于真实前台操作与无并行负载的过程条件由主代理记录，不从 valid 字段臆测。

Profiler 总耗时累加 `samples.slice(profilerMount)` 的 100 次 actualDuration（渲染阶段）；dispatch→commit 逐项计算 committedAt−dispatchedAt，含调度及提交，不等于屏幕呈现延迟。每轮分位数为排序后 floor((n−1)×p)，组对照为三轮相应指标的中位数。单位 ms，表格保留两位，原始浮点值保留在 JSON。约 5 秒的流式时长由 50ms×100 节奏决定，不能当吞吐改善。

## 每轮完整主指标

| 样本 | 100次流式 render 合计 | 单次 render P50 / P95 | dispatch→commit P50 / P95 / Max | 挂载 |
| --- | ---: | --- | --- | ---: |
| B-R1 | 198.60 | 2.00 / 2.80 | 2.40 / 3.40 / 5.60 | 478.30 |
| A-R1 | 263.50 | 3.10 / 4.30 | 3.50 / 4.90 / 7.30 | 503.10 |
| B-R2 | 285.30 | 2.70 / 4.10 | 3.30 / 4.70 / 5.50 | 412.50 |
| A-R2 | 246.70 | 2.40 / 4.00 | 2.90 / 4.50 / 5.50 | 412.20 |
| B-R3 | 279.30 | 2.80 / 4.20 | 3.30 / 4.80 / 5.20 | 409.70 |
| A-R3 | 243.50 | 2.40 / 3.90 | 3.00 / 4.40 / 4.70 | 410.50 |
| B-F1 | 269.00 | 2.60 / 4.10 | 3.20 / 4.60 / 4.90 | 414.10 |
| A-F1 | 252.20 | 2.50 / 4.00 | 3.10 / 4.50 / 5.00 | 402.30 |
| B-F2 | 276.40 | 2.70 / 4.10 | 3.30 / 4.60 / 7.40 | 400.30 |
| A-F2 | 264.00 | 2.60 / 4.00 | 3.20 / 4.60 / 4.90 | 416.50 |
| B-F3 | 280.50 | 2.70 / 4.30 | 3.30 / 4.90 / 5.90 | 408.90 |
| A-F3 | 239.10 | 2.40 / 3.70 | 2.90 / 4.20 / 6.70 | 408.90 |

## 组中位主指标

| 模式 | 组中位指标（ms，数量项除外） | before | after | 变化 |
| --- | --- | ---: | ---: | ---: |
| reduced | 流式 Profiler 总耗时 | 279.30 | 246.70 | -11.67% |
| reduced | 单次 Profiler P50 | 2.70 | 2.40 | -11.11% |
| reduced | 单次 Profiler P95 | 4.10 | 4.00 | -2.44% |
| reduced | 单次 Profiler Max | 4.70 | 4.80 | +2.13% |
| reduced | dispatch→commit P50 | 3.30 | 3.00 | -9.09% |
| reduced | dispatch→commit P95 | 4.70 | 4.50 | -4.26% |
| reduced | dispatch→commit Max | 5.50 | 5.50 | 0.00% |
| reduced | 挂载时间（模块/字体预热） | 412.50 | 412.20 | -0.07% |
| full | 流式 Profiler 总耗时 | 276.40 | 252.20 | -8.76% |
| full | 单次 Profiler P50 | 2.70 | 2.50 | -7.41% |
| full | 单次 Profiler P95 | 4.10 | 4.00 | -2.44% |
| full | 单次 Profiler Max | 5.10 | 4.40 | -13.73% |
| full | dispatch→commit P50 | 3.30 | 3.10 | -6.06% |
| full | dispatch→commit P95 | 4.60 | 4.50 | -2.17% |
| full | dispatch→commit Max | 5.90 | 5.00 | -15.25% |
| full | 挂载时间（模块/字体预热） | 408.90 | 408.90 | 0.00% |

## 辅助指标与回退

rAF 仅取 streamStart 至 streamEnd 内的原始相邻时间戳，避免把挂载长任务混入流式间隔；rAF 不是合成器或显示器帧率。全段 Long Task 包括挂载，另列与流式窗口重叠的数量，不能用全段总耗时宣称纯流式吞吐。零基线且保持零记 0%，不以百分比放大噪声。

| 模式 | 组中位指标（ms，数量项除外） | before | after | 变化 |
| --- | --- | ---: | ---: | ---: |
| reduced | 固定节奏流式时长 | 5011.80 | 5013.70 | +0.04% |
| reduced | 调度迟到 P50 | 2.70 | 1.20 | -55.56% |
| reduced | 调度迟到 P95 | 3.40 | 2.80 | -17.65% |
| reduced | 调度迟到 Max | 4.90 | 3.80 | -22.45% |
| reduced | 流式 rAF 间隔 P50 | 6.30 | 6.30 | 0.00% |
| reduced | 流式 rAF 间隔 P95 | 6.40 | 6.40 | +0.00% |
| reduced | 流式 rAF 间隔 Max | 12.60 | 12.60 | +0.00% |
| reduced | 流式重叠 Long Task 数量 | 0.00 | 0.00 | 0.00% |
| reduced | 流式无效 class remove | 0.00 | 0.00 | 0.00% |
| reduced | 流式无效 attr remove | 0.00 | 0.00 | 0.00% |
| reduced | 全段 Long Task 数量（含挂载） | 1.00 | 1.00 | 0.00% |
| reduced | 全段 Long Task 总耗时（含挂载） | 387.00 | 388.00 | +0.26% |
| full | 固定节奏流式时长 | 5013.70 | 5014.90 | +0.02% |
| full | 调度迟到 P50 | 1.90 | 2.30 | +21.05% |
| full | 调度迟到 P95 | 5.40 | 4.30 | -20.37% |
| full | 调度迟到 Max | 5.80 | 5.40 | -6.90% |
| full | 流式 rAF 间隔 P50 | 6.30 | 6.30 | 0.00% |
| full | 流式 rAF 间隔 P95 | 6.40 | 6.40 | +0.00% |
| full | 流式 rAF 间隔 Max | 12.50 | 18.80 | +50.40% |
| full | 流式重叠 Long Task 数量 | 0.00 | 0.00 | 0.00% |
| full | 流式无效 class remove | 0.00 | 0.00 | 0.00% |
| full | 流式无效 attr remove | 0.00 | 0.00 | 0.00% |
| full | 全段 Long Task 数量（含挂载） | 1.00 | 1.00 | 0.00% |
| full | 全段 Long Task 总耗时（含挂载） | 385.00 | 382.00 | -0.78% |

## 原始样本顺序

相对路径均从 `.data/fluidity-followup-20261023` 起；createdAt 为 UTC。

| 样本 | createdAt | runId | 原始文件 |
| --- | --- | --- | --- |
| B-R1 | 2026-10-23T15:29:11.009Z | `f1477bd2-5ed7-45e0-9771-e8c19bf50d7d` | `chat-before/runs/run-1792769351014-83a00e17-cc9d-429c-ae2a-78981f729e03.json` |
| A-R1 | 2026-10-23T15:29:44.430Z | `73d003b0-8946-41c0-85d2-16b9c8764e3f` | `chat-after/runs/run-1792769384435-71433a2e-1b55-4e67-bb94-c08db6ea6f70.json` |
| B-R2 | 2026-10-23T15:30:12.685Z | `abb38173-7b08-4956-b309-66f44a61fd16` | `chat-before/runs/run-1792769412689-142170ff-4c22-45f5-9b25-f6c9f45f68b1.json` |
| A-R2 | 2026-10-23T15:30:18.745Z | `436e505c-2b7a-4521-bd3c-501cdd40d6bd` | `chat-after/runs/run-1792769418750-132eb291-be55-4e07-95cd-4d60d0e72717.json` |
| B-R3 | 2026-10-23T15:30:35.499Z | `e0c05cac-dbf1-42c1-a51a-36d145c3882d` | `chat-before/runs/run-1792769435506-f05650b7-7cb0-4df2-99bb-263e303f2c1a.json` |
| A-R3 | 2026-10-23T15:30:41.564Z | `94995d52-5b08-4881-afb6-33b81cb8a82c` | `chat-after/runs/run-1792769441568-30dd6d6b-4845-49eb-ae83-1362aef72fe5.json` |
| B-F1 | 2026-10-23T15:30:47.675Z | `9976416e-901e-4b9b-9bc7-913cf506441d` | `chat-before/runs/run-1792769447678-a2436eeb-6de7-40a5-8d59-a6534170f9a7.json` |
| A-F1 | 2026-10-23T15:31:04.868Z | `0e36607c-bec7-4fc9-8945-95bc7cac2b7d` | `chat-after/runs/run-1792769464872-5abc8a24-f5af-4ac3-8542-c1ca28df15aa.json` |
| B-F2 | 2026-10-23T15:31:10.916Z | `2e6c980a-c83f-49be-9ebe-bfa34ec6ff4e` | `chat-before/runs/run-1792769470919-72c116a5-c125-4ecf-9cfb-72be39f9a18d.json` |
| A-F2 | 2026-10-23T15:31:17.005Z | `c1a84e2b-31de-4363-b773-e62b403dba2b` | `chat-after/runs/run-1792769477009-0dcb100b-8662-4b8e-a758-b26143a2eca4.json` |
| B-F3 | 2026-10-23T15:31:32.800Z | `6dacd6ba-11b0-4af7-9ade-7fa580b04a21` | `chat-before/runs/run-1792769492803-791b91e0-8447-41a0-8902-3e3d6f5db035.json` |
| A-F3 | 2026-10-23T15:31:38.860Z | `094639ce-31b0-4521-a198-0ad086ca2388` | `chat-after/runs/run-1792769498863-47228dcf-ecb8-4d92-8e81-799a7e93ba44.json` |

## 验收边界

仅本机 Chrome 合成消息工作负载，无业务账号、附件、模型调用或后端数据。未凭本报告声明 Android 真机流畅度、冷启动加速、物理 FPS 或生产 SLA。既有 StrictMode 10 项表单/焦点/选择区/滚动/语音/回调/会话隔离验收由主代理对新候选另跑，本报告不提前记通过。未在汇总期间重新跑性能或操作浏览器，也未修改性能夹具、正式客户端、正式更新清单或部署资源。
