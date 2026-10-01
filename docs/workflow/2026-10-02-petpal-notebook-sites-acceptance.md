# 网站适配验收记录

日期：2026-10-02。源附件仅只读解析；未执行 notebook，原始附件与历史统计未入仓。

## 当前验证范围

- 13 个目标站点，46 条新增固定浏览器只读查询；保留 23 条公开查询，共 69 条 / 25 个查询入口。
- 合并库存 189 个命名空间 / 1400 条命令。库存不等同于实际可访问网站数量。
- `node --test --test-concurrency=1 tests/opencli*.test.mjs tests/desktop-tools.test.mjs tests/codex-config.test.mjs tests/desktop-executor.test.mjs tests/execution-hosts.test.mjs`：158 / 158 通过（PowerShell 实际展开 glob 为文件参数）。原生 siteOrigins 白名单/CAS/旧配置持久化与关闭失败恢复已补回归。
- `npm run build`：TypeScript 与 Vite 通过。既有动画 chunk 体积提示仍存在。
- 实际 `OpenCliManager.query()` 公开 worker：npm 的 OpenCLI 包信息 1 条，V2EX hot 2 条。没有执行账号写操作。

## Chrome 页面与界面

使用 Chrome 插件查看目标页面。电影云集主站可见帖子；备用站当时无帖子列表。Switch520、Gamer520、围炉Go 可访问，观察到的 www 跳转已加入默认来源。消防网可见公告，路由 `/#/tzgg` 已适配。百度/必应可见搜索结果；贴吧/B站首页可见；夸克/迅雷可见登录入口。

电影港返回 `ERR_CONNECTION_CLOSED`，未通过真实访问。百度网盘被 Chrome 工具的站点安全策略阻止；未通过其他工具绕过，只有代码与 fixture 验证。受登录保护的收藏、历史、网盘目录未用用户账号实测。

隔离管理界面已通过实际输入、保存、清空恢复默认网址，保存后输入为空且默认域名显示正确。响应式 DOM 实测 CSS viewport 412 × 960、document.scrollWidth=412，OpenCLI 行与输入横向溢出数为 0。首次设置页的 412 截图请求超时；issue-3 后续已保存浏览器准备草稿的 412 界面截图。截图像素尺寸受浏览器缩放影响，CSS 尺寸以 DOM 为依据。临时 viewport 已恢复。

## Bridge 与真实 Agent 链路

自有 daemon 的只读连接检查为 extension.connected=false、profiles=[]。自有 daemon 随后关闭。没有在线 OpenCLI Browser Bridge 档案，因此未完成 Agent → 所选电脑 → Browser Bridge → 新站点的真实查询。Chrome 页面能访问与 Bridge 查询成功分别记录。

安装与环境引导已完成 issue-3；扩展授权、显式 Chrome 档案选择及网站登录仍由用户完成。生产部署与只读 Agent 环境检测的结果见下节；它们不替代新站点的 Bridge 查询验收。

## Chrome / Bridge 准备验收

- 相关回归 344/344 通过；真实 Google 下载发现 gzip 透明解码与 Content-Length 不一致，已固定 identity 编码并拒绝不一致响应。此后安装/registry/manager/native/UI/草稿相关最终 108/108 通过，其中安装模块 34 项。
- 网页 TypeScript / Vite 构建通过。Chrome 实际点击准备按钮后进入未发送 Agent 草稿，当前电脑仍为中央服务器，权限仍为只读、需要时询问；没有提交任务或扩大权限。
- 新引导的窄屏 Agent 页面实测 CSS 412×960、scrollWidth=412、相关控件溢出为0；截图保存在忽略的私有测试目录，viewport已恢复。
- Windows 真实检测确认已有 Chrome，helper PowerShell AST 通过。
- 为测试下载分支，在独立私有目录真实准备官方 Google MSI，并通过 Valid + Google LLC Authenticode 和私有ACL检查。168,673,280 bytes；SHA256 `e744ffd35f5af8d453443a1a20d96a749f396c39d2e6238868f375ea519d8dc9`。结果为 `prepared / installed=false / userActionRequired=true`；未启动安装器。
- 真实 Google key → InRelease → amd64/arm64 Packages 签名/哈希链由 Windows Git GnuPG 验证通过；包版本154.0.8037.92-1。没有下载完整DEB，也没有在Ubuntu目标机执行安装。Ubuntu ARM64已有官方包，不能沿用旧版不支持判断。
- 新工具只允许 status/install-browser/open-extension，下载与商店打开继承所选电脑的账号 scope、完整访问与审批；不提供自定义网址、命令、profile或插件加载。
- Web/Android任务发送给所选电脑。本轮未重打冻结0.9.6客户端，旧客户端本机缺新工具时应更新客户端，不能认为服务器部署已替换其运行时。

## 网页 / 后端上线与真实 Agent 验收

- 确认生产主账号没有 running / stopping / unknown 或 streaming 任务后，按既有 Start-PetPal-Service.ps1 入口重启服务；保留私有网络、工作区和模型配置。当前生产进程监听 4318，公网页面为 https://magicdatou.top:44318/。
- 生产验收：本机和公网 health 均正常，公网首页 HTTP 200；未登录的本机网站清单和公网 OpenCLI 状态均 HTTP 401。授权清单返回 69 条查询与 13 个 notebook 网站。
- 生产 OpenCLI 状态：Chrome 已安装；Browser Bridge 未连接，在线档案数量 0。未执行安装器或授予扩展权限。
- 使用生产同源 Responses 服务下的 halogen-qwen3.8-flash-next，向中央服务器提交独立只读 / 需要时询问任务。任务 completed、审批数量 0。Codex 实际 rollout 确认恰好一次 petpal_opencli_setup({action:status}) 及匹配的工具返回：win32 / x64、supported=true、chromeInstalled=true；没有其他工具调用。环境工具本身不返回 Bridge/profile 状态，模型据此明确说明无法从该返回推断它们。
- 本次独立验收会话在完成后已删除；脱敏回执和原始私有 rollout 保留于忽略目录，不提交生产数据、凭据或会话内容。
- Chrome 插件以 test 账号登录生产页面，通过 Agent「已就绪 → 准备浏览器」生成未发送草稿。执行电脑仍为中央服务器，模型仍为原选择，权限仍为只读 / 需要时询问。该草稿没有提交，生产截图已保存在忽略目录。
- 生产部署没有重打或替换冻结 0.9.6 安装包、tag 及更新清单。Windows 官方 MSI 已做真实下载验签；Ubuntu DEB 安装与扩展就绪、十三站真实 Agent → Bridge 查询仍未验收。电影港连接关闭、百度网盘浏览器安全策略阻止的限制保持。
- 最终独立只读审查确认账号 scope、完整访问与审批门禁、草稿保护以及 Windows / Ubuntu 源码打包闭包，没有新增阻塞问题。提交前再次审计 Git index，原附件、浏览历史、私有配置和回执均不入仓。
