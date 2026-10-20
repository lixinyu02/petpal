# 每日陪伴：问候、天气、节日与安卓通知

- Date: 2026-10-20
- Complexity: L2
- Status: updated

## Background

用户希望安卓可设置每日某时问候、查天气、节日祝福并弹出通知。现有自动化仅派发 Agent，需要电脑；通知 v1 只接受 Agent 完成事件，新来源会让旧客户端停止监听。原生通知 Intent 还可能被 OAuth 清洗逻辑提前清除。

## Goal

每个登录用户独立设置一份每日陪伴计划（默认关闭、08:00、可选时区），支持已确认地点天气、常用公历/农历节日及生日祝福、试运行、运行记录与安卓通知。无需执行电脑或 Agent 模型。通知点击进入对应每日问候记录。

## Non-goals

不创建 Codex App 自动化，不调用中央电脑 Agent，不假造天气或调休信息，不承诺系统强停/省电冻结后准时送达，不自动朗读或打开麦克风，不替换正式更新包。

## Solution

- 独立 companion-routines.json 采用串行原子替换，配置与运行/通知outbox同一事务；按用户隔离，revision CAS，手动requestId幂等，持久claim不重叠。复用已有每日/IANA时区的下一次时间计算；错过较久的计划跳过，不补弹过期天气。关闭/修改计划撤销未完成结果；禁用用户不能运行/收到新结果。
- 内置固定问候与已验证节日文本，不依赖模型可用性；天气走既有官方只读adapter的受限worker，先选中明确候选，保留来源、发布时间/新鲜度限制。天气失败只降级天气部分。
- 按用户补充要求，每次读取同一用户的记忆上下文，尊重现有记忆开关。使用本人默认的服务端可用Chat模型，在事实正文后生成一句个性化回应；无工具权限，不借用他人或手机/PC本地官方会话。没有相关记忆则基础问候，模型/记忆故障不影响天气事实。记忆视为不可信参考，不执行其中指令；个性化段不进入通知预览。
- 全量正文保存在每日陪伴记录；默认通知仅提示结果已就绪，用户可选择显示预览。新通知使用独立 companion-feed 和独立原生游标，复用受限设备凭据，旧Agent feed完全保持。validUntil阻止离线补弹过期问候。
- 安卓前台通知服务继续承担用户开启后的HTTPS监听；每日问候独立高优先级通知频道（锁屏隐藏正文），点击携带内部tag/epoch并重新认证读取本人记录。网页/App显示后台提醒和省电设置入口；强停、重启、凭据到期需要重新开启，不绕过系统限制。

## Wire contract

- 登录接口：GET/PUT `/api/companion-routine`；GET `/api/companion-routine/locations?query=...`；POST `/api/companion-routine/preview`；POST `/api/companion-routine/run` `{requestId}`；GET `/api/companion-routine/runs/:id`。
- 配置完整字段：`enabled,time,timezone,includeWeather,location,includeHolidays,birthday,notify,notificationPreview,tone`。location为空或`{id,name,fullName,province?,city?,sourceUrl}`；birthday为空或MM-DD；tone为gentle/brief；PUT另带revision（首次null）。GET返回`{routine:{...配置,revision,nextRunAt},runs,instanceId,userId}`；run返回`{run,...identity}`，run具有id/status/trigger/scheduledFor/createdAt/finishedAt/content/title/warnings/validUntil。
- preview接收完整配置（不带revision），只返回生成内容、title与warnings，不保存/通知；run必须先保存配置，POST回执不等待天气完成，客户端轮询运行状态。
- 独立设备凭据接口：GET `/api/notifications/companion-feed?after=N&limit=20`；响应`{deviceId,instanceId,userId,events,nextCursor,highWater,minCursor,resetRequired,expiresAt}`；首次无after只建立当前基线。事件`{seq,id,runId,createdAt,validUntil,title,body}`，隐含来源companion/状态completed，无虚构Agent会话。返回连续outbox中的事件（含过期），原生过期项只推进companionCursor不展示；重置批次不展示历史。
- 原生待导航来源companion，runId指向登录接口的本人记录；JS验证真实记录及账号后进入 `?chat=1&greeting=<runId>` 的每日陪伴页面。原Agent导航保持现状。

## Risks

前台服务不是HMS/FCM推送；系统冻结、网络断开、7天登录过期会影响通知。默认不显示锁屏敏感预览。来源超时有降级提示；节日不推断法定假期。独立文件遇损坏保留并报错，不静默清空。已有业务数据、下载、代理与原生权限保持。

## Verification Plan

调度时区/DST、重启去重、并发保存、幂等、暂停竞态、账号隔离、天气故障与节日日期单测/API测试；Chrome界面验收；Android16模拟器真实前台/后台通知、点击、登出隔离和过期抑制；打独立测试APK并审计。
