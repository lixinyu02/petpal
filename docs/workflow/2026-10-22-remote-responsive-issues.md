# 回复收尾与流式交互优化 Issues

- Date: 2026-10-22
- Complexity: L2
- Related design: 2026-10-22-remote-responsive-design.md
- Ordering rule: issue-1 完成后再执行 issue-2；同一issue内可分工独立文件。

## issue-1

- ID: issue-1
- 标题: 解开任务终态与记忆、传输及整库刷新之间的等待
- 范围: 后台记忆任务所有权与原子写入保护、Chat/Agent终态交付、客户端终态读取和按会话恢复。
- 依赖: none
- 验收标准: 慢记忆不阻塞下一条Chat/Agent；done/error不等EOF；成功不再等/state；敏感输入/撤权/删除/关闭不产生晚写或账号串用；旧恢复不覆盖新任务。
- 状态: done
- 验证方式: 后端10文件125项、前端收尾/API/组织115项及原生隔离38项、扩展权限/队列/通知52项全部通过（矩阵存在重叠，不累计为唯一用例数），tsc通过。Chrome在5秒慢记忆夹具中连续完成两条，约466/861ms可交互；服务端32/82ms交付终态，第二条完成早于第一条记忆回调结束；无多余/state刷新，客户端取消终态读取后两回复仍complete、两条辅助记忆回调均完成。详见verification。
- commit: `bb9e713` (`fix(issue-1): release completed replies before auxiliary work`)

## issue-2

- ID: issue-2
- 标题: 稳定流式Markdown节点并减少隐藏页面无效刷新
- 范围: Markdown组件身份、长回复展示预算、Agent可见/在线单飞轮询。
- 依赖: issue-1
- 验收标准: 追加文本保持表格/链接DOM、焦点和滚动；首段/终态不延迟；隐藏/离线暂停被动UI请求，恢复立即刷新；后台执行和通知保持。
- 状态: done
- 验证方式: Markdown/批显/消息30项、Agent/可见轮询及关联回归146项均通过（矩阵不累计）；Chrome桌面与412×960追加保持表格DOM、横向位置300和表格/链接焦点；实际hidden事件后24秒会话GET为零，恢复调试焦点后重新读取。物理切回前台与原生后台未验收。tsc、隔离Vite构建及只读自审通过，详见verification。
- commit: issue-2实现提交（以本issue对应Git提交为准）
