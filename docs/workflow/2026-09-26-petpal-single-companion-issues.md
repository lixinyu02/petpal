# 单一伙伴与双角色 Issues

- Complexity: L2
- Related design: 2026-09-26-petpal-single-companion-design.md

## issue-3
- ID: issue-3
- 标题: 可切换二次元伙伴与立体小猫、持续行为与四端集成
- 范围: 实时 3D 猫、原创二维网格少女、行为状态机、每次一个角色、透明桌宠、Android 共享渲染、0.2.0 包
- 依赖: issue-1/2 done
- 验收标准: 少女/小猫可切换且仅单角色画布，无动画画廊入口；角色偏好本地优先且可同步；交互与暂停正确；跨端构建和验收边界明确
- 状态: done
- 验证方式: 行为测试、Web build、Chrome 单猫交互与响应式、Windows WebGL/CLI 原生启动、Android/Ubuntu 构建与归档复核
- 当前证据: 52 项自动测试与 5 项 Android 资源策略测试通过。Chrome 双角色切换、闭眼/唤醒/口型、刷新保留、聊天/Codex入口及零控制台错误通过；最终 Windows 便携程序实跑通过双角色/透明桌宠/CLI与26项包内hash。Android 0.2 APK 签名与全部18项Web资源通过；Ubuntu x64/ARM64归档/ELF/字节检查通过，Android/Ubuntu实机未验证。源码与五产物hash汇总见最终manifest。猫修正短耳/贴脸眼/连续四肢及四足行走，少女使用原创透明图与实时局部变形，未包含Cubism或TTS。
- commit: not possible - not a git repository
