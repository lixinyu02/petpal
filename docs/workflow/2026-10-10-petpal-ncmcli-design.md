# 网易云官方 CLI 技能接入

- Date: 2026-10-10
- Complexity: L2
- Status: final

## Background

用户希望小伴内置Agent适配官方ncmcli，注册、API申请、配置凭据与扫码由用户操作。Chrome安全策略禁止访问提供的网页，未尝试绕过；以npm公开包README和NetEase/skills官方GitHub作为替代文档来源。

## Goal

Windows/Ubuntu执行电脑随包提供受控CLI入口与自动发现的中文技能。官方CLI是独立可选运行时，由用户在该电脑安装；Web/安卓通过所选执行电脑使用同一技能。CLI账号资料在该电脑按小伴账号隔离、切模型保持。提供实际可调用的状态、命令和用户向导准备入口。

## Non-goals

不代用户申请开放平台、输入私钥或扫码授权；不改变现有桌面MCP、播放器或系统权限；本轮不发布或重打安装包，不写宿主Codex全局技能目录。

## Solution

### CLI与来源

核实`@music163/ncm-cli@0.1.7`的版本、包元数据、README和实际运行。其manifest引入已知漏洞的旧build链和image-size 1.x，故不加入小伴production dependency、不把混淆dist当自包含、不盲目override或audit fix。准备入口生成固定版本的用户安装脚本，使用账号目录的独立runtime prefix且禁用lifecycle脚本；也识别经过元数据校验的官方全局安装。脚本执行、开放平台申请及登录由用户完成。独立安装仍有上游依赖风险，保留来源和边界。mpv为官方本地播放依赖，缺失时报告并指导用户安装；返回链接不代表播放成功。

### 账号与执行

新增NcmCliManager，沿用desktop-tools的当前conversation账号scope和所选执行电脑。稳定目录`dataDir/ncmcli/<scope hash>/profile`作为CLI的HOME/USERPROFILE/XDG配置目录，与Codex revision无关。固定包内入口、Node/Electron-as-Node，spawn argv数组且shell=false，不继承上游密钥或宿主音乐环境。目录私有，输出有界、超时/取消清理进程，敏感字段脱敏。

### 工具与用户操作

状态只检查包、已知配置文件与mpv存在，不主动登录/续期。命令工具调用官方CLI，通过既有完全访问与审批门禁；配置、扫码登录和诊断上报不在自动命令入口执行。准备向导只生成本机安装/配置/登录启动文件，用户在所选执行电脑亲自运行，完成协议、注册、API申请和扫码。登录检查属于可能续期的命令，不能称为纯读。

### 技能发现与打包

官方0.1.7的Windows播放器使用固定`ncm-daemon`/`ncm-mpv`命名管道，另有按进程名终止mpv的legacy路径；HOME隔离不证明播控隔离。当前工具只开放版本、帮助、命令树、search、playlist及明确的login --check，不开放play/pause/resume/stop/next/prev/seek/volume/queue/state；本机播放继续现有MCP/媒体工具。禁止借help入口分派其他真实命令，也不使用shell绕过。

中文`petpal-ncmcli`技能放server/native/skills，并在API Codex私有CODEX_HOME/skills中物化；仅让Agent调用新动态工具，不直接绕过账号路由。修改音乐提示明确区分官方云CLI与网易云桌面MCP。host模式保持宿主技能，仍可依据动态工具说明使用CLI。Windows使用既有server/**解包；Linux补源清单与逐文件验收；不打包CLI、账号私钥或可选安装目录。旧安装包需更新才能得到新技能入口。

## Risks

官方命令会动态加载，必须先help/commands发现参数；未配置时不伪造在线结果。官方包混淆且未附MIT全文，保留原元数据及来源，不擅写其版权声明。账号目录和退出会话取消不得泄露/串用凭据。物化只覆盖本项目拥有的技能文件，禁止递归删除其他技能。

## Verification Plan

真实包version/help与未配置提示、官方技能来源/前言验证、实际Codex skills/list发现；两账号与跨revision隔离；参数校验、输出上限/脱敏、取消/超时、权限与工具路由；Linux/Windows清单和轻量归档验证；相关回归、tsc、保留15下载文件的网页构建。未获用户配置前不宣称已登录、在线搜索或mpv播放通过。
