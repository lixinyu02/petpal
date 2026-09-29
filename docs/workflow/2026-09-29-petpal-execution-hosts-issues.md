# 同账号执行电脑任务

- Date: 2026-09-29
- Complexity: L2
- Related design: 2026-09-29-petpal-execution-hosts-design.md

## Task Overview

- Goal: 登录桌面自动注册，四端在同一账号和聊天中选择执行电脑。
- Ordering rule: 顺序完成 issue；当前 issue 内按独立文件协作。
- Current status: issue-25 done; issue-26 todo

## issue-25

- ID: issue-25
- 标题: 实现账号执行电脑、任务路由和桌面执行器
- 范围: server 注册/租约/relay/任务路由，desktop worker，src 登录生命周期和主机选择，同账号聊天连续性及测试
- 依赖: issue-24 done
- 验收标准: 不切换中央账号与历史即可选择同账号电脑；真实执行器接收指定任务；撤销、离线、重复请求及密钥隔离正确
- 状态: done
- 验证方式: 515/515 全量测试、TypeScript/Vite、318 文件公开源码审计通过。真实 GPT-6 Luna + 两个隔离 Windows 执行器完成 A→B→B 三轮（同物理主机），保留中央 2/4/6 条消息及同机 thread resume。Chrome 登录/切机/历史/离线禁发、412×915 无溢出通过。自查修复旧接口回落、成员空模型越权、跨 delta 密钥回显和未知执行状态；详见 docs/acceptance-execution-hosts.md。
- commit: 本 issue 实现提交（见 Git 历史）

## issue-26

- ID: issue-26
- 标题: 部署、Chrome 验收与桌面交付
- 范围: 受控部署、Chrome 列表/历史验收、新桌面包与使用说明、推送源码
- 依赖: issue-25
- 验收标准: 线上界面可选择已登录新客户端，账号/语音/聊天保留；桌面包可获取；报告真实验证边界
- 状态: todo
- 验证方式: 待 issue-25 完成
- commit: pending
