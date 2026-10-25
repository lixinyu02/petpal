# 账号记忆深度测试结果

- 日期：2026-10-25（Asia/Shanghai）
- 测试时产品源码：`dab6652ce9871139b78eb9e7feefd7f19453724a`
- 范围：新增11项确定性组合测试、真实提炼与隔离Chat端到端；不重配或重启线上服务。
- 结论：核心存储、隔离、提炼、回答引用及恢复测试通过；确认中央/PC开关仍分别生效，不能宣称全账号暂停通过。

## 确定性测试

新增 `tests/memory-depth.test.mjs` 5项：6账号216路重复写入、24路同ID不同内容冲突、导入与本地写入重叠及失败批次回滚、24个迟到写跨两轮清空、单journal损坏隔离。核对72次唯一提交/144次去重、顺序与游标、重开后的去重、错误码及原损坏字节保持。这组使用真实MemoryService和文件系统，网络调用断言为零。

新增 `tests/memory-sync-depth.test.mjs` 6项：两PC同账号合并/去重与其他账号隔离；中央断开后的缓存/受控备用、服务重开与补同步；epoch清空隔绝旧离线写；中央接收后丢响应的恢复；开关现状刻画；237条记录的分页续传与5条增量。实际回环HTTP核对游标0/100/200，重开后从237续传，反复同步最终242条、无重复/错序、其他账号独立。上游提炼与PC runtime为替身，不属于两台实机断网验收。

最终10组记忆相关测试合并 **121/121通过，0失败、0取消、0跳过**，约21.6秒。其中开关测试是对当前行为的characterization，通过代表复现稳定，不代表账号级暂停语义成立。此前120项合并日志和各次独立日志保留；没有删除失败或通过修改期望隐藏结果。

```powershell
node --test --test-reporter=tap tests/memory-service.test.mjs tests/memory-api.test.mjs tests/memobase-client.test.mjs tests/reply-memory-jobs.test.mjs tests/agent-memory.test.mjs tests/memory-settings-ui.test.mjs tests/memory-depth.test.mjs tests/memory-sync-depth.test.mjs tests/memobase-runtime.test.mjs tests/desktop-memory.test.mjs
```

## 实际模型回答与应用恢复

在私有目录启动隔离PetServer，使用合成账号、当前真实Memobase及GPT 6 Luna。只给账号A写入称呼和茶饮偏好，在新对话询问，两项事实都由真实Chat回答正确引用（约2.79秒）。没有这些事实的账号B明确回答不知道（约2.77秒）。同时检查发给模型的system内容，A含自身记忆，两账号互无对方的种子事实。

正常处理这些成功回复的后台记忆任务，等其写入/提炼收敛后，关闭并重新创建本轮PetServer及MemoryService对象。重新读取同账号上下文仍保留事实，B仍无A的事实。这里只重开自有应用对象和回环监听，没有重启操作系统、生产Node或容器。两个自有投影均删除并确认不存在。

## 实际多事实提炼与更正

另一套随机实例/三个用户在写入前逐一GET确认404。真实Memobase只执行三轮单次提炼：约61.8、67.8、25.0秒，各一次insert/flush。A首轮形成8条结构化profile，新增多种生活偏好与稳定事实；第二轮更正当前饮品偏好，形成11条profile，新值存在，保留的旧值明确标成历史，其他稳定事实保留，日志属于两段对话。

B作为不同身份的正对照，可从context召回其身份和饮品，A/B互不包含对方标记；B的结构化profile仍为0条，因此只确认其context可召回，不把它说成结构化画像已经形成。C没有事实、事件或profile，负对照通过。自有MemoryService重开后，A的新偏好和身份、B自身资料、隔离及2/1/0事件数保持，没有额外flush或待同步。

三轮复杂提炼的等待明显长于读取：记忆后台异步处理，在尚未完成提炼时跨新会话不保证立刻读到更新。测试没有把插入acked误当成提炼完成，要求本轮lastSyncAt与contextUpdatedAt推进后再检查。19项真实深测检查均通过，三个随机投影最终清理并逐一GET确认404。

## 确认的边界与未通过项

**中央开关不能作为所有设备的账号级暂停。** 实际组合复现：中央关闭后，其context为空且拒绝上传；同步快照不含enabled，已绑定PC仍显示开启，可把新事件留在本机队列。随后中央不可达时，PC按自身设置启动备用并召回同账号旧、新事实；中央重新启用后，这些事件补同步。反向关闭PC也只影响该PC，重开仍保持其本地关闭状态。这不是跨账号泄漏，但需要后续定义并实现跨设备偏好传播，不能把121项通过扩展成全账号暂停已满足。

既有空模板预览识别问题、按约1000token用户摘要召回而非query语义搜索、历史不自动回填的边界仍在，本轮没有修改产品逻辑。未做真实第二台PC断网、原生客户端/手机生命周期、生产服务或操作系统重启验收。

## 数据与证据保全

正式zut账号未接收任何测试对话或记忆写入；最终仍为1个独立journal、1条已确认的问候事件、无待同步或错误，完整journal SHA与扩测前一致。没有清空正式账号、改模型配置、移动正式tag、改下载/更新清单或重打客户端。

私有证据在 `.data/memory-depth-20261025/`：

- `regression-verified.tap`：最终121项；`regression-final.tap`保留较早120项。
- `journal-depth-*.json/.tap`、`sync-depth-receipt.json`、`sync-depth-six.tap`：新增测试及账号级暂停未通过的单独记录。
- `chat-*/receipt.json`：真实Chat两账号问答、出站记忆边界、应用对象重开、zut保全及自有投影清理。
- `profile-depth-*/final-receipt.json`：三轮真实提炼、更正、正负对照、重开和三投影清理。
- `depth-acceptance.json`：总验收收据，明确将账号级暂停设为false，不以测试执行成功掩盖功能边界。

正式账号ID、凭据、原记忆正文不进入公共文档；包含测试凭据的隔离应用状态和原始合成回答只保留在私有诊断目录。
