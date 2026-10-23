# 深度流畅性优化验收

- Date: 2026-10-23
- Status: complete
- Product baseline: `a44330e`
- Baseline fixtures and planning: `38e365d`

## 范围与证据

本轮保持账号、后端、代理、权限和正式更新源不变。基线为真实组件、合成历史/流式输入和实际Android APK，分别见 `2026-10-23-chat-fluidity-baseline.md`、`2026-10-23-avatar-fluidity-baseline.md` 和 Android 基线报告。私有原始数据位于 `.data/deep-fluidity-20261023/`，不提交生产数据或凭据。

## 产品变更

聊天保留同层keyed消息元素；只复用Message引用与全部实际行属性相同的ReactElement，缓存仅在提交后发布。内容更新沿用稳定ID序列，入场动画只清理本生命周期实际活动节点。没有虚拟化或分块重挂载。

人物仅在一次pointer/refresh操作内复用矩形，异步tap/hold重新测量；连续诊断数值100ms发布，前两帧及语义变化立即发布。实际模型、纹理、口型、动作、DPR、30Hz配置和加载管线保持。

定向Node回归：聊天27/27、人物67/67，加Android指标聚合3项，最终统一97/97、零失败/取消/跳过，完整输出 `final-node-tests.tap`。TypeScript、隔离生产Vite与OpenUI构建验证通过，入口 `assets/index-DbFPGlqk.js`，OpenUI `assets/OpenUIBlock-CiOXK0px.js`。构建保留两条第三方zod纯注释位置warning，没有构建失败。

Chrome实际development React StrictMode下10/10语义检查通过：跨32/64位置的删除/重排保留129个既有节点；OpenUI表单、焦点、选择区和表格横向滚动保持；新回调、朗读归属、不可用状态、canonical ID替换、动画取消/策略变化/删除清理和会话隔离正确。另100消息/full/locked测量有效，最终100段按序且scrollTop固定13926。

## 同条件前后对照

同一Chrome、夹具、依赖、合成数据、视口/DPR和画质下，聊天两策略各3轮、人物idle/pointer各3轮after均有效。详见 `2026-10-23-chat-fluidity-comparison.md` 与 `2026-10-23-avatar-fluidity-comparison.md`。

| 三轮组中位指标 | before | after | 变化 |
| --- | ---: | ---: | ---: |
| 1000消息/reduced 提交确认P50 | 3.70ms | 2.70ms | -27.03% |
| 1000消息/full 提交确认P50 | 3.60ms | 2.90ms | -19.44% |
| full流式Profiler总耗时 | 278.10ms | 229.20ms | -17.58% |
| reduced流式Profiler总耗时 | 193.60ms | 238.30ms | **+23.09%** |
| reduced提交确认P95 | 5.00ms | 5.20ms | **+4.00%** |
| reduced流式class/attribute清理 | 各100000次 | 0次 | 清除无效全表清理 |
| 人物静置data属性变更/10秒 | 640 | 219 | -65.78% |
| 人物固定交互data属性变更/10秒 | 1523 | 556 | -63.49% |
| 人物固定交互rect读取/10秒 | 4362 | 2948 | -32.42% |

收益有权衡：元素缓存仍扫描实际行属性，reduced的React render期耗时增加，而旧DOM清理主要在layout/commit期。不能把两种指标混称全链路提速，也不能只用P50掩盖P95回退。没有筛除较慢样本；固定5秒输入总时长不作为收益。人物style变更约1165→1164基本不变；实际动作保持，采样诊断帧计数允许±3帧，不证明GPU/物理FPS。

## 最终包与网页

独立QA APK：`.data/deep-fluidity-20261023/apk-final/PetPal-0.9.14-Android-debug.apk`，149,924,298B，SHA256 `b51c89139d1fd62bb7ea7518ea79988ffaa818c2814dbdd089675c725552ec40`。独立审计核对313网页资源、45原生源输入、765条ZIP CRC、v1/v2同签名、权限集合与私密配置扫描；APK包含新入口及App/Cubism代码。APK大小与基线相同来自实际文件读回，不是复用旧元数据。

Android前后各9轮均有效、流式最终12500字逐SHA正确，但没有全端普遍提速证据。单独AVD启动后的冷进程登录页：before2424/1801/1508ms，after5851/2855/2048ms；after流式React提交52/50/52（before58/84/54），约1.85–1.98秒的冷路由长帧仍存在，不能以次数更少声称延迟普遍改善。

为核对启动回退，追加单次API36 boot、同WebView/软件GPU、old→new交错3组；每次安装后保留一次预热原始记录，再测冷app进程。六个计量全部有效：old1938/1483/1494ms，new1529/1529/1495ms；中位1494→1529ms（+2.34%）。未复现独立boot样本的大幅回退，也不称启动加速。两类缓存条件不可合并。第一次控制实验遇5037调试连接无响应，作为工具失败保留，不算App失败；全局ADB未被kill/restart，恢复后在新目录完整重采三组。

最终API36关键回归16/16、零跳过，收据 `android-key-runtime-02/result.json`：真实打包页面、IME/旋转/安全区/字体与主题、原生前台信号、三次实际renderer终止与恢复，以及登录→合成时钟8天续期→同Activity前台自动重连→主题持久化→退出清理。未重跑API33/35全矩阵；45项原生main源和权限未变，本轮重点是新打包前端。

首轮关键运行11项通过后，themeNight因旧测试期待rgb(24,29,27)失败；基线提交`a44330e`的theme.mjs、theme.css、index.html和原生实现早已一致使用#282828。只修正测试为rgb(40,40,40)，增加实际CSS/native诊断，不改产品颜色，再在新目录完整16项重跑。首轮失败JSON/PNG和清理记录保留，不算新产品bug，也未混计为16项通过。

网页已同步至 `https://magicdatou.top:44318/`。以617项已提交运行源码摘要、冻结资源、Chrome/API36证据作发布门禁；先发布资源，最后原子替换HTML。公网与本地HTML/入口/OpenUI完整响应SHA一致，HTML SHA256 `d7bc4deedc6f67a28572902b5703c5e7b27af6b319f9e78b9e65531751ce07e6`。Chrome实际加载公网登录页正常，未使用生产账号执行任务。

239项受保护文件、2614项旧资源逐SHA保持；49个正式下载文件共9,233,483,137B保持，4用户/5提供商/60会话/1附件/0自动化、state.json原始SHA与更新信任完全保持。后端PID103892和guardian34088及其启动时间保持，没有维护标记或重启。v0.9.14标签保持`7b8f84f5b3962efaebbacb3d5af72cecdc790e59`。独立QA APK不替换正式下载与升级清单。

保全备份、门禁和HTTP/运行态核验位于 `.data/deep-fluidity-20261023/deploy/`。所有自建聊天/人物静态服务、合成后端、专用AVD和ADB转发均已停止/释放，未重启全局ADB；原始样本、失败、包和回退资产保留。Chrome仅保留已上线公网入口作为交付页面。

## 验收边界

Chrome桌面与API36 x86_64专用模拟器不代替真实小米、荣耀、ARM设备或Ubuntu桌面验收。Android基线启动定义为冷进程到未登录的可用登录表单；不冒充已登录主页冷启动。语音、真实模型网络和长期泄漏未包含在本轮性能工作负载中。
