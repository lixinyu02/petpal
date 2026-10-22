# OpenUI Prompt Size Issues

- Date: 2026-10-23
- Complexity: L1
- Related design: 2026-10-23-openui-prompt-size-design.md

## Task Overview

- Goal: 评估 Open Intelligent UI，并取消人为的组合提示词字符预算。
- Ordering rule: Complete issues in sequence.
- Current status: all complete

## Issue List

- [x] issue-1 取消提示词预算并打通长提示词执行链路

## issue-1

- ID: issue-1
- 标题: 完整传递长组件说明和任务
- 范围: OpenUI guide 策略、Chat/Agent 拼装、本机 Codex 与远程执行器、针对性测试及兼容评估记录。
- 依赖: none
- 验收标准: >32000 字符 guide/组合 prompt 不再主动降级、截断或重置线程；已检索记忆继续可用；原生与远程桌面可接受完整 prompt；原始消息校验和权限不变。
- 状态: done
- 验证方式: policy/API/queue/memory 53/53、native bridge/executor 73/73、context repair/Chat+Agent/queue API/attachments 31/31，共 157/157，无跳过；tsc、diff check 通过。上游隔离兼容探针 15/15；65413 字符完整 guide+task 不降级、48000+字符经真实桥接到 fake CLI 逐字相等。无生产模型/实体终端/新组件浏览器验收；无前端变更，未重复构建或布局测试。
- commit: fix(issue-1): remove artificial OpenUI prompt character budget (本提交)
