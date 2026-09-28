# 用户隔离、模型授权与语音配置入口

- Date: 2026-09-26
- Complexity: L2
- Status: updated

## Background

0.3 使用单一配对令牌和全局 settings/providers/conversations。用户要求预备 TTS/ASR 设置入口，并让后端区分用户、保存可用模型配置。新功能在 PetPal 内完成，不修改固件工程、既有包或运行中的旧服务。

## Goal

管理员创建账号、重置密码、停用账号并分配模型；用户独立保存聊天、伙伴设置、默认模型及语音连接配置。旧单用户数据归主机 owner，继续兼容桌面配对。账号切换不能携带旧聊天、请求、音频或待同步偏好。

## Non-goals

本轮不开放自行注册、云部署、计费、第三方身份或多主机数据库集群。不新增远程音频传输、音视频录制或 ASR/TTS 服务调用；语音接口明确标示配置预备状态，现有本地系统朗读继续可用。普通用户不借用主机 Codex 身份。

## Solution

采用用户明确选择的管理员建号模式。v1 状态备份后原子迁移 v2，稳定 instanceId 和唯一 owner；旧数据与配对令牌仅归 owner。账号带 id/username/displayName/role/disabled/providerIds；密码为独立盐的 scrypt 哈希；会话令牌随机产生，服务端仅保存摘要和到期时间。登录限速；不记录密码/原始会话令牌。

认证中间件从凭据解析当前用户。成员只看到被分配的模型；模型定义和密钥由管理员维护。会话必须验证归属，模型权限在创建和发送时重验；跨用户的查询、删除、停止均拒绝。停用、重置密码或撤销授权终止对应任务；注销撤销登录会话。Codex 仅 owner 可访问，成员状态查询不调用共享 CLI，审批绑定活跃任务和用户。

接口约定：

- `POST /api/auth/login {username,password}` 返回 `{token,user}`；`POST /api/auth/logout`；`GET /api/auth/me`。
- `GET /api/state` 保留原有 settings/providers/conversations/codex，增加 `instanceId` 和 `user:{id,username,displayName,role,isOwner,canUseCodex}`；settings 增加 `defaultProviderId`。
- `GET /api/admin/users` 返回 `{users}`；`POST /api/admin/users {username,displayName,password,providerIds}`；`PATCH /api/admin/users/:id {displayName,password,disabled,providerIds}`。owner 不可停用或降权；管理员可为其设置登录密码。
- `GET /api/voice` / `PATCH /api/voice` 按当前用户读写 TTS/ASR 配置，返回白名单字段与 hasApiKey，绝不返回密钥。body 用户 id 不作为授权来源。
- TTS：mode `system|remote`，baseUrl/model/voice/speed/apiKey；ASR：mode `disabled|browser|remote`，baseUrl/model/language/apiKey。远程配置保存时校验字段、地址和密钥；公网 HTTPS，回环/私网/.local 可用 HTTP，适配本机或局域网语音服务。空密钥保留，clearApiKey 显式清除，已存密钥不能在换地址时自动沿用。
- 语音返回 `runtime:{tts:'system',asr:'not-connected',remoteConfiguredOnly:true}`，UI 明示只预备连接资料，未完成远程接入。

前端将凭据保留在内存/sessionStorage。每次切换连接使 epoch 递增、取消旧请求、停止朗读、清空旧状态并重挂载账号相关 UI；请求捕获连接且校验 epoch。角色偏好以 instanceId+userId 分区；旧离线队列不得 PATCH 到新用户。桌面浮窗只同步公开显示偏好，不在 localStorage 同步令牌。

用户随后明确增加麦克风输入、摄像头输入和扬声器输出选择。新增设备区域，基于 MediaDevices 枚举并按账号+本设备本地保存 deviceId，设备偏好不写跨设备后端。用户主动点击才申请对应麦克风/摄像头权限，提供无录制/无上传的电平和摄像头预览，以及低音量短测试音。输入选择使用 exact deviceId，失效时提示重新选择；输出优先 HTMLMediaElement.setSinkId，不支持时明确提示只能系统默认，不能静默声称切换成功。现有 Web Speech 系统朗读无法单独指定设备，仍跟随系统输出；选择的扬声器用于测试音及后续可路由音频。切换账号、设备、页面隐藏或卸载时关闭 tracks/音频/AudioContext；异步权限请求返回后也校验当前身份，废弃旧采集。Android/Electron权限限定主应用可信来源，透明悬浮窗不获得捕获权限。

## Impact

版本 0.4.0；后端存储、鉴权、路由与测试，前端账号连接/管理、模型权限、语音设置与偏好生命周期，文档及四端共享资源。继续使用本地 JSON 原子写，适用于单服务进程。

## Risks

迁移需保留备份并幂等；权限遗漏会造成跨用户数据泄露，因此不能只增加 userId 字段。账号切换的异步回写与偏好队列单独验收。管理员与主机 owner 区分，绝不把模型授权解释为主机 CLI 授权。配置已保存不代表远程语音已连通。公网仍需可信 HTTPS；无商用账号运营或集群承诺。

## Verification Plan

验证旧数据迁移/重启、双用户隔离与越权矩阵、模型撤权、注销/停用/密码重置、并发取消归属、敏感字段回读、语音字段/密钥变更；回归原提供商/Codex/演出测试及生产构建。优先 Chrome 验证账号和设置完整流程，插件不可用时以实际 Electron 窗口验证并记录限制。最终构建与目标设备验收分开记录。
