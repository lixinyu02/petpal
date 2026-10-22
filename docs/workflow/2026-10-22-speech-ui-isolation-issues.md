# 语音播放期间的页面流畅性优化 Issues

- Date: 2026-10-22
- Complexity: L1
- Related design: 2026-10-22-speech-ui-isolation-design.md
- Ordering rule: 一个完整issue，内部可分工独立文件。

## issue-1

- ID: issue-1
- 标题: 隔离人物语音进度与工作区渲染
- 范围: useSpeech可选进度订阅、人物订阅组件、App稳定输入及回调、隔离验收。
- 依赖: none
- 验收标准: 连续字符/音量进度不使App逐帧执行；人物持续收到完整进度；播放/停止/错误/缓冲及账号切换及时生效；默认hook调用行为保持；模型不重载。
- 状态: done
- 验证方式: 真实hook基线6项中5失败；候选语音/人物197项及工作区155项通过（矩阵不累计）。Chrome同为1.5秒38次合成boundary，App执行76→0，人物口型继续变化；412×960的37次boundary同样App执行0次，无横向溢出，输入/停止/草稿和canvas身份通过。tsc、隔离构建和自审通过，详见verification。
- commit: 本issue对应的实现提交（可由Git历史检索）
