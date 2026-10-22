# 模型 HTTPS 连接恢复任务

## issue-1

- ID: issue-1
- 标题: 恢复 CPA 证书加载与真实模型连接
- 范围: 证书来源、载入与续期检查，私有备份，真实模型验证
- 依赖: none
- 验收标准: 正常 TLS 校验下 models 与实际模型回复成功；私有配置保持
- 状态: done
- 验证方式: CPA 已切换到同域名受管证书目录；Mac、Windows Node 严格 TLS 验证通过，证书有效至 2026-12-27 17:21:58 UTC。models HTTP 200；生产后端 Qwen3.8 Flash 与 GPT-6 Luna 测试分别约 1.1s、1.9s 收到真实回复；正式 HTTPS 网页 test 账号 Qwen 测试显示“连接成功，已收到模型的实际回复”。21 个证书重载门禁回归通过；Mac 安装的脚本哈希与源码一致，LaunchAgent 首次执行 exit 0。
- commit: 本 issue 提交

## issue-2

- ID: issue-2
- 标题: 显示明确的模型网络及证书错误
- 范围: Chat provider 错误分类与回归
- 依赖: issue-1
- 验收标准: 过期证书、域名不符等错误明确；原取消及超时行为保持
- 状态: pending
- 验证方式: 针对性自动测试与生产连接验收
- commit: pending

## 运行恢复记录

- 根因：CPA 8.0.4 的 TLS 配置仍指向旧 LAN Media Hub 证书，截止 2026-10-22 03:01:14 UTC；小伴 HTTPS 入口与 DNS 续期本身正常。
- 私有 CPA 配置已留 0600 前像，只替换 TLS cert/key 路径；模型、密钥、权限和小伴会话未被改写。旧媒体证书目录及现有续期任务保持。
- CPA 启动时静态载入证书，配置热更新不会更换内存中的 TLS 证书。本轮仅重启确认的 CPA 用户任务一次；当时唯一已建立连接属于 Chrome 管理页。
- 新增 `scripts/reload-cpa-certificate.py`，部署为同 CPA 用户的 LaunchAgent：登录时及每 900 秒检查。目标证书必须有正确 SAN、完整可信链、匹配私钥；只在证书指纹变化且两次连接检查均空闲时重载，并严格验证实际新证书。进程身份、配置路径、原子证书目录与配置变化均有门禁；重试冷却 1 小时，标记原子落盘。
- 该检查与 CPA 一样依赖 Mac 用户登录；保守连接检查会对空闲长连接延后，不声称具有请求级无损 drain。未来真实 ACME 续期尚未发生，已验证当前受管证书和重载门禁。
- 验收截图：本机忽略目录 `.data/model-tls-recovery-20261023/production-qwen-success.jpg`，不提交用户页面数据。
