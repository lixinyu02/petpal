# Open Claude UI 参考实现 Issues

- Date: 2026-10-22
- Complexity: L1
- Related design: 2026-10-22-open-claude-ui-design.md

## Task Overview

- Goal: 按实际开源组件规范改善小伴深色界面。
- Ordering rule: Complete issues in sequence.
- Current status: issue-1 done

## Issue List

- [x] issue-1 完成主题与交互控件的统一参考实现

## issue-1

- ID: issue-1
- 标题: CDS表面层次与轻量控件
- 范围: 连贯主题切片，包含夜间tokens、原生首帧、分段选择、Composer/弹层/消息操作及来源许可；不引入整包依赖。
- 依赖: none
- 验收标准: 灰阶层次/中性选中/统一圆角实际可见；触控与键盘可用，无布局溢出或fixed菜单偏移；对比度/减少动画/日间/自动/透明合同通过，生产与正式包不动。
- 状态: done
- 验证方式: Chrome1440×1000/412×960/360×800；模型与权限浮层、模式滑块、键盘/触控消息操作、对比度与day/auto/reduced；合成hidden生命周期；157/157、tsc和隔离Vite通过，结果见design。未打包/部署/实机验收。
- commit: feat(issue-1): adapt Claude surface and control patterns（本议题同次提交）

## Review

- [x] Requirement alignment：按固定上游源码落实表面/控件，保留MIT通知，无示例业务或新依赖。
- [x] Regression risk：不改变fixed弹层祖先坐标系，补触控/混合指针和不支持:has的可见性降级。
- [x] Test coverage：相关合同、Chrome视觉/几何/对比度、生命周期、类型与隔离构建完成；实体设备及旧浏览器边界明确。
- [x] Dirty changes：仅本议题主题、原生常量、合同测试、许可与设计文档；业务和发布资产未改。
- [x] Docs sync：结果、证据与临时进程收尾已记录。
