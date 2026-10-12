# Ubuntu 自启与全屏验收

日期：2026-10-12。功能提交：80597de。

## 使用

Ubuntu 桌面客户端登录后，进入「连接与设置 → 设备连接」，找到「启动与窗口」。开启「开机自启」及「启动后全屏」，登录系统后小伴会铺满当前显示器。若也开启「启动时最小化」，先留在托盘，打开主窗口才进入全屏。

「进入全屏／退出全屏」按钮只切换当前窗口，不修改下次启动偏好。F11 切换、Esc 退出；托盘也有全屏入口。自启属于桌面用户登录会话，不是无需登录的系统服务。

Linux 自启保留允许的 graphics 参数，包括 ARM Mali wrapper 使用的 `--ozone-platform=x11 --use-gl=angle --use-angle=gles-egl`。便携包需保存在固定位置；搬动或升级后可重新开启自启来登记当前位置。

## 源码回归

七个相关 Node 测试文件 131/131 pass，覆盖偏好持久化、旧配置／旧 bridge、Linux XDG 参数及回滚、账号隔离、异步窗口转换、Esc/F11、重复实例、关闭与窗口恢复。TypeScript/Vite build 通过。最终 smoke 分支改动后窗口相关 31/31 回归再次通过。

Chrome extension 实际登录普通账号，并打开设备连接页，确认 Web 只显示桌面客户端下载入口，不提供不可执行的原生全屏开关。

## Ubuntu 原生窗口

已运行的 Ubuntu 24.04 x64、WSLg X11 `:0`、Electron 39.8.10，普通 UID1000。所有测试使用独立 profile、XDG_CONFIG_HOME、workspace 与临时本机账号；Chromium sandbox 保持开启。

源码验收 runtime 使用当前应用源目录链接，未包含已有私有用户数据。5 次独立启动均 exit0：普通窗口、保存后全屏、托盘隐藏启动与手动显示；真实 native 全屏、F11/Esc、设置页按钮进退、XDG 注册／撤销与图形参数保存。最后两次额外等待 WSLg 初始窗口映射坐标稳定：普通窗口 1180×800@(376,167)，全屏 1920×1080@(0,0)，与显示器完整 bounds 相等。

证据：`evidence/ubuntu-fullscreen-20261012/pass1` 至 `pass5`，每次包含 `window-result.json`、截图、launch log 和进程退出收据。`pass5/fullscreen.png` 是实际原生窗口截图。早期 pass2 的初始坐标是 WSLg 尚未映射的瞬态，不作为最终显示几何；pass5 已使用稳定采样。

WSLg 环境出现 GPU 初始化回退软件 WebGL；源码目录依赖只有 Windows Codex，出现 executor 连接错误。本轮没有执行 Agent 任务。完整 Linux 包与内置 CLI 的验收在下节另记。

## 本地客户端包

本地预览包已生成。没有发布 GitHub Release 或更新软件内正式升级清单，版本仍为 0.9.11。

| 架构 | 文件 | 字节 | SHA256 |
|---|---|---:|---|
| x64 | releases/ubuntu/PetPal-0.9.11-Ubuntu-x64.tar.gz | 360404005 | 80b8baa3482a959ca322e5dc12b820e99f932ff401a64341d560bbe0f9358910 |
| ARM64 | releases/ubuntu/PetPal-0.9.11-Ubuntu-arm64.tar.gz | 354589115 | c2e16893e1a8c1389fd57ce1433ff744c0583eea04510836bf40a73782086920 |

两架构 `linux-verify --compare-current-dist` exit0、ok=true、failures=[]；每包 14160 条目、1549 个前端文件、100 个应用文件与当前源一致，无凭据、用户数据、安装包缓存或错误平台二进制。跨平台打包 manifest 的 `runtimeVerified:false` 保持原始生成记录，原生测试使用外部收据记录，避免修改已审计归档。

完整 x64 包另行解压到 Ubuntu 临时目录，未链接源码；普通用户下内置 `codex-cli 0.143.0`、`OpenCLI 1.8.8` 的真实版本命令都 exit0。两次完整载荷启动均 exit0，全屏、快捷键、设置按钮和 XDG 测试通过，保存后启动也为 1920×1080@(0,0)。完整包不存在源码阶段缺少 Linux Codex 的错误，WSLg 软件 GPU 回退仍有日志。

真实包 SHA 再次匹配上表；native 收据为 `evidence/ubuntu-fullscreen-20261012/package-native-receipt.json`，两次窗口结果、截图和日志在 `package-pass1/2`。全部本轮测试 PID 已退出，两组临时 XDG 自启项均已撤销，最后启动偏好已还原。原用户和生产服务没有修改。

解压整个 tar.gz 到固定目录后，以普通桌面用户运行 `./start-petpal.sh`。RK3566 仍保留原有 wrapper 的 X11／ANGLE 参数；本轮未连上板，不自动替换已安装版本。

初次打包因 `dist/downloads` 中的正式 Windows 安装包缓存触发平台安全审计而停止，未生成包。随后只排除这一分发缓存，不删除网页下载资产。真实 snapshot 复制、缓存保留、其它敏感／错误平台文件拒绝与归档检查的相关 75/75 测试通过。

## 未验范围

当前 USB ADB 为空，历史板端地址 SSH/ADB 超时，未确认 ARM64 实板当前 IP、boot 或窗口状态。没有操作板端、LCD 固件、内核、显示寄存器或供电。ARM64 实屏／Mali、Ubuntu 原生登录后自动启动、实际系统重启、Wayland 桌面尚未验收。XDG 登记／撤销和同一 profile 下的独立进程重启已验证。
