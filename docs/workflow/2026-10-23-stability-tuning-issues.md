# 服务与聊天稳定性调优 Issues

- Date: 2026-10-23
- Complexity: L1
- Related design: 2026-10-23-stability-tuning-design.md

## Task Overview

- Goal: 修复已确认的服务恢复缺口与聊天停止竞争。
- Ordering rule: Complete issues in sequence.
- Current status: all done

## Issue List

- [x] issue-1 守护恢复与健康状态可靠性
- [x] issue-2 停止请求绑定本轮并完成网页验收

## issue-1

- ID: issue-1
- 标题: 守护恢复与健康状态可靠性
- 范围: 服务启动回执、受版本管理的守护脚本、既有 Windows 计划任务恢复与隔离测试
- 依赖: none
- 验收标准: 周期恢复保留身份/维护/互斥保护；仅健康检查成功才报告恢复；回执不被读取为半文件；本机与公网恢复且业务数据保持。
- 状态: done
- 验证方式: Windows PowerShell 5.1/7 及相邻部署回归 27/27；并发读写连续8轮16/16。实际周期恢复31.67秒、后台PID保持；最终helper单守护加载，本机与公网健康200，匿名状态401。详情见validation。
- commit: 本 issue 提交

## issue-2

- ID: issue-2
- 标题: 停止请求绑定本轮并完成网页验收
- 范围: Chat 前后端停止任务身份核对、迟到请求回归、构建部署与 Chrome 验收
- 依赖: issue-1
- 验收标准: 停止上一条后快速发送下一条不会误停新回复；当前回复正常停止；保持鉴权与账号隔离。
- 状态: done
- 验证方式: 最终组合243项全通过；TypeScript、隔离生产构建、49模块OpenUI入口图检查通过。Chrome真实Qwen停止后重发完成，网络请求核对停止ID匹配原轮且下一轮不同；412×960无溢出/错误提示。网页与后端已部署，4账号/5模型/49下载保持；详见validation。
- commit: 本 issue 提交
