# 云端环境创建故障与管理员准入

- Date: 2026-10-25
- Complexity: L2
- Status: final

## Background

zut 的 K3s 申请已有项目记录，creationPending=true，观察状态 stopped。原页面隐藏了具体错误；本服务的 local Docker 和已配对 Platform 都是中央管理资源，普通用户不应分配新环境。

## Goal

核对原申请的平台/节点回执与日志，修正适配错误；中央创建与未完成创建恢复只允许管理员，前端隐藏对应入口，保留已有资料。

## Non-goals

不删除 zut 的项目/数据，不重新分配账号归属，不向普通账号开放管理员能力，不修改其他主机或重启集群，不重打客户端。

## Solution

服务层 create 默认要求 isAdmin；HTTP 创建路由管理员检查；目录对普通账号返回空创建来源/节点以及 canCreate=false。前端同时依据账号与目录隐藏新建/确认创建，拒绝旧事件处理器，隐藏普通账号的 pending 创建恢复启动；已完成且属于自己的环境仍可使用和正常启停。

未完成创建的 start 走与 create 相同准入，异步关键边界重新校验当前身份，阻止降权过程中继续分配。未登录401、普通用户403，拒绝发生在驱动、journal分配或资源动作之前。

诊断先保留本机和平台原记录，再使用只读 inspect/集群状态。恢复只沿用原逻辑ID与requestId，不通过普通账号发起，不重复创建资源。修复具体错误提示，区分已知失败与结果未知；未知请求仍沿用原幂等ID。

## Impact

cloud routes/service、前端、合成回归和必要的平台生命周期适配。已有 platform/service-links 两份工作区改动先备份，逐项评估，仅提交本任务必需的差异。

## Risks

旧前端绕过入口、未完成 start 绕过 create、异步降权、上游/节点不同版本的 revision、创建超时导致重复申请。保留原状态与下载，部署不暂停记忆学习或重启 Memobase。

## Verification Plan

服务/API/真实UI处理函数测试管理员/普通/所有者、直接POST、恢复start、降权、旧事件、未知送达；实际平台只读对账及管理员独立验证。Chrome 查看入口隐藏，正式API拒绝与发布保留检查。
