# UI 与连接恢复验收

- 日期：2026-10-24
- 状态：网页修复已上线；后续按用户追加要求制作 0.9.15 正式客户端。
- 产品源码：`114cc5bde6b27277f77ccfa4d56f155ac38172a9`
- 网页入口：`assets/index-CBQ0IJPq.js`
- OpenUI：`assets/OpenUIBlock-CnNLjfrz.js`
- 私有证据根：`.data/ui-connectivity-20261024`。其中账号、完整业务前像及签名/配置不得公开。

## 已修复问题

| 严重度 | 触发 | 修复与验证 |
| --- | --- | --- |
| P1 | HTTP 200 正文截断被吞成空对象，hosts 写成 undefined 后渲染崩溃 | 成功正文损坏明确报错；校验 hosts 和对话最小结构，保留旧状态 |
| P2 | Web/Android 状态读取半开，轮询一直等待 | 有界 JSON 请求覆盖 fetch 和正文，状态读取 12 秒、列表刷新 15 秒；取消及迟到结果隔离 |
| P2 | 模型 POST 已完成，刷新 503 后再次新增 | 已提交与列表读取分离；只提供刷新重试；明确 2xx 正文损坏也进入核对列表流程 |
| P2 | 保存期间另开编辑窗口，被旧请求关掉 | 同步操作锁、禁用字段/关闭/其他入口，校验账号与操作身份 |
| P2 | 360px 下默认模型选择框被长名称撑出屏幕 | 样式移出懒加载账号模块，独立随 App 加载；可收缩网格、44px 控件高度 |
| P3 | Agent 网络恢复后仍显示旧错误 | 轮询单独持有错误，恢复只清除自身提示，保留其他操作错误 |
| P3 | 执行电脑刷新失败仍显示旧绿色在线 | 保留电脑选择，显示“状态待刷新”；断网显示提示且保留草稿 |
| P3 | 连接 dialog 缺少可访问名称 | role 所在节点绑定 connection-title |

ASR 探测提示也改为配置/协议检查结果，避免将服务探测描述成麦克风识别验收。

## 浏览器流程与截图

截图均在私有证据根的 `browser/`。Chrome 首轮导航与视口联用出现 debugger 同步超时，未归因产品崩溃；IAB 分步操作完成主流程，最终 Chrome 新标签恢复并复验新增边界。

1. 登录与设置：Chrome 公网桌面/412px 登录、隔离桌面设置；360px 原选择框 376px，父容器 315px，右边箭头被裁切。`04-settings-before-412.png`、`05-settings-before-360.png`。
2. 窄屏修复：360px 控件缩至父容器、44px 高；412px 与桌面、日夜配色无页面横向溢出。`06-settings-after-360.png`、`15-final-settings-412.png`、`16-final-settings-night-412.png`、`17-final-settings-desktop.png`。
3. 提交与刷新故障：模型保存成功后注入 state503，创建窗口关闭、提示已保存；恢复后只刷新列表。`07-saved-refresh503.png`。最后在实际 Chrome 对最终源码追加 HTTP200 损坏正文和 state503 同时发生：POST 仅一次、最终 3 个模型中新增目标仅一项。`18-chrome-r2-save200-bad-body.png`、`19-chrome-r2-refresh-recovered.png`、`chrome-r2-model-check.json`。
4. 运行期恢复：无效 JSON/结构、hosts503、挂起超时均保留界面/草稿；恢复清错。离线/在线事件保留草稿且不重发。`08`—`13` 截图及真实源码轮询回归。
5. 登录失效：仅确认 session401 后返回登录门禁；重新登录可用。`14-final-session401.png`。连接 dialog 的实际 DOM 名称已核对。
6. 正式网页：Chrome 重新载入公网，入口与候选一致，412px 页面 scrollWidth=412；`20-public-after-desktop.png`、`21-public-after-412.png`。没有使用生产账号或在生产新建测试对话。

## 自动化与实际服务检查

13 个定向测试文件共 182 项通过，0 失败/取消/跳过；TypeScript、隔离 Vite 和 OpenUI 构建验证通过。新增测试运行真实 API 和组件/effect，覆盖 fetch/body 截止时间、取消、账号替换、坏响应、保存与刷新互锁。日志为 `regression-r2.log`、`typecheck-r2.log`、`build-r2.log`。

检查当时五个真实模型的最小回复均成功（0.45–3.52 秒）；ASR 配置/协议探测通过，TTS 能力接口正常。未合成/播放音频，也未验证真实麦克风。证据为 `upstream-audit-a7b3/report.md`。

## 网页交付与保全

`deploy-live/ready.json` 绑定以上源码与候选，314 个候选文件逐 SHA 核验。先增加 51 个新资源，再原子替换 manifest/HTML。2,708 个旧 assets 留存，49 个旧下载保持；没有重启后端。

本地及公网 health200、匿名 state401，HTML/入口/OpenUI 完整正文 SHA 一致；原生客户端 Origin 预检 204。公网检查来自当前主机，不代表独立外网或 IPv6-only 验收。

首次准备目录包含旧构建资源，严格单 renderer 检查拒绝；保留旧目录并在全新 r2 目录重建。最初生产保全基线因既有 guardian 恢复服务及真实用户新增对话/登录而拒绝，未回滚这些新数据。服务配对内容解密后保持，退出原因日志未提供。最终重新取得真实基线，并仅允许一个精确记忆文件的两个同步时间字段变化；其事件/context 等完整语义及其他保护文件仍严格核验。该门禁及原子文件测试 36 项通过。

最终 `deploy-live/published.json` 与 `after.json` 确认业务/信任保持、179 项保护集通过。隔离 fixture 已关闭，Chrome 临时视口和离线模拟已恢复。安装包运行验收属于下一正式发布任务，不把本报告当作安装包通过证据。
