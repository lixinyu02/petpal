# Agent 项目目录

- Date: 2026-10-01
- Complexity: L2
- Status: final

## Background

Agent 固定使用私有 runtime workspace。constructor 配置不能改变 API mode 实际工作目录；中央共享 bridge 也不能通过修改全局 workspaceRoot 支持多人项目。旧桌面客户端严格拒绝未知执行字段。

## Goal

Agent 与 Chat + Agent 均可指定所选电脑上的现有项目目录。设置参与提交、排队、追加引导与重试快照，实际 Codex cwd 和工作区写权限使用同一真实目录。

## Non-goals

不自动创建项目、不提供远程文件系统浏览、不替换 CODEX_HOME、不放宽现有账号授权、不触及 RK3566 工程。当前轮先更新源码、网页与后端，现有客户端下载保持，桌面新能力需重新打包才能安装使用。

## Solution

请求使用可选 projectDirectory（绝对路径，空或缺省为原默认工作区）；依据目标平台做有界语法校验，不展开环境变量或 shell。任务、队列、Chat 协作回执保存目录快照；指纹包含目录，旧缺省指纹保持。运行中的 steer 继承目录并拒绝更改。切电脑或切目录启动新 native thread，以既有有界文本保留上下文；旧未标记目录线程只在默认目录下续接。

执行端在开始前 realpath/stat 校验现有目录，不创建、不遇错回退。owner/full 账号可选择外部项目；workspace 账号仅允许真实路径位于原 workspace 内。外部能力由后台根据账号授权生成，不能接受前端宣称；授权撤销时重新检查。CodexBridge.run 使用局部 cwd，同步传 thread/start、resume、turn/start 与 writableRoots，不改变进程工作区或其他账号任务。

新版桌面注册声明 projectDirectory 能力，中央仅对能力明确的连接下发新增字段。旧客户端默认目录继续兼容；选自定义目录时派发前提示升级。新版向旧服务注册可在确定 HTTP400、尚未取得连接的协商阶段回退旧字段，绝不重试执行任务。

界面沿用折叠面板，在模型/电脑下方显示一条目录摘要；Chat + Agent 弹窗使用同一输入。按服务实例、账号及电脑保存最近目录偏好，不能把 Windows 路径带到 Ubuntu。默认目录可一键恢复，说明路径属于执行电脑。运行、队列、状态未知和待确认提交期间锁定目录。412×960 下允许路径换行、输入不溢出，不新增拥挤第三列。

## Impact

涉及任务协议、恢复校验、远程能力协商、真实 Codex run、Chat 协作及前端。新增模块同步加入 Windows/Linux 源码打包清单。生产保持原账号、会话、暂停队列、下载包与密钥；不自动重试历史任务。

## Risks

旧包不可假称支持目录；必须显式协商。目录变化不能续接原 native thread。工作区账号不能通过 symlink 或绝对路径扩大授权。前端偏好不是执行事实，队列展示保存的快照。

## Verification Plan

针对绝对路径、非目录、不存在、symlink 逃逸、账号隔离、能力缺失、旧缺省指纹、重复提交、目录切换/续接、steer 和队列快照建立回归。验证中央和真实 DesktopExecutor 传入真实 Codex cwd，使用临时测试项目做只读标记读取，不碰用户项目。TypeScript/Vite 构建、Chrome 桌面/412×960 验收；上线前检查活动任务并保持数据/下载，部署后独立 QA 会话验收与清理。浏览器模拟不视为 Android/Ubuntu 真机验收。
