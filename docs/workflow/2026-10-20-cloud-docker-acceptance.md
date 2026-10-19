# 云端 Docker 验收

日期：2026-10-20。小伴代码基线 `49edd17ae7d4129ba407e1c3be8c36e4188f87be`，版本号保持 0.9.13，本轮先交付 Web/后端，不重打原生包。

## 已完成的验证

- 模块、真实 HTTP/WS、账号/设备隔离与旧功能定向回归通过；最终功能组 76 通过、1 个需要显式 WSL 参数的测试跳过，该参数传递用例已另在真实 Windows→WSL 环境通过。Harbor 配置版本已映射成稳定 UUID，完成任务后 JsonStore 重启恢复通过。
- TypeScript、Vite 真实构建通过；noVNC 1.5.0 独立按需加载，完整许可和来源保留。Windows/Ubuntu 包闭包检查通过，实际安装包与 ARM64 设备没有重验。
- 真实 API Harbor HTTP 配对、确认、目录、重启恢复、刷新和撤销通过。上游补丁独立提交 `32ba662843a7d435e4e98e49d1ee6a39fbe0e333`，位于 `E:/api-harbor/.worktrees/petpal-service-links-20261020`；未合并、推送或升级生产 Harbor。
- 真实 Docker Platform 控制服务、节点和 Docker：配对、节点目录、desktop 项目、inspect、Codex 0.162.1 的 WS stdio、RFB 桌面、错 owner 拒绝、项目删除及撤销均通过。该项没有替代模型推理测试。
- 小伴本地镜像最终 revision `20261020.6`：真实 Node 24.19.0、CLI 0.143.0、Chromium、Windows→WSL 参数传递/stdio/进程回收、RFB 003.008 和 1280×800 画面、重启与工作卷保留通过。Linux 管理器使用合成 Responses 驱动真实 `exec_command` 落盘，验证短时代理票据过期、账号隔离及冷恢复。最终定向组 54/54（含显式启用的真实 WSL 参数测试）通过。
- 另用完整小伴 HTTP 路径调用真实 GPT-6 Luna，命令返回 `/workspaces/project`、UID 10001、容器 hostname 与 `PETPAL_LUNA_DOCKER_OK`。独立 Docker inspect 与输出中的 hostname 一致，没有在中央或实体机执行。
- Chrome 实际连接 noVNC、显示终端，并把鼠标右键传入容器，显示容器自己的桌面菜单。412×960 CSS 视口无横向溢出，桌面使用抽屉；测试后恢复正常视口和仅查看。
- rev6 真实运行长命令后从 Agent 任务入口取消，162ms 后任务及提交均为 cancelled；独立确认命令 PID 不存在、完成标记没有生成、launch 文件无残留，容器与桌面仍在运行。未确认的收尾返回 execution_unknown，不能仅依据 turn/interrupt 回执标记取消成功。

## 实测修复与隔离

Windows WSL 必须使用 `--exec` 保留字面参数；创建失败使用耐久 `creationPending`，刷新/重启和回包丢失不丢原请求，运行后手动停止不被同请求重启。桌面退出期间迟到的连接被关闭。构建必须显式安装对应架构的 Codex 二进制，并强制版本检查，不能以 npm 主包安装成功代替 CLI 可用。

真实取消还暴露 native shell 的子进程可能另建进程组。最终镜像由 Python/Linux subreaper 监督本轮子树，每轮 binding 等待精确 cleanup 回执后再结束，失败保持环境 unknown。该范围不包含容器里原先的桌面与其他任务进程。已补 Docker host 的 authenticated 状态，避免错误继承中央 CLI 的未登录提示。

共享 WSL 引擎存在缺失默认网桥及外部资源占用，未修共享网桥或停止外部容器。验收使用独立 data-root、Docker/containerd、socket 与专用桥；初次 mount namespace 不一致的失败已保留，并纠正为真正私有 containerd。最终镜像仅二进制下载构建步骤使用 host 网络，差异已记录；运行容器始终为 bridge、非 root、cap-drop ALL、no-new-privileges，无宿主挂载、无公开 VNC/Docker 端口。

## 证据与边界

去密回执与截图位于本机私有 `.data/cloud-docker-20261020/`：`platform-real-acceptance.json`、`service-links-http-acceptance.json`、`revision5-private-import-receipt.json`、`windows-4cf739fc-f8f6-4b23-a2f3-ae195f1565b7/receipt.json`、`native-7fb0dcfa-bd09-4775-bf2c-3611fe09e57a/receipt.json`、`luna-http-acceptance.json`、`web-closure-receipt.json`、`chrome-desktop-sidebar.jpg` 和 `chrome-desktop-control.jpg`。私有凭据及模型 Key 不提交仓库。

最终 rev6 对应 `revision6-private-import-receipt.json`、`native-cancel-ead7a28a-3681-4179-8993-5fea858ff627/receipt.json`、`windows-dc5c9889-1287-4d97-8334-5f0e58ae5a86/receipt.json`、`native-8344559e-7fa2-4b34-a07a-f68d54dddfde/receipt.json`。GPT-6 Luna 供应商推理在 rev5 完成，rev6 的进程监督变更另跑真实 CLI/合成 Responses 与长命令取消，不能合并冒称同一次推理。

## 正式部署与收尾

最终部署回执 `deploy-receipts/run-20261020-020558-8e3c5de20c39417e9b54367077cc612f/` 通过：4318 本机后端与公网 HTTPS 健康，Web 入口 SHA256 `f234867912d376bed518288dc3c39e818ea72fd0102d74cb0c21a9a371194cf8`，guardian 已接管，维护标记移除。匿名新接口返回 401，普通 test 账号被管理员配对/镜像准备接口拒绝 403，仅见自己的 Docker 列表；公网 WSS 的无效票据返回 401，反代确实到达桌面门禁。

部署保留 3 用户、5 模型、54 会话、1 附件、原记忆与代理资料，业务字段 SHA256 仍为 `33d397af5c096ef1ddb233a8328c13713ea9910725445d8df7fbf20c38aad7b3`。客户端下载与更新资源逐文件摘要不变。正式 test 浏览器登录/退出通过，没有导入 QA 会话、配对或容器到生产。

QA 后端、Harbor、平台控制/节点、私有 Docker/containerd 均已停止；root 的 3 个环境及其他本轮测试容器停止，工作卷和证据保留。专用桥按 ifindex 核验后移除；共享引擎的运行容器在收尾前后均为 37，未停止或修改其他容器。最终停止回执 `platform-private-daemon-stop-receipt.json` 保留全部 26 个测试卷及 data-root，未删除目录。

正式站点尚未替管理员配对真实 Docker Platform/API Harbor，本机 Docker 尚未准备；普通账号会看到真实的未就绪状态。管理员完成平台配对或准备可用 Linux Docker 引擎后，才能创建生产云环境。隔离验收连接不会被自动带入生产。使用说明见 `docs/cloud-docker.md`。

云容器暂不支持图片、独立审查模型、官方账号、OpenCLI 扩展和原生 Computer Use MCP，能力明确关闭，实体机能力保留。本机需要可用 Docker Linux 引擎，平台需管理员配对；没有替用户兑换或升级生产服务。本轮浏览器与镜像实测是 x64，不能视为 ARM64 或四端原生包验收。
