# Agent 项目目录 Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-agent-project-directory-design.md
- Current status: done

## issue-69

- ID: issue-69
- 标题: 为 Agent 与聊天后台任务设置实际项目目录
- 范围: 目录验证、队列与协作快照、Codex cwd、桌面能力协商、紧凑界面、回归及网页后端交付
- 依赖: issue-68 done
- 验收标准: 目录进入真实执行电脑 Codex；旧默认客户端兼容、缺能力明确阻止；权限不扩大；412×960 可操作；原数据与下载保留
- 状态: done
- 验证方式: 208/208 相关回归、TypeScript、隔离 Vite 构建通过；真实 Codex 0.143.0 + Qwen 中央与 DesktopExecutor 各三轮 A→A→B 通过；Chrome 实际 CSS 412×960 无横向溢出；网页和后端已上线，公网 test 的直接 Agent 与 Chat 派发 Agent 均从指定项目读取随机标记成功。原生产会话、暂停队列、账号、模型与电脑登记保持，QA 已清理。详见对应 acceptance.md。
- commit: 本 issue 同名提交 `feat(issue-69): add Agent project directory selection`

## 交付边界

本轮未重打客户端；旧 Windows/Ubuntu 安装包的默认目录仍兼容，自定义目录需要新版桌面执行端。中央与 DesktopExecutor 的实际验收在同一 Windows 电脑完成，不等同跨物理电脑、Ubuntu 或 Android 真机验收。

界面子任务初次直接构建清空了 dist/downloads；已从原归档恢复全部文件并核对历史清单 SHA-256，保留原签名更新清单。最终部署前后下载字节与 mtime 保持；这不表示事故过程中 mtime 从未变化。Vite 已增加 emptyOutDir:false，验收构建使用隔离输出。
