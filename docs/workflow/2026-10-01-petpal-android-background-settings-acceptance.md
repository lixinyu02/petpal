# Android 0.9.3 手机后台设置验收

## 交付

Android 0.9.3 / versionCode 13，开发签名，与 0.9.0 / 0.9.2 使用同一证书。最终 APK 为 `PetPal-0.9.3-Android-debug.apk`，19,493,982 bytes，SHA-256 `503db5c9c6d2ce454db99f58081ab48911e41052e0cdccf4eb016a03ea9733c6`。

新增品牌识别、固定省电 / 自启动 / 通知入口及折叠指导；入口不可用时回退并说明实际页面。返回小伴后刷新系统电池优化及通知状态，迟到结果不会污染另一账号。后端和执行协议没有改变，Windows / Ubuntu 未重打。

## 分层证据

- 相关前端测试 25/25、TypeScript 和独立生产构建通过。
- 原生单元测试 57/57，通过固定动作、厂家识别、系统 handler 授权及回退验证。
- Chrome 插件以 412×960 验证页面，document scrollWidth 为 412，三个设置按钮均在屏内；检查了小米、荣耀、三星、vivo 指导及回退 / 失败 / busy / 账号切换后的迟到反馈。
- Android 16 / API 36 独立模拟器运行测试 1/1：真实打开应用电池页、应用通知页、应用详情；自启动回退应用详情；每次实际返回小伴；非法动作拒绝；前后系统电池豁免事实未改变。四张系统页截图已逐一检查。
- APK 与最后源码构建的 30 个 Web 资源及 2 个 Capacitor bridge 逐字节一致；新原生类存在，runtime 测试类和 fixture 不在正式 APK。v1/v2 签名有效，9 项本机私有凭据逐字节扫描无泄漏。
- 无 `QUERY_ALL_PACKAGES`、`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`、开机广播或唤醒锁。

完整 Node 回归并发版 1149/1151；串行版 1150/1151。认证入口隔离文件重跑 5/5，真实 Codex 文件单独重跑 6/6；完整串行仍有既有 Codex 取消请求后的上游关闭等待超时。因此不宣称全量回归通过。该测试和对应 server/transport 实现不在本 issue 的修改中，保留诊断记录继续调查。

本地证据目录：`evidence/android-background-settings-20261001/`，包括 `apk-audit.json`、`background-settings-runtime-result.json`、`screenshots-visual-review.json`、`chrome-ui-verification.json`、`final-tests.log` 与 `final-tests-serial.log`；原生单元日志为 `.tools/android-background-settings-unit.log`。原始设备、私有数据和测试 APK 不纳入公开源码或 Release。

## 验收边界

各品牌私有页面来自历史开源候选，现代系统可能更改或限制入口；每次运行均重新检查并回退。品牌覆盖不能替代 OEM 真机验证，系统电池豁免不能代表厂商自启动 / 后台权限。只验证标准系统页导航，没有改动模拟器系统开关，也没有执行 RK3566 安装、烧录或重启。

旧 APK 需要安装新版才能使用原生入口。页面和应用不会自动取消系统限制，强制停止或重启后需要用户重新打开并检查后台监听。
