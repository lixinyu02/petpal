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
