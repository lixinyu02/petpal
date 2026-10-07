# OpenCLI 常用网站扩展 Issues

- Date: 2026-10-08
- Complexity: L1
- Related design: 2026-10-08-petpal-opencli-popular-design.md

## Task Overview

- Goal: 增加七个常用网站、十一项可调用查询并进行联网验收。
- Ordering rule: Complete issues in sequence.
- Current status: 两项完成；登录站点与淘宝的联网验收限制见 acceptance.md

## Issue List

- [x] issue-1 固定政策、查询与回归
- [x] issue-2 本机服务与浏览器联网验收

## issue-1

- ID: issue-1
- 标题: 固定政策、查询与回归
- 范围: 新增站点政策、builtin DOM/API 提取、设置说明与必要回归。
- 依赖: none
- 验收标准: 七站/十一项结构化只读查询；参数/来源有界；真实链接、ID不丢精度；登录/验证/空数据错误明确；通用全站访问保持。
- 状态: done
- 验证方式: 十个相关文件共133项回归通过（并发2、每项15秒上限）；新查询/政策/来源针对性43项通过；TypeScript、diff检查与保留dist/downloads的生产构建通过。初次全并行回归挂起，终止精确测试进程；定位并更新旧目录13站断言，串行及有界并发复验通过。自审确认三个新增GET路径固定、没有读登录源或写站点动作，ID精度/参数转义/结果身份与空数据回归通过。
- commit: b8618ab

## issue-2

- ID: issue-2
- 标题: 本机服务与浏览器联网验收
- 范围: 生产构建、无任务更新、本机内置桥实际查询与 Chrome 设置显示。
- 依赖: issue-1
- 验收标准: 新目录上线；每站记录实际成功或具体阻塞；账号/会话/配对/下载保持；不宣称未完成登录的站点已通过。
- 状态: done
- 验证方式: 真正OpenCLI1.8.8/Bridge1.0.24通过所选Chrome档案查询全部11项：知乎hot/search、微博hot、豆瓣movie-hot/book-hot/top250、京东search成功；微博search/小红书search/抖音search返回明确登录提示；淘宝无有效条目且随后Chrome工具网站安全策略阻止访问，未继续换通道验收。修复桥exec异常吞掉固定提示、抖音登录文案识别和根卡片为a的商品链接提取；最终10文件134项回归通过。Chrome验证本机真实登录页/常用目录20站80项及截图；本机服务健康、账号/聊天/配对/15发布文件保持，最终桥ready=true、websiteAccess=all，测试租约与标签已关闭。本轮无实际模型Agent派发或安装包重打，详见acceptance.md。
- commit: 本issue提交
