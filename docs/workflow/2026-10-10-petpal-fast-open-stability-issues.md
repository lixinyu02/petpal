# 小伴打开速度与服务稳定性 Issues

- Date: 2026-10-10
- Complexity: L2
- Related design: 2026-10-10-petpal-fast-open-stability-design.md

## Task Overview

- Goal: 分离普通页面与Agent探测，缩短加载等待并修复服务取消生命周期。
- Ordering rule: Complete issues in sequence.
- Current status: complete

## Issue List

- [x] issue-1 快速启动接口与服务生命周期
- [x] issue-2 前端启动及Cubism下载重叠
- [x] issue-3 本机上线与性能／稳定性验收

## issue-1

- ID: issue-1
- 标题: 快速启动接口与服务生命周期
- 范围: bootstrap/deferred state、进行中Codex探测复用、provider test取消收敛、关闭时auth/login写入门禁
- 依赖: none
- 验收标准: 慢Agent不阻塞轻量启动；真实就绪不伪造；账号隔离、配置切换和关闭正确
- 状态: done
- 验证方式: bootstrap慢状态/身份撤销/失败重试/换配置、真实scrypt关闭门禁、loopback模型流异步finally收敛；相关认证、Codex配置、providers、中央监听器组合71/71通过；node --check及diff自审通过。证据 evidence/fast-open-stability-20261010/issue1-regression-final.txt。根代理另验原回归34/34与新增测试11/11（末项补充前）。
- commit: e45c23c

## issue-2

- ID: issue-2
- 标题: 前端启动及Cubism下载重叠
- 范围: 首页/Chat初始化、首次请求取消超时、独立偏好同步、模型资源受控重叠
- 依赖: issue-1
- 验收标准: 聊天不等待偏好保存；模型减少串行波次、完整后ready；失败排空及旧账号门禁
- 状态: done
- 验证方式: 真实api wrapper/App/CompanionWorld初始化effect 80/80（pending hydrate、404-only兼容、超时重试、账号/卸载取消、central真实状态）；Cubism57/57（真实Core/V12 MOC与16动作，门控传输/GPU，多纹理顺序、shader与失败排空）；根代理偏好/request-scope11/11、tsc和diff自审通过。证据 evidence/fast-open-stability-20261010/issue2-startup-regression.txt、issue2-cubism-tests.txt。
- commit: a3cf23c

## issue-3

- ID: issue-3
- 标题: 本机上线与性能／稳定性验收
- 范围: 构建回归、Chrome桌面和412×960、短时并发稳定性、本机后端；验收发现的既有私有guardian时间解析及路径规范化修复
- 依赖: issue-2
- 验收标准: 指标可复核、核心功能正常、无测试残留、账号历史和下载保持
- 状态: done
- 验证方式: tsc/Vite构建；Chrome真实Core/V12人物、Chat/Agent、412×960无横溢、阻断bootstrap后重试恢复；同条件首页83KB→2.7KB、受限网络启动请求551→222ms；60.4s/并发12/600GET无失败；实际私有guardian函数PS5/PS7各35/35、单次空闲退出约5.1s健康恢复且旧子进程退出；13个业务字段SHA及15下载文件名称/size/mtime保持。完整边界见 2026-10-10-petpal-fast-open-stability-validation.md。
- commit: 本issue验收提交（git log --grep='test(issue-3): verify fast startup and local recovery'）
