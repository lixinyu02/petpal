# Qwen 累计消息兼容 Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-qwen-cumulative-stream-design.md
- Current status: done

## issue-68

- ID: issue-68
- 标题: 修复Qwen工具间累计消息的Responses兼容
- 范围: 明确模型下的message映射、中央relay和Codex transport、合成回归、真实Agent续接与后端部署验收。
- 依赖: issue-67 done
- 验收标准: 两条Chat保持成功，真实Qwen Agent包内npm/V2EX查询完成；工具身份/参数/终止门禁不放宽，现有远程客户端收到标准帧；用户数据和下载保持。
- 状态: done
- 验证方式: 两条Chat保持成功；完整流明确重复message id及累计文本冲突。170项相关回归通过（含20项新映射测试）；修复后真实Codex/选定DesktopExecutor/Qwen5轮完整请求，包内npm与V2EX查询通过。中央relay→旧strict normalizer及二次适配幂等通过。公网HTTPS test/Qwen/none查询与同线程续接completed，验收会话删除/登录退出，原有会话逐对象不变。空闲受控后端重启state/token字节保持、16下载文件和1目录size/mtime保持。未重打客户端，旧PC完整运行与Ubuntu实机不算新增验收。
- commit: fix(issue-68): normalize Qwen cumulative message segments
