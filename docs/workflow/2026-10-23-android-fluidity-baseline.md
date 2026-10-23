# Android 实际客户端流畅性基线

日期：2026-10-23。对应 deep-fluidity issue-1；本轮没有修改产品、正式下载或更新清单。

## 输入与条件

- 产品基线 `a44330eb92a1b27f2caca2442e64ea22dbe78530`；使用已有 `apk-final-03/PetPal-0.9.14-Android-debug.apk`，SHA256 `f3765e0ad48227bb63d2709cf9f10cee4c9e92350c6d726da8267313680e6d85`，149,924,298 B，包名 `com.petpal.app`、versionCode 26。
- 测量前逐项核对既有 APK 审计中的 45 个 nativeSourceInputs、313 个 frozen web assets，均一致；另记录真实后端 87 个源文件摘要。完整输入见 `.data/deep-fluidity-20261023/android-baseline/baseline-identity.json`。
- 只重建 instrumentation APK，SHA256 `76566d8121618ab3813597394604c9398f76c9aa3fb872083fd4461ce403e742`。真实 HTML、React state、Markdown renderer、网络流式管线保持；测试脚本只在 document-start 安装 rAF、PerformanceObserver、React commit **计数**。不支持生产版 commit 耗时 profiler。
- 专用 API36 x86_64 AVD，`412×960`、160dpi、fontScale 1.0、软件 GPU，WebView 133.0.6943.137。不是小米/荣耀真机或 ARM 性能验收。
- 真实 `createPetServer` + 独立合成账号、200/600 条历史、三个空会话；API 仅监听 loopback 45331，上游 mock SSE 仅监听 45332。上游每 25 字一帧、共 500 个 delta，标称间隔 10ms，Windows timer 实际周期不承诺精确 10ms。最终输出 12,500 字。没有调用 ASR、TTS 或 Agent。
- 只有前台且整个样本从未 hidden/pagehide 的样本有效；9/9 有效，0 hidden 样本被接受。Chrome 已停止绘制；test build 21:04:22–21:04:41，在 Chrome 最后一轮 21:04:01–21:04:11 之后。

## 结果

三个独立冷进程进入可用的**未登录真实登录页**：2,424 / 1,801 / 1,508ms。包括 native/WebView 启动与可点击登录控件出现，不代表已登录主页或人物完整就绪。document-start 到该状态仅有 14/12/10 个 rAF 间隔，不能据此估计稳态帧率。

| 工作负载/轮次 | rAF P95 / max (ms) | longtask 数 / max (ms) | React commits | native janky / total |
| --- | --- | --- | --- | --- |
| 600 条历史滑动 1 | 16.8 / 183.3 | 0 / 0 | 4 | 16 / 817 |
| 600 条历史滑动 2 | 16.8 / 183.4 | 0 / 0 | 5 | 20 / 811 |
| 600 条历史滑动 3 | 16.8 / 166.7 | 0 / 0 | 5 | 8 / 818 |
| 冷路由流式 1 | 16.8 / 1599.9 | 1 / 195 | 58 | 3 / 492 |
| 冷路由流式 2 | 16.8 / 183.4 | 2 / 191 | 84 | 6 / 474 |
| 冷路由流式 3 | 16.8 / 1833.4 | 1 / 224 | 54 | 2 / 485 |

滑动采用真实 MotionEvent 连续 18 次（9 次回读、9 次返回），样本约 13.8s；有 477–486 个真实 scroll 事件、3,108–3,139px 范围，约 11,726 个 DOM 元素。没有用 JS scrollTop 循环代替触摸。

流式总时长 8,002 / 7,927.5 / 7,880ms；首字 1,847.5 / 278.7 / 2,102ms。最终页面文字 **和** 后端持久化回复均逐字/SHA 对照正确，三轮 SHA256 都为 `d2db5b645ca410dc9583d2e95058ac0defe56adae40f3843ba35c996494a30d6`，没有截断或漏末尾。后端计数：upstreamRequests=3、audioRequests=0、externalCodeRequests=0。

宿主应用 PSS 在滑动结束为 150,968 / 164,635 / 169,370 KiB，流式结束 166,052 / 166,436 / 166,225 KiB；不含独立 WebView renderer 进程，不能称为完整应用总内存，也不能凭三轮差异判定泄漏。

## 尾部停顿与解释边界

流式第一/三轮的长间隔发生在 rAF 第三个间隔，Long Animation Frame 也记录到 1620.9ms@start23.2 / 1839.4ms@start25.2；随后才出现 195 / 224ms longtask 和首字。它证明该冷路由工作负载在开始附近有前台帧停顿，**不证明 JavaScript 主线程连续运行 1.8s**。

每轮是 force-stop → 实际应用启动 → 实际聊天路由 DOM/输入可用即发送，没有等待所有懒加载/人物初始化静止。原始 logcat 可见这一导航期间加载 Cubism 资源、随后首次加载 Markdown renderer chunk，因此指标包含初始化尾部；缺少 trace/timeOrigin 的进一步关联，无法把停顿归因于某个模块。`dumpsys meminfo` / gfx reset 在 `begin()` 前、最终 dump 在 `end()` 后；测量中只有 instrumentation 每约 80ms 的完成条件 JS 轮询。不能把它当作热流式纯渲染耗时，或把差值全归因给 Markdown。

`gfxinfo` 是 native 窗口合成与帧完成指标，rAF 是页面调度，两者不是相同管线。API36 的 `Flags,FrameTimelineVsyncId,IntendedVsync,...` 表头已按列名解析；原始采样未变，仅修正派生汇总，旧汇总保留为 `result-before-gfx-parser-fix.json`。平台仅保留约 120 条 framestats 环形记录，不能冒充整轮分布。native 新版/legacy janky 定义差别很大，派生 JSON 两者都保留，不选择性省略 legacy。以上数据都不等于实机稳定 60FPS。

本轮没有单独采集人物 visible/hidden 对照、已登录主页启动、语音或复杂 OpenUI 卡片。当前数据不足以要求重写 Rust、虚拟化所有消息或削减人物画质。

## 复现与工具验证

```powershell
node scripts/benchmark-android-fluidity.mjs --output .data/deep-fluidity-20261023/android-baseline
node --test tests/android-fluidity-metrics.test.mjs
```

默认输出目录拒绝覆盖。原始 9 份 `startup/scroll/stream-N.json`、各自 instrumentation/logcat/gfx/meminfo、合成数据校验和清理收据都在 `.data/deep-fluidity-20261023/android-baseline/`。已有数据仅重算汇总可用 `--summarize-only`，不会启动 AVD/服务或改写原始样本。

after 候选必须显式传入 `--phase candidate --apk <absolute-apk> --audit <absolute-audit-json> --web <frozen-web-dir> --expected-apk-sha <sha256> --output <new-owned-dir>`。自带审核文件、源/资源 SHA 和 APK SHA 都通过才会安装；不允许以旧 baseline 审计替代候选审计。

3 个聚合单测通过，覆盖 API36/旧版表头、sentinel/nonzero Flags 排除、缺失指标保持 null、宿主与 renderer 内存区别及长尾保留。工具自审未发现产品数据写入或外网模型调用路径；网络 gate 仅允许真实本地资产与 loopback API。测试构建和采样均通过，正式 APK 没有重打。

清理验收：fixture 正常关闭，专用 AVD 退出，5592/5593/45331/45332 全关闭，ADB transport 不存在，reverse 移除，原 APK SHA 保持。没有重启全局 ADB server或操作其他 AVD。等待产品候选冻结后再独立审计和同条件 after 验收。
