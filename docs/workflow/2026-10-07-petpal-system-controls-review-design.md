# PetPal 系统控制与替我审批

- Date: 2026-10-07
- Complexity: L2
- Status: final

## Background

当前桌面助手有 Computer Use 的 Accessibility、截图和键鼠能力，可间接打开系统设置，但没有固定系统总音量工具。播放器 MCP 的音量不等于操作系统输出音量。权限模式 review 向 Codex 传入 auto_review；自定义桌面工具仍等待人工批准，界面未显示原生审查过程。

内置 Codex 0.143.0 的 Guardian 优先选择 catalog 中的 codex-auto-review。API 网关只接受已授权的任务模型，导致专用审查模型被拒绝。review_model 是 /review 代码审查配置，不能用于 approve for me。model_catalog_json 只在 app-server 启动时生效，不能通过 thread/start 动态替换。

## Goal

在所选执行电脑上读取、调节、静音系统默认输出设备并读回验证；提供有限系统设置入口。让 API 模式的替我审批沿用当前已授权 Agent 模型，显示真实审核结果并避免无期限等待。改善主界面及 Chat+Agent 的批准提交状态。

## Non-goals

不静默提权、不自动处理 UAC，不放宽账号、模型和执行电脑的授权。不给模型任意命令、设备地址或系统设置 URI。不开启对通用桌面写操作的无条件批准；不改现有第三方运行时版本、用户全局 Codex 配置和已经发布的 0.9.10 包。本轮先源码和本地验收，不重打或发布新包。

## Solution

新增 petpal_system_audio 的 status、set-volume、adjust-volume、set-muted，schema 严格拒绝额外字段。Windows 固定 CoreAudio helper，Ubuntu 固定 wpctl/pactl argv；修改前后使用同一输出端点，报告读回和默认端点变化，音量限制0–100。新增 petpal_system_settings，仅 sound/display，打开只表示请求发出。工具在现有执行注册表内串行运行、可取消；状态无需完整访问，修改和设置入口保留完整访问门禁。

API 模式从固定官方 0.143.0 catalog 生成私有启动 catalog，只移除 codex-auto-review，其他 ModelInfo 字段原样保留，不加入或重写未知第三方模型。Guardian preferred 缺失时回落当前模型；请求仍经过既有 active model 授权，不能扩展为任意 reviewer 模型。保存原始来源、许可和摘要，并补包装成员合同。host 登录模式保留原生行为，不覆盖全局配置。原生 Guardian 使用其90秒期限；展示 started/completed 和拒绝/错误原因。

动态工具与原生命令分开处理：review 下仅固定、参数完整、可逆的系统音量操作可通过明确的本地规则审查；展示规则审查结果，不伪装成模型审查。通用 Computer Use、浏览器、安装、自动化与设置入口继续人工确认。审批有有限有效期，到期拒绝并解除等待；停止、任务完成及账号切换清理定时器和迟到回调。auto 仍只在已授予范围内执行。

上报新版执行器审核能力，旧执行电脑不声称具备新版适配。权限已有折叠区域说明当前审核模型与工具差别；批准提交与后续读取分离，阻止重复提交和跨账号迟到响应，查询失败时准确提示，后台存在批准请求时显示等待确认。

## Impact

桌面工具、Codex 私有运行配置、审核事件及生命周期、执行器能力、权限和审批 UI、包装合同、针对性测试及使用文档。保留现有账号数据、模型选择和所有安装包。

## Risks

Guardian 策略或第三方模型可能拒绝/无法解析，必须显示失败并保持拒绝，不能静默转为自动运行。原生 catalog 是版本绑定的兼容资产，不能声称适配其他 CLI。系统音量操作不是播放器音量；设备切换或无图形会话要准确报告。规则审查只限固定音量枚举，未知工具不能借描述降低完整访问门禁。

## Verification Plan

严格参数、端点固定、依赖缺失、取消、读回、readonly/full-access、ask/review/auto、重复审批、审核超时、迟到结果和账号切换回归；catalog 字段保持、未知模型 fallback、实际 CLI 接受启动 catalog、模型授权与 Guardian 事件验证；包装成员检查与 TypeScript。实际 Windows 音量读取、小幅调节后原值恢复；尽可能以配置的模型验证真实 Agent 链路。Chrome 插件验证权限与等待提示；Ubuntu 无目标桌面时明确仅 fixture/静态验证。任何模型或设备验收失败如实保存，不以 fixture 代替。
