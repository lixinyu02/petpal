# 聊天流畅性前后对照与语义验收

- Date: 2026-10-23
- Issue: deep-fluidity issue-2
- Status: candidate measured; product not committed by subagent

## 结果与限制

1000 条历史、100 次尾部追加的两组测试中，dispatch→commit P50 的分组中位数均下降；reduced 的无效 class/attribute 清理各从 100000 次降为 0。full 的流式 Profiler 总耗时中位数下降，但 reduced 的 Profiler 总耗时 **增加 23.09%**、提交延迟 P95 **增加 4.00%**。这是有明确收益和回退的候选，不能称所有渲染指标全面改善。

测试使用固定 50ms 输入节奏，约 5 秒的流式总时长不是性能收益指标。Profiler `actualDuration` 观察渲染阶段，不直接统计 layout effect 内的动效 DOM 清理；dispatch→commit 还包含调度及该轮提交工作，因此二者变化方向可以不同。新元素缓存仍为 O(N) 扫描，每行创建 props 并执行完整浅比较，有实际 CPU 成本；当前前后采样不能独立证明 reduced 回退全部来自该缓存，没有追加 motion-only 实验或丢弃较慢样本。

## 同口径与原始证据

基线详见 `2026-10-23-chat-fluidity-baseline.md`。前后均使用真实 React production profiling renderer、实际 ChatMessages/Markdown/动效/滚动与产品 CSS，模块及字体预热、新 React root、1000 条同形状合成历史、100 次固定尾部更新、稳定控制属性和回调，follow 模式。Chrome 155／Windows、CSS 2560×1140、DPR 1.5；主代理唯一操作浏览器、`Page.bringToFront`、未使用 focus emulation，全部正式样本 `valid=true`，无疑似 1Hz 限帧。运行期间没有并行 CPU 大构建或另一浏览器测量。

- before：`.data/deep-fluidity-20261023/chat-baseline/frozen-02/`，build `9ff81efd-ed0b-43a2-b654-8d99d68c3b7f`，source digest `d0ff735c740ff8b3e26baf461c6cfefff7e37ce41cac74dafedfe8bbfd5b1465`。
- after：`.data/deep-fluidity-20261023/chat-after/frozen-01/`，build `836c3547-8a2f-460b-8ddd-2caabd24a2af`，source digest `9c5da6161cb1bb33223976cd36cdb8d0282c2bab399084c2a07d8f1756155f09`。
- 两构建实际加载输入 1949→1950，只有 `src/ChatMessages.tsx`、`src/chat-message-motion.mjs` 修改与 `src/chat-element-cache.mjs` 新增；其余 **1947 项输入 SHA 全部一致**，包含性能 fixture.tsx/css/index.html 与 React/Markdown/OpenUI 依赖。Git HEAD 因 issue-1 文档与夹具提交而不同，不把正常提交变化当成输入违规。
- 完整未舍入数据、源摘要差异及清理收据保留在 after 的 `comparison-summary.json`。前后按时间分组采样而非交错 A/B，各组仅三轮，仍受 JIT、温度和宿主负载影响，不外推真机、长期 FPS 或生产 SLA。

每项统计先按单轮计算；组对照采用三轮统计量的中位数。P50/P95 均使用排序后的 `floor((n-1)*p)`。流式 Profiler 排除挂载，累加 `commits.samples.slice(profilerMount)` 的 100 个 actualDuration；dispatch→commit 逐项使用 `committedAt-dispatchedAt`，不等同屏幕呈现延迟。

## 精确样本与分布

before 的 B-R1～B-F3 对应 baseline 文档 R1～F3 的精确 runId／文件，未更改选样，已排除使用过 focus emulation 的 `30bb1287-1142-4e34-8e9f-a8b11704190d`。after 文件位于上述 after 目录的 `runs/`：

| 样本 | runId | 文件 |
| --- | --- | --- |
| A-R1 | `ce7a6577-243c-471a-9bd5-f821c7b4ff44` | `run-1792764765894-85ea0cbc-b12b-4261-9a2b-ae5cdb321e24.json` |
| A-R2 | `64b4f86b-30b8-4906-949c-853ff89dd39a` | `run-1792764814351-d42e53c0-36d5-42ea-8ea3-5bed3a06010a.json` |
| A-R3 | `6f79449b-9079-469b-bc5d-9e91148a490b` | `run-1792764826312-10403411-f1f9-47d6-b503-0f065b99d126.json` |
| A-F1 | `4b86ed9c-c10c-4a5e-9005-5bbbb5b8dfc7` | `run-1792764851327-5bfb5c3b-5d87-4d8b-8ad0-d97a41e8774c.json` |
| A-F2 | `91f6ebc7-c7dd-48ff-9be7-94b645bd0bd3` | `run-1792764886613-fc8456c2-b351-4e5f-b4d2-1be378e2f2e7.json` |
| A-F3 | `6b0d36b4-aa91-4b6b-9e6b-e002c1a2801f` | `run-1792765229652-d1bda2bc-8192-43b3-8aae-0417923ab3c2.json` |

以下单位 ms。每轮均实际提交 100 次并保留按序最终 100 段。

| 样本 | 流式 Profiler 总耗时 | 单次 Profiler P50 / P95 | dispatch→commit P50 / P95 / Max | 流式 class remove / attr remove |
| --- | ---: | --- | --- | --- |
| B-R1 | 193.60 | 2.10 / 2.80 | 3.70 / 5.00 / 6.20 | 100000 / 100000 |
| B-R2 | 195.70 | 1.90 / 2.80 | 3.90 / 5.10 / 7.10 | 100000 / 100000 |
| B-R3 | 183.90 | 1.90 / 2.80 | 3.60 / 4.60 / 5.00 | 100000 / 100000 |
| A-R1 | 282.70 | 2.10 / 6.30 | 2.70 / 7.60 / 9.10 | 0 / 0 |
| A-R2 | 238.30 | 2.30 / 4.40 | 2.90 / 5.20 / 6.10 | 0 / 0 |
| A-R3 | 207.50 | 2.00 / 3.10 | 2.40 / 3.60 / 6.10 | 0 / 0 |
| B-F1 | 313.10 | 2.90 / 5.40 | 3.90 / 6.50 / 12.00 | 0 / 0 |
| B-F2 | 278.10 | 2.60 / 4.40 | 3.60 / 5.30 / 8.80 | 0 / 0 |
| B-F3 | 275.30 | 2.70 / 4.40 | 3.60 / 5.30 / 7.30 | 0 / 0 |
| A-F1 | 201.90 | 2.00 / 3.00 | 2.50 / 3.60 / 3.80 | 0 / 0 |
| A-F2 | 229.20 | 2.30 / 3.60 | 2.90 / 4.30 / 6.50 | 0 / 0 |
| A-F3 | 296.60 | 2.80 / 4.70 | 3.30 / 5.30 / 6.80 | 0 / 0 |

| 模式与组中位指标 | before | after | 变化 |
| --- | ---: | ---: | ---: |
| reduced 流式 Profiler 总耗时 | 193.60 | 238.30 | **+23.09%** |
| reduced 单次 Profiler P50 | 1.90 | 2.10 | +10.53% |
| reduced 单次 Profiler P95 | 2.80 | 4.40 | **+57.14%** |
| reduced dispatch→commit P50 | 3.70 | 2.70 | -27.03% |
| reduced dispatch→commit P95 | 5.00 | 5.20 | **+4.00%** |
| full 流式 Profiler 总耗时 | 278.10 | 229.20 | -17.58% |
| full 单次 Profiler P50 | 2.70 | 2.30 | -14.81% |
| full 单次 Profiler P95 | 4.40 | 3.60 | -18.18% |
| full dispatch→commit P50 | 3.60 | 2.90 | -19.44% |
| full dispatch→commit P95 | 5.30 | 4.30 | -18.87% |

挂载中位数 reduced 513.90→514.00ms，full 564.10→485.00ms，样本离散且不是冷启动指标。A-R1 的尾部延迟和 A-F3 的较慢渲染均原样保留，没有为了展示收益删除。

## 真实 DOM 与滚动语义

独立 development React DOM／StrictMode 页使用实际 ChatMessages、OpenUI 和 CSS，不以 SSR 或 VM 等价替代。原始报告 `.data/deep-fluidity-20261023/chat-semantics/frozen-01/runs/run-1792764699344-8ea6549f-5c9c-44c2-b50a-4e4d2c558257.json`，build `e8a28500-a883-4bc2-80e1-f3e4d8f00831`，**10/10、valid=true**。

覆盖 130 个同层消息行；删除头部及跨 32/64 边界重排后 129 个保留行均为原节点，OpenUI 输入节点、焦点、2–5 选择区、表格 scrollLeft=120 保留。更新回调后真实 SDK action 含已填 `$note` 且只调用新回调；朗读归属、pending/error、读/停回调、busy/sleep/support、不可变消息状态与模型变化、canonical ID、动画取消及 reduced 切换不补播、移除活动行清理、scope 表单隔离均通过。

另有实际 100 条／full／locked 的补充样本：runId `950f8c9b-265a-4561-9f38-8a8290271828`，文件 after `runs/run-1792765256527-e602230a-f390-44a6-88d4-f331fbe5d391.json`。该轮 valid=true、100 次提交与最终 100 段均正确，`lockedTop=finalScrollTop=13926`，流式期间没有抢夺上翻位置。它是额外语义样本，不混入 1000 条性能分组。

定向 Node 元素缓存／消息动效／实际消息输出 27/27 通过；最初新增重排测试的预期条数写为 128，实际构造为只删除一项的 129，修正该测试断言后通过，不把它描述为产品缺陷。主代理统一 TypeScript、生产 Vite/OpenUI 检查通过；Android 与人物验收另有独立 owner，本文不代替其结果。

## 清理

由子代理向自己持有的 TTY 12388／19482／3874 分别发送非空 `close\n`，三者全部 exit0。独立 `Get-NetTCPConnection` 读回确认 45329／45330／45331 均无监听，45331 已交回 Android 使用。所有 before、after、排除样本、构建和语义产物保留；未删除数据、改生产资源、提交或创建额外实验。
