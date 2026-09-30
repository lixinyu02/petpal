# Qwen Agent 模型适配 Issues

- Date: 2026-09-30
- Complexity: L1
- Related design: 2026-09-30-petpal-qwen-agent-design.md
- Current status: issue-47 done

## issue-47

- ID: issue-47
- 标题: 接入 Qwen3.8 Flash Next Agent 模型
- 范围: 同源 Responses 连接、已授权账号模型分配、纯文本附件入口、实际工具与续接验证。
- 依赖: issue-46
- 验收标准: test 与 owner 可选 Qwen Agent；实际 Codex 工具执行及续接成功；不继承 GPT 的 max 强度；原 Qwen Chat/GPT 默认与历史保留，图片限制明确。
- 状态: done
- 验证方式: 两处 /models 与 Responses 工具续接、实际捆绑 Codex 终端执行及同线程续接、test 账号真实任务均通过；48/48 定向回归、TypeScript、Vite 构建与 27 文件部署比对通过。Chrome 确认 Qwen/none/仅文字可选、图片入口禁用，切回 GPT 恢复。验收见同日期 qwen-agent-acceptance.md。
- commit: 本 issue 使用 feat(issue-47) 提交；精确提交 ID 由 Git 历史记录。
