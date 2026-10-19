# PetPal Cloud Agent

本镜像仅提供独立 Linux Agent 工作目录及回环 RFB 桌面。宿主不发布 VNC、Docker API 或代码服务器端口。
CLI 固定为项目当前的 @openai/codex 0.143.0；模型凭据只由每次启动的临时中央代理票据提供。
桌面包含 Openbox、文件管理器、终端、Chromium 与 xdotool/wmctrl；浏览器档案独立保存在本环境 /runtime/browser。
浏览器使用容器外层隔离而不使用其进程内 sandbox；无宿主挂载、Docker socket、host network 或额外 capabilities。
本镜像未集成 OpenCLI Chrome 扩展或原生 Computer Use MCP，不能把这些宿主工具宣传为云端已可用。
Chromium、Debian 组件及 Node/Codex 的许可随软件保留，构建后 /opt/petpal/debian-packages.txt 与 npm-packages.json 记录实际版本。
镜像不含账号、API Key、主机配置、浏览器档案或项目数据。构建需要访问 Debian 与 npm 公共源。
Ubuntu 使用本机 Docker；Windows 可选择已运行的 WSL Docker。ARM64 由基础镜像和 npm 对应二进制决定，需另行实机验证。
