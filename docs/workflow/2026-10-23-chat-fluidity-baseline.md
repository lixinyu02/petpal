# 聊天流畅性基线与夹具自审

- Date: 2026-10-23
- Issue: deep-fluidity issue-1
- Product baseline: `a44330eb92a1b27f2caca2442e64ea22dbe78530`
- Status: baseline frozen; no product changes

## 构建与采样条件

真实 React DOM、`ChatMessages`、Markdown、消息动效、`useChatScroll` 与产品 CSS，1000 条合成消息、100 次仅尾部追加，固定 50ms 截止时间调度并等待每次实际提交。历史为交替用户／助手的 GFM 段落、链接及列表，尾部追加新段落；全部 row 控制属性和回调保持稳定。模块及字体预热，测量使用新 React root 和 production profiling renderer，不是冷启动测量。

冻结构建在私有目录 `.data/deep-fluidity-20261023/chat-baseline/frozen-02/`。Build ID `9ff81efd-ed0b-43a2-b654-8d99d68c3b7f`，source digest `d0ff735c740ff8b3e26baf461c6cfefff7e37ce41cac74dafedfe8bbfd5b1465`。1949 项实际加载输入摘要及 13 项输出文件 SHA 保留于 `build-result.json`；本次再次核验 13 项输出均一致。重建与启动方法见 `tests/fixtures/deep-fluidity-chat/README.md`。

主代理唯一操作 Chrome 插件，使用公开 CDP `Page.bringToFront` 将窗口置于前台；正式六轮均未启用 focus emulation。浏览器 Chrome 155、Windows、CSS 视口 2560×1140、DPR 1.5，系统 reduced motion 为 false；分别显式设定夹具 full/reduced，滚动均 follow。六轮均 `valid=true`、无隐藏／失焦／视口变化／疑似 1Hz 限帧，100 次流式提交、1000 行和按序最终 100 段、滚动跟随均通过。

## 原始样本映射

所有文件均在上述冻结目录的 `runs/`。下表保留全部有效六轮，不筛除较慢的挂载样本。

| 编号 | 动效 | runId | 文件 |
| --- | --- | --- | --- |
| R1 | reduced | `27ea0fc0-7560-40e9-921d-073ef781f6b6` | `run-1792760332630-dd87d0fe-f28e-4cfc-94ac-27d630a68cf7.json` |
| R2 | reduced | `9a66dde3-cf0c-4623-9250-ea9d7a55df2d` | `run-1792760354812-468fe736-18dc-438f-9ab1-835aba64ec1a.json` |
| R3 | reduced | `c719079f-6890-4ac0-9dbb-61a497d52555` | `run-1792760388762-ed759c7c-d19e-4bc5-af60-9131ef8e61f8.json` |
| F1 | full | `91df0575-47de-4280-ab36-796d91471ff6` | `run-1792760439022-aea79c83-b873-4187-a7cf-8ad39856e5cd.json` |
| F2 | full | `805904fc-da6a-4147-971a-9550a03d2b87` | `run-1792760478032-7336cd59-f90e-4db7-916e-2679922514f1.json` |
| F3 | full | `6cab445d-d8fe-452f-9d1e-89bceaf33b74` | `run-1792760501454-0d6c6df9-bb12-4250-bc55-487b12c03248.json` |

排除但保留的 frozen-02 首轮：`30bb1287-1142-4e34-8e9f-a8b11704190d`，文件 `run-1792760270814-aab7f8f6-9087-4cf9-800d-72f236abf7ce.json`。主代理确认该轮使用过 CDP focus emulation；虽然报告 `valid=true`，仍因条件不同排除。报告本身没有 CDP 开关字段，不能只凭 valid 自动选样。

更早夹具初版在 `chat-baseline/` 根目录的 Chrome 自检出现可见但约 1Hz rAF；原始报告逐字保留，`self-check-assessment.json` 明确拒绝将其当性能基线。冻结 02 加入焦点与保守 1Hz 门禁后才进行上述正式样本。

## 流式工作指标

单位 ms。Profiler 总耗时仅累加 `samples.slice(profilerMount)` 的 100 次流式 `actualDuration`，排除挂载。dispatch→commit 为每个更新的 `committedAt-dispatchedAt`，表示提交确认延迟，包含调度及本轮 layout effect，不代表屏幕呈现延迟。分位数采用排序后 `floor((n-1)*p)`，数值四舍五入至两位。

| 样本 | 挂载时间 | 100 次流式 Profiler 总耗时 | 单次 Profiler P50 / P95 | dispatch→commit P50 / P95 / Max | 流式 class remove / attr remove |
| --- | ---: | ---: | --- | --- | --- |
| R1 | 1013.90 | 193.60 | 2.10 / 2.80 | 3.70 / 5.00 / 6.20 | 100000 / 100000 |
| R2 | 513.90 | 195.70 | 1.90 / 2.80 | 3.90 / 5.10 / 7.10 | 100000 / 100000 |
| R3 | 479.50 | 183.90 | 1.90 / 2.80 | 3.60 / 4.60 / 5.00 | 100000 / 100000 |
| F1 | 564.10 | 313.10 | 2.90 / 5.40 | 3.90 / 6.50 / 12.00 | 0 / 0 |
| F2 | 537.50 | 278.10 | 2.60 / 4.40 | 3.60 / 5.30 / 8.80 | 0 / 0 |
| F3 | 630.30 | 275.30 | 2.70 / 4.40 | 3.60 / 5.30 / 7.30 | 0 / 0 |

三轮分组的流式 Profiler 总耗时中位数：reduced 193.60ms、full 278.10ms；各轮 dispatch→commit P50 的中位数为 3.70／3.60ms，P95 的中位数为 5.00／5.30ms。完整未舍入数据、选样及聚合方法见私有 `summary-accepted.json`。这些是两种策略的独立基线，不把 full/reduced 之间的差异当成产品优化收益。

流式总时长受固定 50ms×100 输入节奏约束，约 5 秒不能作为后续性能收益指标。原始 rAF 时间戳与 Long Task 保留用于观察主线程；rAF 不等于合成器或显示器 FPS。六轮的全段 rAF 最大间隔仍有约 419–938ms，主要覆盖初始挂载，未将其隐藏或解释为持续帧率。每轮 2 项 Long Task 的原始时间在报告中，不能将包含挂载的统计误标为纯流式。

## 夹具自审与后续边界

- 产品组件保持实际 React DOM 渲染，未用 VM、SSR 或人工计数替代浏览器结果；Profiler renderer 与窄 DOM 方法包装的开销相同，after 必须保持夹具版本和环境一致。
- DOM 包装仅统计实际消息行上的 `ui-message-enter` remove 与 `data-ui-enter` remove；mount/stream 分列，结束恢复原始原型方法。每轮重新挂载、释放 observer、rAF 与事件监听；静态服务仅 loopback，CSP 及同源报告门禁，无账号、真实附件、业务后端或模型调用。
- 真实初版 Chrome 100/reduced 自检确认 101 列表提交、实际 10000+10000 清理调用、最终内容与滚动正确；其帧样本因遮挡问题排除。冻结 02 资源、HTML、入口及构建信息 HTTP 200，未列文件 404、无 Origin 的报告请求 403；脚本语法与限定 diff 检查通过。
- 已证实 reduced 下静态行重复清理；流式仍扫描全部消息并生成行元素。优先减少无效 DOM 清理、稳定 ID 序列与复用未变 ReactElement，保留单一同层 key，不采用会改变跨块行身份的 Fragment 分块。
- 产品实施后须检查删除／重排时相同 ID 的 DOM、OpenUI 表单与焦点保持；附件、状态、朗读归属、回调更新、最终文字、上翻锁定、会话隔离及动效 StrictMode／取消边界。当前六轮 follow 基线不冒充这些语义已验收，也不代表 Android／手机或生产 SLA。
- 本文完成时仅新增夹具、冻结测量和文档，没有修改产品、启动业务服务或替换正式资源。45329 夹具由主代理进行后续验收，子代理保有 TTY session 12388 的关闭职责。
