# 关键词唤醒验收

- Date: 2026-10-10
- Runtime: 本机 0.9.10 / http://127.0.0.1:4318
- Implementation: ae20398（issue-1）、ed9014d（issue-2）、issue-3 本次 UI 与验收提交

## 行为

- 默认关闭，账号保存最多 5 个词，默认“你好小伴”；连续对话空闲 45 秒回待机，可设 15–300 秒。
- 等待唤醒保持一次麦克风申请，经 VAD 才创建短 ASR。静音不上传。只根据最终句首匹配唤醒；未匹配内容不进入聊天，不触发 Agent/TTS。
- 仅说词进入连续倾听；词+问题去词后发送。连续对话和自动插话保留，待机积压的任务报告唤醒后再播。
- 单字符 NFKC 扩展不能中途匹配并吞掉正文；英文词边界、组合字符、分解韩文和最长词已验证。
- 隐藏、退出、账号/设置/输入输出设备变更停止监听；上游 busy/故障显式停止，不自动无限重试。

## 验证

- 17 个语音、ASR、TTS、账号与首页 UI 回归文件共 210 项通过，无跳过；TypeScript 与 Vite 生产构建通过。
- Chrome 在隔离账号保存三个词“你好小伴 / 小伴小伴 / Hey Cat”和 30 秒，重新读取保持；启用但空词被明确拒绝。用户正式配置未被测试修改。
- CSS412×960 的 document clientWidth/scrollWidth 均412，字段宽367.33、无组内溢出；临时 viewport 已恢复。截图 `evidence/wake-word-20261010/settings-412x960.png`。
- 新代码已启动本机后端，新 PID42056。认证 `/api/voice` 返回默认 wake 字段；重启前后 users/conversations/providers/settings/ASR/CosyVoice 配置逐项相同。原数据与服务收据备份在私有 `.data/deployment-backups/wake-word-*`。
- Vite使用 `--emptyOutDir false`；15 个 dist/downloads 文件路径、大小、mtime、SHA256 均与构建前相同。
- 验收后已关闭 Chrome 测试页和隔离预览服务、恢复 viewport。清理本次私有临时目录的两次操作均在执行前被自动策略拒绝，未删除；目录保留在 Git ignored `.preview-data-wake-Zw3hag` 中，不参与构建和发布。正式 .data 保持。

## 真实上游识别

用新服务代码和现有真实 ASR/CosyVoice 配置建立 loopback 隔离服务，使用 CosyVoice 合成 PCM，再输入真实前端语音状态机、实际 ASR HTTP/SSE 适配器。模型回复采用固定测试回调，不调用正式模型/Agent，也不生成正式聊天记录。采集与播放替身不使用现场麦克风/扬声器。

1. 合成“今天的天气怎么样”→ ASR `Speaker 0:今天的天气怎么样？`，没有 Chat 请求，回 armed。
2. 合成“你好小伴，请告诉我今天是星期几”→ ASR `Speaker 0:你好，小伴，请告诉我今天是星期几？[Silence]`，实际发给 Chat 回调只有“请告诉我今天是星期几？”。
3. 合成“请再重复一遍”→ ASR `Speaker 0:请再重复一遍。`，连续对话收到第二次请求；两次测试回复均经真实 CosyVoice 返回有效 PCM WAV。
4. 15 秒空闲后回 armed。5 次 TTS 请求本次约1.0–1.8秒返回有效1.0–3.12秒音频，仅代表合成接口本次耗时，不是麦克风至可听声音延迟。

收据 `evidence/wake-word-20261010/live-voice.json`（pass=true），测试脚本和音频只保留 ignored evidence。

## 边界

这是前台 ASR 文本唤醒，不是声纹、纯本地离线热词或系统后台唤醒。候选语音会送至已配置 ASR；未验收用户现场环境人声、扬声器回声或真实目标设备。已有 ASR 能量降噪只能有限减少旁人/电视触发候选；不会以任意包含或模糊匹配替代用户关键词。

本轮更新本机网页/后端，未重打 Windows/Ubuntu/Android 安装包，未推送 GitHub或在远程主机部署。旧安装包的内置前端仍需下一轮打包更新。
