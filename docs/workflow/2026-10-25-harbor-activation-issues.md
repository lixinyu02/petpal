# Harbor 正式接入 Issues

- Date: 2026-10-25
- Complexity: L2
- Related design: 2026-10-25-harbor-activation-design.md
- Current status: issue-1 done; issue-2 done

## issue-1

- ID: issue-1
- 标题: 补齐Harbor接收方、模型与恢复契约
- 范围: 隔离Harbor receiver/迁移、PetPal目录/优先与备用/权限/能力、配对与撤销恢复、相关测试
- 依赖: none
- 验收标准: 旧接收方不变、新petpal可配对；原配置和授权保持；支持的模型类型按能力选择；未知送达不盲重试；离线/撤销不残留新调用资格
- 状态: done
- 验证方式: PetPal最终串行完整回归4112项，4106通过/6既有可选跳过；TypeScript/独立网页构建/OpenUI模块图/公开源码审计通过；Chrome隔离真实HTTP配对、无刷新目录更新、模型连接、ASR空WS探测和完整WAV播放通过。详见validation文档。上游main/部署结果由专门会话交接。
- commit: 29a0d35b8b7f0cb5ee5729cec594f4b3d80ca18f（已push main）

## issue-2

- ID: issue-2
- 标题: 正式配对、网页上线与端到端验收
- 范围: 定位真实Harbor、备份/受控升级、连接码兑换、模型分配及真实调用、PetPal网页后端上线和Chrome验收
- 依赖: issue-1
- 验收标准: 正式链接ready且真实请求经Harbor；缺模型沿旧配置；账号隔离、数据及下载/更新信任保持；未验能力明确报告
- 状态: done
- 验证方式: 独立review及fresh捕获/单次受控部署/保全/守护接管通过，313公开资源完整SHA回读；Harbor0.52.1正式ready、Responses模型请求200及真实内置Codex CLI任务完成且账本一次上游尝试；原provider实际200、ASR协议与CosyVoice真实WAV通过。原65会话/授权/63下载和test/zut记忆保留；owner新增两条验收会话及一条自动记忆事件和上下文变化单列。详见validation文档。
- commit: 本次 docs(issue-2) 正式验收提交

网页/后端和Harbor正式配对已完成。独立官方Codex Auth登录/模型同步由Harbor新会话按其用户要求继续，不作为本次API Key/Responses接入已验收能力。

## 后续客户端范围

PC本地模型下载/运行管理已获用户同意，按用户最新选择在本轮Harbor正式上线之后推进；Windows/Ubuntu新版不在本阶段发布。现有云端API路线保持可用。
