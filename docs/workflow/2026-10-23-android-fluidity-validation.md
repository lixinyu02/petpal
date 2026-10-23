# Android 冻结候选验收与性能边界

日期：2026-10-23。对应 deep-fluidity issue-3；产品提交 `47c6d58`，未替换正式安装包或更新清单。

## 候选与审计

- 从 `.data/deep-fluidity-20261023/web-final` 冻结生产资源打包，入口 `index-DbFPGlqk.js`。独立 QA 包 `.data/deep-fluidity-20261023/apk-final/PetPal-0.9.14-Android-debug.apk`，149,924,298 B，SHA256 `b51c89139d1fd62bb7ea7518ea79988ffaa818c2814dbdd089675c725552ec40`。
- 审计实际路径 `.data/deep-fluidity-20261023/android-final-audit/apk-audit/android-apk-audit.json`。765 个 ZIP 条目完整读取/CRC、313 个资源与冻结 web 逐字/SHA、45 个生产原生 Java 源与基线一致、v1/v2签名、16KiB zipalign/native ELF 对齐、Cubism/Mihomo 资产和已知私密配置扫描通过。
- 与正式包 signer/权限集一致；同版本号/code26单独比较，不冒充发布升版。审计的 app.bytes 来自实际 APK 文件读取，恰与旧包同为149,924,298B，不是复制旧字段。额外直接读取实际 ZIP 四个条目，确认 HTML 引用新入口、`CubismScene-BVSd3ypX.js` 有 `.publish/.invalidate` diagnostics publisher、`App-CzJ7uVvF.js` 有新聊天 element cache，并逐SHA对照：`targeted-apk-entry-verification.json`。
- 包为开发签名 QA 候选，正式客户端仍保持。完整前基线见 `2026-10-23-android-fluidity-baseline.md`。

## 原始九轮前后与启动配对控制

真实 APK + 真实独立后端/合成数据，API36、412×960、160dpi、软件GPU条件相同；前后各9个有效前台样本，0 hidden 样本被接受。数据分别保留在 `android-baseline` / `android-after`，没有删除较慢或异常样本。

| 指标（三轮） | before | after |
| --- | --- | --- |
| 每次各自 AVD 启动环境下，冷 App 到可用未登录页（ms） | 2424 / 1801 / 1508 | 5851 / 2855 / 2048 |
| 600 条原生滑动 rAF P95（ms） | 16.8 / 16.8 / 16.8 | 16.8 / 16.8 / 16.8 |
| 600 条滑动 longtask | 0 / 0 / 0 | 0 / 0 / 0 |
| 12,500 字流式 React commit 计数 | 58 / 84 / 54 | 52 / 50 / 52 |
| 流式 max rAF 间隔（ms） | 1599.9 / 183.4 / 1833.4 | 1983.3 / 1900 / 1850 |
| 流式 max longtask（ms） | 195 / 191 / 224 | 200 / 206 / 186 |

原始启动中位数 1801→2855ms（+58.5%）必须保留，不能直接略过。于是补做**单次同一 AVD 启动、同一 WebView/软件 GPU，old→new 三组交错控制**：每次安装对应已审计 APK 后，先完整启动真实登录页一次预热，再 force-stop 后测量；旧/新各3个计量，6个预热也逐份保留。仅开始时清一次专用合成 App 状态，没有清系统缓存、换WebView或启动后端。

| 同一预热 AVD/WebView、冷 App 进程（ms） | 第1对 | 第2对 | 第3对 | 中位数 |
| --- | --- | --- | --- | --- |
| old | 1938 | 1483 | 1494 | 1494 |
| new | 1529 | 1529 | 1495 | 1529 |

中位差 +35ms（+2.34%），这组控制未复现原独立 AVD 条件下的大幅回退，也没有证明启动加速。三个配对样本不足以排除所有小幅差异；两种缓存/启动条件不能合并统计。成功控制在 `android-startup-paired-02`；第一次 `android-startup-paired` 因全局5037 ADB读取中断失败，原始部分样本/错误/清理均保留，属于工具/环境失败，未当作App失败或加入成功控制统计。未kill/restart全局daemon，后续可读后在新目录完整重采。

流式样本为冷进程进入真实聊天路由、DOM/输入可用即发送，包含懒加载/人物初始化尾部；长rAF与longtask不代表同一指标，不能推断JS持续阻塞1.9s，也不能把较少commit直接换算成实际FPS提升。Android实际数据没有显示全面帧性能改善。滑动不退化、回复正确，但初始化尾部仍存在。

前后流式最终**可见文字和后端持久化回复**均为完整12,500字、SHA `d2db5b645ca410dc9583d2e95058ac0defe56adae40f3843ba35c996494a30d6`。每次fixture正好3次上游请求、0语音/Agent调用，无截断或末尾丢失。

## 关键运行回归与测试漂移修正

最终 `.data/deep-fluidity-20261023/android-key-runtime-02/result.json`：API36 **16/16通过、0跳过**：

- 真实打包 JavaScript 登录入口1；系统栏/刘海/真实IME/键盘优先返回/旋转/字号/主题5；真实HOME前台事件1；真实WebView renderer退出与恢复1（3次provider终止、加密登录文件保持）。
- 真实账号表单/加密持久化8阶段：login、服务端仅子进程假时钟+8d后的restored、断网保留原Activity/WebView并真实HOME恢复、themeNight、nightRestored、themeDay、logout、cleared。同token/创建时间保持、滑动续期、自动恢复、退出清凭据均有服务端布尔收据；不修改主机或Android系统时钟。
- night成功收据：computed HTML背景 `rgb(40, 40, 40)`，`--theme-surface/#282828`，native preference=night、mode=32；day=`rgb(250, 251, 248)` / `#fafbf8`，preference=day、mode=16；主题切换不改变系统夜间模式和会话。

第一次关键回归保留在 `android-key-runtime`：11项通过后，旧 `PetLoginSessionAppTest` 把night背景硬编码成历史的`rgb(24,29,27)`，而本轮未改的theme.mjs/theme.css/index首绘/ScreenInsetsController契约已是`#282828`。这是基线已存在的测试期待漂移。本轮**只修测试期待并增加成功/失败的computed背景、CSS变量、native preference/config诊断**，未改产品颜色；重建test APK后在新目录完整16项通过。

性能/配对使用原instrumentation APK SHA `76566d8121618ab3813597394604c9398f76c9aa3fb872083fd4461ce403e742`；最终关键回归专用test APK SHA `09ea1e861c8c2ce0a6f91a5330a90c454ed444f68c4cc6511249b88bbaf059e2`。产品APK没有因测试修正而重打或改动；性能采样不涉及该主题断言，无需重采。

## 构建记录、保全与边界

独立Node `fs.stat/readFile`验证实际构建日志非空：`android-test-build-01.log` 8,150B（18s）、`android-final-build-01.log` 12,111B（13s）、`android-test-build-02.log` 8,172B（15s），均含真实`BUILD SUCCESSFUL`。文件大小与SHA进入最终清单，不能用PowerShell集合的`.Length=1`当文件字节数。

所有使用的专用API36 AVD/fixture正常停止：5592/5593、45321、45331、45332及owned transport均无残留，独立CIM owned进程检查为空，reverse已移除。两个失败尝试、全部原始样本、预热和更正前汇总保留；未清业务数据、其他AVD或全局ADB。

45个生产原生源/权限集未变，因此本轮没有重复API33/35的完整212项矩阵。不是小米/荣耀真机、ARM性能、电池长稳、真实ASR/TTS或正式发布验收；WebView宿主PSS不包含独立renderer。配套聚合工具3个单测通过；最终代码/资源/包身份、关键运行和清理证据齐备，可供root进入后续保全部署，不能写成Android全指标变快。
