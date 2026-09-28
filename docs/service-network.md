# 源码服务的网络访问

`scripts/Start-PetPal-Service.ps1` 默认只监听 `127.0.0.1:4318`。需要局域网或受控公网入口时，在项目私有的 `.data/service-settings.json` 中合并以下字段；保留已有的 `codexHttpOrigins` 等设置：

```json
{
  "port": 4318,
  "host": "0.0.0.0",
  "allowedOrigins": ["http://petpal.example.com:4318"]
}
```

`host` 仅接受 `127.0.0.1` 或 `0.0.0.0`，省略时使用前者。`allowedOrigins` 省略时为空数组；每项必须是完整 HTTP(S) origin，只含协议、主机和可选端口，不含用户名、密码、路径、末尾 `/`、通配符、查询或片段。它同时允许该域名通过后端的 Host 校验。启动脚本明确设置子进程的来源名单，不沿用终端中残留的 `PETPAL_ALLOWED_ORIGINS`。

构建后运行 `powershell -File scripts/Start-PetPal-Service.ps1`。`-Port` 参数继续优先于文件配置；已占用的端口会报错，不会停止已有服务。修改设置后需受控重启该服务。启动结果中的 `url` 始终是本机健康检查地址，`listenHost` 和 `networkOrigins` 才反映本次网络设置。此设置只影响源码服务，不改变 Windows 桌面 EXE 的私有后台。

该脚本不会配置防火墙、路由器、DNS 或 TLS。IPv4 端口转发需指向运行服务的固定局域网地址，并单独放行所需 TCP 端口；域名若有 AAAA 记录，还需核实 IPv6 是否到达同一服务。局域网回环访问成功不能代替外部网络验收。

公网登录应使用可信 HTTPS 入口，HTTP 会明文传输密码和 Bearer 凭据；Android 应用也要求 HTTPS。HTTPS 反向代理需保持 SSE 不缓冲，并将实际网页 origin 加入名单；Android 连接还需加入 `https://localhost`。仅做网络联通检查时，使用不带凭据的 `/api/health`（仅返回状态与版本），并确认无凭据的 `/api/state` 返回 401。`.data/token` 和 `.data/service-logs` 都应保持私有，不公开配对链接或原始启动日志。

## HTTPS 与设备权限

当前小伴入口为 `https://magicdatou.top:44318`，端口不能省略。后端来源名单已追加该完整 origin。浏览器端服务地址留空以使用同源接口，或填入完整 HTTPS 地址；不要把内网 HTTP 后端或 CosyVoice 地址填到公网网页中。

HTTP 与 HTTPS 分别保存登录、设备选择和浏览器权限。第一次使用新入口需重新登录，并在主动测试麦克风／预览摄像头时授权。可信 HTTPS 提供安全上下文，但不会绕过用户或操作系统的设备权限。扬声器选择还取决于浏览器是否支持 `setSinkId`；系统语音始终跟随操作系统输出，CosyVoice 音频使用所选输出。

本次部署使用独立 Mac Caddy 实例终止 TLS，经过限定为单个 loopback 监听端口的 SSH 隧道访问 Windows 后端。Mac 代理作为普通用户运行的 LaunchDaemon 启动，Windows 隧道在当前用户登录后启动，并在断线时重连、端口空闲时启动已有后端；这不代表 Windows 登录前可用，也不代表持续监控后端崩溃。两台主机及网络需在线。

路由器只为该入口保留 IPv4 TCP 44318 转发和目标 Mac `/128` 的 IPv6 TCP 44318 放行。Mac 原已在 NetGov 的设备允许名单；额外保存单个静态 IPv6 邻居映射，避免固定服务地址从自动学习的允许集中遗漏。已有 IPv6 DNS 记录仍有效；公网前缀变化时需同步更新 DNS、精确防火墙地址和该邻居映射。原有媒体端口保持客户端证书认证，路由器局域网管理保持不变。临时用于 ACME 验证的 80/443 转发在公网验证超时后已撤除。

证书与 DNS 凭据只放在服务器私有目录，不能提交仓库。DNSPod 续期任务每天当地时间 04:17 检查证书，剩余不超过 30 天时申请续签并校验载入结果。2026-09-29 已从德国、日本独立节点验证 IPv4、从芬兰独立节点验证 IPv6：健康接口均为 200，TLS 信任检查通过。续期、Chrome 验收与尚未实测的运行边界见 [HTTPS 部署任务](workflow/2026-09-29-petpal-https-issues.md)。
