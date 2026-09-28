# CosyVoice 流式播放验收（2026-09-29）

## 实现与自动化验证

源码功能提交：`d8685f5`（issue-23）。新增的是音频输出流：上游一次接收完整文本，返回 24 kHz / PCM16LE / mono。未确认有逐字追加文本接口，自动朗读仍从模型回复完成后开始。

1.0 倍使用 `/api/voice/synthesize/stream`，其他语速保留完整 WAV。服务端按消费速度转发并逐帧鉴权；前端认证作用域持续到消费结束；桌面 IPC 一次至多 64 KiB 在途。播放器以 120ms AudioBufferSource 连续排程，约 240ms 首段预缓冲，最多约 3 秒提前排程；跨块的半个 PCM sample 保留。口型使用已排程样本能量与近似文字嘴型，不是音素识别。

- 全量测试 **461/461**（`node --test --test-concurrency=4 tests/*.test.mjs`）。
- TypeScript、Vite 构建、Git 差异检查通过；保留已有 Three.js 大 chunk 提示。
- 覆盖首段先于 EOF、NDJSON终帧/顺序/大小、奇数采样边界、背压/欠载、注销/停用/配置变化/断开、非默认扬声器拒绝静默回退、取消后迟到数据、播放器自然结束及资源释放。
- 自查并修复解锁中的 context 被播放接管时误关自动朗读竞态。
- 初次高并发测试包含未完成 fixture 捕获修正、既有 Codex fixture 超时与动态端口被 fetch 拒绝；修正新 fixture 后，Codex 独立复测及最终全量通过，未改 Codex 实现。

原始本机证据位于忽略目录 `evidence/cosyvoice-stream/`，不发布参考音频、会话令牌或私有配置。

## 真实服务与浏览器

已在 `https://magicdatou.top:44318` 部署，同一主机经公网域名回环访问，使用默认 CA 校验，没有跳过证书验证。此轮没有使用独立外网节点，不能据此新增独立公网可达性结论。

| 验证 | 实测结果 |
| --- | --- |
| 93 字中文，公网域名流接口 | HTTP 200，响应头 33ms，首 PCM 3537ms，完整 EOF 11327ms |
| 输出 | 51帧、760320 bytes、15.84 秒、24kHz 单声道 PCM16LE，有匹配的 end |
| 匿名访问 | 401 |
| 旧 WAV 兼容 | 200，4516ms 完成，5.68 秒有效 WAV |
| Chrome 长句连续播放 | 24.64 秒音频，首 PCM 3646ms，首个音频节点约3699ms开始播放 |
| Chrome 排程 | 206段连续音频，未测到排程空隙（浮点误差 < 1e-9ms），最大提前量2.995秒，24kHz内容由48kHz AudioContext播放 |
| Chrome 结束/停止 | 自然结束回到就绪；第二次在播放中停止，中止reader并停止25个已排程source，随后未再增加source |
| Chat 自动朗读 | 使用真实 Halogen 回复触发第三条语音流，HTTP200、首段约3861ms，正常播放结束；自动朗读未被解锁回调误关 |

Chrome Console 未见错误；验收后已关闭自动朗读，移除临时 fetch/AudioBufferSource 时序观察，并保留已登录的验收页面。截图及原始音频时钟数据在 `evidence/cosyvoice-stream/chrome-*.png/json`。自动朗读并未在模型每个文字增量时发起请求。

首次公网探针错误地断言每帧必须偶数字节，导致探针自己停止；修正为累计总PCM偶数后成功。该失败单独记录，不属于生产故障，未因此修改生产实现或音色。

部署备份和私有回执位于 `.data/https/cosyvoice-stream-backup-20260929-065051-743-37d6762c` 及同时间戳 deployment JSON。已核对实例、2账号、部署时11会话及所有消息、模型、语音/参考音频、service设置完整保留；23个最终前端文件与隔离构建逐项哈希一致。Chrome的聊天功能验收会额外留下命名明确的测试会话。

## 交付范围

共享前端和后端源码包含 Web、Android、Windows、Ubuntu 的适配。现有 GitHub v0.7.0 安装包未重发，其中仍使用完整 WAV 路径；本次真实验收针对更新后的网页。Android/Ubuntu 物理设备、指定物理扬声器、音色自然度尚未人工验收。浏览器音频时钟和 PCM 数据可验证传输及播放安排，不能替代物理听感确认。
