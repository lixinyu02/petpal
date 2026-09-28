# 小伴可信 HTTPS 部署

- Date: 2026-09-29
- Complexity: L1
- Status: updated

## Background

公网 HTTP 页面不能使用浏览器安全上下文中的媒体设备能力；默认 HTTPS 入口当前为路由器自签名证书。用户提供现有证书主机的 SSH 账号，要求可直接供其他人使用。

## Goal

提供系统信任、域名匹配的 HTTPS 小伴入口，验证 Chrome 设备 API 和认证语音代理；保留账号、模型、历史及原有服务。

## Solution

- 在 Mac mini 上以独立 Caddy 实例监听 HTTPS 44318，代理到小伴当前 Windows 后端。初期复用同机证书完成连通验收，最终使用独立 DNS-01 签发的证书与私钥，不复制私钥到仓库或 Windows。
- 独立配置与进程，不修改现有媒体服务及其强制客户端证书策略。小伴入口使用服务器 TLS 和已有应用账号认证。
- 后端来源名单只追加 `https://magicdatou.top:44318`，保留其他私有设置。修改前保存私有备份；路由器保留一个精确 IPv4 TCP 转发和到 Mac 已公布 IPv6 地址 `/128` 的 TCP 44318 放行。用于初次 ACME 实验的 80/443 转发在公网验证超时后已撤除。
- 路由器 NetGov 依赖已允许设备的 MAC 与邻居表生成 IPv6 允许集。为原本已允许的 Mac 保存单个 `network.petpal_https_neighbor6`（`neighbor6`、`interface=lan`、固定 `ipaddr` 与已核对 `mac`），运行态设为永久邻居。只补齐固定服务地址，不变更设备允许名单或 NetGov 规则；后续前缀变化时同步维护 DNS、防火墙及邻居映射。配置语义已核对 [netifd 对应版本源码](https://github.com/openwrt/netifd/blob/76d2d41b7355e02f95fbfa79affbd232fb090595/config.c#L499)。
- Mac 后台进程直接访问 LAN 后端遭系统限制，而 SSH 会话可访问。最终使用 Windows 到 Mac 的受限 SSH reverse tunnel，代理 upstream 固定为 `127.0.0.1:14319`。SSH key 固定监听地址、禁止交互命令、校验主机密钥；不放宽 macOS 安全设置。
- Caddy 作为普通用户的系统 LaunchDaemon 启动。Windows supervisor 由当前用户登录启动，检查端口/PID/启动时间及健康状态，空闲时启动已有后端，SSH 断线后重连。后台 stderr 通过独立进程文件重定向，不触发 PowerShell 5.1 的终止异常。
- DNSPod 独立子用户仅有编程访问，四个所需 API 限定为该域名资源：DescribeDomainList、DescribeRecordList、CreateRecord、DeleteRecord。平台没有本次可验证的记录名/TXT 条件，因此不能宣称凭据只可写 `_acme-challenge`；操作程序只用于证书挑战，不修改业务记录。凭据存服务器普通用户拥有的 0600 文件。
- 通过已安装的 lego 5.3.1 `run` 签发/续期；每日当地 04:17 检查，剩余不超过 30 天才请求续期。私有锁避免本任务并发，已签但未发布的证书优先复用。发布前核对 SAN/时间、证书公钥与私钥、Python TLS 加载、系统 CA 信任链，再原子切换独立证书目录指针。
- 同一域名的其他 ACME 客户端或人工续签需错开执行：当前 lego DNSPod 清理逻辑会删除同一挑战名、TXT 类型、默认线路的记录，未按当前挑战值逐条筛选。本任务锁不协调原媒体或其他客户端。
- 核验 Caddy PID、用户、实际程序和完整参数后发送 SIGUSR1，并用正常 CA/域名验证检查监听器实际提供的新证书指纹。失败保留回退版本。旧的小伴共享证书重载任务已停用，不触及原媒体进程。首次签发、载入和未到期分支实测；未来到期续期、重启和故障回退不能据此宣称实测。
- 新 HTTPS Origin 使用同源 API，需要用户重新登录/授权设备。语音模型仍由后端调用，不把内网 HTTP URL直接交给浏览器。

## Non-goals

不变更已有媒体服务的客户端证书策略，不关闭浏览器验证，不安装自签 CA，不更换已发布安装包；不把麦克风授权等同 ASR 已实现。

## Verification

代理配置校验、系统信任链及 SAN/有效期、HTTPS 200 健康/401 匿名/403 错误来源、认证语音 WAV、Chrome 页面和安全上下文及设备列表/扬声器测试。保留 LAN 与公网回流、独立外网验证之间的证据区别。代理 SSE 采用默认及时刷新，保留客户端断开取消，不设置负 flush_interval。

独立公网节点的 IPv4（德国、日本）和 IPv6（芬兰）健康接口均返回 200 且信任证书。未来到期续签与宿主/路由器重启后的恢复仍需实际运行验证，不由一次签发或静态配置读回推导。

## Rollback

停止并卸载本任务独立代理、移除本任务新增转发、恢复追加前的后端来源名单。其他服务、规则及证书文件不回滚或覆盖。

另停用本任务 DNS 续期 LaunchDaemon、Windows 登录启动项及专用 SSH key；DNSPod 子用户与策略可由主账号停用。仅恢复本任务 Caddy 的私有备份，原媒体证书目录保持不动。最终配置、账号凭据和含路径的部署日志在私有目录，公开仓库只记录可复核的方案与边界。

如撤销本任务静态邻居，仅删除 `network.petpal_https_neighbor6` 并撤销对应永久邻居；不覆盖完整网络配置、不移除 Mac 原有允许名单。其余服务可能继续使用相同 IPv6 地址，先核对这些依赖。
