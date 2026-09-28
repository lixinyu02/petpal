# 微表情与可开关朗读 Issues

- Date: 2026-09-26
- Complexity: L2
- Related design: [2026-09-26-petpal-expressive-avatar-design.md](2026-09-26-petpal-expressive-avatar-design.md)

## 任务概览

- Goal: 以 0.3.0 增强原创少女微表情，加入默认关闭、可停止的系统朗读，并控制动画与语音生命周期。
- Ordering rule: 当前只推进 issue-4；渲染、朗读、性能与文档分工属于同一 issue。
- Current status: issue-3 与本轮 issue-4 均已完成。现有 0.2.0 包和验收记录保留，0.3.0 原生包、源码和发布清单已通过各自明确范围的验证。

## Issue List

- [x] issue-4 微表情、系统朗读与四端资源验证

## issue-4

- ID: issue-4
- 标题: 原创伙伴微表情、可开关朗读与性能控制
- 范围: 同人物局部表情资源与平滑动画、默认关闭的自动朗读/停止/朗读上一条、真实语音状态与口型边界、隐藏/切换/卸载清理、有界演出队列、版本 0.3.0、动态发布清单和冻结后四端包核对
- 依赖: issue-3 done；沿用现有研究与原创角色，不引入 Cubism/第三方模型或远程 TTS
- 验收标准: 每次仅一个角色画布；微表情无明显错位；朗读仅成功完整回复且无重复；只使用匹配语言的本地 voice，缺失/受限时明确提示；停止及取消/切会话/隐藏/换猫均清理；音素同步不作虚假声明；构建/资源与目标设备运行证据分开，旧版验收保留
- 状态: done
- 验证方式: 定向控制/生命周期/性能测试与完整回归、TypeScript/Vite、Chrome 交互和截图、具备本地音色时实际听音、冻结后 Windows 最终包运行及 Android/Ubuntu 包资源/版本/哈希核对
- 当前证据: L2 设计已定稿，0.3.0 package/lockfile、Android 与后端元数据一致；功能回归、原生包和源码归档均完成下述检查。发布脚本语法、文档链接及动态版本/错误回执拒绝验证通过，本轮交付使用独立 0.3.0 回执，不沿用 0.2 结果冒充通过。真实听音、Chrome 和 Android/Ubuntu 设备运行仍按明确边界记录。
- 冻结复核: 短回复状态批处理、休息朗读与 pending→active 表情衔接已修复；最终测试 70/70，生产构建通过。Windows 源码与最终 EXE 均验证首页两句真实系统朗读 2 start/15 boundary/2 end、停止/隐藏取消和 App 单块回复/休息保护；截图已复核，但没有人工听音/录音。Chrome 两次连接及一次恢复调用超时，本轮 UI 依据 Electron 实测。
- 原生交付: Windows 0.3 最终 EXE 实跑、受限 PATH 内置 Codex、退出回收、22 Web/8 运行源码/6 纹理一致；Android 0.3/code3 开发签名、22 Web/6 纹理一致；Ubuntu 两架构各 5329 entries、6 ELF、22 Web、7 运行源码与 5016 全文件字节核对通过。Android/Ubuntu 设备 GUI/声音仍未实测。
- 最后检查: 本轮 JSON、九张最终截图、源码运行追溯文本和 Linux 全文件回执已纳入源码白名单。源码归档 186 项 ZIP 成员回读、boundaryScan/zipReadback 均通过；release-manifest 覆盖五个产物，哈希均与最终回执一致。源码精确摘要由发布清单提供，不在工作流文档嵌入。
- commit: not possible - not a git repository
