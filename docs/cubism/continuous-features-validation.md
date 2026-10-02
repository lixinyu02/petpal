# V11 连续五官验收

开始于 2026-10-02，网页上线与最终验收完成于 2026-10-03。默认资源 `/avatars/akari-cubism-v11/akari.model3.json`。

## 模型与测试

- 官方 Core 6.0.1 实际执行 MOC5：16 个绘图、22 参数、3261 顶点，一致性和损坏负例通过。
- 106 组姿态，50 项独立五官检查；左右眼、虹膜、眉毛的孤立性、眼睑中间插值、真实 mask、三角形朝向、随机组合有界性通过。
- 身体、头发、既有合手动作和 A/O 嘴型原生几何与 V10 保持一致。Core 重建量化偏差门槛小于 0.08 源像素。
- PSD 16 层位置/可见性/像素精确读回；采用 native clipping 合成后，中性可见像素误差 ≤1/255。修正前眼周 558 像素误差 >5，修正后为 0。
- 340 项人物、Cubism、交互、语音驱动相关测试通过，TypeScript 和隔离 Vite build 通过。
- 60 秒、3600 次 ASR 草稿变化与固定草稿的姿态差为 0；持续前倾不累积，结束后回落。此为受控状态输入测试，不是本轮上游 ASR/TTS 服务重新验收。

## Chrome 与上线

- Chrome 插件检查实际 V11 中性、半闭眼、闭眼、侧目，保留脸型、眼睛大小和刘海；修正眼周白边。
- 浏览器连续模式中倾听保持 `scale(1.00672)`，停止后连续退回约 `scale(1.00004)`，嘴部保持关闭；ASR 草稿按钮更新未重启入场。
- 公网鼠标头部悬停实际触发 `TapHead`；手机触摸合手区域实际触发 `Sway`，区域和 source 元数据分别匹配 `head/hover`、`hand/tap`。
- 公网关闭缓存后实际加载 V11 与官方 Core，无 fallback；本次 Core 传输 228342 bytes、约 2033ms。
- 412×960 CSS 屏幕：document scrollWidth=412，画布 379×570.8125，无横向溢出。
- 220 项本机静态文件部署校验通过；216 项公网资源与隔离构建 SHA-256 完全一致。
- 后端 PID 34828 未重启；账号配置、token、下载包和正式升级清单保持。仅网页更新，客户端没有重打包。

证据在忽略目录 `evidence/cubism-features-20261002/`：`core-attempt4.json`、`final-regression.log`、`final-neutral.png`、`final-half.png`、`final-closed.png`、`public-412x960.png`、`public-head-hover.json`、`public-hand-touch.json`、`listening-exit-browser.json`、`deployment.json`、`public-readback.json`。失败及旧候选保留，最终只使用 attempt4。
