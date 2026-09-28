# 本机 Responses 配置与后台服务

- Complexity: L2（实际网关省略 Responses item 事件，需增加 CLI 传输兼容层）
- 范围：确认 Windows 便携版使用方式；给用户指定的服务配置 PetPal 独立 Codex；启动当前源码服务；生成包含本次兼容修复的 Windows 0.6 便携版。
- 当前 Windows 0.5 EXE 自带后台，回环随机端口，用户数据在 Electron userData。源码服务使用独立 `.data` 和固定回环端口 4318，两者不共用配置，也不能用源码启动宣称旧 EXE 已升级。

默认继续拒绝远程 HTTP。部署者可用 `PETPAL_CODEX_HTTP_ORIGINS` 列出精确 HTTP origin，启动时解析并捕获，仅匹配规范化 scheme/host/port，不接受路径、凭据、查询、通配符或 API 自授权。已有配置与后续 PATCH 使用同一约束。

本机启动入口读取 `.data/service-settings.json` 的非凭据部署设置，隐藏启动 Node 后台，记录 PID 和私有日志，等待健康检查后返回访问地址。服务仅监听 127.0.0.1；不增加防火墙规则、外网监听、系统服务或开机启动。API Key 只存在忽略的私有数据文件中，不作为命令参数、日志或 Git 内容。

先查询用户给出的模型列表，再选择存在且适用于 Codex 的模型，并以只读独立工作区请求一句固定测试回复。若远端不可达，仍完成本机服务启动，保存待配置材料并明确报告外部阻塞；不编造模型 ID 或将未执行请求标记为成功。

验证：默认/例外/越域/重启单测，真实健康与模型端点，服务身份/后台 PID，真实 Codex 小请求（远端可用时），源码凭据扫描。停止仅使用本次拥有的进程，不碰用户其他 Codex、OpenCLI 或全局配置。

## Responses 流兼容

实际服务的非流式响应包含完整 assistant 输出，但 SSE 省略 `response.output_item.added` / `response.output_item.done`。Codex 0.143.0 因而正常结束但没有可显示文本，不能仅凭 HTTP 200 或 turn/completed 判成功。

API 模式由每个 CodexBridge 拥有一个只监听回环随机端口的适配器；它只接受带随机本机 token 的 `POST /responses`，上游固定为已验证配置，固定使用服务端持有的密钥，禁止重定向和转发客户端 Cookie/任意头。CLI 获得本地 token；公开配置保留实际上游地址。正文、响应累计大小和超时有界；客户端断流、停止或退出中止上游并回收监听端口。

标准事件不重复。对已提供 item_id 的文本增量补缺失的 message/part 起始事件，最终 output 可补 item 完成事件。函数调用须等待真实完整的 name/call_id/arguments，不能凭片段猜测并执行工具。所有工具仍经过既有审批和权限边界。无有效终止、解析错误和空回复均明确失败。

验证增加规范流、不完整流、文本与工具调用、取消/退出、固定上游和认证边界、真实内置 CLI 对受控 fixture 的回归。最后使用用户模型验证一条无工具的简短回复。API 调试原始材料保存在忽略目录；公开记录只写脱敏结论。

## 桌面私有部署设置

为保证新 EXE 双击时仍能读取已授权的 HTTP 例外，桌面端从 Electron userData 的 `service-settings.json` 读取唯一字符串字段 `codexHttpOrigins`。进程显式环境变量优先，含空字符串；缺文件默认关闭例外。格式或权限错误明确阻止启动，不回显文件内容。读取限制 64 KiB 并严格验证 UTF-8 和 origin。模型、API 路径和密钥仍由既有设置接口独立写入桌面 `data`，不复制源码的账号、令牌或历史。

Windows 打包与字节回读必须包含新 transport 和 desktop settings helper；Linux 打包/校验清单同步更新，但本任务不宣称已经重建或实测新的 Ubuntu 包。

## Windows 置顶回归

实际便携包启动检查发现 `floating` 层级没有保留置顶标记。隔离的 Electron 原生窗口对照探针同时读取应用状态和 `WS_EX_TOPMOST`，确认 `pop-up-menu` 是当前 Windows / Electron 运行环境中能保持标记的最低层级。只对 Windows 选择该层级，其他平台保持 `floating`；显示后重复设置和强制切换开关均未解决问题，因此不保留这些尝试。修正后先完成隔离源码 smoke，再重新打包并从最终 EXE 验证，不降低验收条件。
