# Notebook 网站与内置 OpenCLI 接入

- Date: 2026-10-02
- Complexity: L2
- Status: updated

## Background

用户要求把所提供 notebook 中的网站接入 PetPal 内置 OpenCLI，供所选电脑上的 Agent 使用。只读解析得到九个核心站点及正文补充的贴吧、B站、夸克，共十二个名称。随后用户提供 opencli_adaptation_plan.json 和上游适配器目录，完整目标为十三站（新增迅雷云盘）及具体域名。文件仅作为数据和参考，未执行其中代码或采集建议。不得执行 notebook 的历史采集/解密脚本，也不把访问统计、分享地址、提取码提交公开仓库。

## Goal

接入百度搜索、必应、百度网盘、贴吧、哔哩哔哩、夸克的固定只读查询；接入迅雷云盘分享信息与根目录；为电影云集、Switch520、Gamer520、电影港、围炉Go、消防职业技能鉴定考试网提供由用户配置当前网址的受控页面读取与站内搜索。网站与命令清单分别展示公开查询、浏览器查询、待配置网址，并保持 Agent 权限和执行电脑选择。

## Non-goals

不自动采集360浏览历史，不绕过网站登录/验证码，不开放下载/保存网盘文件/发帖/付款，不加载用户插件或任意脚本，不更改已发布 0.9.6 安装包和签名更新清单。

## Solution

保留现有 23 条公开 worker 查询。新增固定浏览器策略和自建站点适配器，复用 OpenCLI 1.8.8 daemon、显式 Chrome profile、独立页面租约和账号 scope。Agent 仍通过 petpal_opencli_sites/query 调用，根据策略路由至公开 worker 或浏览器 runner。B站、贴吧复用经审核的固定上游只读模块；网盘仅返回有界文件信息，不返回 cookie/token；输入提取码不进入审批描述或错误。浏览器查询结果有总条目、字节及时间上限，取消后不自动重试。

六个自建资源站以用户提供域名作为默认 HTTPS origin；用户可在 OpenCLI 设置覆盖当前网址（电影云集最多两项），Agent 只能读取该站已配置 origin 内地址。除已核实 Switch520 原生搜索外，站内搜索明确标为必应 site: 搜索，避免声称已有专用原生 API。旧 enabled/revision 配置可无损读取；网站配置同样通过 CAS revision、私有 scope 目录与原子文件写入。

## Impact

涉及 server/opencli*.mjs、desktop-tools 工具说明、tool version、OpenCLI 设置与类型、Windows/Ubuntu 源码闭包核验。Web/Android使用所选远程执行电脑；只有管理员能配置服务主机，桌面完整权限用户管理本机配置。此次先发布网页/后端，旧客户端待下一次打包获得新运行时。

## Risks

浏览器来源检查是操作策略，不是网络沙箱；网站自身跳转和已经发出的操作无法由取消撤回。页面布局、站点风控和登录状态可能影响结果，必须在状态及验收中如实区分。十三站域名均来自用户计划；Chrome 已确认 Switch520、Gamer520、围炉Go 的 www 跳转并纳入默认范围。电影港当前连接关闭，百度网盘被浏览器工具站点安全策略阻止，均不可声称实际访问通过。

## Verification Plan

固定 schema、URL/来源、显式 profile、账号隔离、旧配置兼容/CAS、输出凭据剔除、结果上限、取消和租约清理测试；相关回归及 web build；优先通过 Chrome 插件对实际网站与产品 UI 验收，登录/验证码交用户处理。记录联网结果与 fixture 结果，未验证的网站不声称通过。

## 追加需求：未安装 Chrome 的执行电脑

用户要求考虑 Chrome / 扩展缺失的首次使用场景。OpenCLI CLI 已打包，不能要求另装全局 npm。新增固定安装引导供所选执行电脑的 Agent 调用，先检测平台、Chrome 和 Bridge，再从 Google 官方准备 Chrome 安装器。Windows 验证 Authenticode Google 签名；Ubuntu x64 / ARM64 使用官方对应 .deb 并检查包名与架构。系统提权、协议与扩展访问授权由用户在相应界面完成；不静默改浏览器偏好或用户档案。安装器启动只报告等待用户，不声称就绪。公开 worker 查询仍不需要 Chrome。

设置里的“交给 Agent 准备”只产生可检查的任务草稿，保留当前执行电脑、权限和模型；不得自动提高权限或自动发送。Web / Android 可以准备远程电脑，不能在手机上安装桌面扩展。最终就绪仍需要显式连接在线 Chrome 档案。
