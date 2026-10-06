# 系统控制与命令审批验收

本轮源码基于内置 Codex 0.143.0；不修改已发布0.9.10安装包或生产配置。

- 完整回归：2195 passed、1 skipped、0 failed（concurrency=4）。跳过的90秒Guardian期限另经真实CLI独立验收。首次高并发已有stream取消fixture超时，单文件6/6及限制并发全量均通过；末次生命周期55/55、前端审批20项、TypeScript、独立build、包装和资产摘要检查通过。
- 原生Guardian fixture：GPT/Qwen允许后执行临时标记；拒绝、格式错误、503及90.9秒超时没有执行。没有人工无限等待。
- 已配置且授权的HTTPS上游：gpt-6-luna和halogen-qwen3.8-flash-next均返回200、真实Guardian approved，且只有批准后临时标记执行。父命令请求为fixture，不能视为真实用户桌面任务验收。
- 真实GPT模型、真实Codex和CoreAudio：Agent调用一次只读系统状态工具，读回12.02%及未静音。独立音量修改验收在同一端点+1%并finally恢复12.023513019%，误差小于0.001%，restored/passed均为true。
- Chrome插件：权限选择、旧执行器禁用自动审查、等待确认、批准按钮单次提交及最终卡片消失。412x960 CSS视口documentWidth407，无横向溢出；临时viewport已恢复。
- Ubuntu系统工具目前只有固定命令、依赖、取消与读回fixtures，没有目标图形桌面的真实系统设置验收。

原始回执、私有运行目录和截图保存在ignored `evidence/system-controls-review-20261007/`；上游密钥不写入文档或提交。本验收对应issue-1/2的跟随Agent版本，独立审查模型由issue-3单独验收。
