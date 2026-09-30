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

issue-56 已完成并上线。完整回归916/916、TypeScript和独立Vite构建通过；构建保留既有较大分块警告，本轮没有扩大资源优化范围。

Chrome隔离环境实际合成并播放同一句正文：开心语气时canvas为happy / speaking=true / playback-progress且mouthOpen>0；中性语气覆盖正文中的开心表达，canvas为neutral且嘴型继续跟随播放。自然结束与主动停止后均回到idle / speaking=false / mouthOpen=0。设置再次读取保持已保存的值；从强烈切换中性自动归一到natural并禁用强度选择。准确412×960 CSS viewport下document/body宽度均为412，两个选择框位于屏幕内；测试后清除临时尺寸覆盖。

真实ASR→GPT-6 Luna→分句CosyVoice闭环完成：合成输入识别为“你好，小拜，请告诉我，二加三等于多少？”，回答“二加三等于五。”；ASR结束到done210.8ms，LLM首delta2831ms，首TTS1057ms，输入结束到首音4266ms。名字误识保留在回执中，不宣称识别完全准确；此测试没有写入生产聊天。

受控重启前确认没有运行中的Chat、Agent、ASR和TTS；已有1条暂停队列保持暂停。原服务PID/启动时间/命令一致后备份私有state；重启后state逐字节SHA256不变，2账号、5模型和28会话保留。新后台PID231164监听原4318端口。静态部署30文件逐一SHA256读回，HTML最后原子切换，保留旧hash资源和回退入口；Windows0.9.1 EXE/ZIP的长度、mtime和SHA256与原baseline一致。本轮未重打原生包。

公网https://magicdatou.top:44318/在正常TLS验证下health200；state、voice、ASR配置/创建和两种synthesize匿名请求全部401。30个部署文件公网内容hash完全一致，ASR config/protocol核对成功、busy=false。新版Accept实际收到happy/natural/rules情绪；旧Accept实际取得精确旧format/audio/end，两次均147840bytes并正常end，首段分别1086ms和952ms。

正式Chrome test账号已读取新设置并实际达到“CosyVoice边生成边播放”状态，主动停止后回到就绪；未保存任何生产账号设置改动。截图public-voice-settings.png和结构回执保存在ignored evidence目录。参数、实际播放及合成字节证明接口与联动可用，不能替代主观听感、物理麦克风或Android/Ubuntu真机验收；自动语气是文本规则，不是声音情绪识别。
