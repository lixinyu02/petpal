# V7 人物展示美化验收

日期：2026-10-02。基线：`25a481354dc5f5d310cae5b38115fc336ca7c3fb`。

## 变更范围

- 奶油底、浅杏柔光和界面文字层级；内置 V7 首页画布轻微提色、淡投影，手形反馈缩小。
- `reference-layered` 纯 Idle 的原生动作时钟为 0.75 倍、角度为 0.7 倍；互动和互动淡出保留原速度与幅度。
- performance 统一日常眨眼时钟，原生互动眼睑保留；语音嘴型、停止／隐藏／休息闭嘴保留。
- 透明桌宠与紧凑聊天头像不在首页滤镜的祖先范围；减少动态模式取消装饰动画。

V7 MOC SHA-256 仍为 `cd23862cb34f5ea26801d638ebc87036f4ba1e08c5d506f27d320df3f7c7c0c9`。本轮未更改原画、脸部比例、刘海、几何或纹理。

## 检查结果

- 223 项既有角色／Cubism／语音相关测试通过。
- `tests/cubism-portrait-polish.test.mjs` 新增 4 项通过：使用真实 Core、Framework、V7 MOC 与六个原生动作，覆盖 16 秒 Idle、左右眼独立闭合、TapHead／Greet、安静状态立即闭嘴、旧 profile、纯待机倍率及互动淡出。
- TypeScript、隔离 Vite 构建和 CSS 解析通过。构建仍有既存的大于 500 kB chunk 提示。
- Chrome 正式站确认 `avatarRenderer=cubism`、`characterStyle=akari-soft`、MOC 5、Core 6.0.1。桌面 1906×904、手机 CSS 视口 412×960，页面宽度等于视口宽度，人物正常呈现。
- 本地真实模型预览轻触成功；正式页面键盘触发 `pet / happy / TapHead`。正式页减少动态模式为 `animation=none`、`motionEnabled=false`、breath／mouth 为 0。临时视口及媒体模拟均已清除。
- 只读复核未发现阻止提交的问题。`data-compact` 目前未写入 DOM，紧凑头像实际通过首页祖先范围隔离。

## 网页交付

地址：`https://magicdatou.top:44318/`。

静态部署于 `2026-10-02T10:37:12.381Z` 完成，核对 135 个静态文件后原子替换 HTML；HTTPS 读回 131 个相关资源全部与本次构建哈希相同。账号／token 字节、下载包大小与修改时间、稳定版升级清单均保持；保留旧静态资源，没有重启后台。

本地证据位于忽略目录 `evidence/cubism-polish-20261002/`：`tests.log`、`native-polish-tests.log`、`build.log`、`deployment.json`、`public-readback.json`、`public-browser.json`、`public-desktop.jpg`、`public-mobile.jpg`。旧模型与历史验收证据保留。

本轮未重跑真实 ASR／TTS 上游，未进行官方 Editor roundtrip、安装包重建或 Android／Ubuntu／Windows 实体客户端验收；不得将上述网页与 Core 测试解释为这些验收已经完成。
