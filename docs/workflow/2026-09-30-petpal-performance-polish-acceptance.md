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

- 工具栏、阅读区、输入区共用最大 920px 阅读列，消息列最大 860px；不更改滚动/flex/短屏高度约束。欢迎建议仍只预填，Chrome 确认点击后消息数为 0。
- 统一 Sun/ArrowRight/ArrowUpRight/Sparkles 等线性 SVG，移除新对话的重复加号；语音、账号、更新设置补图标。三处品牌采用 favicon 同一猫脸 SVG，清除旧图标的背景/padding/旋转，sidebar 为 38px，首页 36px；装饰 SVG 对读屏隐藏。
- coarse pointer 下模型关闭、刷新主机、账号等主要操作为 44×44px；768px 触屏 Chrome 实测通过。设置标签不折行，498px 容器可横向浏览 698px 标签条，各标签高 47px。
- Chrome 最终构建验收实际 1280×800、412×960、412×560 和 768×960；无横向溢出，手机人物 WebGL 正常。短屏权限和模型弹层完整位于视口内；40 条长历史可键盘/滚轮阅读，返回最新入口正常。
- 固定 4000 字合成流式回复完整保存，UTF-8 SHA-256 为 a14e8e42da1a2347b042ae967705ac98e713e8314586bc1b45eeca193e55f951，与预期一致；完成后朗读入口显示，停止保留已到正文并恢复输入。本轮没有调用真实 LLM/Agent/语音服务。
- 最终 42/42 定向回归、TypeScript、Vite 构建、源码包边界检查通过；品牌 CSS 冲突在只读复核中修复并重新构建。Vite Three chunk >500KB 提示仍存在，依赖已经按需加载，不能由传输体积推断低配设备 FPS。
- 30 个新静态文件逐文件 SHA-256 readback 成功；HTML 原子切换且保留回退副本。旧 assets/PNG 与下载目录保留，两份 Windows 0.9.1 镜像的长度、UTC 修改时间和 hash 均保持。后端 listener 仍为原 PID，没有重启。
- 本机和 https://magicdatou.top:44318 health 200/ok，匿名 state 401；公网 30 个 HTML/JS/CSS/WebP/其他静态文件全部 200 且与构建 hash 一致。
- 正式站点既有 test 登录仍有效；实际 412×960 人物帧计数增长、Chat/Agent 模式、可用模型、在线执行电脑与权限状态可见。截图为 public-desktop-final.jpg、public-mobile-final.jpg；未提交真实任务。

本轮只上线网页，不重新制作 Windows/Ubuntu/Android 安装包，不视作四端实机或麦克风/摄像头/ASR/TTS 性能验收。当前收益来自资源传输、按需挂载及减少 React 非实时区域工作；没有证据需要全面 Rust 重写。
