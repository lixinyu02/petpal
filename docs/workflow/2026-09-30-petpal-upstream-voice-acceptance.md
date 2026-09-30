# 上游 ASR / CosyVoice3 适配验收

日期：2026-09-30。真实服务通过独立 loopback 后端验收，不复制生产聊天；参考声音沿用已授权的共享音色。

## 后台协议与实际语音

ASR 当前协议 version 1，保持 mono / 24 kHz / float32、累计文字、done 标记；没有结构化情绪、说话人或时间戳。新健康探测核对 config 与 protocol，仅两个可选入口的404可兼容旧服务。修正空 error 被忽略及 error→close1013 误判502；忙碌为429，等待关闭期间不能继续上传或发布字幕。60秒本地上限和创建登录绑定保持。

4.56 秒已有合成样例经修改后的独立 ASR service 取得两个 partial 和一个 done；首字幕4320ms，end→done192ms，本地和上游均释放槽位。这是合成样例输入，不是用户现场麦克风。

CosyVoice3实际 capabilities 明确支持 instruct2；auto/显式预设不混入正文。产品API实际结果：

| 路径 | 语气结果 | 首音频 | 结果 |
| --- | --- | --- | --- |
| 同文中性流 | neutral / choice / natural | 1046ms | 119040 bytes，2.48秒，end |
| 同文开心流 | happy / choice / natural | 909ms | 153600 bytes，3.20秒，end |
| 自动开心表达 | happy / rules / natural | 914ms | 147840 bytes，3.08秒，end |
| 原声复刻 | 不回传情绪，zero_shot | 1284ms | 74880 bytes，1.56秒，end |
| 1.2倍速完整WAV | gentle / choice / natural | 完整合成 | 105644 bytes，三头一致 |
| 取消后再次朗读 | gentle / rules / natural | 884ms | 115200 bytes，2.40秒，end |

新版流式EOF后核对 X-Request-ID 对应状态 succeeded/error_type=null/runtime未取消未超时才发end。首音后主动取消的真实任务排空，下一任务成功；没有自动重复播放。上述计时是本次局域网请求，不是延迟承诺，也不是主观听感证明。

已发布旧客户端严格校验format字段，新增Accept v2协商保留原格式；新版才能取得情绪元信息。WAV二进制保持原合同。

私有协议、音频、请求状态和测试日志保存在 Git 忽略的 evidence/voice-upstream-20260930；公开文档不包含密钥、参考音频和请求正文之外的用户数据。

## 前端和上线

issue-56 待完成：共同播放状态、人物表情、紧凑设置、完整回归、Chrome以及受控部署。不能以后台API结果替代实际浏览器播放或原生真机验收。
