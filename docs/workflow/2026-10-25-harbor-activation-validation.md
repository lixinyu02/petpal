# Harbor 正式接入验证

## issue-1：来源、授权与恢复契约

同模型ID/协议按本次文本、工具及图片需求优先Harbor，缺能力保留原配置；原provider ID、授权及默认保留。Harbor-only新增模型不自动分配给普通账号。Agent配置/revision与图片历史使用同一来源判断，切换来源不复用旧线程。全局默认及legacy入口采用相同选择。普通配置CRUD操作原记录，不把内存解析副本或Harbor密钥写回普通state。

配对未知结果继续原操作。撤销意图立即封住新请求，工具续轮及语音请求发送前再次校验；已发请求失败不向另一来源重放。六协议目录分角色处理；speech/asr_stream结构化nativeProfile严格投影已知有限字段，过滤外来URL、密钥和映射，兼容旧string/null。媒体不进入文本模型选择器。完整WAV与原CosyVoice实时PCM分别处理；记忆运行时仅选择实际支持Chat Completions的配置。

自审修复了：已解析provider副本的CRUD/容量问题、全局默认revision误停、仅Responses凭据误用于记忆、nativeProfile对象被过滤、配对后模型列表未更新，以及同名文本Harbor遮住旧vision能力。回归覆盖原配置、授权、换源、撤销、先发后失败不重放和前端状态恢复。

最终验证（私有证据位于`.data/harbor-activation-20261025/`）：

- `full-regression-serial.log`：4112 tests，4106 pass，0 fail，0 cancelled，6 skipped，464120.8694ms。
- `typecheck-final.log`、`build-final.log`、`web-build-verification-final.json`：TypeScript、隔离前端构建及51模块OpenUI图通过；未覆盖正式dist。
- `staged-source-audit-final.log`：1876文件公开源码审计通过。fixture允许值只登记精确文件和精确合成值，不放宽扫描规则；也补登记了前次记忆深度测试已有的两个合成值。
- `chrome-qa-final.json`与截图：Chrome扩展实测隔离登录/配对、无reload模型目录更新、保留provider的实际推理连接、ASR空WS协议检测、Harbor完整音频播放反馈；只使用合成issuer/200ms正弦WAV，未调用麦克风/摄像头，不据此声称真实ASR识别或语音品质通过。

保留的失败与限制：首轮默认并发出现fixture登记、动态effort及system-controls时序失败；修登记后的4并发完整通过4098/6skip。新增图片/profile/UI修复后的4并发最终轮有一个输入fixture等待失败和一个native guardian超时，相关两文件单独串行14通过/1既有skip，最终全套串行如上通过。只支持并发/调度不稳定假设，未确证根因，也未放宽超时或断言。六个skip为既有opt-in native代理、WSL、90秒guardian及三个NCM实测，不能计为本轮实际设备验收。

网页/后端正式部署、真实Harbor配对及公网全文读回属于issue-2；在对应收据完成前不把隔离结果记作正式上线。Windows/Ubuntu本地模型下载与新版包按用户决定留到随后发布。

## issue-2：网页与后端正式部署（已完成部分）

部署源码为main `29a0d35b8b7f0cb5ee5729cec594f4b3d80ca18f`（已推送），版本仍0.9.15，不移动tag/安装包/更新信任。最终已提交源码审计为1877文件、273871470字节、0问题。独立review绑定21项实际证据、666源码/314候选/10工具及备份SHA；fresh capture/check确认全业务空闲。第一次capture遇到临时非空闲时拒绝且未改生产，随后核对空闲才重新capture。

`rollout/run-20261025T060310342Z-75ee3a91`完成一次执行与独立verify。原Node101068退出，原guardian34088接管Node107756，restored与monitored事件均存在；维护标记已撤，HTML最后发布，旧静态文件未删。4用户、65会话、1附件、63下载及其他受保护配置/DB字节保持；仅允许已有两项记忆元数据时间戳变化和同密钥的服务链接重加密。没有用备份覆盖业务。中断发生在执行等待期间，继续后只收取既有进程结果，没有再执行重启。

公网`https://magicdatou.top:44318`逐字节读回313个公开资源、57014200字节，全部SHA匹配；内部`.vite/manifest.json`保持隐藏，其HTTP响应是已验证index SPA fallback，本地该文件由rollout完整核验。初次辅助读回将此内部manifest误当公开资源而失败，并触发Node24退出断言；仅修正私有只读验收脚本后通过，未为此改变正式服务的dotfile访问策略。原失败日志保留。

Chrome新建独立tab以test账号登录，模型/设置页与现有列表正常加载，控制台无error/warn；此正常登录会新增会话凭据，发生在上述严格保全verify之后。不提交新聊天，不修改test模型偏好或zut记忆。截图与控制台证据在私有任务目录。真实Harbor配对/推理和缺项回退的生产验证仍待上游交接。

## issue-2：正式配对与真实 Agent（完成）

Harbor专门会话已将接收方适配合入main并恢复保留实例，初始0.52.0/main `136d9df8d627b1825edc9731c872d18ce3870929`。小伴从实际Windows后端连接`http://127.0.0.1:48870`，通过DPAPI CurrentUser解密的一次性码完成正式配对。码只经过内存/子进程stdin，未进入命令行或普通state。`live-pair-1792910820317-91629f92/result.json`确认ready、真实Responses provider/test200，原provider、用户授权、全局配置、默认、旧会话均保持，Harbor元数据key为空。一次前置检查把unpaired占位项误当旧链接，发送前即拒绝；修正私有验收脚本后完成，未盲重发未知兑换。

首次真实内置CLI任务揭示网关准入不接受原生默认推理值，HTTP400 `invalid_reasoning_effort`，发生在请求计量之前；普通provider/test因此不能替代Agent验收。隔离CodexBridge的transportFetch只记录字段名/类型/状态/错误码，定位后由Harbor会话修复可空reasoning语义，保留非法类型拒绝。补丁main `5e09b0c9f65506ef50281b97475705bc8f38dd32`，版本0.52.1；相关Windows/Ubuntu各108项通过，实际`/healthz`200/0.52.1和原生请求SSE200已确认。小伴未为此再次重启或改传输代码。

`live-agent-smoke-02.log`：07:18:13Z提交、07:18:28Z完成，真实包内Codex CLI以read-only/ask、central、Harbor模型执行，返回`HARBOR_AGENT_OK`。仅使用owner新验收会话；账本`req_379221905a6540ba888feb976eda868c`为Responses200/complete、attempt_count=1。旧失败会话及错误日志保留；私有测试脚本也修正了error终态识别，避免在已失败时等待截止时间。

`fallback-provider-smoke.json`：原CPA的gpt-6-luna实际200；CosyVoice来源和实时能力保持。`post-deploy-service-smoke.log`：实际ASR配置/协议检测200，CosyVoice生成188204字节WAV，独立验证为24kHz/单声道/PCM16/3.92秒；未用麦克风，不扩称真实语音识别准确率。Harbor六协议实现已有隔离验证，但当前正式目录只声明一个Responses路由`live-codex-e7300846ed79`（上游nativeModel为gpt-6-luna），其余协议保留原配置。

原模型ID/默认没有改为公共路由别名，新Harbor模型在管理员模型列表中提供；普通账号仍由管理员通过既有账号页面分配，不自动扩权。当前4用户、67会话、1附件；相对发布前65会话，仅新增owner的失败/成功两条技术验收会话。`final-retention.json`再次验证全部63下载SHA、原provider/授权/配置/旧会话保持；test/zut记忆语义严格保持。owner验收触发既有自动记忆流程，新增一个明确的技术测试事件并更新context缓存，因此“所有记忆语义完全未变”的严格检查失败，失败收据保留。`final-retention-reviewed-02.json`仅接受这条精确owner事件和该账号缓存/同步字段变化；不宣称owner旧context语义相等，未删除事件或用备份回滚记忆。

Harbor新的独立官方Codex Auth登录与模型同步由其会话继续，未计入本次API Key/Responses路径验收。此次没有发布新客户端包、改变更新sequence/tag、开放额外公网Harbor端口或修改其他服务。
