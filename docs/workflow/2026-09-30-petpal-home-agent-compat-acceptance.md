# 首页选择器与 Qwen 兼容验收

日期：2026-09-30。

## issue-57

Chrome独立预览从首页直接加载，未先访问工作台：旧版权限内容透明、padding0且字段为单行flex。修复后加载链仅包含首页资源，权限内容有背景/边框、17px padding与两行grid。412×960下padding15px、选择框44px高，两段权限说明完整；语音模型和Chat+Agent触发器分别为44px高的两行，document宽412无横向溢出。

模型菜单在412×960和缩小后的412×520 CSS viewport都位于屏幕内（短视口top78/bottom508），可滚动、搜索Qwen和键盘选择。随后独立导航工作台，共享权限背景/两行保持正常。以上是Chrome模拟尺寸与键盘验收，不替代实体手机软键盘/触摸验收；临时尺寸已清除。

TypeScript及独立Vite build-home通过；30个部署文件公网SHA256一致。保留旧hash资源，HTML最后原子替换，Windows0.9.1 EXE/ZIP大小、mtime和hash不变，未重启后端或改变生产权限。

## issue-58

### 故障及修复

两次对应生产失败日志均为 CLIProxyAPI 8.0.4 连接局域网上游时 no route to host；同一 Mac 的普通 curl 能连接。用户为当前版本开启本地网络许可后，正式同源 `https://magicdatou.top:8317/v1/responses` 返回200/response.completed（1804ms）。未禁用证书校验、改用其他模型或回滚网关。

前后端移除了 Qwen 型号强制禁图，保持显式 supportsImages=false 的拒绝行为。生产管理 API 只将原生 Qwen Chat 和同源 Qwen Agent 两条连接设为 true，URL、密钥、模型、none 强度与账号授权保留。Codex 使用固定提示分类网络不可达、上游5xx及连接中断；原始诊断、内部地址和请求头不会返回用户，stderr仍只排空、不保存。

### 实际任务和图片

- 内置 Windows Codex CLI 0.143.0，以 Qwen/none 读取隔离随机标记文件，原生 commandExecution exitCode0（463ms）；任务 prompt 未包含标记值。同线程续接正确且无新工具调用。64×64纯红 localImage 正确回答“红色”。
- 隔离真实后端分别用 GPT Luna Chat 和 Qwen Chat 派发 Qwen Agent，权限 full-access/auto；限定任务只执行 Write-Output。两次原生命令回执 exitCode0，Agent completed，聊天结果各回传一次，总耗时约29.1/17.0秒。
- 完整附件HTTP链路：上传201、回取哈希一致；同源Qwen Agent通过附件ID收到原生text+localImage并回答“红色”（18.85秒），原生Qwen Chat的SSE meta/delta/done也回答“红色”（1.35秒）。两条链路保留附件元数据，不在生产上传QA图片。
- 公网HTTPS登录test，原生Qwen Chat实际派发同源Qwen Agent/full-access/auto/none完成，并且聊天结果只回传一次。QA对话及后台子任务经API清理，独立登录退出，原有28个对话逐对象比对保持。

### 回归、部署和边界

后端CLI/transport/附件/provider回归67/67，Chat派发/队列/权限/模型切换回归45/45，共112/112；TypeScript、独立build-agent及diff检查通过。固定错误分类覆盖RPC拒绝、error通知和turn.completed.error路径，检查密钥、Authorization/Cookie、内部地址和原始诊断均不泄露。

重启前确认无活动Chat/Agent、待审批或未暂停队列，ASR/TTS闲置；核对精确PID/启动时间/命令行，私有备份后受控重启。重启本身的state字节不变，管理API更新后深比较只变化两条图片能力字段。2账号、5连接、28会话和1条暂停队列保留。部署30个文件公网SHA256一致，HTML最后原子替换，Windows0.9.1 EXE/ZIP大小、mtime及hash不变。

公网健康200；匿名state/voice/ASR/synthesize均401。ASR配置及协议v1检查通过，新旧CosyVoice流均完整end且147840bytes，首音约1108/955ms；新客户端happy元数据可见，旧format字段保持兼容。Chrome正式网页的Qwen/none选项可选，图片按钮可用；412×960 CSS viewport及document宽均412，未溢出，模拟尺寸已清除。首页权限弹层有独立背景、边框和两行字段。麦克风入口检查后已关闭，未据此新增实体语音质量结论。

私有证据：`evidence/voice-upstream-20260930/` 的 chat-agent-real、public-agent-real、qwen-images-configuration、issue58-public-final、部署回执与截图；`evidence/qwen-cli-issue58-20260930/` 的 receipt 和 receipt-attachments。均不提交公开仓库。所有隔离验收服务/CLI关闭，正式服务保持运行。

本轮没有重打原生包，也没有实际操作QQ音乐或Ubuntu实机验收。语音听感和实体手机触摸/软键盘不能由协议、字节或Chrome模拟尺寸代替。语音新协议的完整闭环与人物情绪验收见同日期 upstream-voice-acceptance.md。
