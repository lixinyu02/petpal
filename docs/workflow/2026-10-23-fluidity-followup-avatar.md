# Cubism 启动热点修复与真实浏览器验收

日期：2026-10-23。对应 fluidity-followup issue-2。以下汇总直接独立读取六份原始启动报告及一个指针样本，没有重采或删除慢样本。

## 变更与保留边界

真实授权 Core 6.0.1 读取默认 V12 模型：16 个 drawable、全部 normal/over、0 个 offscreen，官方 `isBlendModeEnabled()` 返回 false。官方 5-r.5 的 shader 加载仍默认生成 79 组扩展混合组合，共 242 个程序、484 次 shader 编译。

新增 `src/avatar/cubism/shader-profile.mjs`，由 `runtime.mjs` 在本 canvas 的 shader 初始化前接入。只有官方分类明确 false、没有 offscreen、当前实例尚未初始化且 API 形状与已固定 Framework 一致时生效。仅在调用官方扩展注册方法期间临时使用空颜色枚举，保留官方 copy shader，finally 恢复枚举；标准、遮罩、反遮罩以及兼容加算/乘算程序保持。未知、扩展混合、已有注册或不匹配的 Framework 继续完整加载。

适配只作用于独占 GL 实例，不修改原型或共享 Framework。取消/释放后保留实例上的终止守卫，使官方尚未完成的 fetch 回调不能重新分配程序。官方 vendor、公开 Framework/Core、模型、贴图、动作、DPR、尺寸和渲染节奏均未改变。Framework SHA256 仍为 `0170359c0cef965054f367ecdd18a8b66cd91aa2ea72ee50eb3c90285fde1e29`。

相关 48 项回归通过：真实 Core/模型/官方 shader 注册，基础 GLSL 逐项相同、程序共享关系、异常和未知路径、取消与迟到回调、跨 context 隔离，以及现有启动、手部、表情、眨眼语义。GL spy 用于验证程序调用与内容，实际浏览器数据另列如下。

## 冻结输入与采样口径

- before：`.data/deep-fluidity-20261023/followup-avatar-before`，receipt SHA256 `91990c0d998963ad70943d472b853a4a26a568bf2efdf9dee73bf2786253e59b`。
- after：`.data/deep-fluidity-20261023/followup-avatar-after`，receipt SHA256 `51241e7510b894d5b144d71c70199a1480ebd152481b2eb3890718585a115e8f`。
- 两个冻结 receipt 的 HEAD 都为 `048a2524566c40690ed1ee4715ac96fe7263fb19`，表示冻结时仓库位置；实际候选包含工作区源码，不能写为两侧同一提交。源码摘要变化只有 `runtime.mjs` 与新增 `shader-profile.mjs`。前后各 65 个冻结资源已重新逐字节数/SHA验证，模型/runtime/art条目相同。
- 工具 `scripts/benchmark-cubism-startup.mjs` 仅在各 HTML 首个 module 前插入同一 external probe，其余 HTML 和资源保持。probe SHA256 `0a2fc1774b2360fcdbeb1148e43c1de0729f2c7d084e12c453a06b083ff2a04c`；原始报告同时绑定冻结 build digest。
- Windows Chrome 155、真实 WebGL2、viewport 2560×1140、DPR 1.5、canvas 1350×752。六次均全程前台 visible、真实 Cubism 首帧完成、无页面错误、只有一个 GL context。按 timeOrigin 排序为 before→after，重复三对。
- HTTP 资源使用 no-store，每次重新导航完整页面；**此前已实际渲染过模型，浏览器/GPU/驱动 shader 缓存没有清除**。这是已预热环境下的页面启动比较，不是冷机器或冷驱动结果。测量期间没有并行性能测试/构建。

`readyAt` 为导航 timeOrigin 起到原夹具真实 `onReady` 的时间；探针另记录自身开始到观察首帧的 `durationMs`，两者不混用。rAF从模块执行前开始记录，遇真实 Cubism帧计数>0结束。WebGL方法耗时是调用前后 CPU 墙钟差，可能包含同步驱动等待，**不是 GPU execution time 或显示 FPS**。

## 三对原始结果

| 指标 | before 三次 | after 三次 |
| --- | --- | --- |
| 真实人物 readyAt（ms） | 884.3 / 908.7 / 864.9 | 578.6 / 544.7 / 532.1 |
| 启动最大 rAF 间隔（ms） | 318.9 / 318.8 / 312.5 | 37.5 / 37.5 / 37.4 |
| createProgram | 242 / 242 / 242 | 5 / 5 / 5 |
| compileShader | 484 / 484 / 484 | 10 / 10 / 10 |
| linkProgram | 242 / 242 / 242 | 5 / 5 / 5 |
| getShaderParameter 总墙钟（ms） | 226.6 / 229.0 / 225.5 | 3.0 / 2.6 / 2.2 |
| getProgramParameter 总墙钟（ms） | 80.7 / 77.8 / 77.1 | 1.7 / 1.2 / 1.4 |
| longtask 数量 / 最大时长 | 1 / 324ms；1 / 323ms；1 / 317ms | 0；0；0 |

这组三对样本的 readyAt 中位数 **884.3→544.7ms，减少38.4%**；最大 rAF 间隔的中位数 **318.8→37.5ms**。GL 原始逐调用记录独立求和/计数与摘要相同，耗时主要落在即时读取编译/链接状态的调用。这里报告的是浏览器中观测到的启动波峰改善，不能外推所有设备或把调用计数直接换算成稳定帧率。

原始六份报告完整保留于 `.data/fluidity-followup-20261023/avatar-startup/runs/`；独立汇总 `.data/fluidity-followup-20261023/avatar-startup/summary.json` 包含各原始文件 SHA、顺序、条件、源码差异、逐组结果和口径说明。六份均 valid，0份 hidden/错误样本被计入。

## 启动后交互保持

候选先前的真实人物指针样本保留于 `.data/deep-fluidity-20261023/followup-avatar-after/reports/report-1792769778981-1.json`，其 build receipt digest 与上述 after 相同。

- 采样10,009ms，1,202次合成 PointerEvent，valid=true；无 hidden、fallback、页面错误或 longtask。
- 诊断帧计数增长298，人物保持 Cubism、相同1350×752 canvas；头部/手部/外部路径产生实际表情与动作变化。
- 这是合成指针回归，不是物理鼠标/触屏验收。诊断计数每100ms发布，可滞后约3帧，298不作为精确 GPU/显示 FPS。该单个候选样本证明交互持续执行，没有作为前后性能改进对照。

## 限制与交接

本报告不宣称 Android 上一次约2秒冷路由停顿已解决，也不代替小米/荣耀/ARM真机、完整应用登录启动或 Android 新 APK 实测。下一阶段应使用冻结候选资源做各端针对性回归；无需修改或重启生产后端。

root已停止相关夹具服务，退出收据 `.data/fluidity-followup-20261023/chrome-fixture-cleanup.json`。正式客户端、更新清单、业务账号/数据库和模型服务均未由本项改变。
