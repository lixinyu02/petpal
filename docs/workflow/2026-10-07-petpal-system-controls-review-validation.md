# 系统控制与命令审批验收

本轮源码基于内置 Codex 0.143.0；不修改已发布0.9.10安装包或生产配置。

- 完整回归：2195 passed、1 skipped、0 failed（concurrency=4）。跳过的90秒Guardian期限另经真实CLI独立验收。首次高并发已有stream取消fixture超时，单文件6/6及限制并发全量均通过；末次生命周期55/55、前端审批20项、TypeScript、独立build、包装和资产摘要检查通过。
- 原生Guardian fixture：GPT/Qwen允许后执行临时标记；拒绝、格式错误、503及90.9秒超时没有执行。没有人工无限等待。
- 已配置且授权的HTTPS上游：gpt-6-luna和halogen-qwen3.8-flash-next均返回200、真实Guardian approved，且只有批准后临时标记执行。父命令请求为fixture，不能视为真实用户桌面任务验收。
- 真实GPT模型、真实Codex和CoreAudio：Agent调用一次只读系统状态工具，读回12.02%及未静音。独立音量修改验收在同一端点+1%并finally恢复12.023513019%，误差小于0.001%，restored/passed均为true。
- Chrome插件：权限选择、旧执行器禁用自动审查、等待确认、批准按钮单次提交及最终卡片消失。412x960 CSS视口documentWidth407，无横向溢出；临时viewport已恢复。
- Ubuntu系统工具目前只有固定命令、依赖、取消与读回fixtures，没有目标图形桌面的真实系统设置验收。

原始回执、私有运行目录和截图保存在ignored `evidence/system-controls-review-20261007/`；上游密钥不写入文档或提交。以上对应issue-1/2的跟随Agent版本。

## issue-3：独立命令审查模型

在模型连接中配置账号有权使用的 Responses 连接，然后在 Agent 权限中选择「自动审查 → 命令审查模型」。默认「跟随 Agent」，也可选择另一条连接。前台 Agent、Chat + Agent 和自动化使用相同设置；静态权限说明小字已删除，实际审核结果与错误保留。

- 最终完整回归：2243项，2242 passed、1 skipped、0 failed，concurrency=4，75.59秒。跳过的90秒Guardian期限已在issue-2另行真实验收。本轮首轮全量2241 passed、1 failed、1 skipped；唯一失败为新增自动化审查模型API fixture完成等待超时，单文件随后16/16通过。测试等待器改为15秒真实时间上限、25ms轮询，HTTP或Agent/Automation终止错误立即失败并附脱敏诊断；没有为此修改产品代码。最终结果见`regression-independent-review-final.log`。
- 定向回归：服务领域125/125，前端与真实TSX/hook160/160，native/config/transport58/58，原生CLI9 passed / 1 skipped，远程与桌面55/55，独立真实HTTP审查中继1/1。覆盖并发任务不同provider、父模型不变、密钥隔离、relay token不能跨run、完成后失效、配置改变409、授权撤销、旧端能力协商与默认跟随。
- 真实独立Guardian：gpt-6-luna → halogen-qwen3.8-flash-next、halogen-qwen3.8-flash-next → gpt-6-luna均在生产transport实现中完成真实上游请求，两个方向各观察到两个HTTP200 Guardian请求，最终approved后才执行临时标记，finally清理。父任务模型与推理等级保持，reviewer使用独立配置（GPT max，Qwen无effort）。父Responses请求使用fixture，因此这是审查链路实测，不是完整真实用户桌面任务或跨电脑验收。
- 真实原始回执：`upstream-independent-gpt-6-luna-to-halogen-qwen3.8-flash-next.json`、`upstream-independent-halogen-qwen3.8-flash-next-to-gpt-6-luna.json`。凭据仅从现有私有状态读入内存，没有生产状态写入；URL/key已从记录中过滤。
- Chrome插件：权限菜单选独立Qwen时Agent仍为gpt-6.1-sol；没有静态说明小字。412×960 CSS视口documentWidth412，无横向溢出；浏览器缩放下截图物理尺寸549×1280，不能视作物理412×960设备实测。独立配置提交隔离预览任务成功，批准按钮单次提交期间disabled，结束后卡片消失。临时viewport恢复，预览服务已正常退出，测试任务未操作电脑。
- TypeScript、独立Vite build、diff检查和自审通过。截图为`chrome-independent-review-desktop.jpg`及`chrome-independent-review-412x960.jpg`，位于上述ignored证据目录。

本轮新增功能仅完成源码与本地验收；已发布0.9.10安装包、生产后端和部署未更新。远程独立模型需要能力v2执行器；旧客户端仍能跟随Agent审查，不能接独立审查配置。通用桌面工具保留既有人工确认边界，独立模型用于Codex原生命令审查。
