# PetPal 0.4 验收记录

版本：0.4.0。范围：管理员建号、用户隔离、模型授权、语音连接预备配置及本机音视频设备选择。设计与状态见 [设计](workflow/2026-09-26-petpal-user-voice-design.md) 和 [issue-5](workflow/2026-09-26-petpal-user-voice-issues.md)。

0.3 的安装包、源码包、哈希与最终 EXE 运行证据保持原样，见 [0.3 验收](acceptance.md)。本页不把旧版运行结果视作 0.4 的验证通过。

## 已完成的检查及最终回执

最终冻结源码的全套测试 **116/116 通过**，0 失败、0 跳过；TypeScript 检查和 Vite 生产构建通过。回执为 `evidence/test-results-0.4.json` 和 `evidence/web-build-0.4.json`。Three.js 大 chunk 提示不影响构建完成。下列定向检查包含在最终总数或独立审查证据中，不额外相加。

- 语音 7 项：默认值与公开运行状态、字段白名单及不可变更新、远程必填项、HTTPS 与本地 HTTP 边界、密钥保留 / 清除 / 换址轮换、类型 / 长度 / 枚举 / 数值限制、双 section 原子更新。
- 设备偏好 6 项：设备 ID 白名单、服务实例及用户隔离、存储异常和坏记录、不可变快照及旧账号控制器停用、权限不足时保留选择、明确失效设备独立回退。
- 独立竞态回归：第九次登录等待旧任务收尾时重置密码，旧密码不能恢复登录会话；任务已中止但桥接尚未结束时，审批拒绝且不调用底层批准。
- 独立 HTTP 检查：大小写等价用户名并发创建仅一个成功；v1 备份冲突保留原状态，修复冲突后迁移保持唯一备份和稳定 owner / instanceId。

上述测试不访问真实提供商，不录音、摄像或播放声音，不属于设备运行验收。

原生源码回执为 `evidence/native/v04-account-media-source.json`，记录账号请求生命周期、原生媒体权限策略的定向测试、TypeScript 检查及 Android `compileDebugJavaWithJavac` 离线编译。该回执明确为源码与 Java 编译检查，不是最终 EXE / APK 验收，也不证明真实设备权限弹窗、摄像头或麦克风已运行。

## 界面及设备证据

本轮使用 Chrome 完成 owner → 成员 A → 成员 B → 成员 A 的实际界面流程，确认成员只显示获授模型，默认模型和语音连接配置分别保存，切回原账号能恢复其配置。流程回执由 `evidence/user-voice-acceptance-0.4.json` 记录。

最终 dist 的桌面与手机宽度截图为 `evidence/media-settings-0.4.png`、`evidence/media-settings-mobile-0.4.png`。手机有效 CSS 宽度和 scrollWidth 都为 391，没有横向溢出。

网页测试音显示自动播放结束，但未人工听音确认扬声器效果。未启动真实麦克风或摄像头；设备选择、权限约束、输入生命周期和账号切换清理的自动测试不能替代物理设备运行证据。没有远程 TTS / ASR 或浏览器识别服务的真实请求。

## 功能与交付边界

远程 TTS、远程 ASR 和浏览器识别当前只保存配置；没有远程语音调用或识别会话。系统朗读继续使用设备本地音色，并跟随系统默认输出，不受网页 `setSinkId` 扬声器选择控制。麦克风和摄像头入口是用户主动发起的本地测试，不录制、不上传。

## 0.4 发行产物

| 平台 | 产物 | 大小（bytes） | 当前验证 |
| --- | --- | ---: | --- |
| Windows x64 | [便携 EXE](../releases/desktop/PetPal-0.4.0-Windows-x64.exe) | 178,486,521 | 最终 EXE 实际启动及资源核对通过；未商业签名 |
| Android | [开发签名 APK](../releases/android/PetPal-0.4.0-Android-debug.apk) | 21,424,552 | v1/v2 签名、版本、权限与资源核对通过；未进行设备运行验收 |
| Ubuntu x64 | [portable tar.gz](../releases/ubuntu/PetPal-0.4.0-Ubuntu-x64.tar.gz) | 271,340,012 | 归档和全部文件独立核对通过；未进行 Linux 运行验收 |
| Ubuntu ARM64 | [portable tar.gz](../releases/ubuntu/PetPal-0.4.0-Ubuntu-arm64.tar.gz) | 265,655,204 | 归档和全部文件独立核对通过；未进行 Linux 运行验收 |

Windows 最终便携 EXE 启动实际 Electron 主窗口和透明桌宠，提供本地服务并发现已登录的内置 Codex；受限 PATH 验证通过，退出后无所属残留进程。独立解出最终 EXE 的 `app.asar`，22 个 dist 文件与 10 个服务 / 桌面源文件共 32 项逐字节一致，六张角色纹理一致，包含新增 auth、voice 和媒体权限 helper。回执为 `evidence/native/windows-final.json` 和 `windows-0.4-asar-verification.json`；本次基础窗口截图取自 `evidence/native/windows-v04-final/`，不沿用 0.3 pose 截图作为本版证明。

Android 最终版本为 `0.4.0` / versionCode `4`。22 个 Web 文件及六张纹理与冻结 dist 一致，DEX 含本地媒体请求守卫，Manifest 含相机、录音、音频设置权限。相机、任意相机、自动对焦和麦克风均为可选硬件特征，不因缺少摄像头而排除安装。回执为 `evidence/native/android-final.json` 和 `android-0.4-extra-verification.json`。开发签名与编译通过不证明 Android 实机权限提示或音视频设备已运行。

Ubuntu 两架构各有 5,332 个归档项、5,019 个文件；与冻结构建输出双向盘点、逐文件 SHA-256 和字节数核对均通过。另核对 22 个前端文件、10 个服务 / 桌面源文件、六个 Linux ELF 和六张纹理，平台和执行权限匹配。主回执、独立回执及 `linux-package-*-allfiles-0.4.json` 的归档摘要一致，详见 `evidence/linux-package-audit.md`。未运行 Linux 二进制、WSL 或 RK3566 板卡，X11/Wayland 透明置顶和目标设备输入输出仍需实测。

源码发行使用 `scripts/package-source.mjs` 的显式清单、敏感内容扫描和 ZIP 逐项回读；正式源码 ZIP 及哈希由最终归档步骤生成，以 `evidence/source-package.json` 和发行清单为准。通用发行回执必须指向 0.4 才能纳入源码包，固定测试凭据仅在指定 fixture 文件按精确字符串放行。`--check` 只生成扫描计划，不生成 ZIP。旧版包和回执原件保留。

本轮没有新增真实模型请求、远程 TTS / ASR 请求或物理麦克风 / 摄像头验收；Chrome 测试音结束也不代表人工听音通过。
