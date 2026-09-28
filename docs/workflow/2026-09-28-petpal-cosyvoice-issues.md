# CosyVoice 接入任务

- Date: 2026-09-28
- Complexity: L2
- Related design: 2026-09-28-petpal-cosyvoice-design.md
- Goal: 试用用户的 CosyVoice，完成受认证的朗读接入和公网使用路径。
- Ordering rule: Complete issues in sequence.

## issue-15

- ID: issue-15
- 标题: 接入 CosyVoice 合成及账号语音播放
- 范围: 管理员上游/参考声音配置，Gradio 适配，受认证合成接口，前端试听/朗读/扬声器/近似口型
- 依赖: issue-14 done
- 验收标准: 受控接口与鉴权测试通过，前端构建及取消/播放测试通过；默认系统朗读兼容，无凭据和私有路径泄露
- 状态: done
- 验证方式: Node 定向测试、前端构建、代码自审、公开源码扫描
- commit: `feat(issue-15): add authenticated CosyVoice speech playback`

### issue-15 验证

- 后端 54 项定向测试、前端 49 项定向测试和 TypeScript/Vite 构建通过；涵盖配置/参考声音私有化、实际 PCM 校验、Gradio 文件及同 session 流式下载、超时/限流/撤权，以及 Blob 账号隔离、输出设备和迟到播放取消。两组测试包含部分共同回归，不把数量相加当作去重总数。
- Chrome 在隔离实例中完成参考 WAV 上传、设置页试听、伙伴页播放、停止与自然结束；可见播放状态进入并退出，自动朗读初始为关闭。使用合成样例和受控 Gradio fixture，不代表真实 GPU 服务已生成音频，也没有人工确认物理喇叭。
- 兼容 Gradio 5.4.0 的同 session playlist-file 下载，最终仍严格检查 PCM WAV；不接受 MP3 伪装 WAV。源码依据 Gradio 官方 audio.py / blocks.py / routes.py。
- Linux 与源码包必需文件列表已纳入后端适配模块，源码打包 check 通过；没有重打包或替换 v0.6.1 Release。

## issue-16

- ID: issue-16
- 标题: 配置实机 CosyVoice 并验证公网路径
- 范围: 合成示例参考声音、实际队列合成、现有源码服务部署、Chrome 试听、公网入口与未登录保护
- 依赖: issue-15
- 验收标准: 真实非静音 WAV 生成并从认证路由播放；保存私有回滚和验证证据；明确独立外网验收边界，不公开无认证 Gradio
- 状态: todo
- 验证方式: 实际 WAV/Chrome/认证路由/网络配置及域名检查
- commit: pending
