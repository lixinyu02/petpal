# 小伴 UI 流畅性验收

- Date: 2026-10-10
- 基线: main / 4f44f7b
- 源码: issue-1 031cde5；issue-2 本验收随提交保存。
- 范围: 共享前端源码、本机网页、隔离 Chrome 对照。没有重打客户端、推送 GitHub或操作生产 Agent。

## 改动与行为

Cubism 一次手势采样合并人物命中/区域坐标，反馈属性、样式和 cursor 仅变化写入。坐标不跨操作缓存，保留人物移动、布局改变与延迟动作的重新验证。CSS transform 比较使用私有的最近赋值，避免浏览器规范化空格/单位导致相同样式重复写入。

短回复继续 50ms 合并，累计 4000/8000 字符后改为 100/120ms；首字和协议事件/最终 flush 保持立即。语音字幕复用展示器，TTS 分句仍立即接收原始 delta；阶段变化/异常/停止/插话先处理已接收字幕，关闭后不会写入下一轮。字幕滚动使用单个 rAF，隐藏与卸载取消，恢复可见补滚。

后台任务组件使用真实 React memo，稳定任务/会话/回调避免随语音进度重绘；其自身状态与审批/轮询逻辑保持。没有改变语音播放进度和口型的 40ms 发布频率。

## 可复现调用计数

`evidence/ui-fluidity-20261010/gesture-counts.mjs` 运行真实手势、反馈模块和所选版本 Cubism onFeedback，使用注入静态 DOM 几何计数。baseline/current JSON 附源码哈希。

| 300 次静止悬停 refresh | 基线 | 新版 |
| --- | ---: | ---: |
| rect 读取 | 900 | 600 |
| cursor 写入 | 300 | 0 |
| dataset 写入 | 1500 | 0 |
| 反馈 style 写入 | 300 | 0 |

一次 pointermove 的 rect 读取 4→3。这是 DOM 调用计数，不能等同于布局耗时、GPU消耗或设备 FPS。

## 流式展示对照

确定性 Node 虚拟时间：500 个 25 字符 delta，间隔 10ms，共 12500 字符。`stream-costs.mjs` 调用真实 helper 和 remark/GFM；旧版 101 次发布/633750 累计解析字符，新版 64 次/321575 字符，解析字符量减少约 49.3%。首字时刻 0、最终 flush 4990ms，最终文本 SHA 一致，关闭后无迟到发布。Node 预热解析耗时只作辅助，没有用来宣称真实 UI 帧率。

Chrome 通过插件在两个隔离 loopback 页执行真实 ReactDOM、MessageMarkdownRenderer、ChatAssistantTasks。基线从 4f44f7b 恢复；仅验证 bundle 插入渲染计数，API 编译替换为拒绝外部调用，未读写生产 .data。

| 同一 12500 字符长流 | 基线 | 新版 |
| --- | ---: | ---: |
| Markdown 渲染次数 | 75 | 52 |
| 累计解析字符 | 467050 | 272475 |
| 流式期间 Tasks 渲染 | 75 | 0 |
| 输入 delta | 500 | 500 |
| 最终字符 | 12500 | 12500 |
| 表格 / 代码块 | 100 / 100 | 100 / 100 |
| 首次展示 | 约 0.1ms | 约 0.1ms |

Chrome 的实际计时受任务调度/解析影响，展示次数不等于 Node 确定性序列。此轮各一次浏览器对照，不是跨设备 FPS 基准。两次最终文字完全一致，API 请求均 0。

100 次、40ms 间隔的真实父组件模拟语音重绘：后台任务渲染 100→0，Markdown 都为 0 次；任务 completed→error→completed 各正常渲染一次，onUpdate 改变渲染一次，conversationId 改变和账号 key 重挂各渲染两次。结果保存 `chrome-baseline.json`、`chrome-current.json`、`chrome-task-restored.json`，current 无 console warn/error。审批/授权实际行为另由回归测试覆盖，没有执行真实电脑命令。

## 实际页面与构建

Chrome 使用现有 test 账号访问本机 4318。真实 Cubism ready；头部悬停显示 head/手势来源 hover，手部显示 hand，离开后反馈隐藏/cursor default。412×960 **CSS** 视口的首页和 Chat：clientWidth/scrollWidth 均 412，模型选择弹层可打开/关闭。保留当前模型与账号设置，没有发送真实聊天或采集麦克风。截图在同一 evidence 目录。

227 项不同的相关回归通过（final-tests.log 225 + reviewer-tests.log 2）。覆盖手势和反馈、CSS 序列化、Markdown/图片/朗读行、首字/flush/取消、语音 EOF/失败/停止、自动插话后字幕隔离、账号失效、TTS 分句、报告、场景调度、UI 动画、后台审批和 review 设置。TypeScript 通过。

Vite 构建通过，显式 `--emptyOutDir false`。递归 15 个 dist/downloads 文件的路径、大小、SHA256 前后完全一致，下载产物没有清空。既有 Three chunk 超过 500kB 的提示仍在；默认关闭的猫/降级渲染按既有懒加载策略保留。

## 自审与限制

已自审取消/异常/轮次隔离、动态几何、计时器清理、账号重挂和精确 Git 范围；独立只读审查未发现阻塞性新增缺陷，其提示的账号失效、自动插话及恢复可见滚动已补回归。早期 fixture 缺少新 memo/rAF 依赖导致的失败日志保留，补齐后通过。

本机网页已加载最终构建，服务健康为 0.9.10。Windows/Ubuntu/Android 安装包未重建，原生实机帧率、实际 ASR/TTS 上游质量和真实环境语音不在本轮验收范围。超长 Markdown 的单次全文解析仍可能占用一帧；本轮减少解析频率和总量，没有宣称消除全部卡顿。
