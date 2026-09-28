# CosyVoice 接入任务

- Date: 2026-09-28
- Complexity: L2
- Related design: 2026-09-28-petpal-cosyvoice-design.md
- Goal: 试用用户的 CosyVoice，完成受认证的朗读接入和公网使用路径。
- Ordering rule: Complete issues in sequence.

## issue-15

- ID: issue-15
- 标题: 接入 CosyVoice 合成及账号语音播放
- 范围: 管理员上游/参考声音配置，Gradio 适配，受认证合成接口，前端试听/朗读/扬声器/近似口型
- 依赖: issue-14 done
- 验收标准: 受控接口与鉴权测试通过，前端构建及取消/播放测试通过；默认系统朗读兼容，无凭据和私有路径泄露
- 状态: done
- 验证方式: Node 定向测试、前端构建、代码自审、公开源码扫描
- commit: `feat(issue-15): add authenticated CosyVoice speech playback`

### issue-15 验证

- 后端 54 项定向测试、前端 49 项定向测试和 TypeScript/Vite 构建通过；涵盖配置/参考声音私有化、实际 PCM 校验、Gradio 文件及同 session 流式下载、超时/限流/撤权，以及 Blob 账号隔离、输出设备和迟到播放取消。两组测试包含部分共同回归，不把数量相加当作去重总数。
- Chrome 在隔离实例中完成参考 WAV 上传、设置页试听、伙伴页播放、停止与自然结束；可见播放状态进入并退出，自动朗读初始为关闭。使用合成样例和受控 Gradio fixture，不代表真实 GPU 服务已生成音频，也没有人工确认物理喇叭。
- 兼容 Gradio 5.4.0 的同 session playlist-file 下载，最终仍严格检查 PCM WAV；不接受 MP3 伪装 WAV。源码依据 Gradio 官方 audio.py / blocks.py / routes.py。
- Linux 与源码包必需文件列表已纳入后端适配模块，源码打包 check 通过；没有重打包或替换 v0.6.1 Release。

## issue-16

- ID: issue-16
- 标题: 配置实机 CosyVoice 并验证公网路径
- 范围: 合成示例参考声音、实际队列合成、现有源码服务部署、Chrome 试听、公网入口与未登录保护
- 依赖: issue-15
- 验收标准: 真实非静音 WAV 生成并从认证路由播放；保存私有回滚和验证证据；明确独立外网验收边界，不公开无认证 Gradio
- 状态: done
- 验证方式: 实际 WAV/Chrome/认证路由/网络配置及域名检查
- commit: `fix(issue-16): align CosyVoice calls with Gradio session protocol`

### issue-16 历史排查

- 2026-09-29：用户修复上游并提供只读日志。重新开始实机验收，定位并修复简化 call API 的 session/event 绑定及文件 URL 前缀兼容性；历史失败证据保留，最终状态以本次 WAV 与浏览器实测为准。

- 源码服务已在核对进程身份及无活动聊天/Codex任务后备份、重启，沿用原端口和来源名单。原 instanceId、用户数量、全部会话 ID 保持；共享服务地址与合成示例参考声音已通过 owner API 保存。配置/回滚材料仅在私有 `.data/` 中。
- 参考声音由本机 Microsoft Huihui Desktop 生成，24 kHz / 16-bit / mono，6.9795 秒，335,062 bytes，115,529 个非零样本。不是用户录音或未经同意的人物音色。
- 实际 Gradio upload 和 generate_audio 队列创建成功，但 SSE 返回 `event: error` / `data: null`；Chrome 原生页面同样显示错误。部署后经小伴认证合成接口复核为 502，错误已脱敏，未生成有效远端音频。默认引擎保留为 system，未用受控 fixture 冒充真实合成成功。
- 独立外部 check-host HTTP 探针验证：两个外部节点对域名现有健康接口返回 200；另两个外部节点对匿名语音接口返回 401。现有个人服务端口已可从公网到达，本轮没有新增裸 Gradio 转发。探针回执保留在 `evidence/cosyvoice/external-probes.json`，未向探针发送登录凭据。
- 公网 TLS 检查遇到不受信任的证书，未绕过验证；当前 HTTP 入口不能宣称已经配置可信 HTTPS。手机/跨源客户端的 HTTPS 连接策略保持不变。
- 阻塞：需要用户提供语音服务器的 SSH/容器日志入口，才能定位服务端合成错误并完成真实 WAV、音色和播放验收。已向用户询问，没有尝试将路由器凭据用于另一台主机。
- 已完成的源码接入、运行配置及公开网络验收均保留；没有更新 v0.6.1 二进制或宣称四端新包已验收。

### issue-16 2026-09-29 验收完成

- 用户修复推理服务并提供只读日志后，确认此前队列错误还包含适配层缺陷：Gradio 简化 GET 按 event_id 查会话，不能传不同的 session_hash；当前修复省略该字段，严格使用返回的 32hex ID 读取队列并校验流归属。Gradio 5.4.0 的 `/gradio_a` 错误前缀只作为精确元数据别名兼容，下载仍使用规范地址。
- CosyVoice 15 项回归及 voice-settings/remote-speech 23 项测试通过；更新了原先错误模拟会话关系的 fixture。独立只读代码审查无必须修复项，公开源码扫描通过。
- 后端沿用现有端口、来源名单及账号数据，核对进程身份后备份并重启。域名认证合成返回 200，耗时 7102 ms，音频 472364 bytes、24 kHz / 16-bit / mono、9.84 秒；PCM 校验非静音。私有证据 `evidence/cosyvoice/repaired-verification.json` 和 `repaired-synthesis.wav`，未提交音频/日志/配置到公开仓库。
- Chrome 在临时 loopback 实例（隔离账号数据、相同前端/修复后端、真实上游与示例参考声音）实际进入播放，停止后立即回到待命，短句自然结束；此处未使用模拟音频。域名上的生产链路由上述认证 WAV 请求验证；不把 loopback 浏览器验收说成已登录公网 UI，未人工确认物理喇叭/听感。
- 主账号引擎已保存为 cosyvoice；实例 ID、用户数及会话 ID 全部保持，匿名合成接口仍为 401。用户同意沿用 HTTP，未新增端口转发或修改已发布 v0.6.1 资产。
- 协议依据：Gradio 5.4.0 [事件和会话](https://github.com/gradio-app/gradio/blob/gradio%405.4.0/gradio/queueing.py#L45)、[简化 GET](https://github.com/gradio-app/gradio/blob/gradio%405.4.0/gradio/routes.py#L1086)、[root URL 参数](https://github.com/gradio-app/gradio/blob/gradio%405.4.0/gradio/queueing.py#L615)、[裁剪实现](https://github.com/gradio-app/gradio/blob/gradio%405.4.0/gradio/route_utils.py#L391)。
