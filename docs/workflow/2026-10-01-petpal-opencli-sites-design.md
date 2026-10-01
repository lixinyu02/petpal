# OpenCLI 网站查询与默认启用

- Date: 2026-10-01
- Complexity: L2
- Status: done

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

## Delivery and Verification

2026-10-01已发布[v0.9.5预览版](https://github.com/lixinyu02/petpal/releases/tag/v0.9.5)，来源为`ddc1af06622b475492ae7c635abad3ba1da2d268`。Windows便携EXE/ZIP、Ubuntu x64/ARM64四个包及`release-manifest.json`、`SHA256SUMS.txt`六资产均核对正式URL、bytes及SHA256。四大包在draft阶段由四批Actions完成HTTPS镜像及GitHub完整字节读回，公开后复核同一asset ID和正式URL；没有在云端执行包，也没有在公开后重复全量下载四包。稳定版latest保持v0.9.1，Android沿用0.9.3，旧10项下载逐字节保持。

生产`/api/downloads`匿名401、认证200，返回`stale=false/error=null`及四个0.9.5预览包。Chrome3登录test后选择Windows ZIP/EXE与Ubuntu两架构，下载URL与安装提示正确，Android0.9.3可选；首次显示仍优先稳定版。验收仅使用自建标签页，没有更改既有对话或发出生产Agent任务。临时转传分支以预期SHA lease精确清理，main未变。

相关本地证据位于`evidence/opencli-sites-20261001/`：`actions-transfer/github-published-verification.json`、四项`*-cloud-verification.json`、`downloads-catalog-verification.json`、`downloads-ui-verification.json`、`published-downloads-x64.png`与`actions-transfer/temporary-branch-cleanup.json`。这些运行证据不进入公开源码。

## Production Process Recovery

转传期间原后端退出并导致HTTPS502；没有Node退出栈，不能依据相邻宿主日志断言原因。服务已恢复，在当前生产Windows服务器私有`.data`目录部署独立当前用户守护任务`PetPal backend current user`。它仅采用已确认的服务或恢复退出的自有进程，保留维护暂停标记；未知监听不接管，也不会自动处理HTTP卡死。守护没有打入桌面包或提交公开源码。

实际空闲受控恢复时activeRuns/pendingApprovals/runningMessages均为0，后端PID252228退出后由独立守护恢复为254908；state与token字节保持，可信HTTPS、enabled/queryReady与12站23命令通过。证据为`service-guardian-verification.json`。这不覆盖活跃Agent崩溃、断电或长期稳定性。

## Acceptance Limits

真实Codex0.143.0/GPT-6.1 Sol通过选定DesktopExecutor调用包内OpenCLI查询npm与V2EX，其余10站为worker联网探测。后台和执行电脑共处Windows，没有跨物理主机证据。Qwen初期经局域网及HTTPS网关补测失败，随后同日issue-68定位并修复累计分段消息的兼容问题；实际查询及公网test同线程续接已通过，见[后续验收](2026-10-01-petpal-qwen-cumulative-stream-acceptance.md)。Ubuntu两包完成完整归档、依赖与原生模块审计，实际UbuntuGUI未运行；Browser Bridge实际操作亦未验收。Windows最终便携EXE真实启动及查询通过，但未签名。库存179个适配器命名空间、1366命令包含本地应用，不能将库存表述为全部网站已可访问。
