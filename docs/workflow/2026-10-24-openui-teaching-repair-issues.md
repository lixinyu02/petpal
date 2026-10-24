# OpenUI 教学交互修复 Issues

- Date: 2026-10-24
- Complexity: L1
- Related design: 2026-10-24-openui-teaching-repair-design.md
- Current status: completed

## issue-1

- ID: issue-1
- 标题: 修复教学呈现策略与历史动态交互兼容
- 范围: 呈现指南、受控组件/校验器、生成说明和定向回归
- 依赖: none
- 验收标准: 原欧姆片段可显示和交互；新教学指南不强制普通问答；原安全约束保持
- 状态: done
- 验证方式: OpenUI完整定向63项通过/0skip，tsc与隔离生产构建/模块图通过。原历史3处错误及真实Qwen自动回复flat Table均不改原文即可validate/render；Chrome实测12V/4Ω=3A、明细/预设/流式终态保持、清空后12.5/4=3.125、零/非法输入提示、普通unbound三控件及纯填写值回填。真实同一Qwen主动UI/显式UI/明确纯文字已采样，原首例Table错误与120s短截止失败保留。教学示例另经f4旧SDK验证通过；原安全约束与输出预算策略保持。证据.data/openui-ohm-20261024/。
- commit: 80c6606b5113280e6e250356cd14f612be4237f9

## issue-2

- ID: issue-2
- 标题: 浏览器与真实模型验收并上线
- 范围: 隔离浏览器复现、真实模型自动选择、网页后端受控上线、原记录复验与保全
- 依赖: issue-1
- 验收标准: Chrome可操作原片段，新模型输出合法交互；业务/旧包/升级信任保持
- 状态: done
- 验证方式: 正式Chrome登录并打开原四消息记录，12V/4Ω=3A与明细正确；刷新重开后默认值及再次计算正常。63项定向回归、tsc、隔离构建/模块图、同一Qwen真实输出及原文回放通过。受控上线一次execute、verify和本机/公网关键资源全文SHA通过；保护文件/下载/更新信任保持，无重打包或移动tag。详见同名verification.md及私有.data/openui-ohm-20261024/证据。
- commit: 本次验收文档提交
