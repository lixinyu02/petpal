# Android 手机后台设置入口

- Date: 2026-10-01
- Complexity: L1
- Status: updated
- Baseline: bed7906

## Background

0.9.2 已提供原生后台任务提醒，但仅能打开应用详情。不同手机将电池优化、自启动与通知设置放在不同位置，用户需要更短的配置路径。

## Goal

后台提醒内识别常见手机品牌，提供省电限制、自启动/后台运行、应用通知的快捷入口及准确操作说明。交付新版 Android APK，保留原通知监听和账号隔离。

## Solution

- 原生 `backgroundSettings()` 返回 manufacturer/brand/vendor/apiLevel、Android 电池优化豁免事实及固定设置类别的入口能力。不会把该事实等同于 OEM 自启动或后台无限制。
- `openBackgroundSettings({kind})` 只接受 battery/autostart/notifications/app 四种固定动作。桥沿用本地可信主页面/前台校验，不接受任意 Intent、组件、包名或 URL。
- 白名单 OEM 入口必须解析为 enabled/exported 的系统或更新过的系统应用；使用有限 package/action queries。尝试类别入口，失败安全回退到标准设置或本应用详情，并返回实际结果。
- 不申请直接电池豁免权限，不自动修改系统开关。小米/Redmi/POCO、华为、荣耀、OPPO/一加/realme、vivo/iQOO、三星、魅族、ASUS 及原生 Android 使用固定本地指导。
- 前端使用折叠指导、一次一个设置跳转，回到应用后刷新 Android 豁免/通知状态。异步结果检查账号代次，412×960 界面保持可读。
- Android versionName 0.9.3 / versionCode 13，独立构建目录，沿用开发签名；网页与下载入口按既有授权交付。

## Impact and Risks

后端、执行器、模型和音频协议不变。OEM 私有设置 Activity 会随系统版本变化；能力探测和捕获启动失败降低闪退风险，但具体厂家入口需要实体手机验收。系统设置无法公开读取的 OEM 自启动状态保持未知；不能承诺取消省电限制后永不被系统回收。

## Verification Plan

固定动作/厂家映射/候选回退与 UI 文案测试、原生相关单元测试、TypeScript/生产构建、Chrome 412×960 设置验收、独立 API36 模拟器标准设置跳转/返回/白名单拒绝。最终 APK 签名/版本/资源/无凭据审计，公网及 GitHub 包哈希核对。模拟器证明标准 Android 路径；厂商列表属于源代码/候选探测覆盖，不能记为所有品牌实机通过。
