# 内置 OpenCLI 网站查询

Windows／Ubuntu 0.9.5 和新版服务增加 `petpal_opencli_sites`、`petpal_opencli_query`。首次配置默认开启；已保存的关闭选择继续保留。公开查询无需 Chrome 扩展。

登录后新建 Agent 对话，选择执行电脑，再提出查询请求。例如：“用内置 OpenCLI 查询 V2EX 热门话题，给我三条链接。”Web／Android 由所选电脑或中央服务器执行；本机入口需要新版桌面客户端。

| 网站 | 已开放的查询 |
| --- | --- |
| 36氪 | 新闻 |
| V2EX | 热门、最新、话题详情 |
| Hacker News | 热门、搜索、帖子与评论 |
| npm | 包信息、搜索 |
| GitHub Trending | 热门仓库 |
| Wikipedia | 搜索、条目摘要 |
| arXiv | 搜索、近期论文、论文详情 |
| BBC | 新闻 |
| 掘金 | 热门、推荐 |
| 今日头条 | 热榜 |
| Steam | 搜索、游戏详情、畅销榜 |
| MDN | 文档搜索 |

共12个入口、23条公开只读命令。2026-10-01当前网络检查全部返回非空真实数据；npm、V2EX另由真实GPT-6.1 Sol及Qwen3.8 Flash Agent调用通过，其余10个为包内worker联网探测。Qwen早期失败已定位为工具间分段消息复用ID与累计文本的兼容问题，同日后端修复后公网test账号查询及同线程续接完成；详情见[验收记录](workflow/2026-10-01-petpal-qwen-cumulative-stream-acceptance.md)。

“连接与设置 → 电脑助手 → OpenCLI 网站工具”可查看、搜索库存与查询参数。中央服务由主账号管理；有完整Agent权限的桌面账号可管理此电脑自己的配置。任务调用遵循当前访问权限和确认设置。

固定OpenCLI1.8.8另打包179个适配器命名空间、1366项命令，其中包含本地应用。“仅打包”表示尚未在小伴开放，并不代表已经联网可用。Chrome网页操作另需Browser Bridge1.0.24+和明确选择在线档案；本轮未验收扩展实际网页操作。

## 2026-10-02 常用网站接入

用户提供的 notebook 与适配计划包含十三个目标网站；仅使用普通网站域名和通用功能定义，未提交历史统计、分享地址或凭据。新增 46 条浏览器只读查询，与原 23 条公开查询合计 69 条。清单包含 189 个命名空间、1400 个命令；这些库存计数含本地应用及未开放命令。

| 网站 / site ID | 本轮开放能力 |
| --- | --- |
| 电影云集 `dyyj` | 当前列表、页面读取、已有链接、必应站内搜索；支持两个域名 |
| 百度网盘 `baidu-pan` | 分享信息、可见根目录（depth=0） |
| Switch520 `switch520` | 列表、详情、已有链接、原生搜索 |
| Gamer520 `gamer520` | 列表、详情、已有链接、必应站内搜索 |
| 必应 `bing` | 网页搜索 |
| 电影港 `dygang` | 列表、详情、已有链接、必应站内搜索 |
| 围炉Go `wlgo` | 列表、详情、已有链接、必应站内搜索 |
| 百度搜索 `baidu-search` | 普通网页搜索 |
| 消防考试网 `fire-exam` | 公告、页面读取、当前登录状态页可见文本、必应站内搜索 |
| 贴吧 `tieba` | 热议、搜索、帖子读取 |
| 哔哩哔哩 `bilibili` | 搜索、热门、排行、视频、评论、历史和收藏读取 |
| 夸克 `quark` | 分享目录、登录账号目录；depth≤1、总条目≤50 |
| 迅雷云盘 `xunlei-pan` | 分享信息、可见根目录（depth=0） |

浏览器查询需要在**实际执行电脑**安装官方 [Browser Bridge](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)，然后在“连接与设置 → 电脑助手 → OpenCLI 网站工具 → Chrome 网页连接”明确选择在线档案并连接。工具不会自动选择档案、登录网站或解决验证码。Web／Android通过所选电脑执行；本机功能需要包含这次源码的新客户端，现有 0.9.6 安装包不会因后端更新而改变本机运行时。

“常用网站”展示所有十三站。六个自建站点可以保存新的 HTTPS 源地址覆盖默认域名，清空覆盖可恢复默认。Agent 不能自行扩大站点范围。`latest` 返回当前可见列表，不能保证网站的时间排序；网盘仅返回可见元数据，不保存或下载文件；消防 `status` 只读当前页面，不提交报名或推断未显示的成绩。已配置入口不等于联网或登录完成。

通过 `petpal_opencli_sites` 获取每条命令真实 schema，随后用 `petpal_opencli_query` 调用。例如 `site="bilibili", command="search", arguments={"query":"Live2D","limit":5}`。只读查询仍需要完整 Agent 权限，遵循当前审批；分享地址和提取码不会写进审批描述。来源检查不是网络沙箱，网页自身跳转可能在检查前发生，取消不会撤回已经发出的操作。

验收与限制见 [本轮记录](workflow/2026-10-02-petpal-notebook-sites-acceptance.md)。先更新网页/后端，不改已有安装包或签名更新清单。

升级会变更Codex工具版本，已有Agent对话需按界面提示使用新配置或新建对话。聊天记录和已暂停队列保留。Ubuntu包完成归档、原生模块和依赖审计；实际Ubuntu桌面运行仍待验证。

Qwen分段兼容同时在当前后端的中央执行和远程模型转发层生效。现有0.9.5客户端连接此后端时可收到标准消息流；已发布包的本机直连上游代码未因服务器更新而改变，本轮没有重打安装包。
## 首次使用：没有 Chrome 或扩展

OpenCLI 1.8.8 已内置，公开查询不需要浏览器。浏览器查询需要执行电脑上的 Chrome 和官方 Browser Bridge；Web / Android 只发送远程任务，不在手机安装桌面扩展。

在 Agent「连接详情 → 准备浏览器」或「设置 → 电脑助手 → OpenCLI → Chrome 网页连接」生成任务草稿。草稿保留你选择的电脑、模型和权限，不自动发送或提高权限；已有未发送文字/附件时会保留原内容。安装准备和打开商店页需要当前账号的完整访问及本轮审批；只读检测不需要完整访问。

固定工具 `petpal_opencli_setup`：

- `status`：只检查平台与 Chrome 文件，不运行会自动启动 daemon 的 `opencli doctor`。
- `install-browser`：从 Google 官方准备并验证安装器；返回 `prepared`、本机路径及用户下一步。它不是安装完成；用户在系统界面完成协议、安装或提权。
- `open-extension`：在执行电脑打开固定 [官方扩展商店](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)。扩展权限由用户确认；不强制安装、不改默认浏览器、不自动连接账号档案。

安装后再次检测，并在这台电脑的 OpenCLI 设置「检查连接」，明确选择在线档案。网页能打开、Chrome 已安装与 Bridge 可查询是三个不同结果。当前 Google 官方 Linux 下载提供 amd64 / arm64；Windows 本轮客户端支持 x64。旧客户端缺少 setup 工具时需更新客户端，不能用任意 shell/npx 替代。此次先上线网页/后端，冻结的 0.9.6 客户端没有重打。
