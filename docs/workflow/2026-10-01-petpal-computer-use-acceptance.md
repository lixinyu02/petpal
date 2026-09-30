# PetPal Zavora Computer Use 验收

日期：2026-10-01。issue-61；固定包 `@zavora-ai/computer-use-mcp@7.4.0`，固定上游源码 commit `cfbb6af0e704da17c43df6c668225a2f84aca762`。

## 已完成

| 路径 | 实际结果 | 边界 |
| --- | --- | --- |
| Windows native / stdio | 70 工具；自建窗口 AX、截图、鼠标、快捷键、输入、拖动、PowerShell 进程查询及真实状态读回通过 | 未访问私人剪贴板或操作用户应用 |
| Electron 39.8.10 | Node 22.22.1 / N-API 10；真实 Electron 子进程退出 0，70 工具、窗口 AX 和截图通过 | 源码运行时，不是新版分发包 |
| Qwen → Codex → 选中执行端 → MCP | `halogen-qwen3.8-flash-next` 完成真实窗口截图/AX、填字、按按钮、读回；11 次工具操作、12 次模型请求，后续输入确有 vision 图片 | 后端和已注册执行端在同一物理电脑，使用真实主机选择/执行器/relay，不是跨两台电脑验收 |
| Ubuntu 22.04 x64 | Ubuntu22 容器 + Xvfb/Openbox/DBus/AT-SPI/GTK；产品 manager 读回窗口标题与真实边界、截图坐标映射、鼠标/输入/按钮；10 次 MCP 调用通过 | 容器图形桌面，无物理 Ubuntu 客户端设备验收 |
| Ubuntu 22.04 ARM64 | ELF183 / GLIBC2.34；交叉编译，QEMU ARM64 Node22 实际加载 N-API10、54 native exports | 未验证 ARM64 桌面输入、窗口或系统权限 |
| Chrome UI | 真实 CSS viewport 412×960，clientWidth/scrollWidth=412；默认关闭，配置折叠、按钮与权限说明可用 | 在隔离账号与后端验收 |

Windows 真实链路、源码 Electron、模型请求、Linux GUI、截图和测试日志均在本机 ignored 目录 `evidence/computer-use-mcp-20261001/`，不将凭据、截图或运行态提交到公开源码。

## 使用方式

在目标电脑登录后进入「连接与设置 → 电脑助手 → 桌面操作 · Computer Use」，启用、保存并连接。创建新的 Agent 对话，选择该电脑和完整访问；询问模式逐项审批，自动运行按任务执行。Chat 派发 Agent 时沿用所选执行电脑及任务权限。网页设置仅管理员可管理服务主机，普通账号在自身桌面客户端配置执行电脑。

Windows 必须是当前用户已登录的图形桌面。Ubuntu 建议 X11，需要目标会话 DBus/AT-SPI，以及 `wmctrl`、`xdotool`、截图与对应 Python/GTK 依赖；长文本输入可能需要 `xclip` 或 `xsel`。状态检查不会操作桌面、读取剪贴板或运行 upstream doctor；静态就绪不是操作成功，实际动作需读回确认。Wayland 目标窗口截图明确拒绝，其他功能依系统权限和图形服务而定。

## 发布边界

本轮按既定选择先更新网页和后端，客户端包延后。原有下载包不包含新增 Computer Use 桥。Windows 下源码 Electron 已验收；未来重打包仍需分发包启动、登录/主机注册及原生模块测试。不能从交叉编译、容器桌面或现有测试推断物理 Ubuntu/ARM64 或 macOS 已验收。

固定 native、MIT LICENSE、补丁和 provenance 保存于 `server/native/computer-use/`。x64 的修正后 native SHA 为 `b7625c7bea15811b9fa78f3b90b39ddced5c9c12e64e936f90b97f1ca2dc27e9`；ARM64 为 `fdefb9683c9f7d92f45533dbf6b25efee2eb24d953b5b901c0c5d78e715a1d8c`。受控补丁 SHA 为 `ad05d1b466c94d2ca90f009630ece9d8dcc0d52aa2b571a09a974d4b6f51ad71`。

可重复构建脚本仅提取固定 Git 跟踪清单中的 20 个 native 成员，比较提取前后清单与源码哈希。独立副本加入未跟踪 Cargo 配置、wrapper 和源码的负测重建仍得到相同 x64 SHA，额外成员未进入编译；原始冻结仓库保持 clean。

上游项目：[Zavora Computer Use MCP](https://github.com/zavora-ai/computer-use-mcp)。PetPal 的完整访问不是操作系统沙箱，停止也不能撤销已完成动作；默认关闭，按账号隔离并沿用现有授权和审批。
