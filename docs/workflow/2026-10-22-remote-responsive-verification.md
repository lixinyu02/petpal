# 回复收尾与流式交互验收

- Date: 2026-10-22
- Source baseline: `bac9f47e698c11034aca3de50013026b8cd8123e`
- Reference: [检查并优化 Codex Remote 客户端](codex://threads/01a119c9-3aa2-7bf3-8659-eb58dcaa3782)，只读参考其分离终态/后处理及保持DOM身份的方法，未修改参考项目，未使用其性能数字作为小伴结果。
- Status: issue-1、issue-2 源码与隔离验收完成；未替换正式客户端或生产服务。

## issue-1

Chat的旧路径在终态保存后等待memory.remember才交付done；Agent虽移除active，仍在同会话锁里等待记忆。独立gate在冻结基线均跑红：Chat取不到done，Agent第二条无法进入bridge。客户端基线另复现已收到done/error却继续等HTTP EOF，以及全量/state不返回时已完成回复无法释放busy。

现改为共享有界记忆任务所有者，默认并发2、最多64个pending、10秒超时、关闭1秒grace。每条记录冻结并清理为有界文本，去重并消费错误；不合作的工作保留物理并发槽。管理员记忆状态仅暴露计数诊断。清空、删除、停用取消相关任务，真实记忆原子替换前重新检查signal、账号/消息归属、敏感fence与epoch；单任务取消不终止共享远端校验。终态后任务仍保持原有敏感输入拒绝条件。

客户端以明确done/error作为结束，忽略尾随帧，不等待cancel Promise。完整权威Chat快照直接解锁并朗读一次；断流或旧协议缺快照只恢复该会话，8秒deadline覆盖忽略取消的传输。新请求、账号切换、删除、切换会话和组件卸载使旧恢复失效，React updater内部再次检查；改名/项目移动和已经到达的后台报告不被回退。

| 验证矩阵 | 结果 | 证据（相对仓库根） |
| --- | --- | --- |
| 后端jobs、真实memory与Chat/Agent记忆等10文件 | 125/125，无失败/取消/跳过 | `.tools/remote-iteration-20261022/backend-audit/backend-regression-final.log` |
| 前端收尾、实际App.send、API与组织/消息复用 | 115/115 | `.tools/remote-iteration-20261022/frontend-audit/frontend-issue1-summary.json` |
| 原生流控、请求隔离、二进制与连接目标 | 38/38 | 同上汇总 |
| 扩展队列/恢复/问题输入、Chat+Agent、组织、通知、角色与启动 | 52/52 | `.tools/remote-iteration-20261022/issue1-extended-regression.log` |
| TypeScript | 通过 | `npx tsc --noEmit` |

矩阵有重叠，不把各批次数量相加宣称唯一覆盖。原始失败gate、超时夹具及修复日志均保留。

Chrome插件在独立loopback夹具运行真实App。假LLM输出25字固定回复，记忆故意延迟5000ms。首轮完成并解锁约466ms，两轮连续完成约861ms；服务端两个POST响应约32/82ms，第二条响应早于第一条记忆完成。完成后没有多余GET /state；两回复最终仍为complete，两个后台记忆都完成，证明客户端终态取消读取没有将已保存回复改成cancelled。证据：`.tools/remote-iteration-20261022/browser/issue1-chat-acceptance.json` 与 `issue1-chat-timeline.json`。这些是本机受控提供方及浏览器交互样本，不代表真实模型速度。

## issue-2 基线

Chrome对真实MessageMarkdown组件操作，点击QA按钮真实聚焦/设置横向滚动后追加内容。旧Renderer每次重建表格节点：tableSameNode=false，scrollLeft从300回到0；表格和链接焦点均从DIV/A丢到BODY。原始Renderer SHA256 `f4c89100ff7c748cc7c4398eedca7ee31226b1231d74f21f504c5f490d6fadad`，基线DOM指标和截图保留于 `.tools/remote-iteration-20261022/browser/baseline/`。

## issue-2 结果

Markdown组件类型和remarkPlugins改为模块级稳定引用。Chrome追加后tableSameNode=true，表格scrollLeft保持300，DIV/A焦点均保留；412×960时结果相同且页面scrollWidth=412。安全URL、禁HTML、GFM任务列表与图片占位语义保持。16k/32k/64k长文中途批显预算调整为180/250/400ms，第一段和显式终态仍立即flush；这只减少完整Markdown重解析频次，没有新增增量AST解析。

Agent被动读取复用可见/在线单飞调度，仍按运行800ms、空闲2500ms刷新；隐藏、离线、卸载及下一次读取都会废弃旧展示owner。普通和自动化快照在React updater内再次复验账号epoch、删除和展示归属，忽略取消的迟到传输也不能覆盖界面。初次已有完成回复不朗读，恢复后新完成回复去重朗读。轮询只GET，不调用任务stop，不修改原生通知。

| 验证矩阵 | 结果 | 证据（相对仓库根） |
| --- | --- | --- |
| Markdown/长文批显/消息 | 30/30 | `.tools/remote-iteration-20261022/issue2-markdown-regression.log` |
| Agent实际App effect、可见轮询及关联回归 | 146/146；基线22项中7项失败 | `.tools/remote-iteration-20261022/frontend-audit/agent-visible-summary.json` |
| Chrome桌面DOM身份、焦点、滚动 | 通过 | `browser/candidate-dom-metrics.json`（以下browser均位于同一.tools目录） |
| Chrome 412×960 DOM与布局 | 通过 | `browser/candidate-mobile-night-verified.json`；真实App日间截图`browser/candidate-chat-mobile-table.png` |
| Chrome页面隐藏 | 实际hidden事件后约24秒，GET计数39→39；恢复调试焦点后重新GET | `browser/visibility-summary.json`与对应原始timeline/DOM记录 |
| TypeScript与隔离Vite构建 | exit 0；2132模块、构建4.79秒 | `.tools/remote-iteration-20261022/issue2-build.log`；输出为同目录`dist/` |
| 独立只读自审 | 未发现阻塞项 | 检查Markdown语义、批显顺序与旧展示owner失效路径 |
| 暂存源码公开审计 | 1691文件通过，无问题；测试数据和证据未入Git | `.tools/remote-iteration-20261022/issue2-public-source-audit-staged.log` |

各测试矩阵存在重叠，不累计。候选手机DOM文件名含night，但QA夹具的自定义夜间body样式不代表产品夜间视觉验收；产品截图仅使用真实App日间视图。截图改用CDP原始PNG保存，早期扩展截图格式/模拟点击偏移的尝试保留，不作为最终通过证据。

Chrome原先调试焦点模拟使多标签均报告visible；关闭该模拟后观察到真实hidden事件和请求暂停，未使用冻结生命周期冒充隐藏。插件的Page.bringToFront未让该环境实际切回前台；恢复验证通过还原调试焦点模拟触发visible后观察GET，不能称物理标签切换完整验收。隐藏/离线/恢复单飞、朗读去重和迟到UI保护由146项回归覆盖；Android真机、Windows/Ubuntu原生后台与生产模型性能未重新验收。

## 适用范围与保留边界

- 测试只用新临时JsonStore、合成账号/模型/记忆和loopback端口。无生产模型、真实OpenAI授权或硬件操作，未以生产数据做测试。
- 初次QA Vite配置未限定入口，扫描大型发布/历史产物导致事件循环占满、页面空白。精确停止自有夹具，限定两个入口并忽略大型产物后恢复；该脚手架失败和清理证据保留，不当作产品首屏/模型延迟结果。
- 聊天历史在交付完成前已持久保存；辅助记忆进入本地journal前崩溃仍可能未入库。未新增outbox；已有journal后的持久同步机制保持。拥塞/超时/失败体现在管理员计数中，不伪装成功。
- 保留0.9.14正式tag、安装包、服务器更新清单与业务数据。本轮源码与隔离验收不等同于新版本正式发布或原生客户端/手机真机验收。
