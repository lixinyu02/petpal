# Agent 项目目录验收

- Date: 2026-10-01
- Issue: issue-69
- Result: 网页、后端及源码交付完成；现有客户端下载包保持。
- 使用说明: [Agent 项目目录](../agent-project-directory.md)

## 代码与协议

`projectDirectory` 进入 Agent 提交、重试、队列、Chat 协作与结果快照。后端根据账号授权生成内部访问范围，执行端 realpath/stat 校验现有目录。Codex thread/start、resume、turn/start 和 sandbox writableRoots 使用本轮局部 cwd，不修改共享工作区或 CODEX_HOME。

目录变化或执行电脑变化开启新原生线程，同项目续接；运行中 steer 拒绝改目录。桌面能力只属于当前连接；旧执行端默认目录兼容，显式自定义目录在派发前被阻止。新客户端向旧服务注册仅可在未建立连接、HTTP400 的能力协商阶段回退，不重试任务。

## 自动与真实执行验证

- 208/208 相关回归通过，覆盖目录格式、权限、symlink 逃逸、归属、能力协商、重复提交、目录续接、steer、队列、Chat 协作、Qwen 及语音错误收尾。
- TypeScript 和隔离 Vite 构建通过，输出位于 ignored evidence 的 web-dist。
- Codex 0.143.0 + `halogen-qwen3.8-flash-next` / `none`：中央与所选 DesktopExecutor 各三轮 A→A→B 全部 completed。实际终端读取临时 marker，退出码 0；RPC cwd 一致，同项目 resume、换项目 start。临时文件未改，隔离服务与执行端已清理。
- 首次桌面检查脚本误读 capability 字段，在桌面任务启动前退出；修正为公开 host.codex.projectDirectory 后只补跑桌面验收，不计作产品运行失败。

## Chrome 与公网

Chrome 插件验收了 Agent 输入目录和 Chat + Agent 共用入口。实际 CSS viewport 为 412×960，document scrollWidth/clientWidth 均为 407，无横向溢出；临时 viewport 已 reset。浏览器 75% 缩放下，需将工具视口设为 309×720 才达到该 CSS 尺寸；第一次工具设置 412×960 实际得到 549×1280，不计作目标尺寸验收。

网页已部署到 https://magicdatou.top:44318/，可信 HTTPS 200，公网 HTML 与隔离 bundle 哈希一致，中央项目目录能力可见。后端由 guardian 受控重启；部署时 state/token 字节保持，2 个账号、5 个 provider、31 个会话与 1 个暂停队列保持。

16:41:58–16:42:51（Asia/Shanghai）公网独立 QA 使用 test + Qwen/none，以 read-only 执行：直接 Agent 从指定临时项目读到未写进 prompt 的随机 marker；Chat 确实调用 run_agent，后台 child 使用相同项目读取成功，结果回到父 Chat。没有自动任务重试。此次 QA 会话、登录与临时目录已清理；全部原会话逐对象、原暂停队列、账号、providers、Codex 配置与执行电脑登记保持。

## 构建事故与恢复

界面子任务初次运行 npm run build，Vite 清空 dist/downloads 并替换静态资源。已主动报告并从保留原始归档恢复 16 个根下载文件、updates 子目录 6 个文件，包括 sequence 7 原签名更新清单与 5 个包；全部字节/SHA-256 对历史下载与发布清单一致。

恢复预检曾选错 Android 0.9.2 归档，长度不匹配，在任何复制前停止；随后改用匹配归档。旧 10 个下载文件 mtime 按历史 receipt 恢复到文件系统精度，新 6 个使用源归档 mtime，因此不声称全过程原始 mtime 从未改变。完成恢复后先恢复旧网页，再受控推广新 bundle；最终部署前后 16 个根下载与 1 个目录的 size/mtime 保持。Vite 增加 emptyOutDir:false，此后都使用隔离构建输出。

## 证据与限制

本地证据位于 ignored `evidence/agent-project-directory-20261001/`：regression.txt、acceptance-summary.json、public-project-result.json、deployment.json、downloads-recovery.json 和 chrome-project-412.jpg。密钥和私有数据不提交公共源码。

真实后台与 DesktopExecutor 在同一 Windows 电脑，本轮不代表跨物理远程主机、Ubuntu 或 Android 真机验收。没有重打四端安装包，也没有修改已有 release、签名更新渠道或历史任务。
