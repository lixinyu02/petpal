# 小伴唤醒提示音 Issues

- Date: 2026-10-10
- Complexity: L1
- Related design: 2026-10-10-petpal-wake-cue-design.md

## Task Overview

- Goal: 最终命中唤醒词后响柔和短音，并继续倾听。
- Ordering rule: Complete issues in sequence.
- Current status: all done

## Issue List

- [x] issue-1 本地短音播放器
- [x] issue-2 唤醒接入与本机验收

## issue-1

- ID: issue-1
- 标题: 实现本地双音和安全输出生命周期
- 范围: PCM生成、播放器、类型、解锁与路由/取消/回声门槛测试
- 依赖: none
- 验收标准: 短音无需网络；启动手势解锁；按所选扬声器；迟到任务静音；三档VAD不误触发；资源可释放
- 状态: done
- 验证方式: 14 项播放器/PCM/VAD回归、tsc和diff whitespace检查通过。同步解锁、按设备静音路由、取消/迟到回调/超时/播放失败和资源释放已测；三档VAD不被合成短音单独触发且随后起音保留。自审确认无网络请求、无麦克风静音、无无关修改；房间混响未作现场证明。
- commit: 439bdc4 — feat(issue-1): add a local wake acknowledgement chime

## issue-2

- ID: issue-2
- 标题: 接入真实唤醒与取消流程
- 范围: conversation、hook、回归测试、说明和本机Chrome
- 依赖: issue-1
- 验收标准: final命中响一次；普通连续对话不响；不阻塞提交或吞掉起音；停止/插话/隐藏/账号/设备变化静音；构建保留下载包
- 状态: done
- 验证方式: 124项相关测试、tsc、Vite和Chrome真实AudioContext/PCM渲染通过；15个下载文件保留。本机页面无前端错误，health正常。自审和只读独立审查无阻塞项；现场回声和目标原生设备未验，未重打包。详见validation.md。
- commit: feat(issue-2): acknowledge confirmed voice wake without blocking conversation
