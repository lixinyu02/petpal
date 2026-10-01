# 小伴原创 Cubism 模型

- Date: 2026-10-01
- Complexity: L2
- Status: updated

## Background

现有少女为整幅 WebP 网格动画，用户要求真正 Cubism 模型，并由我们创建原创资产。保持橘白少女身份、现有聊天与实际 PCM 语音驱动。

## Goal

创建可追溯的原创分层素材、PSD 与真实 MOC3；将 Cubism 模型接入 Web/Electron/Capacitor 共用人物场景，支持视线、眨眼、情绪、语音嘴型、触摸和睡眠。先网页验收，不改 0.9.6 安装包。

## Non-goals

本轮不增加摄像头面捕、不开放任意第三方模型导入、不改 Chat/Agent、安全隔离、下载包、更新签名或运行中后端。

## Solution

1. 内置 imagegen 制作原创人物与透明部件，保留原像素、生成提示和 hash；机械分层与 PSD 打包不重绘美术。
2. 固定并审计独立 GPL-3.0 psd2live 源码编译工具，使用已有 Java21/Gradle；不将工具 runtime 集成应用，不启用在线 upscale 或可选官方 Native 预览。
3. 同源模型包必须完整引用 MOC3、纹理、physics、motions、expressions；路径禁止越界、外链及不受限下载。
4. 官方 Cubism 5-r.5 Framework 固定配套 gitlink d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b，Core 独立取得与记录许可/版本/hash。官方 SDK 下载页要求同意协议；在 Core 真正取得前不绕过条款。
5. 共用 performance/presence 输出映射到真实参数，真实参数索引必须小于 parameterCount。口型在物理后绝对 set；停止/隐藏必须闭嘴。页面级 Framework 引用计数、多画布生命周期，WebGL2 不可用时降级现有场景。
6. 同源资源按需 lazy load，手机限制 DPR 和贴图大小，遵守 Android 本地 CSP，不默认 CDN。

## Impact

新增原创资产、构建工具/说明、Cubism 场景与参数桥。保持旧角色资产作为稳定降级，模型通过真实 Core 检查和 Chrome 验收后才设为默认。

## Risks

自动建模工具的 MOC3 必须用官方 Core 校验及实际渲染，文件扩展名不能当作成功。生成部件可能需要迭代确保拼接一致。Core 是专有许可，Framework 是 Live2D Open Software License；官方样例资产不复用。浏览器通过不代表安卓/Ubuntu/Windows 实机通过。

## Verification Plan

PSD 层与 alpha/offset/hash 审计；编译参数/网格/动作清单；官方 Core MOC 版本及一致性检查；参数桥负例、静音闭嘴与不支持参数；TypeScript/build/相关回归；Chrome 412×960 与桌面视线、触摸、睡眠、实际语音、停止/隐藏恢复、上下文丢失与无 Core 降级；发布后 HTTPS 资源 hash 读回。保留旧包/签名/私有 state，后端不重启。
