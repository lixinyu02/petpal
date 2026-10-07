# PetPal 页面性能验收

Date: 2026-10-07。基线86dfc13；源码与本地隔离验收，不部署或重新打包。

## issue-1：人物绘制节奏

共享可见循环使用可选30FPS期限，保留余数并以极小容差处理浮点边界；长间隔跳过旧时隙，停止/隐藏重置期限。Cubism、恢复人物和小猫保持真实绘制elapsed及既有物理dt限制。默认循环不限速。

相同稳定rAF时间戳10秒模拟，绘制次数如下：

| 刷新率 | 原绘制次数 | 新绘制次数 | rAF回调次数 |
| --- | ---: | ---: | ---: |
| 60Hz | 204 | 300 | 600 |
| 90Hz | 246 | 300 | 900 |
| 120Hz | 266 | 300 | 1200 |
| 144Hz | 288 | 300 | 1440 |

这些是调度模拟，不是实际设备FPS；rAF回调次数不变，不能声称降低GPU开销或耗电。原始脚本及回执在ignored `evidence/page-performance-20261007/scene-loop-counts.mjs`、`scene-loop-counts.json`。

120项定向调度、人物语义、隐藏恢复和慢帧回归通过；TypeScript及diff检查通过。覆盖零时间戳、浮点边界、长间隔无补帧风暴、单pending rAF、取消后的旧回调和隐藏期间文字不重播。

基线build从86dfc13的tracked src逐文件读取，避免并行编辑影响；当前工作区未回退。构建只写本轮baseline目录，现有dist与安装包保留。

## issue-2：会话快照引用复用

完整JSON数据一致时才复用消息引用，不维护易遗漏的新字段清单。相同顺序/ID走同索引路径；重排时按需建立ID索引，重复ID限制一对一，跨会话不复用。任务/项目/标题等元数据使用权威快照；不丢弃附件、模型、状态、任务报告或新增字段变化。

接入组织/状态合并、Chat+Agent替换、自动化缓存及后台子任务轮询/手动刷新。epoch、revision、controller和迟到响应门禁保持。

211项相关回归、TypeScript、helper语法与diff检查通过。原始日志`message-snapshot-regression.log`。算法计数在`message-snapshot-reuse-counts.mjs/.json`：500条元数据更新复用500条，尾条变化复用499条；1000条压力数据分别1000/999。1000条超出产品500条上限，仅作算法压力检查，不代表产品支持超过500条会话。

## issue-3：浏览器性能与兼容验收

Chrome插件初始化两次分别30/60秒超时后，使用缓存Playwright CLI的独立Chrome会话`petpal-perf-final`。两个后端仅监听127.0.0.1:4538/4539；模拟模型监听4540，独立临时账号、数据目录及任务，未连接实际模型、语音服务或电脑控制工具。

基线与新版性能bundle仅在ChatMessageRow加入测试计数器；该插桩不存在于产品源码或无插桩最终build。两个样本起止均402条消息、Agent运行中，600ms模拟进度变化，8秒观察窗口各收到10次会话快照：

| 项目 | 基线86dfc13 | 本轮新版 |
| --- | ---: | ---: |
| 消息数（开始/结束） | 402/402 | 402/402 |
| 观察时间 | 8004ms | 8005ms |
| 会话快照请求 | 10 | 10 |
| 消息行渲染次数 | 4020 | 0 |

这证明仅任务元数据变化时，完整消息引用复用让现有memo生效；任务进度仍更新。不能推断整个页面不重绘、总CPU减少100%、GPU或耗电改善。原始回执`baseline-sample-final.log`、`current-sample-final.log`。

浏览器操作与实际DOM验收：

- 1280×800桌面，真实Cubism渲染（renderer/mode均cubism）；3秒绘制从1463到1554（91帧），头部点击记录region=head。这是本机Chrome观测，不代表手机或原生客户端FPS。
- 收起伙伴后canvas宽度为0，两次独立读取renderFrames均12245；展开后宽度230px、帧计数恢复到12293并继续增长。
- 鼠标滚轮向上阅读历史后，scrollTop=69632、距底1800px，3秒任务快照期间位置保持；“回到最新消息”入口存在。
- Chat发送至模拟流式模型后正常完成，停止入口消失且输入框恢复；实际回复DOM含h2“页面性能测试”、strong、GFM table、pre/code，旁边保留朗读按钮。未启动实际TTS/ASR。
- 412×960 CSS视口，document.scrollWidth=412，无横向溢出。移动端折叠伙伴的真实canvas约53.66×62.39px且1秒推进30帧，输入框宽378px、底部847px，可触达。桌面/手机截图已查看。
- Chrome错误日志0条；独立源码审查与自审未发现可操作回归。

截图保存在ignored目录`evidence/page-performance-20261007/output/playwright/desktop.png`与`mobile-412x960.png`，测量脚本/日志同目录。测试Chrome会话已关闭；只用于本轮的预览通过stop-preview标记正常退出，PID51516已不存在；根目录的本轮CLI日志精确归档到ignored evidence。

## 最终构建与回归

TypeScript `--noEmit`通过；无插桩Vite发布构建通过（2.83秒），输出仅写`evidence/page-performance-20261007/final-build`。保留现有dist和安装包。构建仍提示已有惰性加载Three chunk约519kB；本轮未修改小猫的加载策略或宣称首次下载体积降低。

首次全量回归2301通过/1失败/1跳过；失败为HTTP fixture的`fetch failed: bad port`。检查当前Node内置Fetch受限端口表，发现共享loopback helper遗漏4190/6679。补齐清单并增加确定性端口重试用例后，相关Agent权限及fixture定向11/11通过；最终完整回归2303通过、0失败、1跳过，共2304项，耗时95.25秒。跳过项为已有opt-in的“native guardian 90-second deadline fails closed while SSE remains alive”。未修改权限/审查行为或扩大超时来掩盖失败。

原始日志：`typecheck-final.log`、`final-build.log`、`regression-final.log`（首次）、`fixture-regression.log`、`regression-final-repaired.log`（最终）。

## 验收边界

本轮完成共享前端源码、算法模拟、本机Chrome网页、类型/构建及回归验证。未发布网页、推送Git、重新制作安装包；Ubuntu/Windows桌面与安卓原生实机尚未重验。412×960是CSS视口测试，未模拟实际手机键盘、音频权限或后台系统限制；TTS/ASR真实接口稳定性不在本轮证据范围。
