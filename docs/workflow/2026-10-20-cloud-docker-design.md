# 小伴云端 Docker、服务配对与远程桌面

- Date: 2026-10-20
- Complexity: L2
- Reference: Codex Remote 会话 01a119c9-3aa2-7bf3-8659-eb58dcaa3782，E:/codexsdk 只读参考；API Harbor 与 Docker Platform 按当前源码契约验证。

## 目标

Agent 与 Chat+Agent 在同一入口明确选择实体机或云端 Docker；现有排队、审批、引导、图片、项目目录、自动化与记忆保持。增加 Docker Platform 与 API Harbor 各自独立的一键配对，Web 侧栏按需打开所选容器的远程桌面。配对、可用镜像、健康 CLI 和真实任务完成分别验证。

## 接入与隔离

中央管理员管理平台连接；所有长期凭据只存服务器私有加密目录，不进入前端/URL/镜像/日志。配对首发前保存 instanceId/requestId/随机 credential，未知送达保留同一身份，不盲目生成新凭据；只有上游确认后就绪。Docker Platform 使用 /v1/pair → /v1/confirm；Harbor 使用 service-links exchange/receipt/confirm。Harbor 当前仅接受 codex-remote，增加明确 petpal receiverType 的兼容迁移及隔离联测，不借用其他产品凭据；不自动升级或修改生产 Harbor 数据。

云目标独立持久 UUID，绑定本小伴账号、平台项目、执行节点及容器代次。普通用户只看自己的目标，管理员可管理全部。停止/重建/失联不能把任务改派到实体机或中央；队列和自动化冻结 hostId、目录、模型、权限与授权。执行时解析当前目标与代次，旧线程跨目标重置，未知执行保留现有恢复机制。

## 运行环境

提供受控本机 Docker 与已配对 Docker Platform 适配器。仅管理小伴创建并确认归属的容器/项目；固定镜像、参数、资源及私有工作卷，不挂载宿主 Docker socket，不发布未认证桌面端口，不清理其他项目。Windows Docker/WSL 放独立适配层；Ubuntu 使用同一 Node 协议。缺少 Docker、镜像或平台时显示实际不可用原因。

复用 Codex app-server 的任务语义与中央模型代理，不向容器发送上游永久 API Key。容器模型请求绑定活动任务、用户和所选模型，结束/撤销失效。官方登录模型若尚无等价受控转发则明确不支持，不偷偷改用其他模型。容器目录为 Linux /workspaces/project，禁止把 Windows/中央路径当容器目录。

## 前后端契约

新增 /api/service-links 与 /api/cloud-docker 命名空间，全部要求登录；修改连接要求管理员。执行目标列表扩展 kind=docker，原 central/desktop 默认行为和普通用户隐藏规则保持。管理器向现有 Agent 流程提供 list/hostFor/target/isBusy/bind，统一处理 Chat 派发和自动化。

前端增加「云端环境」页和「服务互联」设置。Docker 列表提供模板/节点、创建、启停、实际状态及打开桌面；同一执行目标选择器分组显示实体机和 Docker，离线目标保持选中但不自动切换。右侧桌面面板保留对话节点，关闭立即断开；412×960 使用可收起抽屉，不挤压输入区。noVNC 固定依赖且 lazy 加载。

桌面不使用猜测 iframe URL。后端为已验证的用户/实例/会话签发短时单用途票据，同源 WS 代理固定 service-vnc RFB。校验 Origin、归属、会话、状态/代次；退出、撤权或停止立即断流；限帧/连接数/背压。代理不接受任意目的地址、端口或命令。

## 验收与发布

先在隔离数据根验配对真实协议、不同账号隔离、失败/超时/注销、云/实体机不误派、任务/审批/取消/目录/模型、远程桌面及移动布局。真实 Docker 验收与模拟协议回归分开记录；当前可用引擎需 fresh 核验 socket，不沿用 Memobase 旧地址。Chrome 插件验网页并保存截图。上线小伴前 fresh idle、固定回退与私有备份，保留聊天/代理/记忆/下载/升级数据；不顺带发布客户端或升级其他产品的生产服务。
