# 小伴第二轮性能优化

- Date: 2026-10-10
- Complexity: L2
- Status: final
- Baseline: 6bf7688，main干净；上一轮已完成bootstrap、deferred state和受控Cubism下载重叠。

## Background

人物加载中的占位图使用1,492,668B完整idle.webp，与3,142,568B主贴图竞争带宽；小型头像也启动同一占位。主贴图无损WebP试编码为1,504,778B，可减少传输且保留RGBA。App与首页主机列表定时探测在隐藏页面仍运行，未开启Chat+Agent的首页仍每10秒真实查询中央Codex。

## Goal

减少人物首轮传输与占位图解码开销，保持最终Cubism外观、原生动作及模型参数；降低隐藏页面非任务主机轮询与渲染更新，恢复可见时及时核验真实状态；本机构建和Chrome以同条件实测确认收益。

## Non-goals

不改变主题、人物比例／动作、语音与消息任务生命周期；不暂停后台任务结果／安卓通知轮询；不缓存用户权限、state或主机探测结果为伪上线。本轮不推送、发布、重打客户端或改板端／远端。

## Solution

### issue-1 人物资源

主贴图改为同尺寸lossless/exact WebP，发布前比较全部解码RGBA（含透明像素），保留源PNG于现有V11作者资产。模型manifest仅换纹理文件引用，MOC、动作、物理、其他原生参数不变。独立构建／核验脚本记录输入输出hash、尺寸、RGBA一致性，应用不依赖编码工具。提供由原始idle派生的小型加载预览，独立于实际备用渲染器的完整表情贴图；保留透明、比例和角色，默认人物最终贴图不降采样。预览使用带内容hash的文件名与immutable缓存，避免今后换图复用旧文件。普通可变模型manifest保持重新验证，不扩大静态缓存规则到所有avatars。

静态协商隔离审计发现大于1KB的JS Range仍被动态gzip，导致206正文与Content-Range字节不一致；本issue同时排除Range/Content-Range压缩并验收，保留普通JS gzip及安装包Range。

### issue-2 空闲轮询

以可见性调度非任务主机列表轮询，隐藏时停止下一次定时请求并取消当前请求；返回前台立即查询，不与在途请求重叠。保留手动刷新、配置／账号epoch隔离、卸载取消和真实Agent权限状态；清理隐藏或过期请求不能迟到修改UI。页面上的活动任务、任务报告和通知收敛机制保持独立。本轮不增加跨账号结果缓存。

首页native executor.status采用相同可见性门禁；它只是UI内存快照，实际执行器heartbeat与重连保持独立。LoginGate已认证的identity作为bootstrap到达前的语音scope，消除guest→真实身份时重复GET /voice，仍以当前epoch禁止账号切换后的迟到安装。

### issue-3 验收与本机上线

先记录当前构建Chrome受限网络冷启动／正常回访；相关资源与可见性回归通过后，tsc/Vite构建保留下载，核空闲、维护现有guardian并更新本机服务。412×960和桌面实际模型、加载预览、Chat/Agent与恢复验收；量化网络体积、资源完成时间和隐藏轮询请求数，保留账号／对话／配置与下载。

## Impact

src/avatar加载预览、public V12主纹理／manifest、编码核验脚本及静态缓存精确规则；App／ChatAssistant主机轮询及对应fixture测试；本地构建运行。最终模型视觉必须由真实Chrome另外验收，像素一致不能替代所有平台解码。

## Risks

编码必须exact保留透明RGB与alpha，不用有损压缩主贴图；旧作者／验包脚本不能假设V12必为PNG。预览小图只能出现在加载或模块错误时，不能取代完整备用动画资产。新静态文件名必须经内容hash核验；不能对mutable URL设置一年缓存。隐藏取消需排空在途请求、避免可见恢复与旧finally重复排队；不得干扰后台Agent任务、ASR/TTS或通知。

## Verification Plan

编码全RGBA比较，资源完整／合法模型引用测试，实际Core/V12/16动作回归；静态缓存规则／条件GET／下载Range隔离回归。可见性时钟／迟到取消／页面与账号切换／单请求并发／手动刷新fixture，Task通知和Agent回归。构建、Chrome禁用缓存与80ms/524288Bps同条件对照，预览与真实人物截图、隐藏／恢复请求数；私有服务配置与业务备份，下载名/size/mtime保留，本机guardian恢复。报告如实区分单次导航、fixture及本机服务；不宣称长期零故障或新安装包验收。
