# CosyVoice 实时音频流任务

- Date: 2026-09-29
- Complexity: L2
- Related design: 2026-09-29-petpal-cosyvoice-stream-design.md

## Task Overview

- Goal: 新 PCM 接口贯通服务端、认证传输及连续播放，实测公网首音与取消。
- Ordering rule: issue 顺序完成；当前 issue 内按文件并行协作。
- Current status: issue-23 / issue-24 done

## issue-23

- ID: issue-23
- 标题: 实现有界、可取消的 CosyVoice 音频流
- 范围: 新后端适配/路由、认证流解析、Web Audio 播放与 hook、桌面背压、语音说明和回归
- 依赖: issue-22 done
- 验收标准: 音频在上游完成前播放；连续排程/奇数采样边界正确；登录/取消/配置变化立即生效；自选扬声器不静默降级；非1.0语速保留原合成
- 状态: done
- 验证方式: 461/461 全量测试（并发4）、TypeScript、隔离输出 Vite 构建通过。后端13项流协议/背压/逐帧鉴权、播放器15项连续排程/欠载/路由/取消/解锁、NDJSON及认证scope与桌面ACK覆盖通过。自查修复unlock预热context移交给speak时误关自动朗读竞态。第一次高并发全量包含未完成fixture捕获修正及既有Codex超时/系统动态禁用端口失败；修正fixture后相关Codex独立复测与最终全量均通过，无修改Codex实现。构建仍有已有Three.js大chunk提示。
- commit: d8685f5

## issue-24

- ID: issue-24
- 标题: 真实服务、Chrome 与公网部署验收
- 范围: 真实长句测量、浏览器播放/停止验收、受控部署、文档和源码推送
- 依赖: issue-23
- 验收标准: 线上使用新协议与真实 CosyVoice 音色；首音/总时延有证据；账号配置与旧接口保持可用
- 状态: done
- 验证方式: 已部署 https://magicdatou.top:44318，23文件哈希匹配，2账号/部署前11会话及配置/参考声音完整保留。公网域名回环93字首PCM3537ms、EOF11327ms、15.84s音频；匿名401、旧WAV200。Chrome真实24.64秒音频首排程3699ms、206段无排程间隙、最大ahead2.995秒，自然结束正常；第二次停止清空25节点且无迟到新增；真实Chat回复自动触发PCM流并正常结束。临时浏览器测量已移除，自动朗读恢复关闭，Console无error。未使用独立外网节点或Android/Ubuntu实机；v0.7.0安装包保持旧WAV。完整证据见 docs/acceptance-cosyvoice-stream.md。
- commit: 本issue验收文档提交（见Git历史）
