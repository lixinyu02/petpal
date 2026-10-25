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
