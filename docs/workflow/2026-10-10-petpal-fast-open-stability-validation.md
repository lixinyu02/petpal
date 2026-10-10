# 小伴打开速度与服务稳定性验收

日期：2026-10-10。源码位于 `E:\RK3566\petpal`，本机服务为 0.9.10，入口 `http://127.0.0.1:4318/`。三个 issue 已完成；本轮完成源码、本机构建与上线，未推送、发布或重新打包四端客户端。

## 实现结果

- issue-1 / `e45c23c`：首页认证后的 `/api/bootstrap` 不读取历史、不等待 Codex；Chat 支持 deferred runtime；进行中的 bridge status 探测合并；provider probe 关闭等待实际收尾；关闭期间拒绝迟到登录及管理员写入。
- issue-2 / `a3cf23c`：Chat 可在人物偏好同步前使用；启动请求可取消／超时／重试，仅404兼容旧服务；中央服务器与桌面主机都以真实主机状态判断 Agent 可用。Cubism 的 manifest/Core 和 MOC/第一张贴图重叠，资源请求并发上限4，单张预取12MiB上限；所有动作、纹理与 shader 完整就绪后才 ready，失败先取消并排空请求再释放资源。
- issue-3 / 本文所在验收提交：构建、Chrome、短时并发、数据保留及本机恢复验收；修复本机既有私有 guardian 的时间解析和路径规范化，启动现有守护任务。

## Chrome 加载指标

同一 Chrome 插件、本机 loopback、已登录 test、禁用缓存，各做一次前／后冷导航。受限网络设置为80ms延迟、下载524288B/s、上传262144B/s。资源 bytes 为 decodedBodySize。

| 指标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 首页启动数据 | 82,968B | 2,712B（减少96.7%） |
| 本机冷导航 FCP | 132ms | 104ms |
| 受限网络 FCP | 520ms | 496ms |
| 受限网络首页启动请求耗时 | 551.2ms | 221.7ms |
| 受限网络首张贴图请求开始 | 4,235.4ms | 1,252.8ms |
| 受限网络最后 shader 下载完成 | 11,684.4ms | 11,485.3ms |

首屏数据和等待 Codex 的耦合已减少，但大模型／贴图的总传输量保持：人物完整冷加载在这次受限网络测量中只改善约0.2秒。FCP 包含加载壳，不等于全部页面可用；最后 shader responseEnd 不等于精确视觉 ready 时间或FPS。单次导航是可复核观测，不当作统计显著性或所有用户设备的加速保证。

前后均最终观察到真实 `data-avatar-mode=cubism` 和首页 `data-ready=true`。Chat 新构建使用 deferred state，消息输入框 enabled；中央 Agent 从真实主机探测进入已就绪，没有把 deferred pending 当成上线。

证据：`evidence/fast-open-stability-20261010/chrome-before.json`、`chrome-after.json`、`chrome-performance-summary.json`、`chrome-chat-before.json`、`chrome-chat-after.json`。

## 页面与失败恢复

Chrome 检查默认桌面2560×1140及实际CSS视口412×960。首页真实Cubism显示、Chat输入和图片入口、Agent模式和模型选择菜单正常；文档宽度412，没有横向溢出。模型菜单 left17/right375，仍在视口内；没有向上游发送测试聊天或Agent任务。

浏览器 viewport capability 最初受到浏览器缩放影响，CSS宽度为549；随后用临时CDP设备指标校准到412×960，并保存准确截图。插件指针在模拟设备下有坐标缩放偏差，菜单交互采用本机开发页的语义DOM点击；本次不等于真实手机触控／键盘验收。手机截图分别为 `mobile-home.jpg`、`mobile-chat.png`、`mobile-agent-model.png`，几何读数保存在同目录JSON。

精确临时阻断 `/api/bootstrap` 后，首页显示错误、重试按钮，语音入口禁用；解除阻断并点击重试后恢复已认证首页和语音入口。后端恢复后重新加载，Cubism ready、无重试按钮。最后30条范围内实际读到14条错误均来自已有Chrome扩展，应用来源错误0。缓存禁用、网络限速、URL阻断及视口覆盖均已撤销。

## 短时服务负载

PID76716 上运行60.4秒，实际最大同时请求12；health、bootstrap、deferred state各200，共600次GET全部200，失败0。三类接口p95分别18.224、18.360、18.874ms。匿名与无效认证均401，响应元数据没有配置密钥或跨账号数据。

生产并发只使用 owner；test 登录和界面为独立Chrome证据，跨用户隔离另由fixture覆盖，没有把owner负载说成生产跨账号并发验收。模型5、owner历史6／消息12在每次形状检查中保持，bootstrap不携带历史。

RSS80.91→82.17MB、private bytes84.88→87.13MB，线程13保持。未给生产Node启用inspector，因此heap不可用；一分钟样本不足以证明长期无内存泄漏。负载过程只做GET，不派发任务。详见 `issue3-local-get-load.json` 和 `local-get-load.mjs`；认证令牌仅在进程内存使用，不输出到证据。

## 本机恢复与保留

启动前核对旧服务、无进行中／排队任务与启用自动化，备份四个私有状态／服务配置文件到忽略的 `evidence/.../private/`。原实际监听为127.0.0.1:4318，service-settings此前记录0.0.0.0；本轮将设置对齐实际127.0.0.1，其余来源和Codex HTTP例外保持。

已有私有guardian的路径字符串包含重复反斜杠，规范化为固定绝对路径。手工以PS7启动时另发现JSON ISO UTC时间被自动转成DateTime，再隐式ToString／Parse导致八小时身份误差，进程被误判但未被停止。修复保留时区文本和绝对时刻，拒绝无时区值；PID、运行时路径、启动时间、命令及监听器身份检查保持。用AST只抽取实际修复脚本两函数，PS5.1和PS7.6.5各35/35通过，真实服务时间差0秒。未整体加载测试guardian循环。

恢复现有已启用的登录任务“PetPal backend current user”，guardian PID57452已监控服务；未新建任务或启用额外自启。核对空闲后只退出确切PID76716一次，健康接口约5,064.7ms恢复至新PID90404，guardian继续监控，唯一监听器127.0.0.1:4318归属正确。旧conhost/codex子进程已退出，恢复前后state.json字节SHA一致，最终stderr大小0。验收脚本第一次因PowerShell null集合计数拒绝操作，修正只读门禁后才执行了这唯一一次退出，旧过程未重复退出。

恢复只验证一次空闲进程退出。尚未模拟挂死、连续崩溃、注销、冷启动、磁盘故障、上游模型／ASR／TTS中断或远端主机故障；不宣称服务长期零故障。guardian修改仅在本机忽略的私有目录，未分发至现有客户端。

最终与更新前私有备份比较，13个业务字段（用户、设置、模型、对话、项目、Codex、自动化、ASR/TTS、更新、主机等）JSON SHA全部保持。downloads的15个文件、2,412,335,697B及规范相对文件名／size／mtime全部保持；没有更新前后逐包完整hash证明。登录sessions不作为业务保留字段。

证据：`guardian-actual-time-summary.json`、`guardian-recovery.json`、`service-final-status.json`、`preservation-final-fields.json`、`downloads-final.json`。私有备份与原始服务日志不提交，stdout可能含配对令牌，仅检查字节长度。

## 构建与回归

`tsc --noEmit` 和 `vite build --emptyOutDir false` 通过，保留downloads；新入口 `index-CMJI_Inf.js`。Three约519KB的已有lazy备用chunk告警不等于首屏加载，也没有为此重新引入默认3D小猫。

服务相关回归71/71；真实API/App/CompanionWorld fixture80/80；Cubism57/57（实际已许可Core、V12 MOC、16动作，GPU／浏览器传输为门控fixture，视觉另由Chrome验收）；偏好和请求范围11/11。diff自审通过。未因最后仅文档及私有守护变化而重复完整产品构建。

设计、issues和本文均更新；本地逐issue提交，源码／文档之外的证据位于ignored目录。本轮未验证四端重新安装包、公网性能或板端硬件。
