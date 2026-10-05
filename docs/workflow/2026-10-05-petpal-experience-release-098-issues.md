# 四端体验与 0.9.8 Issues

- Date: 2026-10-05
- Complexity: L2
- Related design: 2026-10-05-petpal-experience-release-098-design.md
- Current status: issue-1 in_progress

## issue-1

- ID: issue-1
- 标题: 四端体验修复与客户端构建验收
- 范围: 草稿导航、键盘弹层、短屏导航、Windows 打包工具、版本与六个独立发布包
- 依赖: none
- 验收标准: 草稿不被静默丢弃；忙态/权限/任务合同保持；短屏/键盘控件可达；0.9.8 包完整且默认 V12；Windows 两包启动，其他平台明确验证边界
- 状态: in_progress
- 验证方式: App handler 53/53、Windows 工具 22/22、APK 工具 8/8、Android Java 65/65、TypeScript；Chrome 412×960 /320×540 /320×320 与420px可视区模拟通过。完整串行确认轮1933/1933通过。首轮单个fixture未收到done，单文件8/8、30轮单例和15轮完整文件均未重现，未修改生产协议；原始失败与诊断保留。包验收进行中。
- commit: pending

## issue-2

- ID: issue-2
- 标题: 正式发布与最新客户端入口
- 范围: GitHub stable、服务器包与静态网页、两源升级清单、上一版公共包可恢复归档
- 依赖: issue-1 done
- 验收标准: 下载页仅 0.9.8、服务器优先；两源 sequence10 与五目标摘要一致；包公开读回一致；生产聊天/配置/任务保持
- 状态: todo
- 验证方式: pending
- commit: pending
