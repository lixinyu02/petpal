# 默认伙伴与远程 PC 验收

日期：2026-09-30。范围：issue-52 / issue-53 / issue-54。

## 默认形象

3D 小猫改为“小伴个性”中的本设备开关，默认关闭。开关按服务与账号隔离，不覆盖原服务器、legacy 或尚未同步的角色偏好；关闭时有效显示二次元，开启后可在首页切换。浮窗使用 v2 有效显示记录，普通旧查询不能恢复未启用的小猫。Android 沿用既有受限原生资产 URL，并仅同步已运行的猫浮窗；本轮未取得 Android 实机浮窗证据。

20 项偏好、门禁、隔离与挂载回归通过；Chrome 实际开启、切猫、关闭和恢复二次元通过。默认页面未请求 PetScene，人物渲染完成且仅一个 canvas。

原生回归进一步发现，角色开关隐藏后 Grid 自动排位会让人物画布落到零高的 auto 行，已为内容指定固定行位并保留短横屏布局。Android 关闭猫后的异步同步改由稳定 SessionRoot 负责，离开设置页不会取消；状态返回时仍检查最新开关、账号和生命周期，只同步已运行的猫浮窗。新增 6 项真实组件 effect 的延迟/反转/账号/卸载/平台回归，与既有回归合计 27 项及 TypeScript 通过；Android 仍未实机验收。

## 执行电脑入口

Agent、Chat + Agent 与首页语音复用可搜索的执行电脑菜单。分组为此电脑、在线电脑、中央服务器、离线或未连接；“此电脑”仅由可信原生 hostId 精确匹配，同名电脑显示短标识。列表不会把连接状态等同于模型执行成功，也不因主机默认模型未配置而禁止选择账号已分配模型。

16 项主机菜单、偏好与 Chat 快照回归通过；另有 39 项原生执行器、多电脑派发、重连、隔离及 relay 定向回归通过，两批有 10 项重合。Chrome 1280×800、412×960、412×560 验证搜索刷新保留关键词、重开清空关键词、执行期间不可切换、离线目标不回退、Chat 弹层焦点与 Escape 正常。模拟 Windows / Ubuntu 仅用于界面验收，不计为真实 PC 执行。

## 网页发布

TypeScript 与独立 Vite 构建通过。30 个文件已复制并逐项读回，HTML 最后原子替换并保留回退文件；公网域名取得的 30 个文件 SHA-256 与构建一致。本机及 `https://magicdatou.top:44318` 健康返回 200，匿名 state 返回 401。

后端未重启，4318 监听 PID 205864 保持。旧懒加载资源、旧 PNG 和 Windows 0.9.1 EXE/ZIP 下载文件均保留，下载文件的长度、修改时间与 SHA-256 不变。新 UI 已进入网页和当前源码，既有原生安装包本轮尚未重新制作。

后续验收曾误用默认 Vite 输出刷新在线 dist；已从冻结构建恢复 136 个旧静态资源及旧 PNG、两个 Windows 下载文件，恢复下载文件的长度、修改时间和 SHA-256 与原回执一致。最终构建位于独立 build-verified-final，按不删除旧资源、HTML 最后原子替换的方式重新发布，30 个文件本机读回及公网全文 SHA-256 一致。最终 Chrome 412×960 默认二次元画布为 379×622.8125，无横向溢出；证据见 static-retention-recovery.json、static-retention-older-assets.json、deployment-20260930T124926Z-6eb5390e.json 与 public-final-static-verification.json。

## CLIProxyAPI HTTPS

用户启用了 `https://192.168.60.230:8317`，服务的受信 Let's Encrypt 证书 SAN 为 `magicdatou.top`，直接使用 IP 会得到 ERR_TLS_CERT_ALTNAME_INVALID。实际接入改为 `https://magicdatou.top:8317/v1`，保留正常 CA 与主机名校验，不关闭 TLS 校验。

models 鉴权 200，并确认既有 Luna、Sol、6.1 Sol 和 Qwen Agent 模型均在列表。实际 6.1 Sol Responses 请求取得 5 个文本 delta 和预期回复。经既有配置 API 更新四个原 provider ID 与 Codex 地址；默认 `gpt-6-luna` / max、密钥、账号模型分配、其他 Halogen 服务与用户偏好均保持。配置 revision 正常更新，四个 Agent provider 仍可用。私有脱敏回执为 cliproxy-https-applied.json。

## 真实 Windows 远程执行

使用冻结的 Windows 0.9.1 ZIP 实际 PetPal.exe，位于中文/空格目录，全新隔离 profile、数据/日志/workspace，真实原生主窗口通过公网服务注册并保持超过两轮心跳。最终 hostId 为 9583942d-d81a-42fd-9993-932452e0d607；同账号选择该主机，使用已分配的 6.1 Sol，通过迁移后的 HTTPS 模型入口完成只读任务。

实际发布包主进程 PID 186276 派生了 app.asar.unpacked 内的 bundled codex.exe PID 239556（Codex 0.143.0）。私有 CLI trace 恰好一次 `[Environment]::OSVersion.Platform.ToString()`，实际工具输出 Win32NT、退出码 0；终态 run 为 completed，不能仅用模型回复标记替代。权限保持 read-only / ask，仅对提前核实的固定 PowerShell wrapper 批准一次。其他参数/命令/文件/网络/提权均不在验收授权范围内。

早期 harness 对额外 shell 参数、省略的默认 sandbox_permissions 及实际 PowerShell wrapper 格式过严，已拒绝并保留那些失败任务，没有重放；最终使用新会话严格核实。测试结束后执行器离线、成功测试会话删除、自身登录注销、主进程及派生进程 CIM 消失均通过；未修改原 EXE/asar，长度和哈希仍与发布前一致。最终回执 acceptance-1790773287500.json，Chrome 的 public-pc-online-verified.jpg 与 public-pc-online-https-verified.jpg 为真实在线证据；旧 public-pc-online.jpg 实际离线，不计入在线证据。

另用当前源码 Electron 完整 smoke 成功自然退出 0：猫开关全矩阵、两窗 v2 display 同步与 reload、两角色真实手势、五种 Chat 表情、真实系统语音事件驱动口型、手动朗读、休眠静音、停止不重启及隐藏取消均通过。对应透明浮窗角像素 alpha=0、源码 SHA 与回执匹配、无所属残留进程；source-native-appprobe-20260930-205833-a9c6825e/receipt/result.json。Chat 内容为验收 fixture，该测试不等于真实模型调用或音频听感验收；真实模型/CLI 执行由前述发布包单独证实。

## 使用方式与验证边界

Windows 0.9.1 推荐下载 ZIP，完整解压后运行 `PetPal.exe`，无需另外安装 Node、Git、Codex CLI 或 OpenCLI。桌面端连接 `https://magicdatou.top:44318`，登录有 Agent 权限的账号并保持客户端运行；Web / Android 登录同一账号后，在执行电脑菜单选择这台电脑。

连接由桌面端主动发起认证 HTTPS 长轮询，心跳间隔为 10 秒，连接租约为 30 秒；不需要开放 PC 入站端口或将其调试端口暴露公网。客户端退出、断网或退出登录后会转为离线，网页保留此前选择，不自动换到中央服务器。

本轮真实运行环境为本机 Windows 11 经公网域名连接，不能等同于另一 ISP 外网实测；Ubuntu、Android 本轮未做实机验收。既有 Windows 安装包的远程执行链路与本轮新网页菜单分别验收，新的 UI 与默认猫开关尚未进入旧包。

## 私有验收材料

材料保存在忽略的 `evidence/remote-pc-20260930/`：浏览器截图、部署/公网 SHA-256 回执、真实包运行 profile 与脱敏任务回执。账号密码、登录令牌、CLI 私有运行记录和个人配置不进入公开源码。
