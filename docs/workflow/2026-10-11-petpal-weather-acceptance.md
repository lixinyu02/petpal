# 国内天气查询验收

- 日期：2026-10-11，Asia/Shanghai。
- 实现提交：`e0344b3`（issue-1）。
- 结果：六项公开查询完成，当前中央后端已加载；未重打 0.9.11 客户端。

## 可用能力

中国天气网 `weathercn` 提供 `locations`、`search`、`forecast`，中央气象台 `nmc` 提供 `provinces`、`locations`、`weather`。目录当前为 29 项公开、57 项浏览器查询，共 86 项。原上游 OpenCLI 1.8.8 的 23 项公开查询仍单独校验 manifest，没有放宽到任意模块。

天气通过隔离 worker 查询固定官方 HTTPS 主机，无凭据 GET，不需要 Chrome、扩展或 API Key。地点候选保持行政层级、候选数量和歧义标记；不会默认选同名地点第一项。区县和乡镇页必须有对应的自身七天导航 ID，URL 变更重定向拒绝。中央气象台使用官方目录的地点 code，WMO 五位站号不可替代。

## 联网验收

最终用实际 OpenCliManager 启动隔离 worker，覆盖全部六个命令，八次查询均成功、非空；本次网络耗时约 271–610ms，不能当作长期延迟保证。

| 查询 | 结果 |
| --- | --- |
| NMC 省份目录 | 34 项 |
| NMC 上海地点搜索“浦东” | 1 项，使用目录真实 code |
| NMC 浦东实况与预报 | 实况及七日预报非空，各部分时间独立 |
| 中国天气网行政搜索“朝阳” | 9 候选，有歧义标记 |
| 北京朝阳预报 | 七日及三小时分时，身份为北京 / 朝阳 |
| 辽宁朝阳预报 | 七日及三小时分时，身份为辽宁 / 朝阳 |
| 上海 / 浦东新区搜索“北蔡” | 唯一北蔡镇候选，`101020600001` |
| 北蔡镇预报 | 七日、104 个分时点，覆盖 10月11日08:00 至 10月18日05:00，北京时间 |

Chrome 插件核对了浦东区县、张江镇以及北蔡镇官方页面。北蔡镇页呈现正确乡镇、7天导航和明天天气；页面本身没有可信发布时间，未将其浏览器合成更新时间当作数据发布证据。官网部分温度在图表而非 DOM 文本显示，CLI 温度来自该页固定 JSON 数据，不把空 DOM 文本当成完整数值视觉验收。

官方北蔡镇页面：<https://forecast.weather.com.cn/town/weathern/101020600001.shtml>。

## 实际模型与后台任务

当前配置 GPT-6 Luna / max 完成两条实际路径：独立隔离 CodexBridge 动态工具调用，以及正常中央服务 HTTP Agent 提交。HTTP 任务指定 `hostId=central`、当前账号已授权的完整访问/自动执行；没有修改账号授权或默认权限。

成功任务的原生 Codex session 记录包含 `petpal_opencli_sites(weathercn/search)`、`petpal_opencli_query(search)`、`petpal_opencli_sites(weathercn/forecast)`、`petpal_opencli_query(forecast)`，真实搜索 ID 为 `101020600001`。最终回复说明北蔡镇、10月12日晴转多云、18–25°C，并明确 `published_at` 未知、乡镇预报不代表门牌实况。未用 shell 或浏览器代替工具。这是本次采样预报，后续以重新查询为准。

新增“天气接入验收 · 北蔡镇”会话已归档。首轮验收脚本把 `streaming` 当作终态，提前停止该合成任务；修正脚本后复用同一会话第二次完成。首轮回执保留，不将脚本误判描述为模型或天气接口故障。

管理员通用 `/api/desktop-tools/action` 探测未携带会话所属账号上下文，受到既有账号隔离保护而失败；天气任务已改用正常 Agent 提交验收，没有为探测绕过账号校验。

## 回归与审查

相关 OpenCLI 模块及 desktop-tools **234/234** 测试通过；语法检查、`git diff --check` 通过。新增天气测试为中国天气网/common/worker 28 项、NMC 21 项。覆盖同名身份、真实子进程同主机换站拒绝、最终 URL 保留、JSONP 不执行、缺测、全空数据、逐行旧时间、乱序日期、跨年/闰日、乡镇昨日温度排除、包内模块闭包。

自审及并行只读核查发现的问题均修复：同名页面只按中文标题校验不足；bounded Response 丢 URL；NMC 全缺测误成功；公告时间掩盖逐日旧时间。未改变上游版本或动态工具版本：既有 sites/query 工具名和 schema 不变，目录动态发现，恢复线程会重新传入天气指引，无需重置用户现有会话。

## 服务更新与保持

更新前 activeRuns、待审批、桌面工具和网站查询均为零/空闲，队列为空。私有目录保存业务状态、访问令牌、服务设置、OpenCLI 配置及改动前的服务源码备份。首次重载辅助脚本因 PowerShell 自动日期转换丢失时区而在身份校验前停止，未停止服务或写维护标记；改为保留 ISO 字符串后准确核对进程身份，执行一次实际重载。

原后端 PID37528；新后端 PID59700，版本仍 0.9.11。guardian 已确认监控新 PID，维护标记清除。本机和 `https://magicdatou.top:44318` 的 health、两站目录均 HTTP200，均为 29/86。

重载前后业务 JSON 哈希保持（仅排除 sessions、executionHosts、notifications、updateTrustState 四个正常运行元数据），私有配置文件哈希保持。实际任务之后再次确认 instanceId、ownerId、账号、模型连接、设置、Codex配置、项目以及原有所有会话保持；只新增上述归档验收会话和正常任务通知。最终 activeRuns=0、pendingApprovals=0、queryBusy=false。

原始公共采样、worker、服务与模型回执位于本机 `evidence/weather-20261011/`，Git 忽略；私有备份仅在 `.data/backups/weather-20261011-*`，不提交凭据。关键回执：`manager-live-final.json`、`beicai-live-r1.json`、`agent-live-r1.json`、`production-agent-live-r2.json`、`server-tool-live-r1.json`、`service-before.json`、`service-after.json`、`service-final.json`、`targeted-tests-final.log`。

## 精度与发布边界

能匹配北蔡镇等官方已有数据的乡镇街道。区县预报、测站观测和乡镇预报分别注明空间类型；不宣称小区、门牌实况或未知网格分辨率。乡镇发布时间未知保持 `null/unknown`；NMC 每行保留自己的 pt，陈旧、缺失或未来发布时间不会被公告头提升为 fresh；历史逐小时观测单独输出。来源可能共用中央气象台数据，不能称为独立数值模式一致或保证天气绝对准确。

Web/Android 选择当前中央服务器可使用；已发布的 0.9.11 桌面客户端本机模块没有被此次后端更新替换。Windows/Ubuntu 下次打包会纳入新模块，五个源文件已列入必需闭包并自然 unpack。此次未测试新版原生客户端，未变更安装包、签名更新清单、板端服务、固件或路由器。
