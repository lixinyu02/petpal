# Chat / Agent 工作台任务

- Date: 2026-09-29
- Complexity: L2
- Related design: 2026-09-29-petpal-agent-workspace-design.md

## Task Overview

- Goal: 统一登录后的 Chat / Agent 工作台并补齐执行、图片、下载及移动端角色能力。
- Ordering rule: 按 issue 顺序完成，同一 issue 内分文件并行协作。
- Current status: issue-19/20 done; issue-21 in_progress

## issue-19

- ID: issue-19
- 标题: 强制登录与移动端伙伴显示
- 范围: 身份入口、语音门禁、退出取消、二次元角色兼容回退
- 依赖: issue-18 done
- 验收标准: 访客不能启动语音/设备/任务；认证失败可恢复；手机角色有可见回退
- 状态: done
- 验证方式: 24项认证/会话/偏好回归、14项角色资源/表情测试通过；TypeScript/Vite通过。Chrome匿名直达聊天页仅登录，成功登录挂载任务，退出卸载。412px二次元WebGL可见；主动丢失context后DOM帧继续、同角色可见，点击重试恢复webgl 21帧。图片资源和chunk均有失败呈现，不以手机宽度模拟冒充真机。
- commit: 本次 fix(issue-19) 提交

## issue-20

- ID: issue-20
- 标题: Agent 权限、引导与任务队列
- 范围: 账号授权、CLI 权限映射、steer、队列和取消/撤权处理；桌面远程 IPC、流式传输与本地/远程凭据隔离基础
- 依赖: issue-19
- 验收标准: UI 选项对应实际 CLI 策略；只有授权账号操作自有任务；队列顺序明确且不能撤权后继续
- 状态: done
- 验证方式: 全量 383/383 测试通过；Codex 0.143 本地模拟 Responses 验证真实 shell 能力、full+ask 审批与 read-only 拒绝写入。队列幂等、steer 不确定回执、撤权/退出/重启边界，桌面远程流与二进制、凭据隔离及延迟切换竞态通过；TypeScript 与差异检查通过。生产授权尚未应用。
- commit: 本次 feat(issue-20) 提交

## issue-21

- ID: issue-21
- 标题: 统一工作台、执行位置、模型选择、图片和下载
- 范围: Chat/Agent、连接与模型弹层、多模态附件、CLI 引导、下载中心
- 依赖: issue-20
- 验收标准: 两模式入口明确；本地远程凭据隔离；图片确实传入两类模型链路；下载对应真实发布包
- 状态: in_progress
- 验证方式: 会话/附件/协议测试，Chrome UI 全流程
- commit: pending

## issue-22

- ID: issue-22
- 标题: 部署与三平台交付验收
- 范围: 线上更新、APK / Windows / Ubuntu 产物与发布、文档
- 依赖: issue-21
- 验收标准: 已发布源码与资源匹配、无凭据、认证与核心交互线上可用、下载入口可用
- 状态: todo
- 验证方式: 相关回归、原生构建/签名/内容审计、Chrome 与有限无害真实任务
- commit: pending
