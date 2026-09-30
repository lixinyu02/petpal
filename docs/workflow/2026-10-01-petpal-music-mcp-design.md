# 桌面音乐 MCP 适配

- Date: 2026-10-01
- Complexity: L2
- Status: done; web/backend deployed, client packages deferred

## Background and goal

用户指定 `Seraph310/cloudmusic-desktop-mcp` 与 `Sina5byg5L2z/mcp-qqmusic`，希望接入Windows/Ubuntu客户端，并供Chat派发的Agent在所选执行电脑使用。

## Source findings

网易云固定源commit `a61a611bf1284d9663df2742ec83f8769403465d`，Python>=3.11/FastMCP stdio，控制Windows官方桌面客户端，依赖CDP启动参数和内部webpack接口。Ubuntu不具备该上游控制路径，沿用现有MPRIS，并明确功能限制。QQ固定源commit `84f34a92cd44821cd44b5aaf59aa0889b4685e6d`，Python>=3.10/FastMCP stdio、qqmusic-api-python；搜索、详情、歌词、推荐、排行榜、播放地址，不提供桌面播放/暂停/切歌接口。不能把返回链接描述成实际开始播放。

## Solution

本机MCP管理器使用固定的两项目入口，stdio initialize/notifications/initialized/tools/list/tools/call，限制可调用音乐工具；状态读取不启动客户端。运行环境与QQ凭据保存于本机私人目录，不继承LLM/API/中央账号密钥。Python运行时和依赖必须确认可用，缺失显示准备步骤，不由Agent执行任意命令或改配置。

共用具名桌面动态工具提供能力清单和音乐调用，接入既有完全访问/询问/自动运行权限、停止和错误回传。所选PC的远程执行器读取同PC配置，不能落到中央服务器或另一账号机器。本机设置允许登录客户端管理；Web后端只允许owner管理其服务主机，普通账号不能借配置接口执行程序。

准备固定源码与许可、依赖安装入口，更新Windows/Ubuntu打包边界。UI用独立折叠区提供启用、运行环境、连接测试、工具列表和来源文档；不增加首页工具拥挤。默认关闭，连接测试不播放。QQ返回链接提供给对话，现有QQ桌面媒体控制独立保留。

依赖准备以有界 JSON 锁记录 PID、事务 nonce、scope/player 和阶段，只在原进程确凿不存在时处理已知死锁。准备中断时还原固定 previous，绝不提升未验证 staging；未知锁或资产矛盾保留并提示具体备份路径。取消返回最终状态前重新检查登录和权限。

## Verification

真实上游stdio工具发现/只读调用、参数和未知工具拒绝、取消/超时/退出、配置CAS/身份隔离/凭据不回显、执行器本机配置、既有Codex审批回归、TypeScript/独立构建及Chrome412×960。真实歌曲播放与Ubuntu桌面控制需要相应客户端和图形会话，未得到实际证据不得标为完成。本轮先源码与接口，不复用旧安装包作新能力证据。

最终全套 1035/1035、manager 37/37、原生 Windows 源码启动、真实 QQ 查询和公网权限验收通过。详见 [acceptance](2026-10-01-petpal-music-mcp-acceptance.md)。
