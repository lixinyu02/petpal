# 人物及客户端边界回归 Issues

- Date: 2026-10-03
- Complexity: L1
- Current status: done

## issue-1

- ID: issue-1
- 标题: 复现并修复人物及相邻客户端隐藏问题
- 范围: 模型生命周期、交互、表情/语音切换、客户端状态
- 依赖: 已上线 V12，main 1634095
- 验收标准: 可复现问题修复；聚焦回归、TypeScript/隔离构建与 Chrome 验收通过
- 状态: done
- 验证方式: baseline 286/286；最终完整回归 1593/1593；TypeScript 与隔离构建；真实 Chrome / Core / 412×960 公网验收
- commit: 本提交 `fix(issue-1): preserve avatar state and harden client edge cases`

## 已复现的问题

1. 原生 Cubism 每帧移动/缩放画布后未刷新热点；静止指针的旧 head/hand 悬停或长按定时器可继续执行。修复画布变换后的热点刷新，并在动作执行时重新校验坐标/区域/启用状态。真实 Chrome 暂停 RAF 后从头部悬停缩小为 100px，旧计时器被取消、状态保持 idle、手势及隐藏光标清除；覆盖鼠标/触屏长按、延迟轻触及键盘等效操作。
2. Core/Framework 的共享下载等待不可按单一 canvas 中止；卸载后旧 WebGL context 持续到网络完成。补独立可取消等待与已取消请求零分配，保留活跃共享加载。
3. Chrome 真实 V12 长按 sleep 后人为触发 WebGL context lost，备用人物最后变为 idle；延迟加载时 fallback sleep → native idle 也由实际 TSX fixture 复现。补跨渲染器动作交接和命令去重。
4. Ubuntu 下载按架构字母排序，默认 arm64。真实组件复现后改为默认 x64，仍支持显式 ARM64、ARM64-only 及 Windows ZIP/EXE 选择。
5. App 主机偏好调用直接求值 localStorage；getter 拒绝时内部 getItem 异常保护来不及执行。补安全获取与真实根组件初始 effect/切主机 fixture。

本机隔离证据在 ignored `evidence/avatar-bug-audit-20261003/`；不读取生产聊天或私有配置进行复现。

## 完整回归中的夹具修正

初次完整回归 1585/1589，四项失败单独运行都通过。其中两项受控复现为异步持久化/取消尚未发生时就假定完成：图片中继测试只轮询一次可能合法返回空队列；OpenCLI 停用测试固定 15ms 后结束假进程可能早于 SIGTERM。分别改为有界等待实际 run command、等待真实 SIGTERM。OpenCLI 双平台编码测试使用独立 10s fixture 预算，生产时限及 25ms 超时专项不变。

真实 CLI 取消用例未复现产品缺陷；隔离诊断观察 abort 后 4ms 上游关闭。将其 pending opened/closed 闭包绑定到实际输入 prompt 和响应 ID，拒绝未知/重复请求，保留原 10s 期限，失败时记录明确请求身份。最终完整回归 1593/1593、fail/cancelled/skipped 均为 0；确认取消 resp_transport_5 与关闭 resp_transport_8。

## 上线与验收

- TypeScript `npx tsc --noEmit` 通过；Vite 隔离构建通过（保留已有 Three.js chunk 体积提示）。
- 真实 Chrome：native sleep → context loss → fallback sleep，触屏 wake → idle，compact 重建 → native idle；模拟说话输入嘴型 0.340，停止后 0，倾听时闭口。语音输入是 fixture，不代表上游 ASR/TTS 实测。
- 公网 `https://magicdatou.top:44318/` 入口更新为 `index-Qdqbs1bL.js`，11 个入口/新增资源/模型请求均 HTTP 200 且完整字节哈希相同；V12 MOC 哈希保持 `c174352f594b1823bdb9cc14b503d64f41cd2be58d9baa6c4dc82450c93c6195`。
- 已授权 test 会话验证 412×960 / scrollWidth 412、真实 Cubism ready/MOC 5、键盘回应 pet/sway。下载默认 Ubuntu x64、Windows ZIP；显式 ARM64/EXE 与刷新保持选择均通过。验收后退出会话、恢复 viewport 与诊断覆盖。
- 仅新增静态哈希资源并原子切换首页；旧首页有私有回退备份，不重启后台服务。0.9.7 已发布包、版本标签、更新清单和旧模型字节不变。这次修复为 Web/源码，未重打 Android/Windows/Ubuntu 包，也未做这些端的实体设备验收。
- 独立只读审查未见阻断，68/68 聚焦检查通过。

证据：`full-tests-final.log`、`build.log`、`chrome-verification.json`、`deployment.json`、`public-verification.json`、`downloads-412.jpg`、`live-companion-412.jpg`，均位于上述 ignored 目录。
