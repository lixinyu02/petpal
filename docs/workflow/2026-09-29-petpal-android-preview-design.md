# Android 试用包

- Date: 2026-09-29
- Complexity: L1

## 目标与方案

交付可直接下载侧载的 Android APK。Android 保留 Chat、远程 Codex、角色互动、语音及已有悬浮桌宠；不内置 Node、Codex CLI 或 OpenCLI，Agent 操作由连接的后端电脑执行。Windows、Ubuntu 和 Web 既有能力不变；桌面包的 CLI 仍在本机执行。

远程 Codex 继续受后端账号权限控制，当前仅 owner 可用，普通成员仍为 Chat。Android 首次打开默认连接 `https://magicdatou.top:44318`，可修改为其他 HTTPS 服务；已有会话选择优先，不包含用户令牌或提供商密钥。后端精确允许 `https://localhost`，测试允许与拒绝来源。

试用成员已获授权使用 Luna、Sol、Astra 与 Halogen Qwen3.8 Flash Next 四种模型，默认 Luna / max。Halogen 的 `http://192.168.60.25:8082/` 是控制台，实际连接 `http://192.168.60.25:8081/v1` 的 Responses 兼容接口，模型 ID 为 `halogen-qwen3.8-flash-next`；访问由小伴后端完成，已通过真实生成验证。允许空闲的 Chat 会话切换模型并继续上下文；服务器校验会话归属、模型授权和非运行状态，Codex 不走这一接口。新回复保存生成时的模型标记，历史缺失标记不猜测或覆盖。每条完成的回复旁提供朗读/停止按钮，复用 CosyVoice 音频生成与账号取消逻辑；自动朗读保持可选，不主动播放。

以独立 Android 预览版本打包，交付 GitHub v0.6.2 prerelease，保持原 v0.6.1 资产与 latest 不变。复用本机 debug 签名供侧载试用，明确非商店正式包，不声称手机实测。

## 验证

最终候选为 Android 0.6.2 / versionCode 8 的 `PetPal-0.6.2-Android-debug.apk`，21,561,010 bytes，SHA-256 `e2c12c270f4f047460b8eb60fcb6ee853622cfe5469d4b920b730c8c0b86e314`。

TypeScript / Vite 构建、32 项后端测试、23 项语音控制器测试、8 项会话与连接测试通过。17 项 Android 原生单测已实际执行通过；最终仅重建共享前端资源，Java 源未变，沿用该次原生单测结果。最终 APK 的版本、v1/v2 签名、zipalign、资源逐文件一致性与包内运行时/凭据检查通过。生产 HTTPS 来源预检、账号接口、真实聊天与 Halogen 生成已验证。

Chrome 已在同一会话切换 Luna、Sol、Halogen 并收到真实回复；每条新回复记录对应模型。逐条朗读请求实际返回 200 / audio/wav，观察到 CosyVoice 播放状态，并分别验证合成中取消和播放中主动停止。412px 手机宽度下回复与按钮布局正常，测试后恢复默认浏览器尺寸。控制器测试覆盖替换播放和账号取消；手机安装、权限、扬声器、悬浮窗和后台生命周期尚未实测。

## 回退

撤销 Android 默认服务地址可恢复手动配置。后端仅追加一个来源，保留其他设置与历史；GitHub 预览发布不替换旧安装包。
