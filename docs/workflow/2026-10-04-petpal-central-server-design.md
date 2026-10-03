# PC 中央服务器

- Date: 2026-10-04
- Complexity: L2
- Status: final

## Background

Windows / Ubuntu 客户端已内置完整 Express 后端及 Codex 执行器，但后端仅监听随机 loopback 端口。用户希望电脑也可作为其他设备共用的中央服务器。

## Goal

在设备连接中启停本机中央服务、配置固定端口，展示不含凭据的局域网地址。其他设备连接同一服务及账号，共用模型、聊天、语音设置与执行电脑列表；沿用既有账号授权。

## Non-goals

不自动迁移既有公网实例数据、不更改上游 API、不自动配置公网转发或防火墙、不替换 0.9.7 Release。本轮完成源码、网页构建及真实 Windows 原生验收；Ubuntu 原生系统验收需目标设备。新版原生桥需新版桌面客户端。

## Solution

- 保留桌面 127.0.0.1 随机端口及窗口 origin。附加 HTTP listener 直接复用同一 Express 应用和状态，不做 loopback 代理，保留真实访客 IP 和流式/backpressure。
- 默认关闭；固定 IPv4 监听 0.0.0.0、默认 4319 避开现有部署 4318，允许 1024–65535 的浏览器安全端口，不接受额外地址、路径或凭据。
- 后端原生 hosting facade 提供 owner 校验、密码就绪状态和附加 listener；所有 listener 纳入最终 shutdown。附加入口拒绝本机 bootstrap 管理令牌，其他设备使用密码会话。Host 继续只认可本机地址和明确允许来源，更新网络后可用新 IP。
- `desktop/central-server.cjs` 管理独立 `central-server.json`（有界严格 JSON、原子写入、0600、拒绝 symlink），串行读写启停。先验证本机 owner，再 bind，再授权复核、持久化；失败回滚。更换端口成功前保留旧入口；停用断开外部连接，但不关闭本机后端或取消已提交的 Agent 任务。
- 启动恢复仅在既有明确 enabled 设置且 owner 已有密码时执行，失败显示真实原因，仍可打开本机客户端。退出关闭 listener 而保留恢复设置，继续沿用启动与托盘偏好。
- `window.petpal.centralServer.status()/update({enabled,port,publicUrl})`：preload 捕获当前连接，main 只接受可信主窗口、当前 connection 未变且为本机 origin、当前本机 owner。status 不含 token、密钥、文件路径或会话；远程 owner 及 member 无权限管理本机监听。可选 publicUrl 为严格 HTTPS origin，仅用于已有可信反代；额外 listener 允许此 Host/Origin 与固定 Android `https://localhost` 来源，原本机 listener 不扩大来源权限，不信任任意转发头。
- 设置单独 section，按状态显示运行/关闭、端口、局域网地址、重新读取/保存。需要密码时引导账号设置；远程登录时引导本机管理员登录；旧客户端、Web、Android 显示准确能力边界。session epoch 防止旧账号异步结果回流，实际 readback 后才显示成功。
- UI 沿用暖白/墨绿日夜主题、分隔线和短说明，不增加首页控制项；状态切换与保存反馈简短，遵守减少动态效果偏好。

## Impact

后端增加原生 hosting facade 与多 listener 退出；桌面增加服务管理器、受限 IPC 和打包文件；前端增加懒加载设置组件。原中央部署仍单 listener，既有 Chat/Agent、下载、ASR/TTS、权限与会话不变。

## Risks

- 端口被占用、配置无法写入时保持旧状态；中央恢复失败不能阻止本机启动。
- HTTP 局域网页面无法使用浏览器要求安全上下文的麦克风/摄像头，Android 安装版也要求可信 HTTPS；已有 HTTPS 入口可配置到本机服务以提供跨端访问。既有本机 loopback 页面不受影响。HTTPS/防火墙需要按部署环境配置，填写入口不会申请证书或转发端口，界面不声称打开即公网可达。
- 关闭入口中断访客连接，已提交任务保留；彻底退出小伴会停止本机服务器和执行器。
- 仅展示当前网卡地址，不把监听成功当成另一台实机连通或 Ubuntu/Android 验收。

## Verification Plan

后端双 listener 实测登录、bootstrap 拒绝、账号隔离/权限、共享历史、附件、SSE、HEAD/Range、Host/Origin 与整体退出；管理器持久化/恢复、占用/写盘失败回滚、停用活动 socket；IPC 本机 owner/远程 owner/member/logout race。前端真实 lazy、主题及 412×960 布局、过期结果屏蔽。TypeScript/build、相关测试和完整串行回归；隔离 profile 的真实 Electron Windows 启停验收，不改生产服务和账号。Chrome 优先验收网页布局，区分桥夹具与原生结果。

## Verification Results

- 最终完整串行回归 `node --test --test-concurrency=1 tests/*.test.mjs` 为 1785/1785，通过 TypeScript、生产构建和差异检查。首次回归发现两项旧 shutdown VM fixture 缺少中央关闭阶段，已补真实延迟与清理断言；一次既有真实 Codex 取消超时在单独 6/6 及后续完整回归中通过，未修改其实现或削弱断言。最终日志为 `evidence/central-server-20261004/full-tests-delivery.log`。
- 真实 Windows Electron 在隔离 profile 运行两次：无密码禁止开启、实际 UI 保存、额外监听拒绝匿名和 bootstrap、密码会话共享同一 instance、占用端口回滚、同端口 HTTPS 来源热更新、412×960 无横向溢出；第二次启动恢复监听，实际 UI 停用后外部端口关闭、本机登录仍可用。未调用上游模型，验收端口最终关闭。
- Chrome 隔离 Web 分支与部署后的真实 HTTPS 入口均在实际 CSS 412×960 下确认能力说明、登录限制与无横向溢出，不把 Web 夹具描述成原生成功。Windows 原生截图及两阶段 JSON 回执保存在 `evidence/central-server-20261004/native-final/`；线上布局截图为 `evidence/central-server-20261004/chrome-public-mobile.png`。验收账号已退出，临时浏览器尺寸已恢复，隔离服务已关闭。
- 静态网页已同步至 `https://magicdatou.top:44318/`，公网首页 SHA-256 与隔离构建完全一致；保留 V12 模型、0.9.7 正式下载清单、校验和及签名更新清单，没有重启生产后端。回执为 `evidence/central-server-20261004/deployment.json`。
- 交付前自审发现 Ubuntu 使用独立打包数组，已补三个中央模块；同步 Ubuntu 源码摘要、Windows 读回和最终冻结来源/EXE/native smoke 三方摘要。相关 49/49 验证覆盖实际 tar 中逐一缺失、篡改及 Windows 生产比较代码；最终完整回归包含这些新增检查。暂存公开源码审计检查 1238 个文件，无凭据或生成产物违规；新增测试仅按精确文件和精确合成值豁免，并验证其它值及其它文件仍被拒绝。
- 本轮不生成或替换安装包。Ubuntu / Android 物理设备、跨设备网络及公网反代部署不属于本轮已通过的原生结果；现有 0.9.7 桌面包没有中央服务器原生桥。
