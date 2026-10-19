# 云端 Docker 与实体电脑

在侧栏打开「云端环境」，创建独立工作区；在 Agent 或 Chat+Agent 的「执行电脑」中选择实体电脑或 Docker。切换目标后，新任务发往选定环境。已执行或排队的任务仍绑定原目标，断线不会改派到其他电脑。

## 服务配对

管理员在「连接与设置 → 服务配对」填写服务根地址和一次性配对码。Docker Platform 与 API Harbor 分别配对，凭据保存在后台私有加密目录，浏览器仅接收状态与模型目录。

- Docker Platform：在平台签发客户端配对码，完成配对后选节点和模板。项目、执行及桌面均通过平台受控接口传输，不需要公开 Docker socket 或 VNC 端口。
- API Harbor：签发时选择小伴（`petpal`）接收方；配对后，管理员可以为账号分配同步的模型。旧版 Harbor 只支持 Codex Remote 时会明确提示不兼容，需要先升级 Harbor 的 PetPal 接收方兼容补丁。小伴不会以其他产品身份兑换配对码。
- 断开配对会撤销连接。未知送达保留同一请求身份，先刷新或确认后再重试，不反复创建账号或容器。

## 本机 Docker

需要已经运行的 Linux Docker 引擎；本功能准备小伴桌面镜像，不代替 Docker Engine/WSL 的系统安装。Ubuntu 可使用本机 `docker`；Windows 可通过已运行的 WSL Docker 或本机 Docker Desktop Linux 引擎运行。

管理员点击「准备 Docker 环境」构建固定版本镜像，首次需要下载 Debian、Node 和 Codex 的公开包。镜像提供 Chromium、Openbox、终端和文件管理器。工作目录是 `/workspaces/project`，工作卷在停止后保留。

运维可在服务停止时，备份并配置私有 `<dataDir>/cloud-docker/state.json` 的 `localTransport`，重新启动后生效。可选字段为 `wslDistro`、`dockerHost`（受信本机 Unix socket）、`nodeImage`、`debianMirror`、`debianSecurityMirror`。不支持浏览器传入任意执行命令。默认使用本机 Docker CLI；WSL 调用使用 `--exec` 保持参数字面值。

容器需要回连小伴的公开 HTTPS 服务，以使用每次任务的短时模型票据。部署时配置受信的 `PETPAL_ALLOWED_ORIGINS`；开发/嵌入式部署也可在 `createPetServer` 的 `cloudDockerOptions.publicOrigin` 指定容器能够访问的服务根地址。`localhost` 不能代表容器外的小伴后端。

## 远程桌面与权限

点击环境的「桌面」后，在聊天右侧显示 noVNC；窄屏使用可收起抽屉。初始仅查看，点击「允许鼠标键盘」后才控制。关闭、注销、撤权、停止或容器代次变更会断开桌面连接。桌面不公开裸 VNC 端口，短时票据只允许消费一次。

普通账号仅见自己的实体机与 Docker；管理员可见全部。容器没有宿主目录、Docker socket、特权模式或宿主网络。容器完全访问仅作用于该环境，不代表实体电脑管理员权限。

首版 Docker 支持 API 模型、Codex 文件/命令、项目目录、现有任务排队、审批和执行中引导。云端图片输入、独立命令审查模型、ChatGPT 官方账号、OpenCLI 浏览器扩展及 Computer Use MCP 尚未接入，界面和后台会明确拒绝不支持的能力；实体机原有功能保留。ARM64 安装包和真实 ARM 设备需另行验收。
