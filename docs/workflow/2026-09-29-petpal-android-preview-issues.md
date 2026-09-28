# Android 试用任务

- Date: 2026-09-29
- Complexity: L1
- Related design: 2026-09-29-petpal-android-preview-design.md

## issue-18

- ID: issue-18
- 标题: 交付支持 Chat 和远程 Codex 的 Android APK
- 范围: Android 默认服务、来源名单、成员模型切换、逐条回复朗读、构建与 GitHub 预览交付
- 依赖: issue-17 done
- 验收标准: Android 保留 Chat 与远程 Codex，包内无 Codex/OpenCLI 运行时；试用成员可切换已分配模型，消息旁可生成/播放回复语音；APK 可下载、签名正确；桌面双模式保持
- 状态: done
- 验证方式: 针对性 Node 测试、TypeScript/Vite、Gradle、APK 检查、HTTPS Origin 与 Chrome
- commit: 本次 `feat(issue-18): deliver Android preview with model switching and reply speech`

## 交付与验证

- Android 0.6.2 / versionCode 8，包名 `com.petpal.app`。最终 APK 为 `PetPal-0.6.2-Android-debug.apk`，21,561,010 bytes，SHA-256 `e2c12c270f4f047460b8eb60fcb6ee853622cfe5469d4b920b730c8c0b86e314`。APK 与 SHA256SUMS 作为 GitHub v0.6.2 预览交付；保留 v0.6.1 stable/latest 及原更新清单。
- Android 初次初始化仅设置默认 HTTPS 地址和空 token；已保存会话保持地址/令牌配对，不把 URL 中的令牌重绑到默认服务器。Web 仍默认同源，Electron 仍从 preload 获得本地连接。未添加任何 Chat-only 或 Codex 隐藏规则。
- 32 项后端测试、23 项语音控制器测试、8 项会话与连接测试通过，覆盖认证/来源/流式会话、模型授权与切换、语音停止/替换、账号切换与二进制音频隔离、默认服务与 URL 令牌边界；TypeScript / Vite 构建通过。
- Gradle 构建成功，17 项 Android 单元测试实际执行通过。最终仅重建共享前端资源，Java 源未变，复用这次原生单测结果。最终 APK v1/v2 签名及 zipalign 通过，23 项 Web 资源逐文件匹配，466 条 APK 成员未发现 Node/CLI 运行时、原生 ELF/PE 可执行文件或常见凭据内容。
- SDK 下限 23（Android 6.0），target 35，compile 36。最终签名证书与此前 0.4.0 包一致；这里只验证签名身份和递增版本，没有声称手机覆盖安装已验证。
- 当前生产后端精确追加 `https://localhost` 并受控重启，实例 ID 与原 owner 的六个会话保持。HTTPS 预检返回 204，匿名状态 401，未信任来源 403；未关闭来源校验。
- 按用户要求创建独立试用成员，已授权 Luna、Sol、Astra、Halogen Qwen3.8 Flash Next 四个模型并启用 CosyVoice，默认 Luna / max。HTTPS 登录及成员权限检查通过，Codex 状态接口对普通成员仍为 403。Chrome 已通过此账号真实调用 GPT-6 Luna Max，成功保存一段欢迎回复；未发送电脑控制任务。
- Halogen 的 `http://192.168.60.25:8082/` 为管理面板；实际模型连接使用 `http://192.168.60.25:8081/v1` 的 Responses 接口与 `halogen-qwen3.8-flash-next`。模型目录及真实生成已验证，服务专属凭据仅保留后端私有配置。
- 空闲 Chat 会话可切换已授权模型并沿用历史；切换期间阻止发送和会话跳转，新回复保留生成时的模型标记。Chrome 同一会话的 Luna → Sol → Halogen 真实回复通过，历史保留，标签正确。
- 每条完成回复旁提供朗读/停止，自动朗读默认关闭。Chrome 中 CosyVoice 请求返回 200 / audio/wav，并进入实际播放状态；合成中取消、播放中主动停止均返回空闲。412px 手机宽度布局检查通过，测试后恢复默认尺寸；替换播放/账号取消由已有控制器测试覆盖。截图 `evidence/android-preview/message-voice-playing.png`、`message-voice-mobile.png` 和 `message-voice-stopped.png` 保留在本地。
- 252 个受版本控制文件通过公开源码审计，无凭据或私有构建产物发现；暂存差异检查通过。
- 私有证据位于 `evidence/android-preview/`、`evidence/native/android-final.json` 与 `.data/https/android-account-verification.json`，账号密码、会话和服务配置不进入 APK、源码或发布说明。

## 使用边界

- 开发签名侧载试用包，尚未手机实测权限、摄像头/麦克风、扬声器、悬浮窗或后台生命周期；不能代表商店发布验收。
- Android / Web 的远程 Agent 当前仅 owner 可用，普通成员保留 Chat；执行目标是连接的后端电脑。Windows / Ubuntu 内置 CLI，可在本机执行；本次不重新发布桌面包。
- 登录凭据保留当前会话；Android 冷启动若清空 sessionStorage，需要重新登录并可能重新选择自定义服务器。生产服务仍依赖 Mac 和 Windows 在线、Windows 用户登录。
