# 账号唤醒词与连续语音对话

- Date: 2026-10-10
- Complexity: L2
- Status: final

## Background

用户要求可自行录入关键词，并已选择唤醒后连续对话。现有链路为前台主动申请麦克风、VAD 分句、共享 ASR、Chat/Chat+Agent、流式 TTS；连续对话 45 秒无声会停止。共享 ASR 有单槽与速率限制，不能长驻或无限重连。

## Goal

账号可保存最多 5 个唤醒词，默认“你好小伴”。启用后点开始进入等待唤醒；支持只说词或词与问题同句。唤醒后连续对话，空闲超时回待机并复用麦克风和会话。

## Non-goals

不训练声纹或离线声学热词模型，不添加系统后台监听，不重打或发布安装包。不更改设备降噪/插话阈值、下载包和现有聊天数据。

## Solution

1. `/api/voice` 增加 `wake:{enabled:false,phrases:['你好小伴'],idleTimeoutSeconds:45}`。旧账号读取补默认。通过认证账号读写，不接受 body.userId；配置原子校验。词组每条 2–40 个字母/数字或汉字，去重，最多 5 条；超时整数 15–300 秒。允许关闭状态保存空词，但启用必须至少一个有效词。
2. 共享纯模块做严格校验和句首匹配。NFKC、大小写、空格和标点规范化；优先最长匹配；英文词尾必须有边界。保留原问题文本的偏移，不能误删正文或用任意子串/模糊匹配。
3. 新增 `armed` 状态与 `awaitingWake` 标记。启动的音频解锁和采集仍在 await 前执行；原 verify 并行读取账号语音配置，完成后固化 job 配置。默认关闭保留旧行为。
4. 待机仍经 VAD 才申请短 ASR。partial 不唤醒也不展示；final 未匹配不创建 Chat、Agent 或 TTS，不清掉上一有效回复。命中只含词则 listening，含问题则去词直接 answer。识别中的候选使用独立快照；手动进入对话取消候选，late final 不能提交。
5. listening 空闲超时回 armed；thinking/speaking/recognizing 不计空闲，正常插话维持原逻辑。armed 不主动播任务报告，唤醒后再播。stop/error/settings/account/hidden/devicechange 仍释放麦克风，不自动重试。
6. 语音与设备页面增加紧凑开关、逐行关键词输入、空闲时长；首页明确显示等待唤醒、麦克风状态、手动进入对话按钮与使用中的词。说明候选语音会发送至管理员配置的 ASR，页面隐藏会停止。

## Impact

服务器 voice 配置、前端状态机/hook、设置与首页均变化。全部平台共用前端；当前只更新本机网页/后端，新客户端需后续打包。

## Risks

ASR 文本误识别、上游 busy/断线、过短关键词误触发、旧账号/服务兼容、取消后 late callback、自动任务播报绕过待机。分别用句首 final 匹配、有限候选与显式错误、长度门禁、缺字段默认、job/utterance fence、armed 报告队列门禁处理。

## Verification Plan

配置纯函数与真实隔离账号 API；句首/标点/英文边界/最长词/Unicode偏移测试。状态机注入音频测试静音、未命中、partial、词+问题、多轮、超时、插话、任务报告、late final、资源释放与故障。真实 hook 检查设置加载和会话隔离。TS/Vite（保留 dist/downloads），Chrome 桌面与 CSS412×960 设置界面验收。使用真实上游 ASR 测合成中文样本，但不将合成输入称为现场麦克风/声学唤醒验收。
