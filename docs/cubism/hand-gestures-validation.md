# V8 合手动作与情绪联动验收

日期：2026-10-02。范围为共享前端与正式网页，模型地址为 `public/avatars/akari-cubism-v8/akari.model3.json`。原画与脸部、眼睛、刘海比例沿用 V7；本轮没有生成新人物图。

## 已完成

- 新增真实 `ParamHandsLift`、`ParamHandsSway`、`ParamSleeveEase`：合手小幅抬起与左右轻摆，衣袖柔和跟随。原生 Shy、Sway、Bow 加入现有 Idle／Blink／Nod／Shake／TapHead／Greet，保留平滑起落与回位。
- 说话状态接入上游 happy／gentle 情绪，每句最多触发一次轻摆；害羞／感谢语义可触发收手／礼貌点头。停止、缓冲、换回复与语义手势结束通过原生淡出清理；手动互动优先，隐藏、休息和减少动态清空动作。缺失新参数的 V7／旧模型安全降级。
- 官方 Core 6.0.1 实际读取 MOC5、11 drawables、19 参数、2550 顶点；一致性和 64 姿态检查通过。V7／V8 中性脸发比较容许 0.001 源像素浮点误差；121 个头身／手组合姿态无翻面且有限，75 组双手位移的最大残差 0.1995935714 源像素，小于 0.25 px 门限。颈肩区域保持固定。
- 相关回归 `248/248` 通过，涵盖真实 Core 几何、真实 Framework 队列／淡出、语音手势生命周期及原有 avatar／anime／speech。TypeScript 和隔离 Vite 生产构建通过；仅有既有大于 500 kB 分块提示。
- Chrome 插件在私有双实例预览对比 V7／V8 中性，以及 Shy／Sway／Bow 峰值；实际 CubismScene 的模拟说话／停止回待机通过，没有观察到新增脸发拉扯、手指接缝或明显衣服破洞。外观自然度仍需用户体验反馈。
- 正式 HTTPS 首页加载真实 Cubism，支持三个新手部参数；键盘轻触进入 TapHead，双击触发招呼文案和 Greet。桌面视口 1906×848 无水平溢出。手机 CSS 视口实际为 412×960，scrollWidth=412，人物画布 379×570.8125；截图完整显示头脸、衣袖和双手。
- Chrome 的减少动画检查为 motionEnabled=false、motionGroup 为空、gesture=none、mouthOpen=0。临时 viewport／媒体覆盖已恢复；成品网页保留，私有预览关闭，临时 Vite 服务停止。
- 生产静态部署先核对 151 个文件、原子替换 HTML；147 个公网 HTML／模型／Core／Framework／shader／许可与静态脚本的 SHA-256 读回均一致。账号 state／token 字节、下载包大小与 mtime、稳定更新清单保持，原静态文件保留，后端 PID 34828 未重启。

## 验收边界

手与袖子原先烘焙在同一 topwear 层，本轮仍保留双手交握，仅有小幅共同位移。没有独立手指、张开双手或完整挥手；这些需要独立手臂分层和遮挡后的衣服底图。父变形器插值会产生不到 0.25 源像素的微小残差，不能称为逐位刚性平移。

本轮浏览器语音动作测试使用模拟播放进度和情绪输入，未新增实际 TTS／ASR 请求；没有把历史真实 TTS 证据当成本次重测。CMO3 是真实导出的编辑候选，官方 Editor 打开／保存／再导出仍未验证。未重打 Windows／Ubuntu／Android 安装包，也没有声称三端实体设备已经验收。

## 追溯

作者合同见 [手部动作说明](akari-hand-gestures.md)，原始导出与后处理哈希见 [来源记录](akari-hand-gestures-provenance.json)。MOC SHA-256 为 `29ebb1c652f658b2033996583409b920beecd94d2c2b3667b6c67e6820694246`。

详细本机证据保存在忽略的 `evidence/cubism-hands-20261002/`：`core-final.json`、`regression.log`、`build.log`、四张 `*-compare.jpg`、`chrome-public-desktop.png`、`chrome-public-412x960.png/json`、`chrome-reduced-motion.json`、`deployment.json` 和 `public-readback.json`。业务私有配置、依赖缓存、截图和测试服务不入公开源码。
