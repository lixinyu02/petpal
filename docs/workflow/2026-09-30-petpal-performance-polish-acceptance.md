# 性能与视觉细化验收

Date: 2026-09-30。基线 f423860，浏览器使用 Chrome 插件与 loopback 合成夹具；本轮先更新网页。

## issue-50

- 8 张 1024×1536 PNG 原图移到 artwork，发布无损 WebP。完整 RGBA（含透明像素 RGB）逐像素检查通过；17,899,049 → 11,222,842 bytes（减少 37.30%），idle 2,356,254 → 1,492,668 bytes。解码 RGBA 仍为 48 MiB，不能推断 FPS/显存改善。
- 角色运行时均按需加载。CompanionScene 同步 chunk 从 555,054 → 5,004 bytes；仍有约 527KB Three 共用 chunk，但已离开关闭伙伴栏的初始 Chat 路径。
- Chrome 实际 1280×800、伙伴栏初始关闭：基线请求角色/Three/8 PNG；新版仅 7 个 CSS/JS 请求，没有头像或场景请求、canvas=0。展开显示真实 WebGL 人物；收起后帧计数保持 73，再展开增长至 135。
- 手机初开和桌面 resize 到实际 412×960 均自动挂载人物；canvas=1、avatarMode=webgl、帧计数增长，无横向溢出。8 张 WebP 均 HTTP 200；网络记录没有截断或未取完页。
- 稳定历史/模型/日期派生，历史 memo 忽略消息正文/语音 tick/Agent receipt，仍响应选中、标签、禁用与 callbacks；按 ID 读取最新会话与原有保护。窄屏监听清理和迟到事件有生命周期回归。
- 192 项定向回归通过；手机修复后 7 项 mount/history 定向回归、TypeScript、生产构建再次通过；源码包边界预检通过。原 PNG 与旧 Git blob hash 一致。

证据保存在忽略目录 evidence/ui-refinement-20260930；不把合成回复、Chrome 或资源审计当作 Android/Ubuntu 实机、真实模型、ASR/TTS 验收。

## issue-51

待完成 UI、图标及静态上线验收。
