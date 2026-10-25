# zut 微信导入 Issues

- Date: 2026-10-25
- Complexity: L2
- Related design: 2026-10-25-zut-wechat-import-design.md
- Current status: issue-2 pending

## issue-1

- ID: issue-1
- 标题: 实现账号隔离的历史档案、时间保留与幂等导入
- 范围: 档案索引/API/UI、625事件规划、原生记忆时间/有界flush/检查接口、提问相关历史证据与测试
- 依赖: none
- 验收标准: 全量原文无截断、同包/来源幂等、真实人物分开、日期/epoch/账号隔离、当前信息优先、普通会话启动与PC协议不回归
- 状态: completed
- 验证方式: 源包离线核验、隔离HTTP/原生模块/组件测试、类型检查与构建、自审
- commit: current implementation commit; hash recorded with issue-2

## issue-2

- ID: issue-2
- 标题: 正式导入zut与专属Chat/Agent召回验收
- 范围: 备份、受控部署、少量真实提炼检查、全量导入、去重复验、跨账号与时间更新验证
- 依赖: issue-1
- 验收标准: zut完整档案可读与本人记忆可实际召回；原日期保留、不把对方当本人、不重复；已有数据/其他账号/下载/更新信任保留
- 状态: pending
- 验证方式: 私有导入账本、原文件/源ID/SHA核对、Memobase实际投影与flush、Chrome/真实问答
- commit: pending
