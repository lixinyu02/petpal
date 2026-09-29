# CosyVoice 情绪控制能力核对

核对日期：2026-09-30。只读取当前服务的 OpenAPI、Gradio 元数据与状态，以及小伴的现有适配代码；没有发起合成、上传音色或修改配置。

**当前小伴使用的 PCM 流式接口没有声明情绪或指令参数。本轮可以让人物表情与朗读内容、播放状态和实际音量同步，但不能宣称声音已经按开心、伤心、难过、兴奋或害羞切换语气。**

## 当前服务的协议证据

服务 OpenAPI 标题为 `VoiceStack CosyVoice`，版本为 `0.1.0`。

| 来源 | 实际声明 | 能得出的结论 |
| --- | --- | --- |
| `GET /openapi.json` → `POST /api/tts/stream` | multipart 字段为 `tts_text`、`mode`、`prompt_text`、`prompt_wav`、`spk_id`、`seed`、`text_normalization`；输出为 `application/octet-stream` | 没有 `emotion`、`style`、`instruct_text` 等情绪指令字段 |
| 同一文档的流式 `mode` | 类型为 string，默认 `zero_shot`，没有枚举 | 不能仅凭这个开放字符串推断任意模式、特别是 instruct 模式可以运行 |
| 同一文档的 `POST /api/tts/normalize` | `mode` 枚举为 `zero_shot`、`cross_lingual`、`sft` | 文本预览协议没有声明 instruct 模式；该枚举不能代替流式实现的运行时证据 |
| `GET /gradio_api/info` | `/generate_audio`、`/generate_audio_stream` 均声明 `instruct_text`、`stream`，模式选项包含“自然语言控制” | Gradio 界面有指令入口；尚未证明当前加载模型可执行该模式，也没有证明其输出与现有原始 PCM 流式协议相同 |
| `GET /config` | 存在“输入 instruct 文本”控件；预训练音色选项仅为空值 | 不能假定有可用于指令合成的预置音色；通用界面文案也不能用来判定运行中的具体模型 |
| `GET /api/tts/status` | 返回服务正常、队列与既有请求计时 | 状态接口未声明情绪能力或运行中模型标识 |

`text_normalization` 的 `auto/native/legacy/raw` 是文本规范化选项。文档对原生模式音素 token 的描述不是情绪控制承诺。

Gradio 两个生成入口的参数顺序是：

1. `tts_text`
2. `mode_checkbox_group`
3. `sft_dropdown`
4. `prompt_text`
5. `prompt_wav_upload`
6. `prompt_wav_record`
7. `instruct_text`
8. `seed`
9. `stream`
10. `speed`

这些是元数据证据，本次没有调用上述生成入口进行指令试验。

## 小伴当前适配

[`server/cosyvoice.mjs`](../server/cosyvoice.mjs) 的流式合成固定向 `/api/tts/stream` 发送 `mode=zero_shot`，沿用已有参考音频及其转写文本；将 24 kHz 单声道 PCM 封装为小伴的 `format/audio/end` 流。

完整音频合成使用 Gradio `/generate_audio`，模式固定为“3s 极速复刻”，第 7 个参数 `instruct_text` 为 `''`。小伴的两个合成 HTTP 入口目前只接收 `text`，前端口型依据实际播放和音量变化驱动。

## 本轮最小兼容方案

- 人物新增表情由每段文字的情绪与朗读状态驱动；播放开始、结束、取消和下一段切换时同步更新，口型仍跟随实际音频。
- 保持已有 CosyVoice 参考音色与流式 PCM 通路。人物表情变化应称为“表情与朗读同步”，不要标为“情绪音色已启用”。
- 不向正文、参考转写或未声明字段塞入情绪提示，也不使用未验证的特殊 token；这些内容可能被直接朗读或影响已有音色。
- 后续声音情绪控制需要上游明确声明可用字段、模式、模型能力和输出协议，再为小伴增加白名单情绪映射。能力未确认时继续普通 CosyVoice 朗读。

声音情绪功能的后续验收至少应包括：同一段文字、同一音色的中性与情绪对照合成；确认指令没有被念出来、流式首音频与结束正确、取消及错误行为正常；另由实际试听确认情绪是否明显且音色一致。只得到成功响应或不同音频字节不能证明听感有效。

私有原始协议快照与采集回执保留在被 Git 忽略的 `evidence/avatar-emotions/`；本文不包含上游地址、凭据或参考声音。
