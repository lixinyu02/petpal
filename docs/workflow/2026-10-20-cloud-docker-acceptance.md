# 云端 Docker 验收

日期：2026-10-20。小伴代码基线 `49edd17ae7d4129ba407e1c3be8c36e4188f87be`，版本号保持 0.9.13，本轮先交付 Web/后端，不重打原生包。

## 已完成的验证

- 模块、真实 HTTP/WS、账号/设备隔离与旧功能定向回归通过；最终功能组 76 通过、1 个需要显式 WSL 参数的测试跳过，该参数传递用例已另在真实 Windows→WSL 环境通过。Harbor 配置版本已映射成稳定 UUID，完成任务后 JsonStore 重启恢复通过。
- TypeScript、Vite 真实构建通过；noVNC 1.5.0 独立按需加载，完整许可和来源保留。Windows/Ubuntu 包闭包检查通过，实际安装包与 ARM64 设备没有重验。
- 真实 API Harbor HTTP 配对、确认、目录、重启恢复、刷新和撤销通过。上游补丁独立提交 `32ba662843a7d435e4e98e49d1ee6a39fbe0e333`，位于 `E:/api-harbor/.worktrees/petpal-service-links-20261020`；未合并、推送或升级生产 Harbor。
- 真实 Docker Platform 控制服务、节点和 Docker：配对、节点目录、desktop 项目、inspect、Codex 0.162.1 的 WS stdio、RFB 桌面、错 owner 拒绝、项目删除及撤销均通过。该项没有替代模型推理测试。
- 小伴本地镜像 revision `20261020.5`：真实 Node 24.19.0、CLI 0.143.0、Chromium、Windows→WSL 参数传递/stdio/进程回收、RFB 003.008 和 1280×800 画面、重启与工作卷保留通过。Linux 管理器使用合成 Responses 驱动真实 `exec_command` 落盘，验证短时代理票据过期、账号隔离及冷恢复。
- 另用完整小伴 HTTP 路径调用真实 GPT-6 Luna，命令返回 `/workspaces/project`、UID 10001、容器 hostname 与 `PETPAL_LUNA_DOCKER_OK`。独立 Docker inspect 与输出中的 hostname 一致，没有在中央或实体机执行。
- Chrome 实际连接 noVNC、显示终端，并把鼠标右键传入容器，显示容器自己的桌面菜单。412×960 CSS 视口无横向溢出，桌面使用抽屉；测试后恢复正常视口和仅查看。

## 实测修复与隔离

Windows WSL 必须使用 `--exec` 保留字面参数；创建失败使用耐久 `creationPending`，刷新/重启和回包丢失不丢原请求，运行后手动停止不被同请求重启。桌面退出期间迟到的连接被关闭。构建必须显式安装对应架构的 Codex 二进制，并强制版本检查，不能以 npm 主包安装成功代替 CLI 可用。

共享 WSL 引擎存在缺失默认网桥及外部资源占用，未修共享网桥或停止外部容器。验收使用独立 data-root、Docker/containerd、socket 与专用桥；初次 mount namespace 不一致的失败已保留，并纠正为真正私有 containerd。最终镜像仅二进制下载构建步骤使用 host 网络，差异已记录；运行容器始终为 bridge、非 root、cap-drop ALL、no-new-privileges，无宿主挂载、无公开 VNC/Docker 端口。

## 证据与边界

去密回执与截图位于本机私有 `.data/cloud-docker-20261020/`：`platform-real-acceptance.json`、`service-links-http-acceptance.json`、`revision5-private-import-receipt.json`、`windows-4cf739fc-f8f6-4b23-a2f3-ae195f1565b7/receipt.json`、`native-7fb0dcfa-bd09-4775-bf2c-3611fe09e57a/receipt.json`、`luna-http-acceptance.json`、`web-closure-receipt.json`、`chrome-desktop-sidebar.jpg` 和 `chrome-desktop-control.jpg`。私有凭据及模型 Key 不提交仓库。

云容器暂不支持图片、独立审查模型、官方账号、OpenCLI 扩展和原生 Computer Use MCP，能力明确关闭，实体机能力保留。本机需要可用 Docker Linux 引擎，平台需管理员配对；没有替用户兑换或升级生产服务。本轮浏览器与镜像实测是 x64，不能视为 ARM64 或四端原生包验收。
