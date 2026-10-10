# 小伴唤醒提示音验收

- Date: 2026-10-10
- Runtime: 本机 http://127.0.0.1:4318 / 0.9.10
- Implementation: 439bdc4（issue-1）；issue-2 本文所在提交

## 结果

最终识别文本准确命中唤醒词后响一次约140毫秒的柔和双音，直接继续倾听或提交同句问题。partial、未命中、手动唤醒及后续连续对话不会重复提示。按当前账号的本机输出设备选择；设备路由未就绪或不支持时跳过提示音，禁止无声地回退到其他设备。

## 验证

- 9个文件共124项测试通过：wake-cue、voice-conversation、voice-barge-in、voice-reports-hook、voice-audio、voice-capture、voice-reports、stream-speech、device-preferences。
- 三档VAD以140ms合成PCM和不同250ms帧偏移输入，不单独触发；用户紧接着讲话的起音保留。现有AEC保持，没有添加收音暂停或丢帧窗口。
- 真实hook测试启动手势、账号扬声器、final命中、会话取消、隐藏、输出变化和epoch改变。停止时独立释放cue context，不依赖已失效的UI状态回调；插话取消声音并保留当前会话已解锁输出。
- 播放器测试迟到resume/setSinkId、路由不支持/拒绝/错设备、5秒超时、源启动失败、同步静音、重复暖启动和关闭释放。提示音失败不结束Chat。
- tsc和Vite生产构建通过；构建使用`--emptyOutDir false`。dist/downloads仍保留15个文件，mtime均早于本轮构建；未重打或替换客户端包。
- Chrome通过隔离loopback测试页调用真实模块：用户点击成功解锁AudioContext、48000Hz BufferSource播放；OfflineAudioContext实际渲染6721样本、峰值0.0650；停止后context=closed，控制台无错误。试听WAV与截图在ignored `evidence/wake-cue-20261010/`。
- Chrome本机正式页面加载登录界面，默认地址127.0.0.1:4318，控制台无错误；health返回ok/0.9.10。没有更改正式账号设置、聊天或后端进程。
- 自审及只读独立审查未见阻塞缺陷。首次hook新增测试误用fixture字段transcript，修正为onTranscript后通过；不将该测试夹具错误当作产品故障。

## 验收边界

本次是合成PCM回归和真实浏览器输出/渲染验收，没有申请现场麦克风，也没有重新测试远程ASR/TTS上游。真实喇叭听感、房间混响和各安卓/Ubuntu/Windows目标硬件回声效果未据此宣称通过。仅更新本机网页构建；未重新制作安装包、推送GitHub或部署到远程服务器/板端。

测试页和loopback服务验收后关闭；保留ignored证据供复查。
