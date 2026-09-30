# 工作台流畅性与 UI 验收

- Date: 2026-09-30
- Scope: issue-48 / issue-49，网页优化；本轮不重新制作四端安装包。

## issue-48

- Chat 首段立即显示，后续文字 50ms 合并；协议和语音分句仍即时处理。历史列表/行隔离高频口型状态。
- 浏览器实测完成、两批突发增量、停止、503 错误与提前断流：完整回复尾部标记和朗读入口正常；停止/断流保留正文，错误清楚，输入恢复。
- 不主动上翻时最终距底部 0.333 CSS px；真实滚轮上翻后，回复增长期间 scrollTop 保持 10978，返回最新可恢复底部。
- 人物栏可见时帧计数增长，收起后固定在 70；恢复验证在 issue-49 最终构建补齐。
- 根代理定向回归原 165/165，通过滚动边界修正后单独 8/8；原 suite 含旧 6 项滚动测试，合计唯一覆盖 167 项。另有代理人物/调度检查；不重复相加。TypeScript 与隔离 Vite 构建通过。只读复核未见阻塞项，四个新功能 suite 31/31。
- 本机 Chrome 固定合成 4000 字流式样本：ScriptDuration 3.110s → 1.557s，LayoutCount 134 → 21。40 条长历史输入的三次 ScriptDuration：201.76/199.46/180.85ms → 132.62/127.01/122.13ms。
- 以上是隔离合成样本的诊断数据，流式只有一个有效前后样本；不是 FPS 承诺、真实模型/ASR/TTS 或四端实机验收。测试使用 loopback 独立数据，禁止模型/语音/Agent 出站。
- 证据在忽略目录 `evidence/ui-smoothness-20260930/`：regression-48.log、scroll-fix.log、build-48.log、performance-before/after.json、stream-integrity.json。

## issue-49

- 空会话删除重复英文和两行大标题，桌面欢迎区高度约 373 → 237 CSS px；两条预填建议保留。悬浮“回到最新”在消息区内，44px 高，不挤占 composer；消息区域可键盘 PageUp 阅读，焦点可见。
- 修正短屏空会话被跟随到底而裁掉标题：空会话定位顶部，消息/审批存在时保持原跟随行为。
- Chrome 隔离构建 1280×800、412×960、412×560：无横向溢出，输入、模式/模型、执行电脑和权限入口可达。短屏顶部设置区可独立滚动；Agent 模型浮层可正常打开。手机 PageUp 出现返回入口，按钮恢复后距底部约 0 CSS px；最终手机固定流式回复含完整尾标和朗读按钮，停止按钮退出。
- 人物帧计数展开 39、收起 40，后续保持 40，重新展开到 43；首页二次元与 3D 猫切换、Enter 摸头均得到 `pet` 和相应反馈，无画面错误。
- 最终 31/31 调度/滚动/消息/场景回归复验通过，TS 和 Vite 构建通过，最终只读复核无 blocker。Vite 的 Three.js chunk >500kB 提示仍存在，人物是动态加载，本轮未变更打包依赖或角色图像。
- 静态原子部署 27 个文件 SHA-256 比对通过，保留旧 assets 和 `dist/downloads` 两份 Windows 0.9.1 镜像的长度/修改时间；旧 HTML 已备份。没有改动后端代码、模型权限、凭据或生产历史。
- 本机及 `https://magicdatou.top:44318`：health 200/ok，匿名 state 401，HTML/入口 JS/CSS/App chunk 均 200 且与最终构建逐字节哈希一致。
- 正式站点 Chrome 使用既有 test 账号成功登录，桌面和实际 412×960 UI 通过；Chat/Agent 切换、实际模型/在线执行电脑/权限状态可见。没有提交真实模型或 Agent 任务。
- 证据：`deployment.json`、`live-acceptance.json`、`regression-final.log`、`build-final.log`，以及 desktop-final/public-desktop-final/public-mobile-final/mobile-history-final/anime-interaction-final 截图，均在忽略的 evidence 目录。
- 本轮不重新打包 Windows/Ubuntu/Android；浏览器与协议回归不代表四端设备、麦克风/摄像头、实际 TTS/ASR 服务或新的 Agent 执行验收。

## Rust 评估

当前改善来自浏览器主线程减少 React/Markdown 重复更新、正确滚动调度和不可见人物暂停。Rust 后端或替换桌面壳不能直接解决这些路径，暂不全面重写。将来若有可复现的原生 CPU、安装体积或内存热点，再评估局部 Rust 模块或桌面壳迁移。
