# Qwen 工具间分段消息兼容

- Date: 2026-10-01
- Complexity: L2
- Status: done

## Evidence

原生Qwen Chat与同源HTTPS Qwen Chat实际均完整成功。真实Codex/选定DesktopExecutor/OpenCLI测试HTTP200，但在工具间新增assistant message时失败。完整流捕获证明同一source message id被复用到多个output_index；后段delta只有新增文本，而text.done/part.done/item.done及completed.output为每段当时的累计快照。原normalizer严格比较本段delta与累计text.done并拒绝；此前“连接中断”只是安全概括，并非本轮网络超时。隔离证据位于忽略目录`evidence/qwen-recheck-20261001/`。

## Goal and Scope

只对明确的Qwen模型处理此累计message格式，使已发布远程PC也能通过更新后的中央relay使用。保留model/provider配置、推理none、账号权限、任务幂等、审批、tool身份/参数、终止帧和EOF检查。不改上游网关配置、用户历史、默认模型或安装包；不自动重跑生产任务。

## Solution

新增消息映射器，以response作用域、output_index与原id绑定分段。重复assistant message只可引用此前同id且已完整结束的较小index；后段每个output_text结束文本必须严格等于上一段已验证累计前缀加本段原始delta。剥离精确前缀、给后段生成唯一message id，并一致映射added/delta/done/part/item/completed/done。最终output仍需与每段已结束的原始快照完全匹配；缺失、冲突或模糊文本一律拒绝。工具与reasoning不参与别名或文本改写，参数/身份门禁保持。

中央executor relay在凭据脱敏前应用映射，现有0.9.5 PC随后收到标准分段；直接本机/中央Codex transport按实际请求model应用同一映射。已标准化的流可再次处理且保持不变，其他模型默认不启用。所有大小/时间/取消限制继续有效。

## Verification and Delivery

构建真实缺陷的脱敏合成回放，覆盖多个工具交织、message alias、累计快照、双重处理；负例覆盖前段未完成、前缀或delta冲突、最终快照变更、工具身份/参数变化、缺completed/EOF和别名冲突。运行transport/relay/executor/Codex相关回归。真实Qwen Agent必须查询npm与V2EX并完整结束，再同线程续接；Chat保持通过。

后端部署前核对当前服务身份及空闲边界，私有备份，仅更新后端源码并用既有独立守护恢复；服务状态、令牌、暂停队列及旧下载保持。以当前test账号、独立验收会话和现有客户端兼容路径完成公开HTTPS验收，清理仅本轮验收会话和登录。不据此宣称Ubuntu实机或长期稳定性。

## Result

170项相关回归通过（含20项分段映射正反例），真实Codex/选定DesktopExecutor/Qwen完成5轮模型请求与npm/V2EX包内查询。后端空闲受控重启后state/token逐字节保持、16个下载文件及1个目录的size/mtime保持。公网HTTPS test账号Qwen/none查询成功，同线程续接返回1.8.8与标记；本轮会话删除、独立登录退出，原有会话逐对象保持。旧客户端严格normalizer经中央映射的合成回放通过；未重新执行整份已发布PC包或重打安装包。完整边界见[验收记录](2026-10-01-petpal-qwen-cumulative-stream-acceptance.md)。
