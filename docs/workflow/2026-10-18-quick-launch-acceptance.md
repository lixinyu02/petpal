# 快捷入口验收与上线

- 日期：2026-10-18（Asia/Shanghai）
- 实现提交：`dcd8525`
- 正式入口：https://magicdatou.top:44318/?chat=1&shortcuts=1

## 已交付

伙伴首页闪电图标及工作台侧栏新增快捷入口，页面按需加载。支持查天气、打开音乐、自定义模板；配置任务、模型、执行电脑、权限后保存，之后一键运行并查看最近结果和运行记录。定时默认关闭，可显式配置每天、工作日、每周、固定间隔、一次性任务。普通自动化可加入/移出快捷入口。

旧存储缺少quickLaunch时按false展示，不自动改写；旧create指纹/重试保持兼容。沿用账号隔离、执行电脑/模型授权、requestId去重、版本冲突、未知结果确认、草稿离开保护。仅改快捷标记不改变定时状态。修复过去的一次性任务在关闭定时后仍无法编辑的问题。

## 自动验证

- 自动化schema/service/API/tools/executor及两套天气：135/135。
- UI事件51、App导航61及ack、主题、共享代理回归：157/157。
- 总计292项通过；TypeScript no-emit和Vite生产构建通过，git diff --check通过。
- 快捷与自动化复用同一lazy模块；key按视图切换，切页保留聊天草稿和附件，编辑dirty/busy仍保护离开。

## Chrome实际交互

使用Chrome插件完成独立验收账号登录、天气模板保存（默认只手动）、一键运行、查看原结果对话、工作日09:00计划保存和关闭。结果对话只读，没有二次派发。隔离执行器为合成codexFactory，不代表真实付费模型推理。

CSS视口校准为412×960：页面scrollWidth=412、编辑器无越界控件；模板单列、任务操作换行，伙伴首页4个入口均在视口内。已恢复Chrome临时视口。预览截图位于私有验收目录。

正式HTTPS网页使用既有test账号登录成功，快捷页与天气编辑器可用：模型从账号授权列表选择，定时未勾选，执行电脑仅列账号自己的电脑（目前均离线），中央服务器与其他账号设备不显示。取消草稿，未创建生产快捷任务或定时计划。

## 真实天气与派发验收

通过真实OpenCliManager和隔离weather worker三次查询中国天气网北蔡镇101020600001，全部成功：7日、92个分时点。公开源在2026-10-20 07:00至20:00有13小时时间缺口，返回coverage=gapped和coverage_gaps，保留缺口而不插值；发布时间不可信时published_at=null、freshness=unknown，未伪称新鲜数据或门牌实况。组内大间隔、倒序、重复、错日期与超过24小时的交界仍拒绝。

隔离真实后端中，3次同requestId手动请求只创建1次运行；推进虚拟时钟后一次性定时也completed，共2次派发，执行器读取真实天气但模型为合成模型。此项不是墙钟等待、真实LLM自主选工具或物理安卓验收。一次性任务完成后enabled=false、nextRunAt=null，无剩余定时；验收后端和worker已关闭。

## 受控上线

复核实际服务身份与fresh idle，固定旧源码f470a488d41320ae450a29c91df7f836ced2e7c7回退，备份业务数据/附件/语音/代理/服务配置及旧Web入口后重启后台一次。逐文件核对资产并原子发布，index最后。

本机与公网HTTPS health均通过，匿名API仍401；公网index和App/AutomationsView/CompanionWorld资源与本次冻结构建SHA256一致。服务新PID65284且guardian已接管，maintenance已移除。业务字段哈希保持，3账号、5模型配置、54会话、1附件与0自动化记录保持；正式下载与签名更新清单、代理配置、守护配置均未修改。浏览器登录只产生常规session元数据。

私有证据：`.data/quick-launch-20261018/`中的build.log、regression.log、backend-regression.log、online-verification.json、mobile-layout.json、quick-launch-production-mobile.png、weather-acceptance-2026-10-17T18-24-45-611Z-c0e8203d-58ec-4951-a437-1d8b92c0376e.json及deploy-receipts。保留失败天气回执便于核对修复前后，不向仓库提交私有证据。

本轮发布Web和后端，版本仍0.9.13；未重打或更新四端安装包。共用前端代码已具备功能，现有原生包需要下一次打包才能带入本轮新界面。未实测安卓真机、Ubuntu原生包及真实模型的本轮自动选工具行为。
