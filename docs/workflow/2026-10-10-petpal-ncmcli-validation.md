# 网易云官方 CLI 接入验收

- 日期：2026-10-10
- 工作区：E:\RK3566\petpal
- 范围：官方技能、可选 CLI 调用、Windows／Ubuntu 包装规则与本机后端；未重打客户端或发布。

## 已验收

1. 固定官方 `@music163/ncm-cli@0.1.7` 的版本与缺少 API 配置时的真实响应；用户安装、配置与扫码启动文件可运行，凭据不经聊天输入。
2. 真实 Codex 0.143 发现私有 `petpal-ncmcli` 技能，实际 dynamic tool 在当前账号与所选执行电脑上调用。read-only 状态免审批、read-only 运行被拒绝、完整访问 ask 的版本／帮助经过真实审批。
3. 真实 Electron 39.8.10 通过 Node 模式启动官方 CLI。全部模型请求留在本机 Responses fixture，没有请求真实模型或网易云音乐 API。
4. 六组技能／命令／配置回归：74通过、0失败、0跳过。八组执行器／模型切换／真实 Codex／音乐 MCP 回归：144通过、0失败、0跳过。新端到端 smoke：2通过、0失败、0跳过。
5. TypeScript 检查及 Vite 构建通过；构建使用 `--emptyOutDir false`。三个固定技能资产的 Git blob 原始字节符合来源哈希，`.gitattributes` 禁止 Windows 换行转换。
6. 更新本机后端 `http://127.0.0.1:4318`，启动前确认没有待执行任务并留存私有状态备份。health 200／0.9.10，授权 state 200，未登录 state 401。2个账号、46个对话、原消息、模型及登录会话完整保留；Chrome 刷新后登录页可用、未发现控制台错误。
7. `dist/downloads` 的15个文件、2,412,335,697字节与原始大小／mtime清单完全相同；既有发布包没有被替换。
8. Windows／Linux包装专项66通过、0失败、0跳过。轻量Linux归档拒绝缺失／修改模块或技能、未知技能成员及CLI误打包；真实ASAR与Electron加载验证技能为unpacked、默认来源路径正确且物化字节一致。三个包装脚本语法检查通过。

## 验收边界

- 尚未取得用户网易云开放平台凭据，在线搜索、歌单变更、扫码登录和实际播放未验收。研究残留 CLI 仅在测试中显式注入，默认运行时发现不会把它视为用户已安装。
- 官方 CLI 是用户单独安装的可选运行时，未加入小伴生产依赖或包内 payload。其原生 Windows mpv 播控使用共享管道，不在新工具入口开放；实际桌面播放继续按所选电脑的音乐 MCP／媒体能力执行。
- Web／安卓转发到执行电脑；旧安装包不含此次工具。既有 Agent 线程保留历史，但要新建对话获得新工具修订。
- 本机服务与测试不等同于远程 Windows／Ubuntu 安装包、ARM64 实机或公网服务验收。本轮未修改板端、路由器或远端部署。

## 证据

ignored `evidence/ncmcli-20261010/` 中保留 `issue2-final-regression.txt`、`issue3-integration-regression.txt`、`issue3-real-agent-smoke.txt`、`issue3-package-final-tests.txt`、`typescript.txt`、`vite-build.txt`、`backend-validation.json`、`preservation-validation.json`。状态备份与启动日志仅在该目录的 `private/`，不提交 Git。
