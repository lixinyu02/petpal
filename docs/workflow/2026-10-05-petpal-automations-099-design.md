# PetPal 自动化与 0.9.9 四端客户端

- Date: 2026-10-05
- Complexity: L2
- Status: delivered
- Baseline: main `9b3da8a`，0.9.8 正式交付已完成。

## Background

用户要求独立自动化页面，并允许 Agent 自行创建自动化；随后明确要求一起重新打包四端，发布0.9.9。现有Agent任务和远程执行电脑、审批、通知可复用，但任务授权依赖短期登录会话，不能直接拿浏览器令牌作为定时授权。

## Goal

同账号管理定时Agent任务，固定电脑/模型/项目/权限，支持手动执行、暂停、修改、删除与结果对话。Agent可在真实当前任务上下文创建自动化、查看和暂停，并在页面可见。网页关闭或退出登录不取消已保存计划，服务器或目标电脑未运行时不保证执行。0.9.9正式发布和两源升级、四端包验收闭环。

## Non-goals

本轮不增加任意shell定时器、跨用户管理、自动权限提升、离线电脑唤醒或跨主机回退，不改变UAC/审批策略。没有Android/Ubuntu真机时明确包审计边界。不变更RK3566/PSTX/WSL。

## Solution

### 持久数据与调度

新增 `state.automations` 的版本化账户偏好、jobs与有界请求回执。每账号最多50个计划，每计划保留最近30次记录。保存扩展在JsonStore原子写队列中合并最后已提交数据，避免无关历史保存覆盖新计划。非法旧数据fail closed，不丢弃或清空用户文件。

计划字段为 `id/title/prompt/hostId/providerId/projectDirectory/permissions/schedule/enabled/revision/createdBy/sourceConversationId/createdAt/updatedAt/nextRunAt/runs`；私有userId、创建请求指纹、运行快照和grant不发给前端。创建和立即运行用UUID requestId去重，编辑/暂停/删除用revision拒绝陈旧写入。权限沿用read-only/workspace-write/full-access及ask/review/auto。

schedule严格支持 `{kind:'once',at:ISO}`、`{kind:'daily',time:'HH:mm',timezone:IANA}`、`{kind:'weekly',time,timezone,weekdays:[0..6]}`、`{kind:'interval',minutes:5..10080}`。工作日是周一至周五的weekly预设。由服务器计算时区和下一次触发；DST不存在时间跳过，重复本地时间仅执行一次。逾期不补跑；一项未完成时不叠加新运行；离线固定电脑记录跳过。每次真实派发前先持久化claim和下一次计划，再生成真实codex会话并绑定grant，使用runUUID作为submissionId。重启后未完成派发标未知/暂停，不自动重试；服务器停机期间错过的计划跳过。

### 身份与 Agent 工具

独立内部automation principal以计划/运行/grant标识绑定持久运行快照，不能由HTTP调用方传入身份。每次派发和工具调用重查用户状态、Agent权限、已分配Responses模型、电脑归属/在线状态和项目范围。退出浏览器不撤销计划，停用账号或撤销权限仍有效。暂停仅影响未来计划；删除撤销计划并停止其在途任务。

Agent工具为 `petpal_automation_list/create/pause`。create仅接受名称、指令、schedule和enabled/requestId，执行模型/电脑/项目/权限从当前真实Agent entry继承，不能自行选择其他身份或扩大权限。默认允许Agent创建，用户可在页面关闭；每轮最多创建10项且受账号50项上限约束。暂停不能修改权限或启动别的计划。写操作按当前ask/review/auto审批处理；自动化工具的最低访问级别为只读，既有桌面工具仍要求完全访问。

远程Agent工具走connection/run/relayToken限定的中央代理，复用已有单轮令牌，不携带长期用户令牌。只注册明确的自动化工具，服务端从当前run entry确认账号和范围；任务结束、断线、过期、停止后均拒绝。未知结果不自动重发创建写请求，通过相同requestId查询确认。中央和本地Agent统一工具语义。

### 页面与四端

独立lazy“自动化”主导航，沿用LoginGate和session fence。视觉延续暖白/墨绿，用任务行和按需展开详情；每行显示时间、固定电脑、下次与最近结果，编辑表单只在需要时展开。入口主行动为“新建自动化”，暂停/恢复和结果查看为次行动。表单允许选已登记离线电脑，明确执行时须在线。412×960、320×540/320×320下控件可达，无横向溢出；沿用轻量入场、列表展开与按钮反馈，减少动效有效。

表单编辑/保存中阻止任务通知自动跳转，离开有未保存保护。每次执行使用真实codex会话并标automationId，从普通最近聊天列表排除；结果记录可打开会话，Android通知继续沿用既有真实Agent完成通知，不扩展任意URL导航。

API：`GET/POST /api/automations`；`PATCH/DELETE /api/automations/:id`；`POST /api/automations/:id/run`；`POST /api/automations/:id/acknowledge`（revision/runId）；`PATCH /api/automations/preferences`。GET返回 `{allowAgentCreate,automations}`，每项内含有界runs。权限按用户隔离。UI与Agent走同一持久验证/去重路径。

### 完成实现时补强的边界

远程审批由中央从真实run.entry重算完整工具参数，账号批准后绑定一次性callId与参数指纹。ask/review缺失证明、参数替换、客户端自报approved、拒绝后重放、换callId、停止或断线均不能提交；auto仍按原任务范围验证。

unknown 阻止恢复与再次运行，也不能继续使用旧 grant。用户核对执行电脑后通过带 revision/runId 的确认入口将其标为 cancelled，计划仍暂停，不自动重派。计划和对应会话取消状态在同一原子保存中提交，私有 acknowledgedAt 防止旧快照覆回 unknown。Agent 不获得确认未知任务的工具。

生成结果不占普通聊天200项配额，按照每计划最近30次记录修剪；仅同用户、同计划及确切run匹配、已终止、无active/queue、不被其他计划引用为来源的结果允许清理。未绑定或删除计划后的保留结果回到普通历史并计入200项配额，保持可查看、可清理，避免隐藏孤儿。自动化结果禁止再次发送、编辑队列或切换范围，保留审批、停止与返回计划。

写请求在进入 JsonStore 保存队列后重新检查内部同步 guard，验证真实任务、signal、账号或登录会话。停止、断线、退出登录期间尚未落盘的操作不得迟到创建；相同 requestId 的结果确认也先验证 guard。固定项目路径在保存前规范化。通知打开隐藏结果只接受已登录账号的 exact conversation GET，并匹配 automationId、通知 runId 和真实结束状态。

## Impact

新增自动化schema/service/tool模块、JsonStore验证与原子合并、后端路由与Agent授权、中央/远程工具桥接、前端页面/导航/草稿保护和测试。版本0.9.9、Android versionCode19。新包内含该实现；0.9.8历史Release保留。上线需新后端，先检查生产无进行中任务，私有备份后正常退出并恢复监听/HTTPS隧道，不中断在途业务。

## Risks

定时跨退出登录授权、DST、持久claim与Agent队列之间的未知窗口、执行电脑离线、陈旧编辑、远程工具伪身份和旧客户端兼容必须实测。重复派发风险优先选择跳过/未知而不自动重试。已登记旧客户端不含自动化工具时仍能执行普通任务，创建自动化工具需更新客户端；不假装旧客户端具备新功能。

## Verification Plan

隔离时钟/存储/执行器测试一次性/每日/工作日/间隔、DST、重启/断线/重复请求、并发保存、错误回滚及跨账号/权限撤销/陈旧revision。真实TSX事件测试表单保护、暂停/编辑/请求失败/账号切换。Codex动态工具审批与远程relay绑定测试；隔离实跑Agent创建计划、触发固定无工具回复并完成通知，不操作用户软件。

完整回归与TypeScript，通过后冻结新源码构建六包。Windows EXE/ZIP真实启动与工具注册，Ubuntu双架构完整依赖/ELF/隐私审计，Android完整CRC/web/DEX/证书/版本读回。Chrome验证线上自动化和新版下载入口。GitHub stable/服务器镜像完整字节回读、两源sequence11/Android19及旧公开包可恢复归档。证据准确区分目标设备、真实模型、fixture与云端读回。

## Delivery

0.9.9 已按冻结源码 `76f6a54c713a9f42eac3d4db384706f95fca848e` 正式发布，生产网页与后端为0.9.9，GitHub与服务器更新源为sequence11，Android versionCode19。六包双源完整字节验证、旧0.9.8公共下载可恢复归档及Chrome最终入口通过。最终回归2058/2058；真实GPT-6.1 Sol仅在隔离环境验证计划创建和无桌面工具的定时回复。Windows两包真实运行通过，Android/Ubuntu本轮为完整包审计。后端清理时出现的约六秒退出/恢复与云端下载重试、未知原因和各项验收边界均保留在 `docs/acceptance-0.9.9.md`。
