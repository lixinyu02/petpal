# 已有历史记忆提炼接续

- Date: 2026-10-26
- Complexity: L1
- Status: final

## Background

用户发现长期记忆疑似停止更新。只读核查完整档案已落库，zut 625组中原生确认86组、任务检查点82；dds 199组中原生确认14、检查点9。2026-10-25 14:57 UTC 两个缓冲因 PETPAL_MEMORY_MODEL_FAILED 标为failed，有限接续脚本安全退出，未继续投递。

## Goal

保留完整历史、epoch和事件/缓冲/blob原ID，验证当前模型链路，安全处理已有失败缓冲，再接续原作业。

## Non-goals

不重建用户记忆库，不重新导入档案或重复insert blob，不在未知部分写入情况下盲重试，不修改模型选择/学习开关，不把后台运行等同于全量完成。

## Solution

当前 halogen-qwen3.8-flash-next 在真实记忆API容器内，两个账号各一次合成请求并发2/2成功。只有核实原native event fingerprint/epoch、无processing、失败缓冲创建后无profile/event更新，且已pg_dump备份时，才调用官方flush_buffer_by_ids，选择既有failed缓冲；每个只进行一次显式恢复，保留日期/ID。不经insert重新投递。

恢复后确认done与原生同步检查点，使用既有作业ID和已绑定plan继续剩余批次。接续器仅在原队列空、无未知写入、全部既有事件逐字段对账后resume；错误保留公开原因，不绕过failed或反复发同一blob。

## Impact

本轮优先为运行恢复和验收，私有脚本/凭据/聊天原文只进忽略目录，生产后端、数据库容器和模型路由不需要重启。

## Risks

上游当前合成请求成功不证明未来或历史大请求稳定；后台全量耗时长。旧检查点落后于原生确认是可对账状态，不直接补写计数。失败后若发现部分profile/event写入，停止本次恢复，保留资料再核查。

## Verification Plan

原档案/plan/事件ID/日期对账；模型双并发；pg_dump与缓冲证明；done和新学习进度实证；最终状态和剩余量明确。
