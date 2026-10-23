# 深度流畅性优化第二轮

- Date: 2026-10-23
- Complexity: L2
- Status: completed 2026-10-24; measured Chrome gains, Android QA and web delivery accepted
- Baseline: `a3834f9`，开始时 main 与 origin/main 同步且工作区干净

## Background

上一轮改善了消息提交和人物诊断开销，但 reduced 流式 render CPU 回退，安卓启动未证明提速。本轮由用户明确要求创建新 goal，继续针对剩余热点优化。

## Goal

减少长会话流式期间的重复工作，调查首次路由加载的额外成本；用相同夹具、依赖、可见前台条件和交错采样验证可保留的改进。保持真实 Markdown/OpenUI、焦点、滚动、语音与账号隔离。

## Non-goals

不降低人物画质、不截断消息或工具数据，不改账号/代理/模型配置、数据库或正式发布号。不改正式安装包、更新目录和历史回退资产。本轮共用前端修改可制作独立 QA 包；正式包更新需要独立发布验收。

## Solution

1. 冻结当前真实聊天基线，检查消息元素缓存每帧 props 分配/浅比较与启动依赖图。独立只读调查并行，issue 按顺序推进。
2. 只选择有证据的热点：共享行输入仅比较一次，未变消息复用元素；任何回调、朗读归属、scope 或业务输入变化均失效。保持平面 keyed 兄弟列表，候选缓存只在提交后发布。启动优化须保持鉴权门禁和初始化依赖，不以延后必需功能制造假提速。
3. 同条件 Chrome 交错 before/after、StrictMode DOM 语义、定向 Node 和 TypeScript/生产构建；按真实产品变更验证 Android APK。保留失败与慢样本，并区分模拟器、浏览器和真机。
4. 自审、每 issue 提交和报告；若上线前端，使用新目录、新状态快照，先资源后 HTML 原子替换，无后端代码变化不重启后端。

## Selected hotspots

- ChatMessages 的每次尾部更新仍投影全部 1000 行，分配 props、两次 Object.keys 并拼接朗读 ID。改为传入完整共享输入对象和稳定 projection/factory；共享输入浅比较一次，只有消息或输入发生变化时才投影。仍保留 O(N) ID/引用扫描；factory 变更强制重建、输入增删键也失效、metadata-only 变更发布新快照。
- 当前基线冻结 `.data/fluidity-followup-20261023/chat-before`：build `09274c19-91e3-4614-a3fa-7028c5793b4d`，1950 项实际输入、source digest `9c5da6161cb1bb33223976cd36cdb8d0282c2bab399084c2a07d8f1756155f09`，与上一轮最终源摘要一致。前后冻结一起进行新的交错测量，不复用历史性能数字。
- 启动调查发现 useSpeech 静态引入 Markdown 语音 AST 依赖；先审计同步调用契约及可测量边界。旧 Android 首字前约 2 秒 rAF 长帧没有 trace 归因，不预设为该依赖或 JS 连续阻塞。
- 不仓促拆 AST：现有语音同步 boolean 与报告队列依赖同一解析器，已有消息和首条回复仍需要它。继续验证更具体的 Cubism 启动热点：官方为全部扩展混合组合预编 shader，而本模型可能只用基础模式。仅官方模型明确 `isBlendModeEnabled() === false` 时，在该 GL 实例的注册阶段跳过扩展组合，保留全部基础与复制程序；不改 vendor 或画质，未知/扩展模型仍走完整路径。先冻结真实人物基线，再证明实际程序数/画面/取消/多实例和启动指标。

## Risks

共享输入遗漏会保留旧回调/旧权限，跨会话缓存会串数据，切块会重挂载有状态 OpenUI，启动调度可能制造迟到回调。以全部 props 参与比较、不可变消息契约、scope 与真实 DOM 回归约束。至少三组交错重复，不把 operation counts 或模拟器 rAF 当实际 FPS。

## Verification Plan

冻结源码和依赖摘要；先做 reduced/full 各三组交错，记录 commit P50/P95 和 render CPU；测量期间无并行重负载。真实 StrictMode 验 OpenUI 值/焦点/选区/横向滚动和回调/语音/scope。启动若改动，以相同预热/冷进程条件对比；不将无改善写为成功。业务数据、下载、信任、守护配置保持。独立 QA 资产不代替正式发布。
