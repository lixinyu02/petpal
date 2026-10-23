# Android 长期登录验收

- 日期：2026-10-23。
- 实现：issue-1 `a4e21e0`；issue-2 `65e60b3`；本 issue-3 提交记录原生验收补充与交付。
- 独立 QA APK：`.data/android-long-login-20261023/apk-final/PetPal-0.9.14-Android-debug.apk`。
- SHA256：`3f409b340ee888230876cc48299c77b52670ee148153152cf2db9df66bcfe805`；149911001 字节。
- 包名 `com.petpal.app`；0.9.14 / code 26；minSdk 23、targetSdk 35。没有替换正式下载包、版本号、标签或更新清单。

## 最终行为

Android 默认记住设备：90 天闲置期限，使用时按天滑动续期，创建后 365 天绝对上限。有效旧会话在 Android 验证时升级，保留原 token/hash；过期或撤销会话不可恢复。普通 Web/桌面默认会话与后台通知凭据仍为 7 天。密码不落客户端存储，继续使用原 AndroidKeyStore / AES-GCM / AtomicFile。

业务端点 401 先以当前账号单飞确认身份；明确 `session_invalid` 或身份接口 401 才清登录。网络、模型上游错误和续期磁盘错误不会冒充退出。续期 staged 到 JsonStore 队列，原子保存后才发布，旧队列不能覆盖已提交期限或复活已撤销 token。Agent / Chat+Agent 分段重新读取截止时间，避免 90 天 setTimeout 溢出与旧截止误停。

保存凭据但暂时不可达时显示独立重连页，不展示完整登录表单或私有工作区；联网、回前台合并重试，没有后台周期轮询。可明确切换账号/服务器或重试读取设备保存的登录。Android 已验证界面在相隔一天后返回前台时验证续期，临时失败保留既有工作区。退出、改密与管理员撤销保持有效。

## 自动回归与打包

- 最终定向 Node **276/276**，零失败/取消/跳过，日志 `node-final.log`。覆盖认证入口、长期策略、真实 JSON 队列/保存失败/重启、撤销竞态、Agent/Chat+Agent、通知、存储性能、API epoch 与真实组件处理器。
- TypeScript、隔离 Vite 和 OpenUI 构建校验通过。冻结入口 `assets/index-RiQCD_sB.js`。
- Android JVM **117/117**；应用与 `:app:assembleDebugAndroidTest` 构建成功。
- APK CRC/全归档读取、313 个运行时 Web 资源逐字比较、41 个原生源摘要、私密扫描、v1/v2 签名、16KiB zipalign 全通过。
- 与正式同 code 26 包单独比较：签名证书和权限声明集合相同。APK 审计仍保留旧版本升级检查约束，没有放宽审计器。

主要证据：`.data/android-long-login-20261023/final-result.json`、`apk-audit/android-apk-audit.json`、`gradle-tests.log`、`node-final.log`。

## Android 运行验收

| 系统 | 原生 Keystore/AtomicFile | 真实 App 阶段 | 跳过 |
| --- | --- | --- | --- |
| Android 16 / API36 | 3/3 | 5/5 | 0 |
| Android 13 / API33 | 3/3 | 5/5 | 0 |

每台依次执行真实表单登录、强停后恢复、离线启动后自动前台恢复、真实退出、强停后确认清除。隔离服务只推进自己的 Date.now 8 天，不修改宿主或手机系统时钟。服务端确认 loginCount 始终 1、tokenHash/createdAt 未变、rememberDevice 与续期成功；不输出 token/hash/密码。

`offlineThenForeground` 在同一次 instrumentation 内先等待离线重连页，再由宿主 Home / 恢复同一 Activity。Java 引用与 WebView 随机标记都保持，没有 reload、点击重试或重新填密码。退出后客户端加密文件与服务端 session 均清除。

仅使用前任务创建的精确命名 AVD，先核对名称和 ranchu/goldfish；数据为合成夹具，不使用个人 AVD 或账号。结束两台模拟器、45321 fixture 与任务进程均停止。没有连接小米/荣耀真机，不将模拟器结果表述为 OEM 真机验收。

## Chrome 与公网

Chrome 插件检查真实 LoginGate 组件的冻结隔离夹具：503 时无登录表单、两个操作按钮均 44px；切换对话框可关闭，关闭后仍回到重连；恢复合成服务后点击重试直接进入已验证内容，不填密码。此处设备 bridge 与身份服务是明确测试替身，真实加密持久化证据来自 Android 测试。初始 Vite 开发夹具加载受依赖预编译影响，改用冻结 bundle 静态服务后验收；临时 45326 服务已停止。

另以 Chrome 打开正式 `https://magicdatou.top:44318/`，确认正常登录页与账号门禁，没有登录真实用户。浏览器不作为原生 KeyStore、OEM 或 90 天实时时间经过的证据。

## 部署和保全

- 先确认无执行中/排队/未知/回执待汇报任务、无 90 秒内自动化；备份状态、配置、覆盖资源及 `f49ab0c` 源回退 ZIP。
- 一次受控 Windows Stop-Process：已核身份空闲后端 **99832 → 103892**，固定 Node 路径；不能称为优雅 SIGTERM。guardian **34088** 保持，只移除自有 nonce 维护标记。
- 合并资源保留旧 assets/downloads，HTML 最后原子发布。公网入口 `assets/index-RiQCD_sB.js`；HTML SHA256 `882977f2d31bbe9d8985356e795025e294b5e78bdf065d8ca746262a9d1447ae`。
- 本地/公网 health 200，匿名 state 401 / `session_invalid`，Android 新头 CORS 预检 204，内部 owner 只读身份验证 200。
- 4 用户、5 提供商、60 对话、1 附件、0 自动化、14 个业务字段语义及更新信任保持。
- 49 个正式下载文件 **9233483137 字节**前后 SHA 全相同。58 个保护文件中 57 个逐字相同；一个既有记忆文件只有 `contextUpdatedAt`、`lastSyncAt` 两个有效 ISO 同步时间戳在部署时间内单调更新，其余正文/events/scope/epoch/cursor 完全一致。
- 原严格文件全等失败记录保留在 `deploy-retention-after.json`，明确有界例外后的独立检查 `deploy-bounded-retention.json` 通过，没有把差异藏入成功记录或回滚业务状态。

其他部署证据：`deploy-runtime-before.json` / `deploy-runtime-after.json`、`deploy-http.json`、`deploy-web.json`。私有备份保留在该任务目录，不提交 Git。

## 自审与边界

账号/服务/epoch/卸载隔离、续期失败不发布、撤销优先、原 token 身份、通知与长任务兼容已验证。存储在原子替换前检查授权；异步 rename 期间仍可能发生注销，完成后不会重新插回内存，身份响应再次检查，后续撤销保存清磁盘；这不是操作系统级串行授权事务。

本轮不改变原生 vault 格式，不处理卸载/清应用数据后的凭据恢复，不重做不可恢复 Keystore 密钥或锁架构；不承诺永久免登录或 OEM 永不杀后台。正式客户端发布仍需单独版本/清单流程。本轮交付为兼容现有签名的独立测试包。
