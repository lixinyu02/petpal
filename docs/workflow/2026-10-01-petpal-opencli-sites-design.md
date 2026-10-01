# OpenCLI 网站查询与默认启用

- Date: 2026-10-01
- Complexity: L2
- Status: updated

## Background

内置 OpenCLI 1.8.8 包含 179 个适配器命名空间、1366 个命令（含本地应用），当前 Agent 只暴露两个音乐官网的有限浏览器动作。用户要求列出网站能力、真实 Agent 调用并默认启用。

## Goal

提供可发现、可审阅的固定网站查询命令；新配置默认启用且保存关闭选择；Windows/Ubuntu 本机执行与中央服务均可配置；真实 Codex/第三方模型/远程执行电脑验证。

## Non-goals

不宣称所有上游适配器均可调用或已联网验收。不开放任意 CLI 参数、脚本、模块路径、自定义适配器、插件、cookie 或本机密钥。不替用户登录第三方网站、发帖、购买或授权网站账号。现有音乐浏览器入口保留。

## Solution

1. 增加 OpenCLI manager：按 instance/user scope 持久化 revision/enabled，默认 true；配置读取不启动 daemon 或联网。中央服务缺失会话所属账号时拒绝执行，使用独立 browser runner 与租约。PC outbound executor 使用自己的账号 scope，可信 IPC 管理本机配置及连接。
2. 从固定 1.8.8 manifest 生成库存，区分打包的适配器、PetPal 开放的查询命令、需要 Browser Bridge 的命令及尚未开放的命令。查询工具返回具体参数；设置页支持查询网站列表。
3. 已审阅的公开只读查询使用独立子进程，仅导入内置精确模块与上游执行器，不加载 HOME 下适配器、插件或普通 CLI 入口。不接受额外参数、URL、路径、凭据与表达式。参数类型、长度、范围、输出字节数、超时、取消均受限。输出脱敏、失败明确回传。
4. `petpal_opencli_sites` 负责发现，`petpal_opencli_query` 负责调用。实际查询与 browser 操作仍要求完整访问并遵循 ask/auto/review；库存状态读取无副作用。关闭后禁止新调用，断开自身页面/daemon，不终止共享进程。
5. 更新 Codex toolVersion 与任务提示、中央 owner 配置 API、PC IPC 和设置 UI。网页/Android 借选定执行电脑使用；新增本机功能需要新版 PC 包。

## Impact

新增可选配置文件，不改账号、聊天与模型密钥结构。旧关闭值保持；没有旧 OpenCLI enabled 字段时首次配置默认开启。兼容现有 Browser Bridge1.0.24+和OpenCLI1.8.8。

## Risks

上游 read/public 元数据不保证匿名或无本机读写，故采用人工审阅清单。网络站点可能限流、地区封锁或改接口；库存支持与实时可达性分别呈现。Browser Bridge来源策略不是网络沙箱。多账号共用端口但不共用profile/页面租约。异步取消必须等待子进程退出，禁止自动重试未知结果。

## Verification Plan

固定清单和参数拒绝测试、关闭持久化/CAS、账号隔离、超时/输出/取消及共享daemon回归；API认证和可信IPC测试；生产Web build和Chrome412×960。用真实内置Codex注册动态工具、第三方模型、DesktopExecutor执行至少两个公开网站查询，并记录调用与读回；若扩展可用补浏览器测试。部署保留数据/下载与停止任务边界；新版Windows实际启动/包内查询、Ubuntu双架构完整归档与依赖审计。浏览器和包审计不代替UbuntuGUI验收。
