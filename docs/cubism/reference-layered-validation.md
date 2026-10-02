# V7 Cubism 补强验收：2026-10-02

本次补强的是实际 Cubism 模型。源码与正式网页默认均为 `public/avatars/akari-cubism-v7/akari.model3.json`，由官方 Core 6.0.1 绘制真实 MOC3；临时 AnimeScene 原立绘恢复作为历史检查点保留，不作为本次完成证明。网页已上线，本轮没有重打 Android、Windows 或 Ubuntu 安装包。人物是否符合用户审美仍以体验反馈为准。

## 源图、绑定与真实模型

同一张 1024×1536 中性母稿机械分解为 11 层，保留原脸、眼睛、额头与刘海比例；中性合成对原图 RGB 最大差为 0、alpha 最大差为 1。PSD 实际读回验证名称、顺序、矩形、隐藏状态和所有 RGBA。头部及局部覆片共用坐标，颈部与上肩固定，身体呼吸独立；发根固定，只移动低处发梢。头部采用轻微二维倾斜，避免不完整背面素材造成大角度透视拉扯。

左右闭眼为局部原生覆片，快速闭合以避免半闭眼重影；A 为说话基础口型，O 覆盖 A，OpenY 只改变内部唇形，周围皮肤与覆片边界固定。静音、隐藏、休息和停止播放时嘴型归零。三种实际情绪通道择强使用，避免多个脸部覆片互相混合。

最终模型有 11 个 ArtMesh、16 个实际响应参数、2405 顶点。冻结作者工具的 704 个上游文件保持；新 profile 和 runner 使用公开 API，原始导出与六个动作的运行时后处理分别记录。MOC SHA-256 为 `cd23862cb34f5ea26801d638ebc87036f4ba1e08c5d506f27d320df3f7c7c0c9`，图集为 `7c3d2c7ab8762a0012f38977edbe3fc865d3c47cd8a0f194fee30574ddd94c66`。来源、重建和能力合同见 [作者说明](akari-reference-layered.md) 与 [provenance](akari-reference-layered-provenance.json)。

## 检查结果

- 官方 Core 6.0.1 一致性为 1，损坏 magic 负例拒绝，58 个姿态及实际情绪绑定通过。
- 专用原生模型回归 7 项通过，包括独立左右闭眼、嘴型内部与边缘、共享头部坐标、固定颈肩、独立身体、发根与 121 个组合姿态无三角形翻转。
- 相关 avatar／anime／Cubism／speech 回归为 205 pass、0 fail／cancelled／skipped；TypeScript 与隔离 Vite 生产构建通过。构建仍有既有大 chunk 提示，没有构建错误。
- Chrome 插件直接加载最终 public 模型，观察完整原图与真实模型的中性、闭眼、A／O、情绪、方向及组合姿态，连续慢速巡检覆盖数百帧。私有对照页未观察到模型 warn／error；未使用 atlas 或 PSD 预览替代 Core 截图。
- 正式 HTTPS 网页实际为 avatarRenderer=cubism、Core raw 100663297、MOC version 5。412×960 下 innerWidth=scrollWidth=412，没有水平溢出，完整人物可见。短暂加载原立绘后确认仅剩真实 Cubism canvas；浏览器视口覆盖已还原。
- 正式网页直接点击观察到 petAction=pet、expression=happy、motionGroup=TapHead；鼠标长按后为 sleep、左右闭眼 1、mouthOpen 0、motionEnabled false，Enter 唤醒。此次属于 Chrome 鼠标／键盘及视口模拟，没有转写为手机触控或客户端实机结果。
- 朗读 test 账号中已有的语音验收回复，没有发送新的 Chat／Agent 请求。实际 `/api/voice/synthesize/stream` 返回 200、application/x-ndjson，观测到 speaking、playback-progress、A 口型及开度 0.200；自然结束、准备阶段停止及播放中手动停止后均闭嘴，最终 idle／mouthOpen 0。手动停止产生既有 AbortError 日志，因此没有宣称正式页面全局零错误；ASR 本轮未重验。

## 网页交付与边界

135 个静态文件在部署前核对，保留 113 个已有文件，增加 21 个文件并原子替换 HTML。部署时账号状态／token 字节、下载包大小与 mtime、稳定更新清单均保持，后端 PID 34828 没有重启。正式 HTTPS 的 131 项 HTML、三代模型、Core／Framework、shader、README 与许可资源读回 hash 全匹配。旧资源与回退 HTML 保留；私有检查服务器已停止，对照标签页已关闭。

这版是原比例的原生分层 Cubism 模型，仍采用局部闭眼与情绪覆片，没有连续上下眼睑几何、独立眼球视线、手部挥动或完整大角度三维转头。生成 CMO3 是真实编辑候选，官方 Cubism Editor 的打开、保存和再导出尚未验证，不能称为完整专业 VTuber rig。实体设备及四端客户端尚未在本轮验收。

私有证据保留于忽略的 `evidence/cubism-deformation-20261002/`：v7-core-final.json、v7-related-tests.log、v7-public-mobile.json、v7-public-interaction.json、v7-public-sleep.png、v7-public-412-final.png、v7-tts-active.json、v7-tts-stopped.json、deployment-v7.json 与 public-readback-v7.json。不提交私有数据、账号、工具缓存或浏览器日志。
