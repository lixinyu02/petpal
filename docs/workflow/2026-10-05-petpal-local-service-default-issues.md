# 本机服务默认连接 Issues

- Date: 2026-10-05
- Complexity: L0
- Related design: none
- Current status: issue-1 done

## Design Note

Windows/Ubuntu 首次启动默认使用已启动的内置后端回环地址及动态端口，不预填公网服务器。网页版默认显示当前站点服务地址；Android 无内置后端，继续使用现有 HTTPS 服务器。已有连接优先恢复，初始 token 仍为空，明确登录前不取得本机管理员权限。保持已发布0.9.9客户端与更新元数据，本轮更新共享源码及网页，不重打安装包。

## issue-1

- ID: issue-1
- 标题: 默认本机服务并显示当前网页服务地址
- 范围: 桌面首屏连接默认值、登录表单地址展示、桌面启动验收中的真实地址断言、相关既有回归与静态部署
- 依赖: none
- 验收标准: 新桌面默认本机动态回环地址且未登录；已保存远程连接和退出状态保持；Web自动显示当前站点；Android默认仍可连接已有服务；发布下载未变
- 状态: done
- 验证方式: 最终连接/账号/原生传输/请求生命周期回归52/52、桌面启动回归11/11、tsc --noEmit与隔离Vite构建通过，登录保护与竞态相关原有检查亦通过。Windows真实Electron隔离启动确认登录前地址http://127.0.0.1:9194与内置后端一致、target=local、token为空；明确点击本机管理员登录后执行器在线，未执行模型任务。本次端口仅为测试时分配，应用启动自动获取，不能硬编码9194。生产静态部署已完成，HTTPS首页完整读回一致，后端health仍为0.9.9；未重启后端，15个发布下载及4份更新元数据保持。Chrome确认公网网页自动显示当前HTTPS站点地址、本机网页显示http://127.0.0.1:4318，均保持未登录门禁和淡白主题。证据在evidence/local-service-default-20261005/。未重打客户端、未做Ubuntu/Android实机验收。
- commit: fix(issue-1): default desktop connections to local service（本issue提交）
