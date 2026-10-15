# 桌面应用代理验收

日期：2026-10-15。此轮为私有验收构建，版本号仍为 0.9.11；没有替换现有正式安装包、GitHub Release 或在线更新清单。

## 已完成

- Mihomo 1.19.32 固定官方目标、原始文件哈希及 PE/ELF 架构；四目标均随包提供 GPL、固定源码和 vendor 归档。
- 本机主账号可导入 YAML、启停代理、选择节点组及设置随小伴启动。默认关闭，不修改系统代理、DNS、路由或防火墙；局域网与回环直连。
- 下载中心分别选择系统架构与格式，可靠识别时推荐；未知架构需手选。缺少 ARM64 发布项时不会回退到 x64。
- Windows ARM64 构建与更新清单能力已加入；正式发布仍要求相应原生验收，不能用静态交叉打包代替。

## 代码与界面

issue-1 核心和路由 45 项通过；issue-2 受影响后端/IPC/启动 191 项通过、1 项可选 ncm 运行时跳过，另有 14 项 UI/preload 通过。issue-3 整合回归 171 项通过，Linux 参数与原子发布相关 15 项通过。公开源码扫描器新增精确测试夹具审核后 17 项回归通过；源码打包 `--check` 的边界扫描通过，Git 索引 1,474 文件扫描通过。

TypeScript 与 Vite 生产构建通过。Chrome 实际验证架构、格式切换、刷新保留手动选择、服务器优先及 GitHub 备用链接。412×960 CSS 像素下，架构/格式上下排列，文档宽度为 412，选择器右边界小于 388；移动截图接口超时，因此该尺寸仅记录 DOM/几何验收。桌面截图为 `evidence/app-proxy-downloads-chrome.jpg`。

## 最终包

私有构建位于 `releases/app-proxy-review-20261015/`。

| 平台 | 格式 | 完整性与架构 | 实际运行 |
| --- | --- | --- | --- |
| Windows x64 | ZIP / 便携 EXE | Electron、Codex、Computer Use、Mihomo 及来源/许可独立读回通过 | 完整目录及最终便携 EXE 均通过，见临时路径边界 |
| Windows ARM64 | ZIP / 便携 EXE | 同上，ARM64 原生目标通过 | 无 ARM 实机 |
| Ubuntu x64 | tar.gz | 14,576 成员、ELF、依赖及当前源码/前端比对通过 | 从最终 tar 解压，在 WSLg x64 中通过 |
| Ubuntu ARM64 | tar.gz | 14,576 成员、ELF、依赖及当前源码/前端比对通过 | 无 ARM 实机 |

Windows 独立 ZIP 审计：`evidence/app-proxy-20261015/windows-builds/windows-{x64,arm64}-package-audit.json`。Linux 独立流式审计：`releases/app-proxy-review-20261015/ubuntu/evidence/linux-verify-{x64,arm64}.json`。Windows x64 包内 Codex 0.143.0 与 OpenCLI 1.8.8 的版本命令均退出 0。

## 真实代理运行

Windows x64 完整包运行记录：`evidence/app-proxy-windows-x64-unpacked-aea796d4171346d89f649799fdf7e465/`。

Windows 最终便携 EXE 运行记录：`evidence/app-proxy-20261015/windows-builds/portable-short-7e231962190c/`。短私有 TEMP 下，从启动、LZMA 解压、全部代理检查到退出约 140 秒，真实退出码 0，stderr 为空；没有关闭系统保护。此前两个长临时目录测试没有产生应用结果，未保留其退出码，因此不能断言确切原因或将长路径兼容性视为通过。下载页继续优先推荐 ZIP；便携 EXE 每次解压会明显增加启动时间。

Ubuntu 最终 tar 的 WSLg 运行记录：`evidence/app-proxy-linux-x64-petpal-proxy-packaged.AzH6MkKz/`。显式使用 `QwenMM-Ubuntu-24.04`、普通用户及隔离用户目录，Chromium 沙箱未关闭；系统默认名为 Ubuntu 的旧发行版 VHDX 缺失，不将该环境错误归于客户端。

两者均实际验证：访客拒绝、显式本机主账号登录、初始禁用、导入校验、真内核启动、节点组、启动偏好保存并复原、设置可见；Chromium 与 Node 请求穿过核心和本地模拟代理节点，代理认证没有泄露给目的端；公网路由走自身代理、回环与 LAN DIRECT；关闭后恢复 DIRECT。

这些结果证明内置内核及应用网络接入可用。没有使用真实订阅或公网出口；仍需用户导入自己的有效 YAML。WSLg 验收不等于独立 Ubuntu 物理桌面或 ARM 实机验收。外部 Chrome 和已有第三方工具进程仍遵循使用说明中的网络边界。
