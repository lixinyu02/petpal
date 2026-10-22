# 语音播放期间页面流畅性验收

- Date: 2026-10-22
- Source baseline: `3864bbb7d7f0de640439d54790ee9ae23fa208a0`
- Status: 源码及隔离验收完成；正式客户端/生产服务保持原版本。

## 改动与结果

CosyVoice播放循环每40ms报告一次状态。原useSpeech把字符、音量和情绪进度全部写入App状态。新增实例私有、不可变、可取消订阅的完整快照；App显式启用separateProgress，只在控制状态变化时更新。SpeechCompanion单独订阅完整进度，文字回复/休眠姿态及交互回调保持稳定引用。没有降低音频采样、动画帧率或口型更新频率。

仅charIndex/audioLevel/emotion可以跳过App更新。pending、active、ended、buffering、streaming、voiceName、error、progressBasis及新字段仍会触发界面更新。完成awaiter始终先观察原始状态。默认hook调用保持完整进度，语音对话页面不改变协议。另修复同账号配置重载后旧播放器回调污染当前状态：先失效旧player代数，再释放/重置；账号、配置切换和卸载清理完整快照。

## 自动回归

证据根为ignored `.tools/speech-ui-isolation-20261022/`。新hook基线6项中5失败、默认兼容1项通过；100次纯进度触发父状态更新100次，候选0次，人物订阅仍完整收到100次。覆盖重复终态完成等待、默认兼容、缓冲/错误、停止/隐藏/换音箱、同账号换配置、账号切换和卸载后迟到回调。store另覆盖缓存快照、情绪冻结、重复通知去重和取消监听。

| 矩阵 | 结果 | 证据 |
| --- | --- | --- |
| 语音、人物及新增hook/store | 197/197，无失败/取消/跳过 | `hook-voice-regression.log`，基线`hook-baseline.log` |
| 人物桥、工作区、自动化、Chat收尾、Agent轮询、消息及挂载 | 155/155，无失败/取消/跳过 | `workspace-regression-complete.log` |
| TypeScript | exit 0 | `typecheck.log` |
| 隔离Vite构建 | exit 0；3.76秒 | `build.log`，输出`dist/`位于上述ignored目录内 |
| 最终源码/竞态自审 | 未发现阻塞项 | 默认消费者、pending/stop/sleep、账号/配置及稳定props逐项核对 |
| 公开源码审计 | 1700文件通过，无问题 | `public-source-audit-final.log` |

矩阵存在重叠，不累计为唯一用例总数。工作区夹具首次因缺少上一轮新增chat-completion模块映射而失败；补入真实模块后，旧测试等待已取消的全量/state刷新而挂起，停止本轮自建测试进程后将该旧场景改为验证终态不再读取/state，最终155项通过。原失败/中止日志保留，不把夹具问题当作页面挂死或产品修复证据。

源码审计首次拦截新测试的固定合成凭据isolated-fixture；确认它仅用于隔离hook传输、不对应任何服务后，按仓库惯例将该精确文件/字面量登记为已审查的测试值，再次1700文件审计通过，没有放宽真实凭据检测。

## Chrome插件对照

基线冻结3864bbb的263个src文件并核验字节，候选使用当前源码。两套服务各自新临时JsonStore、合成账号与同样1066字回复；没有使用生产数据。仅在ignored Vite变换中给App入口加执行计数；HTML注入明确标记的无声音中文SpeechSynthesis，每40ms派发boundary。没有访问真实TTS/ASR、模型或控制电脑。

| 1.5秒采样 | 语音boundary数 | App函数执行数 | 人物 |
| --- | ---: | ---: | --- |
| 基线桌面 | 38 | 76 | playback-progress |
| 候选桌面 | 38 | 0 | mouthOpen 0→0.620、phase idle→speaking |
| 候选412×960 | 37 | 0 | mouthOpen 0→0.620，保持语音进度 |

原始计数为同一开发模式下的函数执行，不是React提交数；StrictMode使基线每次状态更新可执行两次。计数差证明进度隔离，不代表FPS、GPU占用、真实音质或手机硬件性能。Canvas仍可见且帧计数继续变化，但本轮不对帧率作推断。

证据：`browser/chrome-baseline-sample.json`、`chrome-candidate-sample.json`、`chrome-mobile-sample.json`。最早3秒CDP采样超出插件单命令限制，改用双方相同的1.5秒窗口；未把超时采样算作性能结果。夹具后续保留的Cat计数代码没有重启加载，不作为本次验收依据。

候选实际播放中输入草稿可用；点击停止后按钮恢复“朗读”，草稿保留。继续输入时同一个Cubism canvas保持、未重载模型。412×960时document.scrollWidth=412，无横向溢出。`browser/chrome-controls.json`和`chrome-mobile-metrics.json`记录这些结果；截图`browser/candidate-mobile.jpg`已按真实JPEG格式保存并视觉检查。CDP截图曾超时，改用浏览器公开截图接口，未修改图片。

## 交付边界

本轮只修改源码及测试/工作流文档。未覆盖生产dist、客户端安装包、v0.9.14标签或更新清单；实体Android/Windows/Ubuntu和真实声音未重新验收。浏览器设备模拟和自建服务在收尾时退出，原始证据保留，运行数据不提交Git。使用既有公开源码审计检查暂存文件后提交。
