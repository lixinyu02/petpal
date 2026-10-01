# 音乐 MCP 使用说明

小伴的 Windows／Ubuntu 客户端提供两个固定来源的音乐 MCP。Agent 和 Chat 派发的后台 Agent 都在所选执行电脑调用；电脑需要保持客户端登录、在线，并给当前账号开通完整 Agent 权限。

0.9.4 预发布桌面包已包含 Computer Use 与音乐 MCP 的原生设置桥。Windows 新配置默认开启电脑控制、网易云 MCP、QQ MCP；Ubuntu 新配置默认开启电脑控制与 QQ MCP，网易云播放控制使用 MPRIS，网易云 MCP 保持不可用。已有手动关闭状态、程序路径和其他配置原样保留；默认启用不会替你改变账号权限、任务访问范围或审批方式，也不会安装依赖、打开应用。

| 能力 | Windows | Ubuntu |
| --- | --- | --- |
| 网易云搜索、播放指定歌曲、队列、循环、音量、桌面歌词 | cloudmusic-desktop-mcp，需官方 Windows 网易云客户端及兼容的 CDP 接口 | 此上游不支持 Linux |
| 指定播放器播放／暂停／上一首／下一首 | Windows 系统媒体会话 | MPRIS，需播放器公开媒体会话及图形会话 |
| QQ 搜索、详情、歌词、推荐、排行榜、播放地址 | mcp-qqmusic | mcp-qqmusic |

QQ MCP 返回播放链接，不能据此宣称桌面客户端已经播放。QQ 桌面播放控制由独立的系统媒体工具提供；不能根据一个链接直接选中 QQ 桌面中的歌曲。

## 设置

1. 在准备执行任务的 PC 客户端登录，确认“执行电脑”状态在线。
2. 打开“连接与设置 → 电脑助手 → 音乐 MCP”。PC 中配置的是这台电脑；网页中主账号配置的是后端服务主机。
3. 安装 Python，包含 pip。网易云要求 Python 3.11 以上，QQ 要求 3.10 以上；小伴目前未内置 Python。若自动查找不到，在折叠的“Python 运行环境”填写本机 Python 程序的绝对路径。
4. 查看本机支持的 MCP 已启用；升级后若保留此前手动关闭状态，可按需开启并保存。Windows 网易云可以填写 `cloudmusic.exe` 的绝对路径；留空会查找常见安装位置。
5. 点击“准备依赖”。首次准备会从固定 PyPI 源下载依赖，最多等待十分钟，可随时取消。只有完整安装并验证后才替换原依赖；失败保留旧集。依赖准备好后 Agent 首次调用自动连接，也可先点击“测试连接”检查工具发现。

“测试连接”执行真实 MCP 初始化和工具发现，不打开音乐软件、不播放歌曲。若需要队列等网易云控制，Agent 的 `launch_netease_music` 会请求使用本机回环 CDP 端口启动官方客户端；已经运行但没有 CDP 的客户端需要用户自行关闭后再启动。CDP 可达也不保证客户端内部接口与上游兼容，失败必须以实际返回结果为准。

网易云上游报告实测版本为 `3.1.24.204791`，其他版本的内部接口需要单独验证，不能仅凭工具清单确认高级控制可用。

新工具版本需要新建 Agent 对话。已有历史记录保留；旧 Agent 对话不会自动换入新工具集。选择“完整访问”后，询问模式会显示工具名与参数的确认卡，自动运行模式按现有账号权限执行。

依赖安装中断后，再次准备或连接会检查固定事务锁：只有确认原进程已退出才恢复旧依赖；不会把安装了一半的目录用于运行，也不会重试播放。仍在运行、无法确认退出的进程或复用的 PID 都保持锁。遇到旧版空锁、损坏锁或目录矛盾时，按错误中的具体路径停止该电脑所有小伴进程、将锁改名备份，保留 `dependencies.*.previous`、`credential.json` 与 `login.py` 后再恢复；不要清空整个数据目录。

## QQ 可选登录

匿名查询可以使用搜索等部分功能。播放地址或账号相关能力可能要求 QQ 登录、会员或上游权限。

小伴不收集 QQ 密码。准备依赖后，固定上游 `login.py` 会复制到该账号的本机私人目录，设置页会显示目录。使用已配置的 Python，先通过 `site.addsitedir` 加载该目录下的 `dependencies`，再运行同目录的 `login.py`，按上游流程自行扫码。不要直接从源码 vendor 目录运行登录脚本。

Windows PowerShell 示例（将路径换成设置页显示的本机路径）：

```powershell
$musicPython = 'C:\Python311\python.exe'
$musicLogin = 'D:\PetPalPrivate\music-mcp\ACCOUNT_SCOPE\qqmusic'
& $musicPython -S -u -c 'import runpy,site,sys; site.addsitedir(sys.argv[1]); runpy.run_path(sys.argv[2],run_name="__main__")' (Join-Path $musicLogin 'dependencies') (Join-Path $musicLogin 'login.py')
```

Ubuntu 也使用相同的 Python bootstrap，依赖与 `login.py` 路径取自设置页。上游会在脚本所在目录保存 `credential.json`。每个服务账号的登录目录独立，接口仅返回是否存在凭据，不返回内容。凭据、二维码和运行环境均不进入源码或发布包。

## 工具范围和来源

- [网易云来源](https://github.com/Seraph310/cloudmusic-desktop-mcp)，固定 commit `a61a611bf1284d9663df2742ec83f8769403465d`：原始 16 项工具中开放 14 项。`control_netease` 和 `send_netease_shortcut` 的全局按键路径被排除；切歌与暂停继续使用指定播放器的系统媒体会话。
- [QQ 来源](https://github.com/Sina5byg5L2z/mcp-qqmusic)，固定 commit `84f34a92cd44821cd44b5aaf59aa0889b4685e6d`：实际 9 项工具。排行榜使用 `detail(type="top", id="...")`，没有名为 `top` 的独立工具。
- 两者均为 MIT 许可，原始源码、许可及逐文件来源哈希保存在 `server/native/music-mcp/`。

示例请求：“在这台电脑的网易云搜周杰伦，播放搜索到的晴天”“把网易云改为单曲循环”“查询 QQ 音乐晴天的歌词和播放链接”。歌曲可用性、会员限制与桌面控制兼容性以客户端和 MCP 的真实结果为准。

新版下载：[Windows 0.9.4 x64 ZIP](https://github.com/lixinyu02/petpal/releases/download/v0.9.4/PetPal-0.9.4-Windows-x64.zip)／[便携 EXE](https://github.com/lixinyu02/petpal/releases/download/v0.9.4/PetPal-0.9.4-Windows-x64.exe)、[Ubuntu 0.9.4 x64](https://github.com/lixinyu02/petpal/releases/download/v0.9.4/PetPal-0.9.4-Ubuntu-x64.tar.gz)／[arm64](https://github.com/lixinyu02/petpal/releases/download/v0.9.4/PetPal-0.9.4-Ubuntu-arm64.tar.gz)。这些包为 [0.9.4 预发布版](https://github.com/lixinyu02/petpal/releases/tag/v0.9.4)，Android 保持 0.9.3。旧 Windows／Ubuntu 安装包不会随网页更新自动获得原生 MCP 设置桥；Web 与 Android 可以派发到安装新版并登录在线的 PC。

相关回归 184／184 通过。Windows 最终便携 EXE 已实际启动并完成 Computer Use 70 项工具发现；该结果不代表所有音乐客户端版本或全部桌面控制动作已验收。Ubuntu 两架构新包通过完整归档与 ELF 审计，尚未在实体电脑进行 GUI 验收。歌曲搜索、播放、会员限制和播放器媒体会话仍需以目标电脑实际返回结果为准。
