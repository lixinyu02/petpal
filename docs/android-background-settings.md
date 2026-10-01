# Android 后台提醒与手机设置

Android 0.9.3 / versionCode 13 新增后台设置快捷入口。升级 APK 后，登录个人服务，在「连接与设置 → 账号 → 后台任务提醒 → 让提醒更稳定」展开操作。

- **省电限制**：尝试进入小伴的应用电池设置，或系统电池优化列表。
- **自启动设置**：尝试进入当前品牌的启动管理；没有可用入口时打开小伴应用详情并给出手动路径。
- **应用通知**：打开小伴的系统通知设置。

设置由你在手机系统中确认。回到小伴后会刷新系统电池优化状态和通知状态。系统电池优化豁免只能说明 Android 这一项，无法判断厂商自启动或后台运行开关。

## 品牌覆盖

| 手机 | 操作指导 | 自启动直达候选 |
| --- | --- | --- |
| 小米 / Redmi / POCO | 省电策略、后台自启动、通知 | MIUI 安全中心 |
| 华为 | 应用启动管理、后台活动、通知 | 系统管家 |
| 荣耀 | MagicOS 启动管理、后台活动、通知 | 应用详情回退 |
| OPPO / 一加 / realme | 耗电管理、自启动、通知 | ColorOS / OPPO 安全中心 |
| vivo / iQOO | 后台耗电管理、自启动、通知 | 权限管理 / i管家 |
| 三星 | 不受限制、休眠 / 深度休眠列表、通知 | 应用详情回退 |
| 魅族 | 电源管理、后台管理、通知 | 安全中心 |
| 华硕 | 电池优化、PowerMaster、通知 | Mobile Manager |
| 原生及其他 Android | 应用电池用量、后台运行、通知 | 应用详情回退 |

厂商设置组件会随系统版本变化。原生桥在每次跳转前检查组件存在、可导出、已启用、属于系统应用且权限满足，启动失败继续尝试标准设置。界面会明确说明实际打开的是应用详情或手机系统设置；上表属于候选和指导覆盖，不代表所有手机实测通过。

应用不读取全部已安装软件，也不自动改系统开关。强制停止或手机重启后需要重新打开小伴并检查后台提醒；允许自启动不表示自动开始监听。网页升级不能为旧 APK 增加这些原生入口。

## 验证与来源

Chrome 412×960 已验证布局、品牌指引、失败 / 回退提示、并发按钮禁用与账号切换后的迟到反馈丢弃。独立 Android 16 / API 36 模拟器用于标准设置实际打开、返回、非法动作拒绝及开关不变验收；OEM 私有页面仍需对应品牌实体手机确认。

- [Android Settings API](https://developer.android.com/reference/android/provider/Settings)
- [Android Doze 与后台限制](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [Package visibility](https://developer.android.com/training/package-visibility/automatic)
- [AOSP 设置入口](https://github.com/aosp-mirror/platform_packages_apps_settings/blob/master/AndroidManifest.xml)
- [AutoStarter 历史厂商组件](https://github.com/judemanutd/AutoStarter/blob/ea5fca55457facb6f97555e20dcd231b39c6995e/autostarter/src/main/java/com/judemanutd/autostarter/AutoStartPermissionHelper.kt)
- [CRomAppWhitelist 历史组件](https://github.com/WanghongLin/CRomAppWhitelist/blob/master/cromappwhitelist/src/main/assets/default_appwhitelist.json)
