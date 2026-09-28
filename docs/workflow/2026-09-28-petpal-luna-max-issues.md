# Luna Max 与路由器入口

## issue-12
- ID: issue-12
- 标题: 贯通推理强度并设置 Luna Max 默认连接
- 范围: 普通聊天与 Codex 的推理强度、界面、真实调用、本机两套配置、Windows 0.6.1 便携包
- 依赖: issue-11 done
- 验收标准: max 真正进入请求；配置可保存/清空；缺字段旧数据正常；两套私人默认配置有效；新版 EXE 可运行
- 状态: done
- 验证方式: 定向测试、构建、Chrome、实际模型请求、原生 EXE 验收和源码审计
- commit: 本 issue 的 `feat(issue-12): support Luna Max reasoning and desktop config` 提交

## issue-13
- ID: issue-13
- 标题: 配置用户指定服务的端口转发
- 范围: 路由器 SSH 检查、精确端口规则、备份及运行态检查
- 依赖: 用户确认开放的具体服务；issue-12 done
- 验收标准: 目标明确；保留已有规则；新增配置与运行规则一致；说明连通性验证范围
- 状态: in_progress
- 验证方式: SSH 只读预检、配置备份/diff、实际转发表与端点探测
- commit: pending

## 当前记录

- 后端 78 项定向测试通过；UI、会话隔离相关 15 项测试通过；构建通过。真实内置 Codex 初次与续接请求均捕获 `gpt-6-luna` / `reasoning.effort=max`。自定义模型须在显式设置强度时声明原生推理能力，否则 CLI 会省略参数；本次由原生配置解决，没有重写模型请求。
- 本机源码和桌面连接分别保存 Luna Max，旧配置已私有备份，用户及历史 ID 保持。实际网关普通聊天和 Codex 均返回非空完成回复；Chrome 确认默认模型和 Codex 强度显示。证据保存在 `evidence/luna-max/`。
- Windows 0.6.1 最终便携 EXE 为 180,858,957 bytes，SHA-256 `f34f8d7ead1e418cb33dbe48fdd13f6ec445997b8e308a5373b99b6d4d30fd68`。1,963 个文件逐字核对通过；修正私有验收脚本真正移除 `ELECTRON_RUN_AS_NODE` 后，同一原始 EXE 的原生运行通过（139.63 秒，含约 119 秒解压；退出码 0、遗留进程 0）。Codex、OpenCLI、两种伙伴、双窗口、透明与置顶通过，47 个运行文件哈希与读回证据一致。未改变产品代码以绕过验收，也没有宣称新版 Ubuntu/Android 包已重建。
- SSH 已备份路由器配置并新增两个精确 IPv4 TCP 转发；旧模型规则保留。后端显式监听与域名来源配置已启用，桌面回环行为不变。公网 IP 回流健康 200、无凭据接口 401、错误 Host/Origin 403、私有路径不返回真实文件均通过。未修改 Windows 防火墙；未宣称独立外网、HTTPS 或 IPv6 后端验收。
- 已修复本地 DNS 的 Fake-IP 代理路径：在现有 overwrite hook 最终退出前追加幂等的精确域名例外，保持 custom 模板关闭，仅将有效列表从 61 项增为 62 项。候选语义比较确认只新增该域名；代理服务重启后原规则保持，真实 A 解析、Chrome 域名页面、域名后端健康及带鉴权的模型列表（11 个、含 Luna）全部通过。路由器本身未重启，公共 A/AAAA 记录未更改。备份与详细证据留在本机/路由器私有目录。
