# Open Intelligent UI 引入评估

- 检查日期：2026-10-23
- 上游：[thesysdev/open-intelligent-ui](https://github.com/thesysdev/open-intelligent-ui/tree/03213439358bf3408ad61a46ec9e3230c5572e48)
- 固定版本：`03213439358bf3408ad61a46ec9e3230c5572e48`，MIT，项目版本 0.1.1（private 应用，非即装组件包）。

## 结论

可以逐步复用组件源码；其 SDK 与小伴现有 `@openuidev/react-lang` / `lang-core` 1.0.1 兼容。无需为组件引入 Next.js、Thesys 云、独立聊天界面或第二个模型。继续由当前 Chat/Agent 自动判断普通文字还是交互回复，沿用小伴的账号、模型连接及消息历史。

用户已明确要求不设置人为的提示词字符预算。上游完整系统提示词 33411 字符本身不构成接入限制；小伴现有自动 guide 为 8149 字符。移植时仍应按最终启用的组件生成一致的 schema 和规则，避免模型引用不存在的能力。上游偏向多数回答制作工具、主动配图和 `@ToAssistant`，与小伴普通问答优先 Markdown、按钮回填草稿的交互约定不同，需要调整。

## 模块选择

| 模块 | 可复用能力 | 实际适配工作 |
| --- | --- | --- |
| Chart | React+SVG 的柱状、折线、面积、饼图、环图、散点，无额外图表库 | 注册组件和 schema；验证数据点数、有限数值、缺失值、手机尺寸及主题；不能把缺失数据直接解释为 0 |
| 数值函数 | Convert、Percent、Clamp、Payment、Allocate 等 | 扩展指定函数及参数校验，限制计算/返回值成本，错误显示为空或提示；保持按钮仅本地交互/回填 |
| Grid/布局、数字输入/Slider | 自适应分栏和可交互计算工具 | 保留原有 `Panel`、`Field`、`Select` 等协议，防止同名不同参数破坏旧历史 |
| 受限 SVG | 简单示意图和可视化 | 纳入总节点/深度/数据限制，限制属性和 path，不加载外部资源 |
| Map | MapLibre WebGL 地图、地点标注和线路 | 迁移 Next worker 路径，评估移动端 WebGL/性能；默认底图依赖 OpenFreeMap/Esri，路线使用 OSRM 的 driving，不能当步行或公交导航 |
| SearchImage/Image | Wikimedia/Wikipedia 查询和图片回退 | 新增登录验证的服务入口、请求/响应限制及外部图片策略，验证目标网络的可达性 |
| HtmlView | iframe 内小游戏/canvas/动态网页 | 上游允许 inline JS、四家脚本 CDN 和任意 HTTPS 图片；opaque-origin sandbox 隔离宿主存储，但仍会联网和消耗 CPU，需单独设计执行边界 |

首批适合 Chart、选定数值函数和相应输入组件。地图、图片与 HTML 是各自独立的联网或脚本能力，不能只作为普通组件无差别加入。

## 已做的兼容性验证

在 `.tools/intelligent-ui-evaluation-20261023/` 保留固定源码快照、blob SHA、探针和结果，未安装上游应用或执行其安装脚本。

15 项检查通过：在实际安装的 SDK 1.0.1 上编译上游 Chart/数值函数；6 类图表 schema 均可在扩展的 `Panel` 库中解析；温度换算、零利率月供、百分比、幂、数值夹取、精确费用分摊正确，非法单位组合回退 null；原有 validator 仍接受旧协议，并拒绝未经适配的 Chart；取消预算后，上游实际 33411 字符 guide 加 32000 字符任务完整保留，自动策略不降级或重置线程。

这属于编译、parser 和 evaluator 兼容性验证，不代表图表已在产品中启用，也不代替真实模型生成质量、浏览器图形交互或实体客户端验收。本轮实现另包含提示词预算移除，详见 `workflow/2026-10-23-openui-prompt-size-design.md` 和对应 issues 文档。
