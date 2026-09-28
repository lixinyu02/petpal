# 小伴 HTTPS 部署任务

- Date: 2026-09-29
- Complexity: L1
- Related design: 2026-09-29-petpal-https-design.md

## issue-17

- ID: issue-17
- 标题: 部署独立可信 HTTPS 入口并验证媒体能力
- 范围: 隔离 Caddy、来源名单、IPv4/IPv6 入口、受限隧道、DNSPod 独立证书与更新载入、浏览器验收
- 依赖: issue-16 done
- 验收标准: 无证书绕过即可打开，认证接口和语音可用，设备安全上下文恢复；原媒体 mTLS 和路由管理保持；续期与运行限制如实记录
- 状态: done
- 验证方式: SSH 配置检查、TLS/HTTP 探针、真实 WAV、Chrome 页面与设备控件
- commit: 本提交（issue-17）

## 验证与证据

- `https://magicdatou.top:44318` 的最终 IPv4/IPv6 TLS 均在默认 CA/主机名校验开启时返回健康 200。匿名和错误凭据 401，错误 Origin 403；实例 ID 与原有六个会话 ID 保持一致。认证 HTTPS CosyVoice 返回 7.36 秒、24 kHz / 16-bit / mono、353,324-byte WAV，SHA-256 `f44ca6a2808b4c383dc746f7446d9c096969940baa1aa9e67d0a3c3197d3c506`，与此前真实上游结果一致。
- 独立公网测试使用域名的无凭据 `/api/health`：Globalping 德国 Falkenstein、日本 Tokyo 的 IPv4 均返回 200、TLS 1.3 `authorized: true`（measurement `2UvF2HwdvtQLmPomT00021DhT`）；芬兰 Helsinki 的 IPv6 同样通过（`2Zs66dTscmuWmVIsj00021Dhf`），证书指纹与本次签发结果一致。
- IPv6 首次外部测试超时的根因为路由器 NetGov 设备允许集遗漏 Mac 的固定地址。实时核实 Mac MAC 原已在允许名单，NDP 探测确认地址归属；只补入这个地址后外部测试通过。随后新增单个持久 `network.petpal_https_neighbor6`，并将相同地址/MAC 的运行态邻居设为 `PERMANENT`，供 NetGov 后续重建允许集使用。没有关闭设备控制、增加允许设备、修改 NetGov 源码或重载整个网络；原有端口防火墙仍生效。
- Chrome 插件实际打开新 HTTPS 页面，无证书拦截；语音与设备的刷新、麦克风、摄像头、扬声器选择控件均可用，测试音显示播放结束。麦克风请求进入等待用户权限后已停止，未录音/上传；未把设备控件可用写作实际麦克风、摄像头或物理喇叭质量验证。
- 独立 DNSPod 子用户仅编程访问，绑定唯一单域名四动作策略；密钥直接转存服务器 0600 文件，本机临时输入已删除，无仓库凭据。DNS-01 首次签发成功，新证书有效至 `2026-12-27T17:21:58Z`，SAN 仅 `magicdatou.top`，叶证书 SHA-256 `a76764495c9134cabad55b70239b30c76435a654e6b6eb41b48a8553111c9b31`。
- 以普通用户运行的续期 LaunchDaemon 已加载每日 04:17 配置。首次发布复用了已签发证书，无重复申请；实际 SIGUSR1 后监听器指纹与新证书相同，未到期分支返回 89 天剩余，job exit 0。修复了 macOS 日志文件属主导致的 EX_CONFIG 和系统 LibreSSL 不支持 `-check` 的兼容问题；最终使用实际通过的 Python TLS 加载校验。
- Windows 登录启动项已安装；精确停止本任务 SSH 子进程后，supervisor 自动创建新 SSH 子进程并恢复 HTTPS 200。PowerShell 5.1 隔离测试验证两次 stderr/非零退出后仍重试、已占用端口不重启后端、空闲端口调用原启动器、拒绝无关进程。
- 原媒体 56122 仍返回客户端证书必需的 TLS 错误且保留原证书；路由器 LAN HTTP 管理仍为 200。后端源码无需修改；必须显式允许带端口的 HTTPS origin。未设置跨端口影响其他 HTTP 应用的 HSTS。
- 续期私有脚本的 5 项隔离测试、语法与嵌入源码一致性、Mac 原生 PID/UID/程序/参数/证书检查通过。最终脚本 SHA-256 `2b0cec1cdfb1b3a1dcfe7080dc497bd75ec482e213bb75d6df31482d459e097c`。没有重跑与部署无关的业务测试或重新发布安装包。

## 范围限制

- 独立外网验收覆盖上述三个测试节点的健康接口，不能代表所有地区和运营商。DNS-01 签发与网站连通分别验证；固定 IPv6 前缀若改变，DNS、精确防火墙及本任务静态邻居须同步更新。
- 未来到期续签、日历定时唤醒、整机重启和失败回退尚未经历实测。Windows 依赖用户登录，两个宿主必须在线；supervisor 仅在连接前检查后端，并非持续监控后端进程的系统服务。
- 静态邻居配置已提交并读回，运行态为 `PERMANENT`；netifd 对该配置的支持已核对到路由器所用源码 commit。未通过重启路由器或完整重载 NetGov 验证恢复过程。
- 现有其他 HTTP 入口保留兼容。分享给其他人的链接应使用完整 HTTPS 44318 地址，首次需要重新登录和允许媒体权限。原媒体服务自身的证书续期不在本次独立小伴部署范围内。
- 同域名的其他 ACME 客户端或人工续签需避开本任务执行时间；lego 当前 DNSPod 清理逻辑可能删除同名挑战的其他 TXT 值，本任务锁不能协调其他服务。

私有验收材料位于 `.data/https/` 与 `evidence/cosyvoice/https-verification.json`，不提交账号凭据、证书私钥或运行日志。
