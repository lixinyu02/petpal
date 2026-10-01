# PetPal 0.9.4 桌面控制默认启用验收

日期：2026-10-01。范围：issue-64，Windows / Ubuntu 桌面预发布，网页与现有个人服务同步更新。Android 仍为 0.9.3 / versionCode 13。

## 行为

- 支持的 Windows / Linux / macOS x64、ARM64 首次创建 Computer Use 配置时启用，默认工具集仍为 `full`。
- Windows 新音乐配置启用网易云和 QQ MCP；Ubuntu 启用 QQ MCP，网易云桌面 MCP 仍为上游 Windows 专用，Ubuntu 播放控制沿用 MPRIS。
- 已保存的关闭、工具集、Python / 播放器路径、CDP 端口与配置版本不被覆盖。当前部署服务主机按本次请求单独启用三个开关。
- 读取配置与状态不会连接工具或操作电脑；Agent 实际调用时自动连接。完整访问、账号归属与询问 / 自动运行机制沿用原有检查。
- 音乐 MCP 首次使用仍需 Python 与“准备依赖”。QQ MCP 提供查询和播放链接，实际桌面控制由系统媒体工具或 Computer Use 执行。

## 验证证据

| 范围 | 结果 |
| --- | --- |
| 相关 manager、HTTP / native 桥、Agent 集成回归 | 11 个测试文件，184/184 通过；含新默认、旧关闭保留、只读无启动、lazy 连接、CAS、账号与审批边界 |
| 网页 | TypeScript 与 Vite 生产构建通过；30 文件部署回读，保留旧 assets 与 downloads，HTML 最后原子替换 |
| 当前服务主机 | 0.9.4 本地及可信 HTTPS 健康检查通过；真实 MCP 初始化 / 工具发现：Computer Use 70、网易云 14、QQ 9 |
| 数据保存 | 重启前无运行任务或审批、无 MCP 操作；用户、对话、暂停队列、服务设置、通知事件及设备保留。通知 run baseline 按既有启动逻辑重排，集合未变，无其他差异 |
| Chrome | Chrome 3 插件实测 HTTPS 管理员设置；三个启用状态、按任务连接文案正确；412×960 无横向溢出 |
| Windows EXE | 隔离用户目录、系统 PATH、中文与空格路径实际启动通过；窗口、登录门禁、UI / WebGL、远程执行电脑在线登记、音乐桥通过；0 个测试进程遗留 |
| Windows 内容 | 最终 EXE 双层解包，4,785 文件回读匹配，含 30 个 Web 文件、最新两个 manager、音乐 vendor、Codex 0.143.0、OpenCLI 1.8.8、MCP SDK、Zavora 7.4.0 Windows x64 native |
| Windows 默认与 native | 最终 EXE 解出的 manager 首次及重读三个开关为 true；真实 Computer Use stdio 发现 70 工具 |
| Ubuntu 内容 | x64 / ARM64 各 12,523 归档成员、11,106 实际文件，全内容哈希对 stage 匹配；源码与稳定 Web 比较、音乐 vendor provenance、依赖闭包与包内 manager 导入通过 |
| Ubuntu native | ELF 架构为 x64 / ARM64，glibc 要求 2.34，符合 Ubuntu 22.04 基线；无 Windows native、生产 downloads 或私有数据 |

本轮真实运行验收仅做初始化、工具发现与启动，不执行歌曲播放、桌面动作或付费模型请求。Ubuntu 是跨平台构建及内容审计，未运行 Ubuntu 图形桌面；Windows 尚未覆盖 Windows 10 新装机器与各家安全软件。Windows 包未商业签名。Windows asar header 保留五条已排除平台 native 的 unpacked 索引，实际文件均不存在，不影响已验收的 Windows 启动。

本轮没有重复全仓 Node 测试，不宣称全仓全绿。上轮全量中已有的 Codex 取消关闭偶发失败不在此次默认值改动范围。

详细日志、发布校验和运行回执保存在本机 ignored `evidence/desktop-controls-defaults-20261001/`；私有账号与配置备份保存在 `.data/desktop-controls-defaults-20261001/`，均不上传到公开仓库或发行资产。

## 发行文件

v0.9.4 为桌面预发布，保留稳定 latest v0.9.1；下载页按真实 GitHub Releases 显示。没有为旧客户端自动替换内置执行器，也没有更新签名的稳定更新清单。

| 文件 | Bytes | SHA-256 |
| --- | ---: | --- |
| PetPal-0.9.4-Windows-x64.exe | 200416350 | `1afc79415ead5420eb092ddcb0c0901236a4317058b2e0d023470337bad6098f` |
| PetPal-0.9.4-Windows-x64.zip | 332386339 | `01d536e2cd7ea5dbc00d241f4a0d89f0baa017300fe5a78dc206a9e33cb173c3` |
| PetPal-0.9.4-Ubuntu-x64.tar.gz | 303027535 | `f15d64a97b32e59c64b9e90e38b5337480bd04df290cedb8f517e0d799e37870` |
| PetPal-0.9.4-Ubuntu-arm64.tar.gz | 297211794 | `9ff214ac2ae64881e2a622b1804f32554757538e5dfa5f6e0d9e2bbe1c5aad36` |
