# 工作区过渡动效

- Date: 2026-10-22
- Complexity: L1
- Status: completed; source and isolated acceptance only

## Background

基线649c9cd已具备模型/权限菜单、弹窗、欢迎页、按钮和新消息入口动效，且有统一full/reduced/off生命周期。用户希望增加过渡效果；本轮补真实缺口，不重复添加已有效果。

## Goal

视觉保持淡白/深色主题的安静层次：历史对话切换用短淡入，Chat/Agent控制区切换清晰但不拖慢操作，消息导航收放带轻微位移，侧栏选中反馈更连贯。

## Solution

复用useUiEntrance，允许在既有DOM ref上启用有限入口动画。对话入口只依赖会话/模式及是否有消息，不随逐字流、语音进度或草稿重复触发；控制区只在模式改变或重入Chat时淡入。两处祖先只改变opacity，避免transform影响fixed菜单定位。导航指示条和消息导航只用opacity/transform短过渡，不新增常驻循环、动画库或延迟业务状态。

## Non-goals

不重排UI、不改变模型/任务/权限、账号及草稿逻辑；不对整个历史逐条重播、不做耗时模糊或尺寸动画、不重载人物、不打包或替换生产资产。

## Risks

动画必须服从系统reduced motion、隐藏/off及原有清理策略，恢复前台不能重播。收起导航马上inert/aria-hidden，不为退场动画保留可操作的隐藏按钮。对话切换不能改变焦点、滚动跟随或DOM身份。

## Verification Plan

相关动效生命周期和App交互回归、类型检查与隔离构建；Chrome真实页面检查动画名/次数、输入和流式更新不重播、模式菜单定位、412×960导航收放与日/夜/reduced样式。保留截图和原始DOM/动画结果，使用新临时数据，不操作生产服务。
