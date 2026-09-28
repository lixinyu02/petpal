# 电脑音乐助手

Windows 与 Ubuntu 桌面包内置 Codex CLI 0.143.0、OpenCLI 1.8.8 和所需 Node 运行环境，无须另装 npm。Android 继续使用 0.4，本次没有新 APK。桌面包只带控制工具，不带 QQ 音乐/网易云音乐客户端、Chrome 或服务商账户。

## 配置 Codex API

1. 以主机管理员身份打开「连接与设置 → 电脑助手」。
2. 选择「配置 Responses API」，填写服务地址、服务商模型 ID 和 API Key，保存。
3. 回到 Codex 工作台，新建对话，例如「查看 QQ 音乐现在是否可以控制」「暂停网易云音乐」。
4. 核对具体播放器及操作的确认卡，再允许本次操作。

保存配置不会调用模型。需要兼容 Responses 工具调用的服务；普通 Chat Completions 接口不能直接用于 Codex。真实模型费用按所填服务商计费。API 模式关闭 shell/exec，内置文件工具保持只读限制，音乐和网页动作通过具名工具审批执行；原有本机登录模式保留。设置更改后，旧对话仍可查看，须新建 Codex 对话使用新连接。默认服务地址要求 HTTPS，仅本机 localhost、127.0.0.1 或 ::1 可直接使用 HTTP。

API 密钥只由后端保存，页面仅显示是否配置。密钥在个人数据目录中为明文，继承本机账户文件权限；不要分享数据目录。API 模式使用 PetPal 独立的 Codex 配置与工作区，不改写全局 Codex 配置。留空密钥保留原值；换服务地址时必须重填或明确清除。

0.6 在 API 模式增加本机 Responses 流适配，兼容缺少 item / content-part 起止事件、但有真实文本增量和完整最终输出的网关。CLI 仅拿到随机的回环令牌，上游密钥由后端使用。完整标准事件不会重复；无法确认工具身份、空回复和残缺响应会明确报错。仅处理 SSE，不把普通 Chat Completions 自动改成 Responses。单次请求限制为 4 MiB，请求总时限 180 秒、空闲 30 秒，响应上限 24 MiB。

### Windows 便携版与源码后台

`PetPal-<版本>-Windows-x64.exe` 是便携版，双击运行，无安装向导，无需单独安装 Node、Codex 或 OpenCLI。它会自动启动监听本机随机端口的后端，关闭主窗口默认收起到托盘；在托盘选择退出才会关闭桌面后台。个人数据保存在 `%APPDATA%\petpal\data`，更换 EXE 不会将配置带给其他电脑。

单独运行源码服务时，先安装依赖并执行 `npm run build`，然后在项目目录运行 `powershell -ExecutionPolicy Bypass -File scripts/Start-PetPal-Service.ps1`。脚本在隐藏窗口启动后台、确认健康状态并返回本机地址，默认 `http://127.0.0.1:4318`。配对令牌在 `.data/token`；进程回执和私有日志在 `.data`，不能公开。占用端口会报错，不会结束已有进程。它不注册系统服务或开机启动。

源码启动器可读取私有 `.data/service-settings.json`，例如 `{"port":4318,"codexHttpOrigins":"http://gateway.example:8080"}`。该文件与下面桌面端的部署文件位置不同；源码服务的聊天和 Codex 配置也独立保存。

### 部署者指定的 HTTP 网关

0.6 源码服务支持部署时明确允许特定 HTTP origin。该例外不是 0.5 旧安装包的功能；启动环境设置 `PETPAL_CODEX_HTTP_ORIGINS` 后，再使用现有「配置 Responses API」页面填写完整 API 地址和密钥。下面只使用保留的示例域名：

```powershell
$env:PETPAL_CODEX_HTTP_ORIGINS = 'http://gateway.example:8080'
npm start
```

Linux shell 可使用 `PETPAL_CODEX_HTTP_ORIGINS='http://gateway.example:8080' npm start`。桌面源码启动也可在设置同一环境变量后运行 `npm run desktop`。实际部署应在自己的私有启动配置中填写已确认的来源；不要把网关凭据加入源码或环境变量示例。

多个 origin 用逗号分隔，例如 `http://gateway.example:8080,http://models.example:8081`。每项仅允许 `http://主机[:端口]`，不可包含结尾斜杠、API 路径、查询、片段、用户名密码或通配符。主机名大小写与默认 HTTP 80 端口由 URL 规范化；子域名、其他主机和其他端口均不匹配。例外允许该来源下的 API 路径，例如 `http://gateway.example:8080/v1`，不把 HTTP 变成 HTTPS，也不为传输提供加密。

服务启动时捕获允许名单，在读取已保存配置和处理后续 PATCH 时使用同一集合。账号、设置 API 和页面都不能修改该名单；运行中改变环境变量也不会改变既有服务策略。重启仍需提供相同例外，否则保存的外部 HTTP 地址会被拒绝加载，服务不会自动扩大许可或改写地址。嵌入服务的开发者可用 `createPetServer({codexHttpOrigins:'http://gateway.example:8080'})` 显式传入同格式字符串；空字符串明确关闭外部 HTTP 例外。

### 桌面端直接双击启动

0.6 桌面源码支持可选的本机 `service-settings.json`，用于让新的 Windows / Ubuntu 桌面包在直接启动时保留 HTTP 例外；0.5 旧包不会读取它。文件位置固定为 Electron 用户目录：Windows 是 `%APPDATA%\petpal\service-settings.json`，Ubuntu 通常是 `~/.config/petpal/service-settings.json`（设置 `XDG_CONFIG_HOME` 时使用对应配置目录）。它位于 `data` 的同级目录，不能放进源码、EXE 或发布包。

文件使用 UTF-8 JSON（兼容 BOM），最多 64 KiB，只允许一个 `codexHttpOrigins` 字符串字段。例如：

```json
{"codexHttpOrigins":"http://gateway.example:8080"}
```

启动优先级是：进程明确设置的 `PETPAL_CODEX_HTTP_ORIGINS`（包括空字符串）覆盖文件；没有设置环境变量时读取文件；文件不存在则关闭外部 HTTP 例外。空字符串可用于明确关闭例外。错误的 JSON、额外字段、不可读取的文件或非法 origin 会阻止启动，并显示文件位置和修正提示；不会忽略错误而放宽策略。修改后须从托盘完全退出，再重新启动应用。

这个文件不保存 API Key、模型 ID、完整 API 路径或其他设置。服务地址、模型和密钥仍通过「电脑助手」保存到个人 `data` 目录；桌面 `data` 与源码服务的 `.data` 独立。不要复制整个源码服务状态到桌面目录，也不要把个人配置文件随软件分发。

### CLIProxyAPI 网关

0.6 可直接连接 CLIProxyAPI 的 Responses 端点。`management.html#/login` 是管理页面；模型连接应填写 API Base URL，例如 `http://gateway.example:8317/v1`。使用「API 密钥列表（api-keys）」中的客户端密钥，不使用管理登录密码或上游 OAuth 凭证。

先带客户端鉴权查询 `/v1/models`，选择该网关实际提供的文本模型，再分别配置普通聊天的 `Responses` 连接和「电脑助手」的 Codex API。网关公布模型名称不等于当前上游可用，须以非空实际回复确认。切换 Codex 后新建工作对话；原历史仍可查看。

HTTP 部署须先把新 origin 追加至允许名单，再重启服务并保存新连接。在旧配置尚未切换时不要删除原 origin，否则启动验证会拒绝旧配置。源码服务和桌面版分别保存自己的连接；普通聊天默认模型也分别设置。切换前备份私人连接配置，不把密钥放进文档或发布包。

## 音乐客户端

在「音乐播放器」区域刷新状态，已安装的客户端可点击打开。先在播放器里选一首歌，之后能否播放、暂停、上一首、下一首，取决于播放器公开的系统媒体能力。

| 平台 | 控制方式 | 必要条件 |
| --- | --- | --- |
| Windows | GSMTC，按播放器身份选择会话 | 播放器提供系统媒体会话；存在多个同类会话时先关闭多余实例 |
| Ubuntu | 当前桌面用户的 MPRIS / D-Bus | 已登录图形桌面、安装 gdbus，播放器提供 MPRIS；无头服务器不等于桌面会话 |

不使用全局媒体快捷键，以免误操作其他软件。状态可区分「已安装」与「有媒体会话」，没有会话时不能把操作当成功。系统媒体接口没有通用曲库搜索功能，也无法绕过会员、地区或播放权限。

## OpenCLI 音乐网页

内置的是 [@jackwener/opencli](https://www.npmjs.com/package/@jackwener/opencli) 官方 1.8.8，Apache-2.0。它当前没有 QQ 音乐或网易云音乐专用命令；PetPal 利用其真实浏览器桥协议和页面方法提供受限网页工具。

1. 通过设置页的官方链接，在 Chrome/Chromium 安装并启用 Browser Bridge 扩展（1.0.24 或更新的 1.x 版本）。
2. 点击连接，显式选择扩展报告的浏览器配置。需要账号时由你在音乐网站完成登录。
3. 从 PetPal 打开 QQ 音乐或网易云音乐官网，再让 Codex 读取页面、定位搜索框及操作控件。网页能力与桌面播放器能力分开显示。
4. 「断开浏览器」会尝试关闭本次租约下的页面并断开连接；共享的浏览器桥继续运行。关闭失败时会提示，不应当作所有页面均已关闭。

工具只接收固定动作，不接受任意命令、脚本、上传或插件安装。每个音乐页使用独立的随机 PetPal 租约、明确选择的 Chrome 配置及记录的页面身份；不会绑定或操作其他任务仍在使用的标签。OpenCLI 可能复用其分组内没有活跃租约的空闲页，所以「打开官网」不保证总是创建一个全新 Chrome 标签。仅允许 `https://y.qq.com` 和 `https://music.163.com`，使用最近快照内的数字控件编号；编号 60 秒后或操作后失效，须重新读取快照。不读取浏览器密码文件。

状态刷新不会启动浏览器桥。明确点击连接时，空闲端口会启动由小伴管理的官方 daemon；已有同版本 1.8.8 daemon 时共享连接，固定其进程身份，并且只管理 PetPal 的页面租约。其他版本或未知进程占用 19825 端口时拒绝连接，不自动结束、重启或升级它们。关闭共享连接不会终止其他任务的 daemon。本机无需独立安装 Node；CLI 及 daemon 使用桌面包的 Electron Node 模式，配置与缓存存放在小伴独立目录。

网页操作仍会受到登录、验证码、页面变化和浏览器自动播放策略限制。操作前后及内部页面脚本会检查来源；这些检查不是网络沙箱，网页自身可能在两次检查间导航或打开新窗口。跳出允许来源后，小伴撤销对此页的操作。页面文字和脚本仍属于网站内容，不代表可信指令。遇到登录或支付等流程应交给你处理。停止请求不能撤销已经发生的点击或媒体动作，超时或断连也不代表未执行；小伴不会自动重试，应先刷新状态再决定下一步。

## 验证范围

版本验收见 `docs/acceptance-0.5.md`。包内文件及协议测试、实际 Windows 启动、真实音乐播放、真实 API 服务和 Ubuntu 桌面运行是不同的验证层；以回执标明的结果为准。
