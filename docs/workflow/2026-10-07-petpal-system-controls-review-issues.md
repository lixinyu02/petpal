# PetPal 系统控制与替我审批 Issues

- Date: 2026-10-07
- Complexity: L2
- Related design: 2026-10-07-petpal-system-controls-review-design.md

## Task Overview

- Goal: 系统音量固定工具和当前 Agent 模型的替我审批适配，准确的批准与等待状态。
- Ordering rule: 顺序完成 issue；同一 issue 内独立模块可以并行。
- Current status: issue-1/2/3 done；源码与本地验收完成，未部署或重新打包。

## Issue List

- [x] issue-1 系统控制、原生审核兼容和批准交互
- [x] issue-2 原生与浏览器实测及文档收尾
- [x] issue-3 独立命令审查模型与精简权限菜单

## issue-1

- ID: issue-1
- 标题: 系统控制、原生审核兼容和批准交互
- 范围: 固定音量/设置工具、版本绑定审核 catalog、Guardian 事件、规则音量审核、审批有效期、执行器能力、权限/批准 UI、包装与定向测试。
- 依赖: none
- 验收标准: 不扩大账号/模型/电脑授权；API Guardian沿用当前模型；通用桌面操作仍确认；到期与取消能结束等待；UI不重复提交；包装不遗漏；相关回归和tsc通过。
- 状态: done
- 验证方式: 完整回归 2195 passed / 1 skipped / 0 failed（concurrency=4）；默认跳过90秒Guardian deadline，已另行真实CLI独立验收。高并发首次已有stream取消fixture超时，单文件6/6及限制并发全量均通过。末次生命周期55/55；实际TSX审批20项、TypeScript、独立Vite build、包装成员/源SHA、diff --check、自审通过。
- commit: 8edebce

## issue-2

- ID: issue-2
- 标题: 原生与浏览器实测及文档收尾
- 范围: Windows音量恢复测试、可用上游真实Agent审查、Chrome权限和批准界面、能力/设备限制及使用说明。
- 依赖: issue-1
- 验收标准: 实际效果和失败边界明确、原音量/静音恢复、UI与原始回执一致、源码和已发布包分开报告。
- 状态: done
- 验证方式: 真实 Codex 0.143 Guardian：GPT/Qwen approved 并执行临时标记；deny/malformed/503/90秒期限均未执行。当前已授权 GPT/Qwen 上游 HTTP200 且真实 Guardian approved（父命令 fixture）。真实 GPT Agent 调用一次系统只读工具成功。Windows 实际音量 +1% 后在同一端点精确恢复原值12.023513019%，restored/passed=true。Chrome 实测权限、旧端禁用、审批单次提交及最终卡片消失；412x960 CSS 宽度无溢出。Ubuntu 仅 fixtures，未声称真实桌面验收。记录详见对应 validation.md，私有原始回执在 ignored evidence 目录。
- commit: 57801f6

## issue-3

- ID: issue-3
- 标题: 独立命令审查模型与精简权限菜单
- 范围: 用户额外要求的审查模型选择、账号授权与任务冻结、原生 Guardian/远程执行器真实路由、删除权限说明小字。
- 依赖: issue-2
- 验收标准: 默认跟随Agent；选择不同授权Responses连接时真实审查请求使用所选模型与凭据；并发/撤销/旧端不串用或扩大权限；前台Agent与Chat+Agent均可设置；权限菜单精简；定向回归与Chrome通过。
- 状态: done
- 验证方式: 最终全量2242 passed / 1 skipped / 0 failed（2243项、concurrency=4）。服务领域125/125、前端与真实TSX/hook160/160、native/config/transport58/58、原生CLI9 passed / 1 skipped、远程与桌面55/55及真实HTTP中继1/1通过。真实GPT→Qwen、Qwen→GPT独立Guardian均HTTP200并approved，批准后才执行临时标记（父Responses为fixture）。Chrome实测独立选择、静态小字删除、单次批准和412×960 CSS视口无横向溢出；TypeScript、独立Vite build和diff检查通过。首轮全量唯一失败为新增自动化API fixture完成等待超时；增强测试等待器后最终全量通过，未据此修改产品代码。详见validation.md。
- commit: this issue implementation commit
