# 小伴第二轮性能优化 Issues

- Date: 2026-10-10
- Complexity: L2
- Related design: 2026-10-10-petpal-performance-next-design.md

## Task Overview

- Goal: 减少人物网络／解码成本与非任务后台轮询，实际验收性能收益。
- Ordering rule: Complete issues in sequence.
- Current status: complete

## Issue List

- [x] issue-1 人物资源体积与加载预览
- [x] issue-2 可见性控制非任务主机轮询
- [x] issue-3 本机上线与性能验收

## issue-1

- ID: issue-1
- 标题: 人物资源体积与加载预览
- 范围: V12无损主纹理、独立小预览、资源核验／编码脚本、精确静态缓存、Range压缩兼容及相关测试
- 依赖: none
- 验收标准: 主纹理RGBA一致、预览比例透明保留、最终动作完整；减少首轮传输，mutable manifest仍可更新
- 状态: done
- 验证方式: 全RGBA --check；Node资产2、Core/加载/眼睑/静态49、Python像素篡改7全部通过；tsc通过；diff自审
- commit: 64b1467

## issue-2

- ID: issue-2
- 标题: 可见性控制非任务主机轮询
- 范围: App／ChatAssistant主机列表及首页native状态轮询，可见性取消／恢复单请求，稳定快照；复用已认证语音scope
- 依赖: issue-1
- 验收标准: 隐藏无定时probe，返回立即真实刷新，迟到响应／账号／卸载不会修改新UI，任务报告和通知正常
- 状态: done
- 验证方式: 真实App／World／审批／动画及helper104项，最新实际语音hook10／ChatAssistant轮询11项通过；任务通知／执行主机／后台派发／语音86项通过；tsc与diff自审通过
- commit: ad92a3c

## issue-3

- ID: issue-3
- 标题: 本机上线与性能验收
- 范围: tsc／构建、Chrome体积和时序前后对照、隐藏恢复、桌面／412×960，本机服务及数据保留
- 依赖: issue-2
- 验收标准: 性能收益可核验，正常模型／Chat／Agent可用、账号历史下载保留，无临时覆盖残留
- 状态: done
- 验证方式: tsc/Vite通过；Chrome人物ready12.72→6.07s、隐藏86s零probe/恢复一次；桌面/412×960；认证GET/304/Range；17业务字段及15下载保留，服务与守护健康；详见对应validation文档
- commit: 本卡所在 issue-3 提交
