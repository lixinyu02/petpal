# Cubism V11 工作状态

- ID: issue-1
- 标题: 真实 Cubism 连续五官绑定与网页验收
- 范围: 拆层素材、PSD、原生 authoring profile、模型资源、runtime 参数、动作连续性、区域鼠标/触控互动、语音输入倾听、回归与网页静态发布
- 依赖: 已发布 V10；官方 Core/Framework 使用许可已获用户同意
- 验收标准: 眉毛/眼睑/虹膜可连续变化，保持人物比例和现有手势，真实 Core 与 Chrome 验收，无旧脸贴图冒充独立绑定
- 状态: done
- 验证方式: 16层PSD精确readback；Core6.0.1、106组姿态和50项五官检查；340/340回归与TypeScript/Vite；Chrome真实半闭眼/闭眼、持续倾听/草稿更新、头部hover与手部touch、412×960无溢出；216项公网哈希一致。后端PID34828未重启，安装包及升级清单未变。详见 docs/cubism/continuous-features-validation.md
- commit: 本记录所在提交，feat(issue-1): rig continuous Cubism features and contextual interactions
