# 荣耀 Magic8 安卓屏幕适配

- Date: 2026-10-20
- Complexity: L1
- Status: final

## Background

用户要求深入适配荣耀 Magic8。标准版屏幕为 1256 × 2760；物理像素不等于 WebView 的 CSS 视口，系统显示大小、字体大小、导航方式和键盘都会改变可用空间。现有 targetSdk 35 客户端缺少原生 edge-to-edge 安全区处理，前端还需检查短视口和字体放大。

## Goal

系统栏、挖孔、横竖屏和输入法都不遮挡主要操作；伙伴、聊天、Agent、登录、设置在约 360–450 CSS 像素宽度下可用；提供独立安卓验收包。

## Non-goals

不按型号或物理分辨率硬编码布局，不修改用户手机系统显示设置，不替换正式发布包，不改业务数据与服务部署。

## Solution

Android 由单一原生 insets 处理者处理 systemBars/displayCutout/IME，避免原生与 CSS 重复补偿。前端继续使用共享 visualViewport，修正被实测证实的短屏、弹层、字体放大及伙伴布局问题。保留系统缩放和所有功能入口。

## Impact

安卓 Activity 屏幕适配、必要的响应式样式及验收用例。认证、代理、通知、语音和悬浮伙伴权限边界保持。

## Risks

Android WebView 与厂商输入法可能有差异；模拟器不能替代 MagicOS 真机验收。浏览器 viewport override 必须用实际 innerWidth/innerHeight 校准。

## Verification Plan

- Chrome 插件验收登录、伙伴、聊天、Agent/模型菜单、设置与弹层，覆盖 360/400/412/440、横屏和短视口。
- Android 16 模拟器配置 1256 × 2760，覆盖系统栏、切口、键盘弹出/收起、旋转和字体缩放。
- TypeScript、相关测试、安卓编译、APK 审计；记录证据和真机限制。

## Result

已实现唯一原生安全区/IME 消费者、返回键优先收键盘、日夜系统栏同步；修复横屏人物区域层叠、三类弹层安全边界、登录与远程桌面短屏布局、字体放大时输入框行高。浏览器和安卓模拟器验收通过，详见 `2026-10-20-honor-magic8-verification.md`。没有荣耀真机验收，也未替换正式下载源或部署服务。
