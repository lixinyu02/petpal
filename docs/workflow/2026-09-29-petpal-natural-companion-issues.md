# 自然角色交互迭代

- Date: 2026-09-29
- Complexity: L2
- Related design: 2026-09-29-petpal-natural-companion-design.md
- Current status: issue-29 in_progress

## issue-27

- ID: issue-27
- 标题: 自然角色交互、人物表现与 UI 整理
- 范围: 共用手势、两种 Scene、模型动作、首页/工作台/悬浮窗交互和样式
- 依赖: issue-26 done
- 验收标准: 无显式抚摸/喂食/休息按钮，直接操作角色且不吞空白滚动；两种角色状态一致，跳跃无断层，桌面和手机布局清晰
- 状态: done
- 验证方式: 49 项相关测试、TS/Vite、Chrome 两角色点击/键盘/触控休息、小猫窄屏唤醒保留草稿、空白触控滚动通过；390/412px 与桌面截图见 evidence/natural-companion（忽略目录）
- commit: e655380

## issue-28

- ID: issue-28
- 标题: 修复审查确认的运行与状态问题
- 范围: 执行器网络恢复、离线队列删除、原生交互验收与测试夹具稳定性
- 依赖: issue-27
- 验收标准: 临时断网可恢复可用状态，已领取任务不重放，账号边界和未知执行状态保持准确
- 状态: done
- 验证方式: 执行器/API/真实HTTP集成56项、队列/访问35项、smoke14项通过；全量549项首次548通过，唯一随机禁用端口夹具已修复且CosyVoice15项复验通过；此前Windows临时目录EBUSY清理已加有界重试、真实CLI6项通过；TS与语法通过
- commit: 本次 fix(issue-28) 提交

## issue-29

- ID: issue-29
- 标题: 可见的小手与抚摸动作反馈
- 范围: 角色命中后的鼠标小手、按住轻抚与触控短暂反馈
- 依赖: issue-28
- 验收标准: 小手只在角色命中时出现；按下/轻抚/松开反馈同步；滚动、多指、隐藏和减少动态行为正确，无操作按钮
- 状态: in_progress
- 验证方式: 手势反馈回归、Chrome 两角色鼠标与触控、清理与可访问性检查
- commit: pending

## issue-30

- ID: issue-30
- 标题: 部署并交付新版四端包
- 范围: 冻结构建、线上备份部署、四端包、更新签名、GitHub 发布与说明
- 依赖: issue-29
- 验收标准: 保留线上账号与历史，网页验收通过；包与冻结源码一致、下载可用，明确未验收的实机边界
- 状态: todo
- 验证方式: 原生 smoke、归档读回、Chrome 公网验收、GitHub 哈希及签名
- commit: pending
