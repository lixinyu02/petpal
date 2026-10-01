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

隔离管理界面已通过实际输入、保存、清空恢复默认网址，保存后输入为空且默认域名显示正确。响应式 DOM 实测 CSS viewport 412 × 960、document.scrollWidth=412，OpenCLI 行与输入横向溢出数为 0。已有截图来自 CSS 549 宽界面，不能当作 412 截图；412 截图请求超时。临时 viewport 已恢复。

## Bridge 与真实 Agent 链路

自有 daemon 的只读连接检查为 extension.connected=false、profiles=[]。自有 daemon 随后关闭。没有在线 OpenCLI Browser Bridge 档案，因此未完成 Agent → 所选电脑 → Browser Bridge → 新站点的真实查询。Chrome 页面能访问与 Bridge 查询成功分别记录。

安装与环境引导已完成 issue-3；不擅自给扩展授权、选择 Chrome 档案或绕过站点登录。生产部署尚未进行；本记录在最终验收后补齐。

## Chrome / Bridge 准备验收

- 相关回归 344/344 通过；真实 Google 下载发现 gzip 透明解码与 Content-Length 不一致，已固定 identity 编码并拒绝不一致响应。此后安装/registry/manager/native/UI/草稿相关最终 108/108 通过，其中安装模块 34 项。
- 网页 TypeScript / Vite 构建通过。Chrome 实际点击准备按钮后进入未发送 Agent 草稿，当前电脑仍为中央服务器，权限仍为只读、需要时询问；没有提交任务或扩大权限。
- 新引导的窄屏 Agent 页面实测 CSS 412×960、scrollWidth=412、相关控件溢出为0；截图保存在忽略的私有测试目录，viewport已恢复。
- Windows 真实检测确认已有 Chrome，helper PowerShell AST 通过。
- 为测试下载分支，在独立私有目录真实准备官方 Google MSI，并通过 Valid + Google LLC Authenticode 和私有ACL检查。168,673,280 bytes；SHA256 `e744ffd35f5af8d453443a1a20d96a749f396c39d2e6238868f375ea519d8dc9`。结果为 `prepared / installed=false / userActionRequired=true`；未启动安装器。
- 真实 Google key → InRelease → amd64/arm64 Packages 签名/哈希链由 Windows Git GnuPG 验证通过；包版本154.0.8037.92-1。没有下载完整DEB，也没有在Ubuntu目标机执行安装。Ubuntu ARM64已有官方包，不能沿用旧版不支持判断。
- 新工具只允许 status/install-browser/open-extension，下载与商店打开继承所选电脑的账号 scope、完整访问与审批；不提供自定义网址、命令、profile或插件加载。
- Web/Android任务发送给所选电脑。本轮未重打冻结0.9.6客户端，旧客户端本机缺新工具时应更新客户端，不能认为服务器部署已替换其运行时。
