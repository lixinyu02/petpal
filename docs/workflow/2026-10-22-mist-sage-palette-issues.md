# 雾灰与青绿配色调整

- Date: 2026-10-22
- Complexity: L0
- Related design: none

## Design Note

用户先确认「雾灰＋低饱和青绿」，预览后反馈仍不美观。最终将大面积背景收敛为中性石墨灰 #282828，正文改为米白 #e5e3dd，青绿仅点缀主按钮、链接和焦点，导航/选中/菜单均用中性灰；缩小侧栏与正文背景的明暗差。以聊天正文为主，导航和模型/权限菜单为辅；沿用既有短过渡与减少动画策略。日间默认淡白 #fafbf8 保持。仅更换主题颜色及跨端首帧常量，不引入依赖或修改业务、布局、角色纹理、正式发布资产。

## Task Overview

- Goal: 改善深色模式的色彩舒适度，同时保持文字、焦点及状态可辨识。
- Ordering rule: Complete issues in sequence.
- Current status: issue-1 done

## Issue List

- [x] issue-1 替换夜间调色板并核对跨端主题

## issue-1

- ID: issue-1
- 标题: 雾灰青绿主题
- 范围: theme.css、残留焦点/角色环境色、Web/Electron/Android 首帧及现有颜色合同。
- 依赖: none
- 验收标准: 主界面、菜单、输入框和角色环境色统一；正文对比度至少4.5，字段与焦点至少3；桌面与412×960/360×800无横向溢出；日间/自动/透明策略保持。
- 状态: done
- 验证方式: 94/94 现有Node测试、tsc --noEmit、独立Vite构建通过；Chrome 1440×1000、412×960、360×800 合成数据界面无文档横向溢出。模式按钮44px；412宽模型菜单x16/w360/right376。正文/主背景11.49、输入框9.99、启用态按钮文字/底色7.42。日间仍#fafbf8，自动在本机夜间为#282828；主题自动/透明及原生颜色合同通过。未打包或做实体客户端验收。
- commit: fix(issue-1): soften night palette with neutral graphite surfaces（本议题同次提交）

## Evidence

- 本轮独立夹具及证据：`.tools/mist-sage-20261022/`；修改前五个文件冻结于a9cc2a3，仅作为源码基线，不声称运行过前后双实例对比。
- 实际截图：`browser/evidence/desktop-final.png`、`mobile-final.png`、`mobile-models.png`、`narrow.png`；计算样式与主题结果保存在同目录json。
- 首版有整片青灰底，用户反馈仍不美观后调整到最终中性石墨灰；首版截图仅保留为过程证据。
- 开发热更新后Chrome一次状态读取超时，随后页面恢复；浏览器模拟尺寸被重置后重新设置并核对CSS尺寸，最终截图使用完整1440×1000视口。没有将工具超时算为产品错误。
- Web/Electron/Android首帧色、系统边缘背景和原有测试预期同步；未改发布清单、线上服务或生产dist。

## Review

- [x] Requirement alignment：按最新反馈去除大面积绿调，保留米白正文与少量青绿操作色。
- [x] Regression risk：布局、业务、日间默认、动画和角色纹理保持，跨端背景同步。
- [x] Test coverage：现有相关合同、Chrome视觉/尺寸/主题切换与隔离构建通过。
- [x] Dirty changes：起始Git干净，变更仅本轮主题及合同，无发布资产变更。
- [x] Docs sync：本文件记录结果与验收边界。
