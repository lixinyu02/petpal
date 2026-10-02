# V12 眨眼修复验收（2026-10-03）

## 结论

V12 自然眼睑已于本次任务上线 Web，默认资源为 `/avatars/akari-cubism-v12/akari.model3.json`。官方 Core 6.0.1 / MOC5 实际加载；桌面点击眼部与 412×960 触控均得到 Idle → TapHead → Idle，未进入替代渲染。修复分为点击时旧眼皮曲线叠乘、模型自身闭合轮廓两层。

## 证据

- 284 项 Cubism/avatar/companion/gesture/interaction/desktop-smoke 回归、TypeScript 与隔离 Vite 构建通过。V11/V12 都实测 TapHead、嘴型、自然眨眼、单眼 Wink，V10/同名导入模型保留其原曲线。
- Core 模型验证 106 姿态通过；左右各 101 个连续闭合值验证原生遮罩、虹膜刚性、三角形不翻转、非眼睑几何与纹理保持。最终作者 profile `reference-natural-lids` 也直接通过验证器。
- Chrome 逐帧查看开度 1/.75/.5/.25/0；动态自然眨眼、摸头、Wink 均从渲染完成回调捕获真实画面。完全闭合为柔缓下弧，半闭眼白没有超出睫毛边缘。
- 线上桌面真实鼠标点击眼部及移动端触控各记录 7 秒 canvas 视频与 RAF 状态。移动视口实际 `innerWidth=scrollWidth=412`、高度 960，无横向溢出。此为 Chrome 设备模拟，非 Android/Ubuntu 实机新增验收。
- 公网读取首页、Cubism chunk、新 MOC 与纹理的完整字节，SHA-256 与本地部署一致。另逐一比对 23 个 V12 runtime 文件。

## 部署与回退

只新增 23 个 V12 模型资源和 8 个带 hash 的 JS 文件，备份后原子替换首页。没有重启后端、修改账号/聊天/下载目录或历史模型。首页备份位于私有 `.data/release-097-deploy/natural-lids-0317246c-2cb4-4bab-b221-7e68216e0a7a/index.html`。

MOC SHA-256：`c174352f594b1823bdb9cc14b503d64f41cd2be58d9baa6c4dc82450c93c6195`。

## 边界

0.9.7 安装包在此前已冻结于 `2d5b654be0d739a5a7b9524f8a98c53e8e913315`，仍内置 V11，不包含这次随后完成的 Web 修复。未使用相同版本名偷偷替换其字节。CMO3 原生编辑结构/关键点/UV/indices/透明度读回通过，仍未在官方 Cubism Editor 打开保存重导出。

完整本地证据在 ignored `evidence/blink-repair-20261003/`：`v12-regression.log`、`v12-promoted-natural-core.json`、`v12-deployment.json`、`v12-public-readback.json`、`v12-desktop-click.webm`、`v12-mobile-touch.webm` 及对应 trace、截图。
