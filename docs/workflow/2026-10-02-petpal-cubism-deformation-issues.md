# Cubism 动态变形修复

- Date: 2026-10-02
- Complexity: L2
- Related design: 2026-10-02-petpal-cubism-deformation-design.md
- Current status: issue-1/2 done; V7 web delivered; aesthetic feedback and official Editor acceptance remain open

## issue-1

- ID: issue-1
- 标题: 修复动作中的五官、头身与发际变形
- 范围: 固定姿态诊断、稳定 authoring profile、新 MOC／物理、runtime 参数所有权、V4 统一前发／额头覆盖及眼组比例修正、真实几何与 Chrome 验收、网页交付
- 依赖: 保留当前 v2 美术与冻结作者工具
- 验收标准: 静态刘海合理覆盖额头、发旋一致、不因补刘海大幅遮眼；单参数及组合动作不拉长脸／扭曲五官，头发和颈肩保持协调，动作与指针不会叠加出过大形变；眨眼／口型／互动和生命周期正常；实际 Chrome 静态和动态对照通过后才上线
- 状态: done
- 验证方式: 真实 Core 几何回归、固定姿态和慢速 Chrome 检查、TS／隔离构建、公网读回及生产边界核对
- commit: 本 issue 的交付提交（Git history）

### 本轮结果

- V3 动态绑定修复保留为历史；当前 V4 改为单张统一前发，眼组缩小 15%、虹膜额外缩小 8%，原脸与连续身体保留。
- 19 层 PSD 原生像素读回、额头／遮眼负例、官方 Core 与真实几何回归通过；210 项相关 avatar／Cubism／speech 检查、TS 与隔离生产构建通过。
- Chrome 对照了中性、半眨眼、微笑、口型、组合视线及连续动态；正式网页 412×960 无横向溢出，点击、鼠标长按休息、键盘唤醒与减少动画偏好通过。
- 已有消息的真实流式 TTS 返回 200 NDJSON，实际嘴型跟随播放能量并在停止后闭合。未新增 Chat／Agent 请求。
- V4 已原子更新网页，83 个公网资源读回匹配；后端、账号/token、下载包与稳定升级清单在部署时保持，临时预览服务及浏览器覆盖已清理。
- 本轮不重打客户端；CMO3 官方 Editor 与实体设备未重验，用户对 V4 外观的最终评价待体验。详细来源、hash 与范围见 [验收记录](../cubism/validation.md)。

## issue-2

- ID: issue-2
- 标题: 补强原人物 Cubism 模型与稳定动态
- 范围: V5/V6 历史候选；最终 V7 原比例 native PSD、reference-layered rig、真实 MOC/CMO3、局部眼口与情绪、真实动态验收及网页交付
- 依赖: issue-1；保留旧 V4 和原参考
- 验收标准: 保留原中性人物脸部与发际比例；小幅头身和发梢动作协调、原生闭眼与局部嘴型无持续重影，情绪与真实朗读可用；真实 Core/Chrome 比对后上线并保留回退。独立眼球视线、连续眼睑和官方 Editor 验收不计入本次完成范围，用户美术反馈仍待体验
- 状态: done
- 验证方式: 源逐层 RGBA 读回、真实 Core 58 姿态、7 项专用回归与121组合姿态、Chrome 完整原图/V7 动态及412×960、实际 TTS、205相关检查、TS／隔离构建、公网读回
- commit: 本 issue 的 V7 补强提交（Git history）；历史恢复检查点为 9eb3bcc

### 最新纠正与 V7 目标

用户明确要求补强 Cubism，原立绘恢复仅是临时检查点。此 issue 继续完成真实模型：同一中性母稿、局部原生覆片、协调头身及发梢绑定、真实 MOC/Core/Chrome 动态验收，再切回默认 Cubism。原 profile 和历史候选保持；不重打客户端。不得用旧几何测试或回退截图证明新模型完成。

### V7 交付结果

实际 11 ArtMesh／16 响应参数模型已成为正式网页默认。PSD 像素核对、Core 58 姿态、121 组合姿态、205 相关回归、TS／隔离构建通过；Chrome 正式网页 412×960、直接点击／长按／键盘唤醒及实际流式朗读与停止闭嘴通过。135 静态文件部署核对、131 正式 HTTPS 资源读回匹配，后端／账号／下载／更新清单保持。本轮只更新网页。连续眼睑、独立眼球视线、手部动作和官方 Editor 仍未完成，不声称完整专业 VTuber 模型；美术最终评价仍以用户体验为准。见 [V7 验收](../cubism/reference-layered-validation.md)。

### 用户否定后调整（历史）

V5 曾上线但用户未接受；V6 未作为默认人物上线，且用户继续指出诡异。默认展示恢复完整原立绘动画，不将候选作为已修复的完整 Cubism 模型。此 issue 的外观修复仍在进行，当前交付目标是恢复协调人物并验证原动画、口型及互动；全 Cubism 模型的美术重制保留为未完成事项。

原完整立绘恢复已交付网页。移除原立绘眼／眉局部 UV 折返和 DOM 重复轮廓风险，正式 Chrome 412×960、互动、已有回复真实朗读及停止闭嘴通过；189 项相关检查、TS、隔离构建与 118 公网资源读回通过。完整 Cubism 美术仍未完成，issue 保持 in_progress；本次仅提交恢复检查点，不把用户未接受的候选标成 done。见 [恢复验收](../cubism/portrait-recovery-validation.md)。
