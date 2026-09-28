# CosyVoice 实时音频流

- Date: 2026-09-29
- Complexity: L2
- Status: final

## Background

现有 Gradio 适配等待 complete，再下载 WAV，浏览器还要等待 Blob 完成才播放。用户已在 192.168.60.10:50000 更新服务，希望流式输入输出与更流畅的语音。

实测 OpenAPI 的 POST /api/tts/stream 使用 multipart：tts_text、mode=zero_shot、prompt_text、prompt_wav、seed=0；返回 application/octet-stream，X-Audio-Format=pcm_s16le、X-Audio-Sample-Rate=24000、X-Audio-Channels=1。网络块可以有奇数字节。短句首段 2210ms，总 2221ms，88320 字节。该 HTTP 接口接收完整文本，没有追加文本或输入结束字段；Gradio 当前为 sse_v3，也未公开双向文本 WebSocket。已向用户索取额外接口路径，先完成已验证的音频输出流，不宣称实现未知的双向协议。

## Goal

让消息播放按钮及自动朗读直接边接收边播放真实 CosyVoice PCM，缩短首音等待，连续安排音频，保留账号隔离、扬声器选择、取消与口型。覆盖共享 Web/Android/桌面前端与桌面原生远程传输。

## Non-goals

不更换参考音色、不自动降级为系统 TTS、不新增 ASR 或更改 LLM 回复内容；不修改既有 v0.7.0 安装包/发布资产。未公开的文本输入流不靠猜测实现。

## Solution

1. 后端保留 /api/voice/synthesize 与旧 Gradio WAV 路径。新增认证 POST /api/voice/synthesize/stream，只接收 {text}，从账号读取语速与已保存的参考音色。1.0 倍走新接口；非 1.0 倍前端继续完整 WAV，明确显示原因。共享合成限流、并发、引用文件校验、配置 revision、180 秒合成截止与取消机制。
2. 对客户端使用 application/x-ndjson 的明确协议：首帧 {type:'format',format:'pcm_s16le',sampleRate:24000,channels:1}；若干 {type:'audio',data:<base64>}（单帧原始数据 <=24576 字节）；正常结束 {type:'end',bytes:<总PCM字节数>}；错误 {type:'error',message:<安全文本>}。必须有 end 才算完整；末帧前检查总字节非零、偶数及20MiB上限。不能把上游异常文字当成 PCM。原始PCM本身没有完成证明，end只证明上游HTTP干净EOF与格式边界，不声称语义无截断。
3. 服务端使用 write/drain 背压，客户退出/撤权/改配置中止上游；每次推送重验会话。配置和密钥只在服务端，浏览器继续访问可信 HTTPS，不直连 LAN。
4. 客户端解析器验证格式、帧大小/顺序/base64/总字节/end，读完或取消才关闭认证 request scope，每块校验 epoch。onAudio 回调可等待播放器腾出缓冲，背压贯穿 fetch。
5. Web Audio 按 24kHz 创建 AudioBuffer，浏览器负责输出采样率转换。AudioBufferSource 在同一音频时钟上连续排程，跨块保留半个 PCM sample，预缓冲约240ms、限制排程提前量约3秒；网络断粮后重新预缓冲，避免大量 Audio 元素切换和逐块 WAV 空隙。实现不依赖 SharedArrayBuffer/COOP/COEP。停止立即静音、停止全部节点、废弃迟到数据与网络，释放 context。
6. 点击播放或开启自动朗读时同步解锁 AudioContext；播放前路由指定扬声器，AudioContext 无 setSinkId 时明确报错，不静默切默认。生命周期覆盖隐藏、退出、切账号、改配置、离开聊天、卸载。保留时间近似口型并允许加入真实音频能量驱动，不能称为音素对齐。
7. 桌面 IPC 增加可选消费 ACK，限制在途块，消费后请求下一块；旧客户端仍保留兼容。元数据位于首帧，无需新增跨源暴露头；原生传输保持凭据快照及固定来源限制。

## Impact

server/cosyvoice.mjs、server/app.mjs；共享前端 API/语音 hook/PCM 播放器及语音设置说明；desktop 远程 IPC 与 native-fetch；协议、播放器、认证和桌面传输测试；CosyVoice 文档。保留现有 state schema 与参考文件，无迁移或数据清空。

## Risks

上游推理速度或网络慢于播放时仍会发生欠载，需要显示缓冲状态而非伪造流畅。浏览器自动播放/输出选择支持不同，必须提前解锁与明确错误。网络突发不能导致无限缓冲；停止/撤权不得留下已排程音频。新接口不支持语速且不支持已证实的增量文本，需要如实呈现。真实公网测量与本地模拟应分开。

## Verification Plan

模拟上游验证收到第一块早于 EOF、奇数分块、错误/空流/超限/格式拒绝、背压、取消/撤权、共享限额。播放器测试连续时钟、采样转换、预缓冲/欠载、有限排程、停止迟到回调、路由失败与播放解锁。解析器验证帧顺序/终帧/限额/认证。运行相关测试、全量回归及 TypeScript/Vite。再用真实 CosyVoice 较长文本记录首头/首块/结束时间，用 Chrome 插件验收按钮、自动朗读、停止及公网 HTTPS；记录实际播放器时间和缓冲情况，不把模拟视口当真机。控制部署保留账号/模型/参考音色/聊天；不替换已发布安装包。
