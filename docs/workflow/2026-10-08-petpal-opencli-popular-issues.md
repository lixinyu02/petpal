# OpenCLI 常用网站扩展 Issues

- Date: 2026-10-08
- Complexity: L1
- Related design: 2026-10-08-petpal-opencli-popular-design.md

## Task Overview

- Goal: 增加七个常用网站、十一项可调用查询并进行联网验收。
- Ordering rule: Complete issues in sequence.
- Current status: issue-1 done; issue-2 todo

## Issue List

- [x] issue-1 固定政策、查询与回归
- [ ] issue-2 本机服务与浏览器联网验收

## issue-1

- ID: issue-1
- 标题: 固定政策、查询与回归
- 范围: 新增站点政策、builtin DOM/API 提取、设置说明与必要回归。
- 依赖: none
- 验收标准: 七站/十一项结构化只读查询；参数/来源有界；真实链接、ID不丢精度；登录/验证/空数据错误明确；通用全站访问保持。
- 状态: done
- 验证方式: 十个相关文件共133项回归通过（并发2、每项15秒上限）；新查询/政策/来源针对性43项通过；TypeScript、diff检查与保留dist/downloads的生产构建通过。初次全并行回归挂起，终止精确测试进程；定位并更新旧目录13站断言，串行及有界并发复验通过。自审确认三个新增GET路径固定、没有读登录源或写站点动作，ID精度/参数转义/结果身份与空数据回归通过。
- commit: 本issue提交

## issue-2

- ID: issue-2
- 标题: 本机服务与浏览器联网验收
- 范围: 生产构建、无任务更新、本机内置桥实际查询与 Chrome 设置显示。
- 依赖: issue-1
- 验收标准: 新目录上线；每站记录实际成功或具体阻塞；账号/会话/配对/下载保持；不宣称未完成登录的站点已通过。
- 状态: todo
- 验证方式: pending
- commit: pending
