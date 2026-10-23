# Android 深度稳定性验收

- Date: 2026-10-23
- Baseline: `6c4b8a6`
- Product commits: issue-1 `4e151ac`; issue-2 `7e53c7f`
- Status: complete; final APK and web verified

## 原生恢复信号与第三轮候选

API36 缺少 DOM 恢复事件的路径增加 `petpal:native-resume`：Activity 恢复后向当前可信主 frame 排队发送无 payload 事件，执行前重新检查原 Activity/view、前台/可见、页面来源和 renderer；JS 端再次检查本地 origin 及非 overlay/pet 页面。LoginGate 监听该事件并复用同一恢复队列，卸载时移除监听，不新增原生权限或第三方插件。

仅原生事件、无 DOM 事件的组件复现先产生5个失败；修复后真实 LoginGate 45/45、最终完整相关 Node262/262通过，TypeScript、Vite/OpenUI通过，第三轮冻结入口 `assets/index-DCvMizBy.js`。API36独立 NativeResumeRuntimeTest 1/1通过：真实HOME/返回由 onResume.post 发出事件，不靠反射触发成功路径；iframe无广播、无payload，后台/overlay/foreign和旧实例通知均拒绝。

最终APK位于 `.data/android-deep-stability-20261023/apk-final-03/PetPal-0.9.14-Android-debug.apk`，149,924,298 bytes，SHA256 `f3765e0ad48227bb63d2709cf9f10cee4c9e92350c6d726da8267313680e6d85`。完整313资源/45原生源码/765成员CRC、同签名与权限集合审计通过，最终汇总再次核验包、原生源码和网页摘要一致。APK 16KiB zipalign通过，内置ARM64/x86_64内核ELF的16KiB静态对齐通过；不代替ARM真机运行。前两轮候选及全部失败证据保留，不交付失败包。

| 最终包系统 | 运行通过 | 跳过 | App Java Fatal / ANR |
| --- | ---: | ---: | --- |
| Android 13 / API33 | 70 | 0 | 0 / 0 |
| Android 15 / API35 | 71 | 0 | 0 / 0 |
| Android 16 / API36 | 71 | 0 | 0 / 0 |

共212项最终包运行验收，JVM133/133。三个版本均实际收到原生resume并恢复同Activity、同WebView，无密码/页面重载，五段登录生命周期全通过。本轮API36真实轨迹同时有DOM与原生事件；旧02特定快速转场没有DOM事件的事实单列保留，不能称所有API36都不发DOM事件。无DOM时的前端分支由确定性组件测试覆盖。

最终汇总 `native-final-03/final-result.json`、`apk-audit/android-apk-audit.json`、`cleanup.json` 全通过。首次清理门禁发现已退出AVD的ADB phantom host transport，保留失败记录后只精确断开该任务transport，未重启ADB；重新全门禁通过。任务设备、模拟器进程及夹具监听均退出；Chrome两轮夹具45327/45328也均无监听。

最终第三次网页同步已完成，公网/本地HTML SHA256 `93d377cf28622137ff1bd9830bc49d394549c00766dfb2676b1971c170eabf05`，入口JS SHA256 `9a7077a49f58caae70e2f712eadea7ef8576d73e85f640f7b6f7a9f5f2923c85`。135受保护文件（含前两轮全部收据/备份）、2567旧资源、49正式下载9,233,483,137 bytes及原始state/业务/trust逐项保持，无例外。后端103892/guardian34088及启动时间不变；health200、匿名401、Android CORS204通过。最终证据及备份在 `deploy-03/`。正式安装包、更新清单和标签未替换。

自审确认第三个issue新增运行诊断只进入test APK；产品改动仅为有界恢复队列及可信Activity恢复通知，不放宽权限、来源或TLS。失败候选与失败汇总未删除，最终交付明确指向03包；源码/资源复核在全部运行测试后完成。issue-1为`4e151ac`、issue-2为`7e53c7f`，issue-3为本次`fix(issue-3)`提交。

## 前台重连修复与第二轮候选（未交付）

首轮 API36 实际 App 在离线后快速 HOME/返回时重连失败，随后两条真实 LoginGate 组件测试在修复前稳定失败，确认恢复事件被 active 请求或五秒冷却直接丢弃。修复保留一次恢复意图，在旧请求结束、剩余冷却结束后尾随重试；发请求前消费意图，因此失败不会自行轮询。成功、隐藏、离线、账号 epoch 更换或打开切换窗口均取消多余意图。

最终相关 Node 回归分两组无重叠文件：241/241（`node-final-02-complete.log`）+13/13（`node-final-02-supplement.log`），共254项，零失败/取消/跳过；实际 LoginGate 组件37项通过，包含修复前失败的两项。TypeScript、diff、Vite和OpenUI验证通过，最终入口 `assets/index-CG8Ur1B8.js`。

第二轮独立 APK：`.data/android-deep-stability-20261023/apk-final-02/PetPal-0.9.14-Android-debug.apk`，149,923,973 bytes，SHA256 `236e9f54fb784abe7db37dd104389a92b0055d16c9c4cbc35be950495ec54642`。313网页资源、45原生源码摘要、765 ZIP成员CRC、v1/v2同签名及权限集合审计通过，JVM仍133/133。该包API33 69/69、API35 70/70，API36通过67项后再次遇前台恢复失败，后两阶段未执行，不能算70项全过。非空失败JSON/PNG证明native foreground、document visible/focused/online、token在，但DOM恢复events为空；需补原生Activity通知，不作为最终交付包。原始证据位于 `native-final-02/`。

第二次网页同步已完成，最终公网/本地HTML SHA256 `fc9e67bed305c2298096652119e88ab434dab811aa7759b75f43dc30c51c77f9`，入口JS SHA256 `3fc3171c7d281489f12d6dbcdba0a31ff8520ccaf8a9ba86170a106bf49861d5`。83个受保护文件（包含首次部署收据和备份）、2520个旧资源、49个正式下载包及业务/trust/原始state保持；后端/guardian未重启。内外health200、匿名401、Android CORS204通过。第二轮备份和证据独立存放于 `deploy-02/`，没有覆盖首轮收据。

第二轮 Chrome 插件操作当前真实 LoginGate 冻结夹具：在旧 `/auth/me` 请求等待时模拟一次前台事件，再只释放旧请求503，自动以第2次请求成功验证；冷却场景以第3次请求成功。两者 `nativeWrites=0`，未点击手动重试。精确冷却时间由确定性组件测试证明，浏览器收据只含计数，不冒称已测量毫秒时序。见 `browser-fixture-02/chrome-validation.json` 及两张 restored PNG。

## 修复与回归

原生登录存储把密钥操作移出提交锁，使用有界工作线程及独立清除队列，核验 fsync、密文读回和故障回退。既有 v1 信封仍兼容，新建 vault 使用独立随机 v2 密钥，避免迟到的密钥创建覆盖另一笔登录。清除、Activity 更换与旧写入均有所有权门禁。

代理操作增加进程级所有权和串行 WebView 路由，旧 Activity 与迟到回调不能关闭新代理。官方账号刷新在 scope、profile、代际及 relay 注册边界重新验证，退出或切换后不允许旧结果恢复凭据。

前端登录的 15 秒网络超时覆盖响应头及 JSON body，原生持久化阶段独立处理，避免磁盘已保存却向界面报网络失败。保存的登录读取也有独立超时与重试入口，迟到读取不会覆盖新账号。WebView renderer 退出后 60 秒内最多自动恢复两次，之后使用不依赖 WebView 的原生恢复页。

## 已完成的定向验证

- Node 相关回归：248/248，零失败、取消或跳过。
- Java 单元测试：133/133。
- TypeScript、隔离 Vite 构建与 OpenUI 构建验证通过。冻结入口为 `assets/index-oT7OULeO.js`。
- API36 issue-1 原生定向回归：43/43（存储故障13、真实 Keystore4、官方账号25、真实代理1）。
- API36 实际终止 WebView renderer 三次：两次自动重建，随后原生恢复页，手动重新打开成功；合成登录密文逐字保持。
- renderer 诊断保留三条 Cordova 销毁后调用 WebView 的清理 warning，未出现应用 Java Fatal，不把 warning 隐藏或当作无故障日志。

## 首轮候选包与跨版本矩阵（发现问题，已暂停交付）

首轮候选 QA APK 为 `.data/android-deep-stability-20261023/apk-final/PetPal-0.9.14-Android-debug.apk`，149,923,973 bytes，SHA256 `43adf8c9c37c457449ce2a79ed9538f62316eb86c4c22465fbdbb95ab731aed9`。包内 313 项运行网页资源和 45 项原生源码摘要核验、765 个 ZIP 成员 CRC 检查通过；v1/v2 签名与正式 0.9.14 一致，权限集合保持。该包在 API36 发现前台重连事件丢失，保留作失败证据，不作为最终交付包。

| 系统 | 最终通过 | 跳过 | 代理内核运行 |
| --- | ---: | ---: | --- |
| Android 13 / API33 | 69 | 0 | 不支持，未纳入调用 |
| Android 15 / API35 | 70 | 0 | 实际打包 Mihomo + native/WebView 路由通过 |
| Android 16 / API36 | 67 后遇前台重连失败 | 0 | 通过 |

覆盖合成存储故障、真实 AndroidKeyStore、官方账号状态竞态、权限与媒体、系统设置回跳、前后台悬浮窗、系统通知点击和账号隔离、打包网页、renderer 恢复，以及实际 App 五阶段登录生命周期。长期登录使用合成时钟推进八天，不修改主机或模拟器系统时间；验证同 token 续期、force-stop 后恢复、离线至同 Activity/WebView 的前台自动重连、注销及退出后不恢复。API35 另有真实打包 Mihomo 的 native/WebView 代理、loopback bypass 和停止清理测试。

专用 ranchu 模拟器覆盖 412×960、160dpi 的窗口，登录页实测 CSS 412×884（扣除系统栏）、DPR 1，截图检查无横向溢出。屏幕测试覆盖 IME/返回键、深浅色持久化、WebView textZoom 100%/160%/200% 和模拟 cutout；不是各家系统字体缩放或真实刘海实测。API33 首次可用登录记录 1208ms，仅为单次模拟器样本，不泛化为真机启动承诺。

原始记录存放在仓库私有目录 `.data/android-deep-stability-20261023/`，各版本 `final-apiXX/result.json` 及截图/日志保存实际结果。

跨版本测试另修正了设置测试把 API 等级写死为 36 的断言，改为核对实际系统 API。API35 首次完整权限组有三项 AX 系统窗口定位超时，系统日志显示设置页/权限页已启动；原样单独麦克风 1/1 通过。测试增加 Activity 启动前的 UiAutomation 连接、精确 view ID/interactive windows 标志和无文本的窗口诊断，结束恢复原标志；产品前后台门禁及系统按钮定位约束没有放宽。随后完整权限组 5/5 通过。首次失败保存在 `final-api35-first-failure/`，诊断与重跑独立列出，不计作三个已证实产品权限 bug，也不抹去失败记录。

## Chrome 交互验收

使用 Chrome 插件操作实际 ConnectionDialog/LoginGate 的冻结 Vite 夹具，监听仅在 loopback，native bridge 和账号完全合成。

- 登录响应先返回 HTTP headers 和不完整 JSON，随后挂起：15 秒后显示超时、表单和关闭按钮恢复；实际点击关闭成功。`nativeWrites=0`，未发生错误凭据落盘。
- 保存的登录读取初次挂起、再次重试挂起：两次超时均回到可操作恢复入口。允许合成读取后第三次重试恢复身份验证，`nativeReads=3`、`nativeWrites=0`。
- 证据：`browser-fixture/chrome-validation.json`、`login-timeout.png`、`vault-restored.png`。两个测试 tab 已关闭；夹具正常退出，45327 无监听，产物保留。

## 网页同步与服务保全

在不重启后端/guardian、不设置维护标记的情况下，先发布新资源，最后原子替换 HTML。公网 `https://magicdatou.top:44318` 和本地入口一致：HTML SHA256 `33a9abb76840d90e594327670098dadc17a88c566d00492263e4d4cf858cea51`，入口 JS SHA256 `2f8613de55167f2d14902cb01619ce3c29f8c9bb6f3710c38373f1a359ed95b4`。

内外健康 200、匿名账号隔离 401、Android 记住设备请求的 CORS 预检 204。59 个受保护文件、2473 个旧资源、49 个正式下载文件（9,233,483,137 bytes）逐项哈希保持；`state.json` 原始 SHA、业务状态和更新信任保持，4 用户/5 提供商/60 会话/1 附件/0 自动化，无忽略差异。后端 PID 103892、guardian PID 34088 及各自启动时间均未变化。

私有备份在 `deploy-backup/`，验收见 `deploy-retention-after.json`、`deploy-http-after.json`、`deploy-runtime-after.json`。既有 `v0.9.14` 标签保持 `7b8f84f5b3962efaebbacb3d5af72cecdc790e59`。

## 验收边界

本轮使用专用模拟器和合成账号/服务，不代替小米、荣耀等真机验收，也不代替真实 OpenAI 授权与上游网络稳定性验收。API33 的内置应用代理仍不支持，不通过跳过或放宽 TLS 宣称支持。

这次提供独立 QA APK，不替换正式下载及软件升级清单，不移动既有版本标签。新 v2 登录密文不保证被旧正式客户端读取，回退时可能需要重新登录；服务端账号和聊天不迁移。

失败或废弃候选的不可导出 Keystore alias 保守保留。本轮未加入缺少引用核验和独立有界队列的密钥垃圾回收，频繁退出重登可能累积条目。
