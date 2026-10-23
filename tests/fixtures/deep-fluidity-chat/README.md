# 真实聊天流畅性夹具

本夹具使用实际 `ChatMessages`、动效、Markdown、`useChatScroll` 和产品 CSS，只有合成的稳定历史及固定尾部流；不创建账号、不连接模型、不启动业务后端。浏览器为 React 的 production profiling renderer，因此能记录 Profiler 回调。测量包装自身有开销，前后两轮必须使用相同夹具版本和环境。

## 冻结与启动

```powershell
node scripts/benchmark-chat-ui.mjs build --output .data/deep-fluidity-20261023/chat-baseline/frozen-02 --label a44330e-baseline
node scripts/benchmark-chat-ui.mjs serve --output .data/deep-fluidity-20261023/chat-baseline/frozen-02 --port 45329
```

`build` 必须使用不存在的输出目录，不覆盖旧包或样本。它捕获 esbuild 实际读取的源码、依赖、CSS 的 SHA256，以及 Git HEAD、构建 ID、输出资源摘要。`serve` 先核对冻结资源，只监听 `127.0.0.1`，仅提供清单文件和同源报告接收入口。TTY 输入 `close` 加回车可关闭；进程也接管 SIGINT/SIGTERM 和 stdin EOF。

Chrome 打开：

- `http://127.0.0.1:45329/?messages=100&motion=full`
- `http://127.0.0.1:45329/?messages=1000&motion=reduced`
- 可加 `&scroll=locked`，验证用户上翻后不会被流式追加拉回末尾。

用页面控件选择参数后点击“开始一次测量”。同一页可继续下一轮，历史会重新挂载；Markdown 模块与字体在测量前预热。每组至少重复三次，保留全部原始报告。不要同时运行别的网页/模拟器性能测量，不在本轮运行时改变视口或与消息区交互。

## 指标与有效性

- 固定 100/1000 条消息，交替用户/助手，历史含真实 GFM 段落、链接和列表；100 次尾部追加按 50ms 固定截止时间调度。每次等待实际 React 提交，不合并或丢弃；原始记录保留实际 dispatch、commit、lateness。
- 挂载时间包括 React 首次提交及随后两帧；流式时间包括 100 次更新及最后两帧。缓存边界为模块和字体预热，React root 全新，不是冷启动指标。
- 列表提交由 layout effect 计数；Profiler 另保留实际/基准耗时和全部样本。实际消息行上的 `ui-message-enter` class remove 与 `data-ui-enter` attr remove 调用由窄包装记录，mount/stream 分列，不以 VM 计数冒充浏览器执行。
- rAF 时间戳和 Long Task 原始记录可辅助观察主线程。rAF 不等于合成器呈现或显示器 FPS；Long Task 可用性在报告中注明。
- 页面隐藏、失去焦点、视口变化、操作中断、缺少最终内容、提交数不符或滚动策略失败均 `valid=false`。可见但多次出现约 1 秒 rAF 间隔时保守标记 `suspected-occluded-1hz-throttling`，保留数据但不纳入产品流畅性比较。这可能牺牲一个真实慢样本，不能用它证明没有长停顿。
- 桌面 Chrome 需要实际保持前台、窗口无遮挡；禁止通过改写 `document.hidden` 或伪造焦点让样本通过。

完整 JSON 始终显示于 `#benchmark-report`；静态服务另保存至输出目录的 `runs/`。初版自检的输出与补充评估保留在 `chat-baseline/` 根目录，该初版遇到了可见但约 1Hz 的 rAF，不能作为性能基线。
