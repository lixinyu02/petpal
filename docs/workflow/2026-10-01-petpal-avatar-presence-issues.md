# 二次元伙伴自然动作 Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-avatar-presence-design.md
- Current status: done

## issue-72

- ID: issue-72
- 标题: 改善二次元伙伴自然跟随与说话动作
- 范围: presence 控制器、WebGL/DOM 同步、PCM 嘴型及点头衔接、VTuber 方案核实、Chrome 验收与网页推广
- 依赖: issue-71 done
- 验收标准: 视线/头部/身体分层跟随，动作与口型平滑，停止/隐藏/低动态保持门禁；单个人物、移动屏完整、降级仍可见；原账号与下载包保持
- 状态: done
- 验证方式: 相关回归 300/300、TypeScript、隔离 Vite build；Chrome 桌面和真实 CSS 412×960、触摸、PCM/实际 CosyVoice 口型与停止、睡眠、低动态、隐藏恢复、DOM 降级通过；原子推广网页和可信 HTTPS 静态资源读回，生产数据及 0.9.6 下载/升级清单保持。详见 2026-10-01-petpal-avatar-presence-validation.md。
- commit: feat(issue-72): smooth anime companion motion and speech
