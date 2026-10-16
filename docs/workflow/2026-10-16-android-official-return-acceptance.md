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
