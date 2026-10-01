# PetPal 0.9.6 客户端重新打包

- Date: 2026-10-01
- Complexity: L2
- Status: final

## Background

用户要求重打安装包，补齐最新项目目录能力，并确认 Qwen 支持图片输入。现有 0.9.5 客户端不具备全部最新源码能力，不能用网页更新替代桌面执行端更新。

## Goal

以冻结源码和隔离网页 bundle 构建 Android、Windows x64、Ubuntu x64/arm64 包，检查 Qwen 图片上传、Chat/Agent 和远程执行端传递。issue-70 完成包内容审核与适用平台启动 smoke；随后 issue-71 完成下载入口和 GitHub 发布。

## Solution

复用既有构建链，不引入新运行时。Windows 交付完整目录 ZIP 与便携 EXE，内置 Codex/OpenCLI/电脑及音乐能力；Ubuntu 复用已审计 Electron/Codex 原生资产但重新封装最新应用源码；Android 使用原签名身份和递增 versionCode，保持通知与 OEM 后台入口。所有构建输出放独立 releases/evidence 目录，禁止把线上 dist 当临时构建目录。

图片能力以模型配置和实际调用为依据；附件沿既有账号隔离和大小限制传输，不向模型伪造识图结果。修复只覆盖发现的阻断，不改变其他模型能力默认值。真实测试仅使用自建非敏感图片及隔离会话。

## Delivery and Risks

本轮已按正式稳定版 0.9.6 发布，冻结包及发布标签来源固定为 `eaae5322566c915b06070e7248f1770470cdd197`，后续文档提交不改变包的来源。GitHub Releases 与服务器分别沿用既有发布身份，五目标清单均使用 stable / sequence 8；旧公钥、历史防回滚记录、Release 和下载资产保留。服务器发布及更新器完整下载、GitHub 四个大包与六项直接资产完整字节读回、签名清单、正式 latest/tag 和 Chrome 登录下载验收均通过。内部 preview 转为 stable 时只替换本轮草稿元数据，保留原 preparation 和清单快照，不改安装包字节。ZIP 首次公网读取超时发生在 POST 前，恢复只延长有界传输期限并增加进度日志，保留原失败证据。

不扩展账号权限，不重试历史任务，不涉及板项目或板用 WSL。Ubuntu/Android 本轮没有真机运行验收；Android code16 沿用开发签名，Windows 两包实际为 unsigned。Windows 的 ZIP 与便携 EXE 均实际启动，并各完成两次独立顺序启动；便携 EXE 生命周期包括展开和退出清理，不把该耗时称为纯 UI 启动时间。

## Verification

检查版本、完整文件清单、SHA-256、CLI/native/MCP 资产、项目目录模块、图片链路与更新签名。针对新增修复跑相关回归；冻结后构建并启动新 Windows 客户端，验证执行器注册能力。真实 Qwen Chat 与 Agent 图片读取；Chrome 验收登录后的下载页。公网下载按哈希核对，保留原生产状态、暂停队列、密钥与历史下载。
