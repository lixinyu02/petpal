# Windows 0.9.1 启动修复验收

日期：2026-09-30。范围：issue-45 / issue-46。正式源码：`ebdfdea`、`8de6447509c6f002f8ba218252ba912930572971`。

## 问题与交付

旧便携包需要每次展开约 832 MB 的依赖；本机普通启动曾等待约 104 秒，期间没有窗口。连续双击还会在 Electron 单实例检查之前共用临时目录，可能影响正在运行的资源。0.9.1 保留便携 EXE，并改用每次独立的解压目录、显示启动等待图；新增完整运行目录 ZIP，解压一次后运行 `PetPal.exe`。主进程与页面加载异常现在会显示修复提示，并记录有容量限制的脱敏阶段与错误码，保留原配置。

推荐下载安装 ZIP，完整解压到本地新目录，再运行其中的 `PetPal.exe`；不能在压缩包内直接运行，也不能单独移动这个 EXE。两种包均无需额外安装 Node.js、Git、Codex 或 OpenCLI，内置 Codex 0.143.0 / OpenCLI 1.8.8。便携 EXE 仍需等待每次解压，不能将启动提示等同于消除解压耗时。

## 冻结文件

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| PetPal-0.9.1-Windows-x64.exe | 185711668 | 61237db82d081556be19e7d46becba2ccbf5e52bc6fdf6a06095411977cb50b0 |
| PetPal-0.9.1-Windows-x64.zip | 308639476 | de514fcd70ef030cbe6f90fd6878625ebeb0c1ae8cc1f26e0a8005090b0afaf8 |

独立构建目录为私有 `evidence/windows-client-20260930/build-091-final`。未把生产 `dist` 当作打包临时目录。

## 验证结果

- 全量回归 816/816；后端版本补充 13/13；诊断与公开源码补充 19/19。公开源码索引审计及打包检查通过。
- 最终 EXE 1,981 项内容读回及原生核心 smoke 通过；ZIP 7,777 个文件逐项完整读回，与冻结目录一致。
- ZIP 在中文和空格路径、全新 profile、仅系统 PATH 下启动成功。登录门禁、隔离测试账号、执行器上线、内置 Codex/OpenCLI、二次元/猫咪手势及透明悬浮窗口通过；退出后无所属残留进程。
- 无效 service-settings 真实故障退出 1，日志阶段和有限错误码正确，原配置保留，私密测试标记未进入日志。
- 普通 EXE 双击启动及重复启动通过：两个不同运行目录，第二次启动退出 0，主实例保持存活、资源 SHA 不变、后端健康为 0.9.1。测试仅清理自身进程。
- 生产前端 27 个文件部署比对通过，保留旧懒加载资源；本地与公网健康均为 0.9.1。受保护 API 匿名返回 401、已授权返回 200；用户状态文件部署前后逐字节一致。

私有证据：`exe-final-readback.json`、`exe-final-runtime.json`、`zip-final-allfiles.json`、`zip-final-core-runtime.json`、`zip-final-fault/fault-receipt.json`、`concurrent-normal/concurrency-final.json`、`concurrent-normal/cleanup.json`、`deployment.json` 与 `native-normal-login.png`。这些运行材料不进入公开源码。

## 公开发布

[v0.9.1](https://github.com/lixinyu02/petpal/releases/tag/v0.9.1) 已公开发布为 latest，固定指向实现 commit `8de6447`。六项资产为冻结 EXE/ZIP、SHA256SUMS、发布清单、签名更新清单和既有信任公钥。GitHub 官方资产长度和 digest 全部一致；[云端任务](https://github.com/lixinyu02/petpal/actions/runs/36686702422) 从 HTTPS 镜像下载并完整验证两项包，上传后再次全文下载校验，不执行 EXE。四个小文件公开匿名下载逐字节一致，更新清单 sequence 6 的签名与既有公钥验证通过。

Chrome 在已登录的下载中心完成验收：默认选择 Windows 0.9.1 ZIP（推荐），对应 GitHub URL 与完整 SHA-256 正确；切换 EXE 的说明和 URL 正确。Android / Ubuntu 保留 0.9.0。私有证据为 `public-release/verification.json`、`transfer/cloud-mirror-success-run.log`、`browser-downloads-091.json` 和 `download-center-091.png`。

公开 HTTPS 镜像保留冻结 EXE/ZIP，TLS 和 206 分段读取通过。发布使用的临时传输草稿、临时分支及重复排队任务已清理；本地审计材料保留，正式 Release 未受影响。生产服务没有为发布重启。

## 实测边界

原生运行环境是 Windows 11 x64，尚未取得 Windows 10 或报告故障的其他电脑实测。两种包没有 Authenticode 签名，因此可能仍出现未知发布者提示；未关闭或绕过系统安全保护。

旧可选扩展 `PETPAL_SMOKE_APP/POSES` 夹具会等待默认折叠的人物栏，并使用旧停止朗读文字，在该夹具上未通过；未产生真实模型请求，不能计入成功项。独立人物与手势的核心 smoke 已通过。此次不以模拟模型或本机启动替代真实外部模型/语音供应商的完整验收，也不修改 RK3566 固件。
