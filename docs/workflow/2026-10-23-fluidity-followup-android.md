# Android 第二轮流畅性与打包验收

日期：2026-10-23。产品提交 `148e0bd8ab9d0dbca9647d58060131491851e9b9`。本轮使用独立 QA 安装包，未修改正式版本号、下载包或更新清单。

## 冻结资源与安装包

- 产品 APK：`.data/fluidity-followup-20261023/apk-final/PetPal-0.9.14-Android-debug.apk`，149,924,298 B，SHA256 `07da44194a1de76cf81d17577a3143da0b20b9834dfb962014e024160796af16`。版本 0.9.14 / code26 / minSdk23 / target35，为开发签名 QA 包。
- 实际入口 `assets/index-Cv_IaiYG.js`，OpenUI `assets/OpenUIBlock-B8mx3-64.js`；HTML SHA256 `9cc5c520bc35a154ed59abd838a99f011d9d614af684a7d91745d417739d9776`。
- 原冻结 `web-final` 有 313 个运行资源和 `.vite/manifest.json`。Android AAPT 按既有 dot-directory 排除规则不打包后者；它是 19,348 B 构建依赖图，SHA256 `4ccaa7dfb6e16556cad9566842618e6e4eae4708b5d04e1b824877cf6dc67cc5`，不是运行依赖。
- 第一次严格审计因缺少该元数据而失败，保留 `apk-audit` 和 `android-apk-audit-01.log`。未放宽审计：建立新 `web-android`，唯一排除上述文件，其余 313 个资源逐字/SHA 与 `web-final` 相同，证据 `android-web-freeze.json`；原冻结资源与 APK 保持。
- 新 `apk-audit-02/android-apk-audit.json` 通过：313 网页资源、2 个 Capacitor bridge、765 条完整 ZIP CRC、v1/v2 签名、16KiB zipalign/native ELF、官方 Core 执行和模型资源闭包、私密配置扫描。45 个生产 Java 输入与上一轮已验 QA 逐 SHA 保持。
- 独立读取 `dist/downloads/PetPal-0.9.14-Android-debug.apk`，正式包 SHA256 `8f8e69fa3c5c4364a202df60cce74ce030d4019610bf5476b4eb2a9b65c18fc9`；候选与其签名和权限集合一致，正式包保持。相同 code26 的比较没有冒用要求升版本的 `--previous-apk`，证据 `android-formal-comparison.json`。

构建日志 `android-build-01.log` 为真实 12 秒成功构建。第一次通用 `assembleDebugAndroidTest` 连带构建 Cordova 库自身测试 APK，失败于该库 Kotlin 1.6/1.8 重复类，原 `android-test-build-01.log` 保留；改为准确的 `:app:assembleDebugAndroidTest` 后成功，日志 `android-test-build-02.log`。没有修改产品依赖来掩盖该工具范围问题。最终 instrumentation APK SHA256 `09ea1e861c8c2ce0a6f91a5330a90c454ed444f68c4cc6511249b88bbaf059e2`，与上一轮最终测试包相同。

## API36 关键运行

`android-key-runtime/result.json`：**16/16 通过、0 跳过**。专用 `PetPal_Permissions_API36_20261023` / `emulator-5592`、API36 x86_64、412×960、160dpi、软件 GPU，只使用合成账号和 loopback fixture。

- 真实打包 JavaScript 登录入口；系统栏、刘海、实际 IME、键盘优先返回、旋转、字号与主题。
- 实际 HOME/前台通知；真实 WebView renderer 终止三次，两次自动重建和一次原生手动恢复；加密登录文件保持。
- 登录、仅 fixture 子进程时钟推进八天后的续期、断网后同 Activity/WebView 自动恢复、深浅主题持久化、退出后清凭据。没有改系统时间、生产账号或真实上游。

## 流畅性样本与污染处理

第一次 `android-fluidity` 的 9 个样本均通过内容/可见性检查，但 startup-1 的 instrumentation 日志区间 `15:51:30.263–15:51:32.881Z` 与另一个 agent 的 627 资源哈希区间 `15:51:31.500–15:51:33.015Z` 重叠。该组完整保留，`measurement-context.json` 标注干扰，不作为无并行负载的启动证据。

协调 root 与其他 agent 停止构建、批量哈希和浏览器计时后，在全新 `android-fluidity-02` 完整重采 9 个样本。全部前台可见、0 hidden 样本被接受；三条流式最终可见文本及后端持久化文本均为完整 12,500 字，SHA256 `d2db5b645ca410dc9583d2e95058ac0defe56adae40f3843ba35c996494a30d6`。fixture 正好 3 个上游请求、0 语音、0 Agent 请求。

| 本轮绝对指标 | 第一次 | 第二次 | 第三次 |
| --- | ---: | ---: | ---: |
| 冷 App 进程至可用未登录页（ms） | 2316 | 1676 | 1634 |
| 600 条原生滑动 rAF P95（ms） | 16.8 | 16.8 | 16.8 |
| 滑动最大 rAF 间隔（ms） | 183.3 | 183.3 | 200.0 |
| 滑动 JS longtask 数 | 0 | 0 | 0 |
| 12,500 字流式 rAF P95（ms） | 16.8 | 16.7 | 16.8 |
| 流式最大 rAF 间隔（ms） | 233.3 | 233.3 | 233.4 |
| 流式最大 JS longtask（ms） | 228 | 229 | 229 |
| 流式 React commit 数 | 87 | 86 | 87 |
| 流式首字（ms） | 153.0 | 191.0 | 142.7 |

此处只给本轮绝对值，不把不同 AVD 启动、缓存和宿主负载下的旧样本计算为收益。本轮没有 Android 前后交错对照，也没有证明 Android 全指标提速；流式仍有约 229ms 的 JS 长任务，滑动仍有少量较长帧间隔。React 提交次数和 rAF 不是 GPU/物理显示 FPS；约八秒的固定合成流也不能当成网络或模型速度。

启动定义为冷进程至真实未登录表单，不包含已登录首页和人物初始化。因此本轮 Chrome 实测的 shader 编译优化不能仅凭该 Android 启动指标推断为 Android 人物冷启收益。

## 工具、保全与边界

四个 Android QA 脚本只新增精确 `.data/fluidity-followup-20261023` 证据根，仍保留旧根、目录不覆盖、明确候选/审计/SHA 参数、固定专用 AVD 和端口身份检查。没有把允许范围扩大到任意 `.data`。四脚本语法检查通过。

关键运行和两组 fluidity 均独立清理成功，清理收据逐项记录：无 owned emulator 进程/transport，5592/5593/45321/45331/45332 均释放，reverse 移除，fixture 关闭，候选 APK SHA 保持。随后独立 CIM 和监听端口读取再次确认无残留。未 kill/restart 全局 ADB，未重启生产后端。

最终 `android-final-ready.json` 绑定日志、审计、冻结资源、APK、关键运行及两组原始样本；第一次失败构建、第一次元数据审计和受干扰样本均留存。API36 软件 GPU 模拟器不代替小米/荣耀真机、ARM 或 API33/35 验收。没有验证真实音频链路、电池长稳、真实代理/模型连接或正式升级安装；45 个生产原生输入和权限未变，本轮重点为新打包前端。
