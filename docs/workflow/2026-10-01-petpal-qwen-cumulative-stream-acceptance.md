# Qwen 累计分段消息修复验收

日期：2026-10-01，issue-68。

## 原因

用户观察Chat正常属实。原生LAN Qwen和同源HTTPS Qwen的Chat请求均HTTP200且完整回复。三次真实Agent重试收到HTTP200，前期已执行工具发现，但在后续请求的消息结束帧失败，不是30秒idle超时。

完整源流显示同一assistant message id用于不同output_index：首段文本结束后插入function_call，后一段仅新增换行，其text.done、part.done、item.done和completed.output却返回累计文本。旧normalizer正确拒绝了“本段delta与累计快照不同”，并且最终输出有重复id；此前“模型连接中断”只是对Codex失败的安全概括，不能作为网络断连结论。

OpenAI Docs的[Responses工具参数结束事件](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.function_call_arguments.done)明确提供item_id、output_index和最终arguments。本修复保持工具身份及arguments一致性校验，不用工具参数修补替代消息兼容。

## 修复及回归

仅明确Qwen模型启用adapter。后段message只有在前段已完整结束、累计文本严格等于已验证前缀加本段delta时才可剥离前缀，并映射唯一message id。所有终态逐段回核原始快照，工具字段不动。别名段的非空annotations或非空初始part文本拒绝，避免裁前缀后引用偏移失效。completed、EOF、大小、时间、取消和权限边界继续保持。

中央模型relay在脱敏前标准化帧，使现有远程PC无需自己的新adapter也能读取；直接Codex transport按实际请求model使用同一mapper，标准帧二次适配保持不变。未来Windows/Linux包的必需源码清单加入新模块。

相关transport、relay、Codex、executor、Agent队列、provider和打包入口回归170/170通过，包含20项新测试。覆盖第三段累计、空/缺delta、交织工具、最终快照冲突、id冒用/碰撞、非空annotations/初始text，以及旧客户端normalizer兼容；GPT同坏流保持拒绝。没有以Chat成功替代Agent验收。

## 实际调用与上线

隔离后端、真实内置Codex0.143.0、选定DesktopExecutor、Qwen3.8 Flash/none完成5次Responses请求，各自HTTP200/completed/EOF。实际调用3次petpal_opencli_sites、npm/package和v2ex/hot；包内查询返回版本1.8.8及3条热帖，两条Chat复测仍通过。

确认本机Chat/Agent/待审批/未暂停队列与语音服务空闲、核对精确进程身份和监听后，经现有独立守护受控恢复后端。原PID254908→254136，state/token字节保持，2账号、5模型连接、31会话、1条暂停队列保留；16个下载文件和1个目录的size/mtime不变，可信公网HTTPS健康200。

公网`https://magicdatou.top:44318`登录test，在中央执行入口以Qwen/none真实完成npm/V2EX查询。同一thread继续对话正确返回1.8.8和QWEN_AGENT_CONTINUE_OK；两轮status均completed。本轮独立会话删除、登录退出，原有test会话逐对象比较保持。

私有证据在忽略目录`evidence/qwen-recheck-20261001/`：result.json、result-agent-repeat.json、result-capture-final.json、result-fixed.json、deployment.json和public-agent-result.json。raw normalizer重放只用于定位上游源格式，修复后该raw回放仍可指出原始缺陷，但实际经过mapper的Agent已完成。凭据、原始源流及用户状态不进入公开源码。

## 边界

本机后端与执行电脑同处Windows，没有新增跨物理主机或UbuntuGUI验收。旧PC路径通过中央relay→旧strict normalizer回放验证，没有重复执行整份0.9.5包。本轮只更新服务器和源码；已发布包的本机直连上游代码不随服务器更新改变。Release六个资产及其来源提交/校验值保持，后续打包会包含新模块。本轮结论是当前请求与续接通过，不代表长期稳定性或所有Qwen网关格式均兼容。
