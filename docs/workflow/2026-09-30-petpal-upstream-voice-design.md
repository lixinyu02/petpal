# 小伴 ASR / CosyVoice3 更新适配

- Date: 2026-09-30
- Complexity: L2
- Status: implemented and deployed; native packages unchanged

## Background

当前生产服务使用 24 kHz mono float32 WebSocket ASR 和 CosyVoice 原始 PCM 流。2026-09-30 实际协议确认 ASR 保持累计 text/chunks/done，增加可选上下文参数；CosyVoice3 新增 instruct2、情绪预设、归一化预览和响应头情绪元数据。旧的“不支持情绪参数”结论已过时。

## Goal

接入已声明且实际可用的接口更新；每账号保存自动/自然/开心/伤心/生气/轻柔语气与自然/强烈程度，人物在音频实际播放时使用同一份上游选择结果。验证识别、流式朗读、非默认语速、取消和公网登录边界。

## Non-goals

不变更模型权限、Agent 执行权限、参考音色、开放端口或 RK3566 固件。不增加任意用户指令、声纹/情绪识别或音素级口型。ASR 仍限制 60 秒；语音聊天仍暂停麦克风避免回声。

## Solution

issue-55 实现后台兼容：ASR 空 error 也失败，忙碌错误保持 429，健康探测核对协议的采样格式。用户 TTS 增加有限枚举 emotion（默认 auto，可选 original 保留复刻声）和 emotionIntensity（默认 natural）。请求只传 text，情绪由当前登录账号的已保存配置取得，不能指定其他用户或共享服务字段。

CosyVoice 以当前配置 revision 为界缓存有界 capabilities；仅明确支持 instruct2 的服务启用情绪，旧服务 auto/original 使用已有 zero_shot，显式情绪不可用应报错。流式传 mode=instruct2、emotion 和 emotion_intensity，保留 prompt_wav，不把指令拼入朗读正文。格式帧增加经过枚举校验的 emotion 元信息。非 1 倍速使用既有 Gradio 完整 WAV；通过上游 /api/tts/emotion 冻结选择，再以自然语言控制模式及其指令合成，向客户端回传同一结果。两条路径共享并发、鉴权快照、限流、revision、中止和大小限制。

新版原始 PCM 的 EOF 不保证推理成功；核对 X-Request-ID 对应的状态回执，只有完成才能发送应用 end。旧服务继续旧协议，并在文档说明无法从旧上游证明完整推理。不可自动重试已经播放的流。

已发布安装包的客户端严格校验旧 format 字段，因此采用 Accept: application/x-petpal-speech-v2+ndjson 协商。新版主动请求才收到 emotion；旧客户端仍收到原格式，继续播放新的声音，不因额外字段失败。完整 WAV 的可选响应头不改变旧二进制契约。

issue-56 扩展共同播放入口的状态和协议。仅在 active 播放时将上游情绪映射人物（happy→happy、sad→sad、angry→pout、gentle→tender、neutral→neutral）；original/旧服务保留现有文本表情。设置用两项紧凑选择，显示自动选择是文本规则，不是声音情绪识别；强烈只用于开心/伤心/生气。停止、缓冲、切换账号和更换设置清除旧任务状态。

## Impact

更改 server/asr.mjs、server/cosyvoice.mjs、server/voice.mjs 和合成路由；前端语音 API、播放控制器、表情 controller 与 VoiceSettings。旧账号通过默认字段补齐，无批量重写生产数据。网页部署独立 build 目录，保留生产 dist 下载和旧 hash 资源，HTML 最后原子替换。

## Risks

实际听感取决于模型和参考音色，参数或字节差异不证明用户觉得更自然。上游单槽位串行真实测试。状态接口可能晚于 EOF，需要有界等待并失败关闭；不得泄漏全体任务状态。完整 WAV 与流式使用相同情绪但推理模式/语速仍不同。Chrome 播放通过不等于 Android/Ubuntu 真机验收。

## Verification Plan

协议 fixture 测试新旧能力、无效字段、空 error、忙碌、归一化强度、元数据、截断、取消、账号隔离。真实 ASR 用已合成短样例；TTS 同文同参考声音比较中性/开心并记录 request ID 和完成状态；非1倍速与取消串行验证。Chrome 正式网页核对设置保存、播放、表情/缓冲、窄屏和匿名拒绝；完整回归和独立构建，检查无密钥进入 public Git；受控重启 backend、公网静态 hash 读回后提交推送。
