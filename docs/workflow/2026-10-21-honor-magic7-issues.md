# 荣耀 Magic7 适配 Issues

- Date: 2026-10-21
- Complexity: L1
- Related design: 2026-10-21-honor-magic7-design.md

## issue-1

- ID: issue-1
- 标题: Magic7/Pro 布局、系统识别、MagicOS 后台入口与安卓验收包
- 范围: 标准版/Pro、Android15/16；已证实的响应式/原生兼容修复、真实系统/型号识别、隐藏其他厂商专属设置、荣耀入口安全兜底、浏览器/模拟器验收、独立测试包。
- 依赖: none
- 验收标准: 屏幕/键盘/大字体不遮挡核心操作，已有功能保留；荣耀设置入口可靠回退且不自动修改权限；测试 APK 可审计，并如实区分模拟器与真机。
- 状态: done
- 验证方式: TypeScript/Vite、Node216/216、Java107/107、原生运行36/36、Chrome421/427/361及横屏/短视口、APK全CRC/资产/签名/16KB对齐与当前正式包签名对比通过。详见2026-10-21-honor-magic7-verification.md；荣耀真机菜单和长期后台留存未验收。
- commit: 本issue的 feat(issue-1): adapt Honor Magic7 devices and platform settings 提交（随本文件一起提交）。
