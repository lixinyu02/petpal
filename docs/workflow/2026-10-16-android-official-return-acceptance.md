# Android 官方授权返程修复验收

日期：2026-10-16。产品实现提交 `31526712ed46292cec8a9093ef74b81795cd6c22`。

## 交付

- 修复候选 `0.9.14-dev.1`／versionCode26，与0.9.13同包名、同签名，可直接覆盖，无需卸载或清除登录。
- 下载：<https://magicdatou.top:44318/client-preview/PetPal-0.9.14-dev.1-Android.apk>。
- 大小149300903 bytes，SHA256 `52bbf76baf562b4ebb0894157fa219ea507b6ebc37f12319a8713775aca0e58c`，已全量公网回读一致。
- 保留正式0.9.13安装包、Web和签名升级指针；生产后端健康仍为0.9.13。未重启生产服务、替换正式文件或改变用户配置。

## 已通过

1. Java策略单测88项；登录/官方账号前端回归55项；自动化导航与APK审核回归97项；TypeScript、隔离Vite、Java及仪器测试编译通过。
2. Android16/API36、412×960隔离模拟器真实native测试15项通过，包括真实loopback socket/HTML、PKCE/JWKS/Keystore合成授权、错误回调、令牌失败、一次性返程票据、旧通知取消隔离及同账号重新绑定。
3. 实际MainActivity重建后保留授权等待；后台临时服务继续保护listener；有效ACTION_VIEW返程固定触发设置事件，不重载现有测试文档；原始data/extras/clip/grants在Capacitor之前清除；重复和伪造票据不触发导航。完成后服务停止且模型relay保留，异常停服只取消匹配attempt。
4. 实际候选APK覆盖已有code25安装成功；强关后使用真实React登录门禁、普通合成后端和Keystore恢复原小伴账号通过，未因新官方账号生命周期丢失普通登录。
5. APK完整ZIP/CRC、zipalign、32个原生类闭包、288个Web资产、Cubism/Mihomo及许可、私有数据扫描通过；与正式0.9.13签名一致。新增授权服务在包中为exported=false/specialUse。

## 验收边界

原生Activity测试使用无脚本可信本地文档隔离UI副作用，官方接口和令牌均为合成夹具；普通登录恢复另用真实产品React页面验收，两者不冒充真实官方账号绑定。

16项原生测试中，Chrome端到端一项先超时，读取模拟器实际界面后确认为首次启动条款页，尚未请求loopback callback。没有代用户接受或绕过条款。最终测试仅在精确识别该初始化环境时跳过（15通过、1跳过），其他浏览器返程异常仍按失败处理。原始失败、UI树和截图保留；不能据此宣称小米浏览器自动唤起通过。

仍需用户在小米17 Pro Max／Android16覆盖安装候选，重新点击官方登录并在官方页面本人授权；若浏览器限制自动打开，请点击新页面“返回小伴”，再以App中真实账号验证结果为准。此次没有操作真实OpenAI授权、消耗真实套餐模型或修改用户已有官方账号。

私有证据：`.data/android-official-return/` 的 `native-runtime.log`（原始Chrome初始化失败）、`native-final.log`、`browser-ui.xml`、`browser.png`、`app-restored.log`、`apk-audit/`、`delivery.json` 与 `acceptance.json`。不提交凭据或测试运行数据。

## 追加交付：手动回调输入备用方案

实现提交`425ed1d66e22e5c0046e9a90b2121ae5df1c55b6`，候选`0.9.14-dev.2`／versionCode27，同签名覆盖dev.1及正式0.9.13，不需要卸载。

- 下载：<https://magicdatou.top:44318/client-preview/PetPal-0.9.14-dev.2-Android.apk>。
- 大小149446830 bytes，SHA256 `b4bf26627e04db177ee0a660def64714896543192d83e9d26d3ad7e86c2ddb08`，已完成HTTPS全量回读一致。
- 正式Web、0.9.13发布清单、签名更新清单及dev.1候选逐文件哈希保持；生产后端health正常、版本仍为0.9.13。

使用：在App的官方账号设置开始“使用ChatGPT登录”，本人完成官方页面授权。若浏览器没有自动返回，复制最终`http://127.0.0.1:<本次端口>/auth/callback?...`完整地址，回到小伴点击“手动输入回调地址”，在原生输入框粘贴并验证。输入原文不传给JavaScript或中央服务器、不存入配置或日志。它只对应当前尚有效的授权；强关/取消/超时后需要重新登录。

验证结果：

1. Java策略91项、前端/登录/桥/UI相关回归161项通过；TypeScript、Vite、原生及仪器测试编译通过。
2. Android16/API36完整原生26项验收25通过、Chrome首次初始化条款环境1跳过。其中新增5项通过真实产品packaged WebView和真实Capacitor消息桥打开原生输入框，覆盖提交、取消、浏览器先完成时关闭、换账号清除、Plugin销毁清除且保留application授权等待。没有新增测试JSInterface或放宽可信页面策略。
3. 原生合成授权覆盖严格目标地址、state/issued client ID、重复输入只读真实状态、双通道仅兑换一次、partial HTTP socket、收据过期及invalid_grant不重兑。输入框不保存view状态、禁止autofill及键盘学习，窗口FLAG_SECURE，关闭后文本和引用清空。
4. 实际code27覆盖安装后，使用真实React页面和合成普通后端的强关后账号恢复通过；原有加密账号保留。完整APK审核涵盖ZIP/CRC、zipalign、32个原生类、288个Web资产及原生内核和许可；签名与dev.1一致。

两次先期仪器运行失败是测试文档初始化问题：关闭JS后再注入exporter没有原生message listener；同源`loadDataWithBaseURL`夹具也未进入预期文档。最终恢复旧Activity测试的已通过初始化，新输入框测试改用真实产品页面并等待登录门禁和listener稳定后绑定合成scope。原失败日志保留；其中第二次结尾的`Process crashed`是验收者主动force-stop中断无效测试，不作为产品闪退证据。最终完整运行无失败。

私有证据：`.data/android-official-manual/`下`node-tests.log`、`native-acceptance.log`、`native-dialog-final.log`、`app-restored.log`、`login-app-restored.json`、`apk-audit/`、`delivery.json`、`cleanup.json`；失败证据为`native-runtime.log`和`native-final.log`。自用合成服务45321和PetPal_Sync_20261016模拟器已停止，未停止生产服务或删除目录。

边界：官方token/验签/回调使用合成夹具；没有操作真实OpenAI授权。真实小米17 Pro Max／Android16和浏览器最终地址粘贴仍需用户本人验收，不将模拟器结果称为真机或真实官方账号验证通过。
