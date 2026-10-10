# 小伴打开速度与服务稳定性

- Date: 2026-10-10
- Complexity: L2
- Status: final
- Baseline: 32a8eac；工作区干净，本机后端0.9.10运行。

## Background

首屏 `/api/state` 等待真实 Codex 启动与 account/read，与普通首页／Chat 所需数据耦合；首页还获取全部对话。App拿到状态后仍等待人物偏好PATCH，最长15秒。Cubism模型初始化依次等待Core、manifest、MOC、动作批次和贴图，形成多级网络链。模型测试probe缺少done，关闭服务未等待其取消收敛。

## Goal

普通首页和Chat尽早可用，Agent就绪仍由真实探测判断；减少真实模型的冷加载网络波次，保证模型完整后才ready；取消、并发与服务关闭有界且不会迟到成功。完成源码、本机运行与Chrome验收。

## Non-goals

不更换框架、模型资产或默认主题，不改变账户权限／模型配置／审批／语音协议，不宣称长期零故障，不改远端、板端或路由器。本轮不发布、推送或重打四端包；保留用户数据和既有下载。

## Solution

### 服务启动接口

新增认证后的轻量 `/api/bootstrap`，提供首页所需账号、设置、模型及Codex配置元数据，不读取历史、不执行Agent探测或任务刷新。现有 `/api/state` 默认行为保持；增加 `runtime=deferred` 只返回配置元数据，仍保留完整历史与任务刷新。未探测状态不能标记available/online。详细 `/api/codex/status` 和执行主机列表仍做真实探测。

同一bridge的并发状态探测复用一个进行中的promise，配置切换和关闭仍等待实际所有者，不以Promise.race丢弃子任务。补齐provider test probe的done/finally清理。身份与权限在响应前重新验证，不跨用户缓存结果。服务进入关闭状态后禁止新的身份授权／写入；登录密码校验完成后及响应前重新检查关闭门禁，避免密码校验迟到生成新session。

### 前端启动

首页使用bootstrap，404时仅回退旧state接口以兼容旧服务；Chat首次读取使用deferred state。账号epoch隔离保持，首次加载可取消且超时后显示可恢复的连接错误。状态先初始化Chat，人物偏好同步独立进行，仍遵循现有dirty与身份门禁。central和desktop均以所选主机的真实Codex探测结果判断Agent可用，不把deferred中的pending误判为离线；设置修改后的完整刷新继续沿用原state接口。

Cubism在原路径校验后重叠Core与manifest获取；有界贴图原始字节请求与MOC／动作加载重叠，解码／GPU上传及所有动作就绪顺序保持。任何失败先取消并等待关联下载结束，再释放GPU／返回错误；旧加载不能提交给新角色。保留隐藏暂停、减少动画及备用渲染器按需加载。

## Impact

server启动状态／probe生命周期，src/api与首页／App初始化，Cubism资源加载及相关回归。发布包规则与既有服务地址保持。

### 本机验收中发现的守护问题

issue-3 附带修复本机既有私有 `.data/service-guardian.ps1`：PowerShell 7 默认把 JSON 的 ISO 时间转换为 UTC DateTime，再隐式转字符串送入 DateTime.Parse 会丢失时区，产生八小时误差；本机 guardian 配置路径也需规范化。使用 DateKind String（可用时）保留原始文本，DateTime 直接构造 DateTimeOffset，拒绝无时区时间，并保持 PID、可执行文件、命令和监听器身份检查。实际脚本两函数在 PowerShell 5.1 和 7.6.5 各35项通过。

恢复已启用的现有登录任务，不新增任务或扩大监听范围；恢复测试只退出经核对的空闲后端一次。该守护修复位于忽略的本机私有目录，本轮安装包不包含它。最终实现／运行边界见同日期 validation 文档。

## Risks

deferred配置不可误作Agent实际可用；bootstrap不携带历史或其他账号数据；旧后端回退必须只针对404。共享探测不能锁死配置或在关闭后重启。下载重叠必须有并发／字节边界，失败后不可残留下载或使用已释放纹理。任何速度数字区分fixture网络延迟、本机Chrome和真实安装包。

## Verification Plan

记录优化前本机构建和Chrome加载资源；慢／失败Codex fixture下bootstrap与deferred state快速返回、认证撤销、共享探测与关闭回归；provider probe取消收敛。挂起偏好／首次请求及账号切换测试；延迟资源fixture证明重叠波次和失败后排空；真实Core/MOC Chrome冷暖加载、首页/Chat、412×960及失败恢复。tsc、Vite保持downloads的构建、相关回归与并发短时稳定性检查；先核本机无执行任务、备份数据，再精准更新后端。最终记录保留证明及验收边界。
