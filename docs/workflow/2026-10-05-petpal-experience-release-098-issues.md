# 四端体验与 0.9.8 Issues

- Date: 2026-10-05
- Complexity: L2
- Related design: 2026-10-05-petpal-experience-release-098-design.md
- Current status: complete

## issue-1

- ID: issue-1
- 标题: 四端体验修复与客户端构建验收
- 范围: 草稿导航、键盘弹层、短屏导航、Windows 打包工具、版本与六个独立发布包
- 依赖: none
- 验收标准: 草稿不被静默丢弃；忙态/权限/任务合同保持；短屏/键盘控件可达；0.9.8 包完整且默认 V12；Windows 两包启动，其他平台明确验证边界
- 状态: done
- 验证方式: App handler 53/53、Windows 工具 22/22、APK 工具 8/8、Android Java 65/65、TypeScript；Chrome 412×960 /320×540 /320×320 与420px可视区模拟通过。完整串行确认轮1933/1933通过。首轮单个fixture未收到done，单文件8/8、30轮单例和15轮完整文件均未重现，未修改生产协议；原始失败与诊断保留。六包摘要已与实际验收回执绑定。Windows EXE/ZIP完整启动、重复启动、中央服务器配置/恢复/关闭、Cubism V12及退出清理通过；ZIP两次gesture输入冲突记录保留，对齐系统光标后原完整断言通过。Ubuntu两个完整归档、Android APK完整内容/证书和Web275项资源通过，未扩大到Ubuntu/Android真机验收。
- commit: 5205e7e544182a504647a7a2273908e40c0db2c7

## issue-2

- ID: issue-2
- 标题: 正式发布与最新客户端入口
- 范围: GitHub stable、服务器包与静态网页、两源升级清单、上一版公共包可恢复归档
- 依赖: issue-1 done
- 验收标准: 下载页仅 0.9.8、服务器优先；两源 sequence10 与五目标摘要一致；包公开读回一致；生产聊天/配置/任务保持
- 状态: done
- 验证方式: GitHub v0.9.8 stable/latest，release403398605、tag固定5205e7e、10个资产ID发布前后不变。原始Actions run37270998208 attempt1成功，六包服务器镜像与GitHub CDN完整字节/摘要通过，四份metadata本机完整读回通过；本机服务器完整读回仅EXE，其余采用明确标注的云端证据。275项静态资源部署与HTTPS index摘要通过，未重启后端。GitHub/server两源五目标均0.9.8/sequence10，Android18，当前版本不重复升级。13个旧公开文件可恢复归档，15个当前文件保留，旧404/新200。Chrome412×960无横向溢出，WindowsZIP默认/EXE与Ubuntu架构切换、服务器优先/GitHub备用，320×320导航滚动和账号弹层可达，退出后登录门禁通过。仅操作验收账号会话，未发送模型/语音配置或聊天/Agent写请求；不代表生产数据全量比对或真实上游业务复验。
- commit: 5205e7e544182a504647a7a2273908e40c0db2c7（v0.9.8 发布源码；验收文档单独收尾）

## 发布工具诊断与证据边界

首次转移分支推送的wrapper guard失败，官方读取确认当时分支和run均不存在；原因未确定。保留原预约记录，第二次经独立create-only CAS检查成功，使用既有credential权限，没有扩展scope，也未重复触发Actions。发布后临时分支已清理，原run和commit证明保留。

服务器promote首次在写入前被阻断，原因是工具把两源各自的可信密钥误要求为相同。ignored发布helper修正为分别绑定可信签名和payload，独立复验两方向cross-key/cross-source均拒绝后，原子提升sequence9→10成功；客户端源码、包及签名内容未改变。

完整验收及限制见 `docs/acceptance-0.9.8.md`。Windows仍未Authenticode签名，Android沿用开发证书；没有Android/Ubuntu真机验收，中央服务器仅本机回环运行验证。控制台捕获的错误来自扩展，不能据此宣称全局零错误。
