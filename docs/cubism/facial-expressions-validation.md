# V10 表情扩充验收

日期：2026-10-02。网页默认切换为 `/avatars/akari-cubism-v10/akari.model3.json`。

## 作者与原生模型

新增害羞、惊讶、安心三张 imagegen 来源图，仅剪取面部到三个隐藏 PSD 图层。旧十一层像素和中性可见层保持；PSD 读回检查通过。作者工具仍冻结于 PSD2Live `2ac751fbb3ffdc8251a82e0d600d97afafafcaac`，704 个源文件未经修改。

官方 Core 6.0.1 真实执行 MOC5：14 drawables、22 参数、2955 顶点，91 个采样姿态、六套表情参数／头部跟随和十二个闭眼／嘴型组合通过。与 V9 对照十个头身、发梢、合手、衣袖和嘴型组合，原有 drawable 几何保持（容差 1e-6）；十六组 motion 逐字节相同。

## 运行时与浏览器

289/289 项 avatar/anime/Cubism/speech 相关回归、TypeScript 与 Vite 生产构建通过。包含真实 Core/Framework 的新参数绑定、互斥覆盖、自然眨眼与 Wink、说话／停止、隐藏／睡眠和旧模型／导入路径隔离。构建仍有原有约 527 kB chunk 提示，不影响构建结果。

Chrome 插件实际渲染三个新增表情及原有表情，检查闭眼、A/O嘴型组合；连续 CubismScene 在文本输入后 650 ms 采样为 shy／surprised／relieved，切回 idle 后为 neutral、嘴型 0。该预览使用模拟文本，不是实际语音服务调用。

首次公网刷新暴露了 Core 脚本 2.5 秒下载预算过短的问题；调整为有界 12 秒，Core 初始化仍独立 3 秒。新增虚拟时钟测试覆盖延迟五秒成功、共享加载、超时清理与重试、网络错误。无修改 Core 二进制或放宽验证。

最终版本关闭浏览器缓存后重新加载通过，Core 资源实际传输 228342 bytes／约 2073 ms，默认人物确认为真实 V10（不是 fallback）。正式 HTTPS 页面 412×960，横向内容宽度 412，人物画布 379×570.8125。截图和诊断位于忽略的 `evidence/cubism-faces-20261002/`。

## 发布边界

只复制已核对静态内容、原子替换首页并保留旧资产及回退副本。最终部署核对 205 个静态文件、201 个公网 HTML／构建资源／历代模型／Core／Framework 文件 SHA-256 一致。后端 PID 34828 未重启；账号状态、token、下载包大小／时间及稳定升级清单保持。完整结果在同目录 `public-readback.json` 和 `deployment.json`。

私有预览页换表情时曾复用已释放的 WebGL canvas，已在验收页改为新 canvas 后完整刷新并重新验收；产品 CubismScene 本来就创建独立 canvas。静态发布时本机 Vite watcher 因 Windows dist 文件 EBUSY 退出，正式网页与后端不受影响；预览验收已完成且临时 tab 已关闭。这些开发工具现象不记为生产模型故障。

未重打安装包、未重新测试 ASR/TTS 上游、未验收四端实体设备。CMO3 是作者候选，尚未在官方 Editor 完成 roundtrip；半垂眼睑和侧目是局部素材，不是独立连续眼睑／虹膜骨架。
