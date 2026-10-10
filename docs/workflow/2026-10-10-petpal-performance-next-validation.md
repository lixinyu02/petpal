# 小伴第二轮性能优化验收

日期：2026-10-10。项目 `E:\RK3566\petpal`，基线 `6bf7688`，版本仍为0.9.10。本轮完成源码、本机网页构建与服务更新；客户端安装包、公网服务、远端和板端未更新。

## 结果

- issue-1 / `64b1467`：V12主纹理改为内容hash命名的exact无损WebP，3,142,568→1,504,778B，减少52.12%；2048²全RGBA包括透明像素RGB逐字节一致。MOC、16组动作、物理、显示信息与其他manifest字段保持。加载／错误／登录预览改为384×576透明小图，1,492,668→58,004B，减少96.11%；完整备用动画的8张表情资产保持。
- issue-2 / `ad92a3c`：App、首页ChatAssistant与native状态只在可见且在线时轮询。隐藏／离线取消并清timer，恢复等待旧请求收尾后立即刷新；信号和账号epoch阻止迟到UI写入。周期刷新不闪loading，相同完整快照复用引用。任务、通知、执行器heartbeat及重连保持独立。已认证identity作为启动期间语音scope，消除重复配置读取与播放器重装。
- issue-3 / 本文所在提交：构建、本机更新、Chrome性能与桌面／412×960验收、数据保留。静态资源仅新hash预览与纹理immutable，manifest继续重验证；JS Range避免动态gzip造成206字节范围失配。

## Chrome前后对照

同一Chrome插件、test账号、本机127.0.0.1:4318，每版本一次禁用缓存的冷导航。启用Network后设置80ms延迟、下载524288B/s、上传262144B/s；已从大图实际持续时间确认限速生效。最早一次未启用Network的快速采样不纳入对照。

真实人物ready使用导航后立即安装的MutationObserver记录：必须首页`data-ready=true`且`data-avatar-mode=cubism`。两个版本均观察到真实Core渲染，不以加载壳或备用图当作最终就绪。

| 指标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 人物完整就绪 | 12,717.9ms | 6,074.0ms |
| 主纹理完成 | 11,035.1ms | 5,271.2ms |
| 加载预览完成 | 7,573.5ms | 1,232.7ms |
| ready前资源transferSize合计 | 5,359,534B | 2,281,831B |
| 首页朗读配置读取 | 2次 | 1次 |
| FCP | 488ms | 496ms |

人物完整就绪缩短52.24%，初次资源传输减少57.42%；transferSize包括浏览器记录的协议开销。FCP包含加载壳，本次没有改善，不能把人物加载收益说成所有UI首绘收益。单次loopback导航不是统计显著性、公网或全部四端硬件的速度保证；本轮没有测量FPS、物理GPU占用或长期内存泄漏。主纹理解码的理论RGBA内存仍为16MiB，384×576加载预览的理论RGBA内存从6MiB降至0.844MiB，未将其当作实测RSS。

证据：ignored `evidence/performance-next-20261010/chrome-before-final.json`、`chrome-after-final.json`、`chrome-performance-summary.json`。加载预览alpha与缩放源完全一致，颜色是q85的加载用途小图；正式纹理是全RGBA无损。

## 后台生命周期与页面

Chrome本机开发页临时覆盖`document.hidden`并派发真实visibilitychange，测试完成恢复属性。旧版59.20秒新增6次主机查询；新版85.91秒新增0次。一次短恢复窗口26ms内观察到1次查询完成。该验收是Chrome生命周期模拟，真实Android系统后台／省电限制没有在本轮另测；helper与真实App/ChatAssistant fixture覆盖ignored-abort、快速hide/show、离线恢复、账号、卸载及单飞。

桌面CSS视口2560×1140，手机模拟412×960，文档宽度分别为2560／412，没有横向溢出。真实Cubism首页、Chat输入、图片入口、Agent已就绪及模型列表可见，输入框enabled。手机模型菜单left17/right375/bottom553.5，在视口内。没有提交聊天、Agent任务或上游模型／ASR／TTS请求。

Chrome插件在临时设备指标覆盖下存在指针坐标偏差，首次点击首页聊天链接落在设置页，原结果已保留为`mobile-settings.*`；随后根据已观察href直接导航Chat，并以本机开发DOM语义点击验收Agent及菜单。模型菜单第一张截图处于有限入场动画中，随后另存完整显示截图。不能把这轮模拟点击当成真实手机触控验收。

截图：`desktop-home.png`、`desktop-agent.png`、`mobile-home.png`、`mobile-chat.png`、`mobile-agent-model.png`。结束时撤销document.hidden、网络限速、缓存禁用、URL阻断、设备指标与viewport覆盖；没有保留测试hook跨导航。

## 本机服务与数据

更新前核旧服务PID90404、Node路径／启动时刻／命令、唯一loopback监听器、原guardian PID57452／现有Running计划任务，并确认无运行／排队任务或启用自动化。备份四个私有文件；由自有维护标记暂停守护，精确退出旧空闲服务一次，使用已有Start脚本启动PID77168，核健康与监听归属后释放维护标记。guardian继续监控新进程，旧两个直接子进程均退出，stderr为0B；没有新增自启、任务、来源或网络授权。

health／bootstrap／deferred state共12次认证GET全部200，匿名bootstrap401；新预览58004B、immutable、条件GET304；gzip请求的JS Range返回206、2048B且无Content-Encoding。首次条件GET检查失败是Node fetch附加no-cache头使服务器按请求返回200，加入显式Cache-Control:max-age=0后核验通过；未据此修改产品代码。此为短时功能smoke，不等于长期稳定性或挂死恢复。

前后state的17个非sessions顶层字段JSON SHA全部一致；15个下载文件总2,412,335,697B，规范文件名、size、mtime一致。没有逐包新增完整hash核验。私有备份、token和日志正文均未提交，也没有输出原始stdout。

证据：`service-update.json`、`service-final.json`、`service-smoke.json`、`preservation-before.json`／`preservation-after.json`。guard恢复沿用上一轮已核验的现有脚本，此轮不重复崩溃演练。

## 构建与测试

- `tsc --noEmit`与`vite build --emptyOutDir false`通过，新入口`index-Cp7fDutZ.js`；保留downloads。已有lazy Three chunk约519KB告警保持，默认3D小猫未重新开启。
- Node资产／Core／实际加载／眼睑／静态相关51项，Python像素／透明RGB／alpha／路径／manifest／动作篡改7项、只读`--check`通过。
- 实际App／World／审批／动画／helper等104项通过；更新后的实际语音hook10项与ChatAssistant轮询11项通过；任务通知／执行主机／后台派发／语音相关86项通过。测试请求与音频硬件均隔离，真实画面另由Chrome核验。
- 源码diff、资源合同及生命周期自审通过，按三个issue本地提交。设计与issues已更新；本轮未推送、发布或重打安装包。
