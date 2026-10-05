# 淡白默认主题 Issues

- Date: 2026-10-05
- Complexity: L0
- Related design: none
- Current status: issue-1 done

## Design Note

未保存主题、非法主题和存储不可用时默认日间淡白背景（#fafbf8），首屏HTML与React主题控制器保持一致。保留明确保存的night/auto及自动07:00–19:00日间规则，不改人物纹理或透明桌宠。四端共用源码同步；本轮上线网页，已发布0.9.9安装包及更新签名不替换。

## issue-1

- ID: issue-1
- 标题: 默认淡白主题与网页上线
- 范围: 默认值、首屏策略、外观说明、相关既有测试、隔离构建与静态部署
- 依赖: none
- 验收标准: 晚上未设置主题仍为淡白；首屏不闪深色；手动夜间和自动切换有效；既有选择保持；生产下载及后端保持
- 状态: done
- 验证方式: 既有主题测试16/16、tsc --noEmit及隔离Vite构建通过。首屏策略测试覆盖默认/非法/存储拒绝、auto边界和透明浮窗；未重复完整回归。HTTPS首页读回与隔离构建SHA一致，后端health为0.9.9；未重启后端，15个公开下载文件及4份更新元数据指纹保持。Chrome已有auto选择被保留为夜间；通过设备连接→外观选择日间后，实际day/day、light及rgb(250, 251, 248)，页面无横向溢出（1906px）。截图及结构化回执在evidence/light-default-20261005/。新默认仅随本轮网页上线及共享源码生效，现有0.9.9安装包未重打，原客户端可手动选日间。
- commit: fix(issue-1): default to pale daylight theme（本issue提交）
