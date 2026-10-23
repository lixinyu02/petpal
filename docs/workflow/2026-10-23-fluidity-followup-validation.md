# 深度流畅性第二轮验收

- Date: 2026-10-23
- Status: accepted; web delivered 2026-10-24 00:02 +08:00
- Baseline: `a3834f9`
- Planning: `048a252`
- Product: `148e0bd`

## 产品范围

本轮保留模型、纹理、帧率、口型、功能和正式版本，修改两个已验证热点。聊天完整共享输入只比较一次；Message 引用未变且所有输入/投影/工厂一致时复用原 ReactElement。仍是同层 keyed 列表、不可变 Message 合同与提交后发布缓存，保留 callback/语音/权限/scope 失效。

Cubism 使用官方模型分类：只在 `isBlendModeEnabled() === false` 且无 offscreen、已知 pinned Framework 形状的新独占 GL 实例跳过未使用的扩展混合组合；仍编译标准/遮罩/反遮罩/copy，全套原 GLSL 保持。未知或扩展模型保留全量；取消后迟到注册不能重新分配。vendor、Framework bundle、Core、模型和纹理未改。

语音 AST 懒拆未实施：会推迟首条回复成本并涉及同步播放/取消契约，当前不足以证明净收益。

## Chrome 与源码验证

当前合并定向 **118/118**、零失败/跳过/取消；TypeScript、隔离生产 Vite 与 OpenUI 验证通过。输出 `web-final`，入口 `assets/index-Cv_IaiYG.js`，OpenUI `assets/OpenUIBlock-B8mx3-64.js`。两条第三方 zod 注释 warning 保持，不是构建错误。

聊天两策略各三对交错，共 12 个有效样本：1000 历史、100 次尾追加；组中位 render 总耗时 reduced 279.30→246.70ms（-11.67%），full 276.40→252.20ms（-8.76%），commit P50 3.30→3.00/3.10ms。首对 reduced 更慢、full rAF 最大间隔组中位更高等全部保留，详见 chat 报告；不称全面或真实 FPS 改善。

development React StrictMode 实际 **10/10** 通过：130行头部删除/跨32/64重排保留行身份、OpenUI值/焦点/选择区/表格横向位置；新回调、朗读归属、busy/sleep/support、canonical ID、取消/策略/删除动画与scope隔离。原报告 `chat-semantics/runs/run-1792769561789-35127048-8f7c-4069-91bf-8a218a1e84ef.json`。另100条/full/locked run `a7583a5f-6bc1-4657-87ef-3e6dfc2932be`，前后scrollTop均13733.3330078125，最终100段完整。

人物真实 WebGL2 六次交错：程序242→5、compile484→10，readyAt 中位884.3→544.7ms（-38.4%），启动最大rAF间隔中位318.8→37.5ms。HTTP资源no-store、同Chrome155/2560×1140/DPR1.5；GPU/驱动缓存已热且未清。测量探针两边相同，程序调用墙钟不是GPU执行时间。before每轮一个317–324ms Long Task，after无Long Task；不是Android约2秒旧停顿已解决的证明。

真实人物画面正常，固定头部/手部指针负载10,009ms、1202次事件，298个诊断帧增量、0 longtask/errors。详细源摘要、原始指标与边界见 avatar 报告。截图 `cubism-after.png`、`cubism-startup-after.png` 保留。注入探针只在隔离测试服务，结束自动恢复GL方法；没有修改浏览器全局设置或生产页面。

## Android 集成

冻结 QA 包为 `.data/fluidity-followup-20261023/apk-final/PetPal-0.9.14-Android-debug.apk`，149,924,298B，SHA256 `07da44194a1de76cf81d17577a3143da0b20b9834dfb962014e024160796af16`，仍为0.9.14/code26，没有提升正式版本。

本轮 API36 关键运行 **16/16、0跳过**：真实打包页、输入法/系统栏/旋转/主题、真实Home往返、3次renderer终止与2次自动重建/第3次手动恢复、登录持久化、模拟8天续期、断网后同Activity/WebView前台自动恢复、日夜偏好恢复及退出清除。只使用隔离账号和模拟器，系统时钟未改，不产生正式会话。收据 `android-key-runtime/result.json`；清理收据确认该次fixture/AVD退出，无占用端口或owned进程。

严格APK审计通过313个冻结资源、765个ZIP条目CRC、v1/v2签名、16KiB对齐、Core/模型及私密值扫描。首轮广义Gradle instrumentation任务连带无关Cordova库测试依赖冲突，保留原失败，精确`:app:assembleDebugAndroidTest`随后通过；未修改产品依赖。首轮资源审计发现AAPT既有规则排除`.vite/manifest.json`，同样保留失败。新`web-android`逐字复制冻结资源，唯一排除该19,348B构建统计文件（SHA256 `4ccaa7dfb6e16556cad9566842618e6e4eae4708b5d04e1b824877cf6dc67cc5`），其余313文件逐字一致；第二轮严格审计通过，原`web-final`保持。

四个QA脚本只增加本轮精确证据根，固定AVD/端口/不覆盖已有目录的门禁保持。首组启动计时与文件哈希重叠，原样保留并标注；停止并行重负载后在全新`android-fluidity-02`重采，九组全部有效、前台可见，三次流式可见及持久化文本均12,500字且SHA相同。滑动rAF P95三次均16.8ms、JS longtask为0；流式仍有228–229ms长任务，不能称安卓全指标提速。新组与旧组不是严格前后对照，只报告绝对值，详见Android报告。

root独立查看真实未登录页与深色恢复截图，无白屏；关键运行和两组性能采样的模拟器/fixture全部退出。三组清理、APK资产/签名/权限与正式包保持证据由`android-final-ready.json`绑定；本轮部署ready额外逐SHA绑定第二组9样本与cleanup，原第一组保留。

## 部署与保全

2026-10-24 00:01:58 +08:00完成网页发布，先增加资源、最后原子替换HTML；共49个文件新建或更新，旧资源全部保留。新资源用同目录hard link原子新增并拒绝碰撞，只有已备份的HTML与构建manifest可替换。执行所绑定产品提交为`148e0bd8ab9d0dbca9647d58060131491851e9b9`，618项源码摘要`6d7afa64b8db7f5e133709253a0b639ccffb65a71ee7c8b8c6f3a99c9b7b3990`，314项冻结网页资源；后续验收文档/QA门禁提交不改变这些产品输入。

本机与公网health均200、匿名state均401、Android CORS均204；完整HTML/入口/OpenUI响应SHA与冻结包一致。Chrome实际刷新`https://magicdatou.top:44318/`，登录页正常，DOM script指向新`/assets/index-Cv_IaiYG.js`；截图与DOM收据为`deploy/chrome-public-after.*`。未在生产创建测试聊天或请求真实模型。

部署后独立SHA核验452个保护文件、2661个旧assets、49个正式下载文件共9,233,483,137B全部保持；业务状态原始SHA、业务投影和update trust均保持（4用户/60会话/1附件）。服务与guardian的本轮PID/startTicks、配置、receipt一致，无后端重启或维护标记。正式tag仍`v0.9.14`→`7b8f84f5b3962efaebbacb3d5af72cecdc790e59`，下载/升级目录未提升。

首次prepare在备份和生产写入之前因嵌套PowerShell无法自动加载`Get-FileHash`停止。私有运行态校验改为.NET SHA256，保留所有身份/哈希门禁后重试通过；失败收据`deploy/prepare-attempt-01.json`和原工具输出保留，未重放旧部署或覆盖失败记录。最终保全、HTTP和运行态分别为`deploy/deploy-retention-after.json`、`deploy-http-after.json`、`deploy-runtime-after.json`。

## 证据与边界

本轮主证据根 `.data/fluidity-followup-20261023`；人物冻结 before/after 使用新路径 `.data/deep-fluidity-20261023/followup-avatar-before` / `followup-avatar-after`，未覆盖旧样本。

所有Chrome夹具已退出，7个端口45329/30/31/34/35/36/37独立检查无监听，收据 `chrome-fixture-cleanup.json`；全局ADB未改。两个旧avatar服务因无stdin退出协议使用精确TTY Ctrl-C终止，exit1为该人为终止结果，不算模型失败。

浏览器短时合成负载和API36模拟器不代表小米/荣耀真机、ARM设备、Windows/Ubuntu独立客户端全矩阵或长期性能。正式包未升版。本轮不改后端，不以此声称数据库性能改善。
