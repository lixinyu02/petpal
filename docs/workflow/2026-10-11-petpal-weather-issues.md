# 国内天气查询 Issues

- Date: 2026-10-11
- Complexity: L1
- Related design: 2026-10-11-petpal-weather-design.md

## Task Overview

- Goal: 官方天气来源与具体地点匹配。
- Ordering rule: 按顺序完成；调研和检查可并行。
- Current status: 两项完成，中央后端已交付。

## Issue List

- [x] issue-1 天气公开适配器及工具接线
- [x] issue-2 联网核验与服务交付

## issue-1

- ID: issue-1
- 标题: 加入官方地点搜索、天气查询与精度说明
- 范围: builtin-public 注册、worker、解析器、Agent 指引、测试与使用文档。
- 依赖: none
- 验收标准: 两个官方来源能发现与调用；地点歧义不静默选第一项；来源/时间/精度明确；现有上游查询与权限隔离保持。
- 状态: done
- 验证方式: OpenCLI 全部相关模块与 desktop-tools 234/234 通过。县区/乡镇导航地点 ID、真实 worker 同主机换站拒绝、缺测、逐行旧时间、跨年及歧义 fixture 通过。自审发现并修复同名页身份、Response URL 丢失及 NMC 全缺测/旧行误报新鲜问题。打包闭包包含五个新增模块；无前端变动，不重建客户端。
- commit: e0344b3

## issue-2

- ID: issue-2
- 标题: 实际联网及 Chrome 核对、服务交付
- 范围: 隔离 worker 实跑、官方页面核对、本机服务状态与可行的更新、验收报告。
- 依赖: issue-1
- 验收标准: 成功与受阻如实记录；地点和数据时间可核验；服务健康且业务数据保持；客户端发布边界说明清楚。
- 状态: done
- 验证方式: 六命令八次最终隔离 manager/worker 实跑、北蔡镇与两朝阳；Chrome 官方页面；实际 GPT-6 Luna 原生工具链及正常 HTTP Agent 任务；本机/公网 health 和目录 HTTP200；业务及私有配置哈希保持，原会话保持，空闲/guardian 检查通过。详见 acceptance 文档。未重打原生客户端。
- commit: 本次 issue-2 验收提交（见 Git 历史）。
