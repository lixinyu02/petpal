# Android 深度稳定性调试

- Date: 2026-10-23
- Complexity: L2
- Baseline: main `6c4b8a6`，开始时工作区干净。
- Status: implementation

## Background / findings

上一轮完成长期登录与权限恢复，但新增审计发现原生生命周期仍有跨层缺口：登录vault共享锁包含Keystore和文件IO，UI reserve/clear可能被阻塞；固定alias永久失效不能通过显式重新登录恢复；AtomicFile.finishWrite不保证抛出落盘异常。代理为每个Activity创建manager，却操作进程全局网络/WebView代理，旧实例迟到停止可能覆盖新实例。官方模型刷新只重核scope，退出档案或切换后旧网络请求可能重新连接已退出凭据。

前端实际组件夹具进一步复现：登录HTTP不返回时表单与关闭按钮无限禁用；native vault read不返回时恢复页永久loading且无操作入口。MainActivity没有接管WebView renderer退出事件，Capacitor默认返回false，缺少内存回收后的受控恢复。

## Goals

修复上述可触发故障，并对实际APK执行API33/35/36的生命周期、权限、账号恢复、代理和渲染恢复回归。保留90/365天登录策略、现有有效登录及业务能力；提供独立QA包与可核查证据，必要时同步网页/后端，但不替换正式发布清单。

## Non-goals

不改账号权限或放宽原生来源校验，不请求VPN或系统全局代理，不绕过OAuth本人授权，不接触真实订阅/上游账号测试，不清除个人设备/AVD数据，不改正式版本/签名/下载源。不声称模拟器等于小米或荣耀真机。

## Native persistence

- UI取消代际使用非阻塞revision；加解密与Keystore不持文件提交锁，文件提交仍序列化并在前后核代际。
- 清除必须在Activity销毁后仍能完成，不排在挂住的Keystore后面，旧任务不得复活登录；清除验证base/bak/new。
- 旧v1信封保持可读写，全新vault的显式登录使用随机独立key-id的v2信封，避免两个迟到key生成互相覆盖固定alias。既有vault仅在显式write遇到确定的永久密钥失效时换新key-id；read与临时Keystore错误不删文件/换key。新密文验证提交前保留旧文件和旧key，失败不得把新账号发布给JS。旧客户端不保证读取新v2登录，回退旧版本时可能需重新登录，但聊天与账号数据不迁移。
- 显式fsync并校验实际提交密文，不能仅凭finishWrite返回就宣布成功。fault injection只通过包内测试依赖，不暴露JS调试接口。

## Native lifecycle ownership

代理的进程全局设置必须有owner/generation；旧Activity、旧进程watcher或旧异步回调只能清理其自身实例，不得停止新owner。全局WebView代理变更需有次序保证，仍保持LAN直连及仅小伴流量。

官方模型请求在读档案、上游返回、relay连接与结果提交各阶段重核scope/profile/revision与刷新代际；退出/切换优先，旧请求不能发布relay或模型。同一档案并发刷新按最新有效请求处理，候选relay失败/过期要清理。

## Frontend and renderer recovery

登录网络握手与body读取有界，超时恢复操作入口；持久化阶段须保证已发布账号与磁盘一致，不能简单为整个写入加AbortSignal后丢弃结果。vault只读恢复有独立超时/操作代际，迟到返回不覆盖新账号且可重试。

WebView renderer退出由原生接管，销毁不可再用的WebView并恢复Activity，启动仍经账号验证。恢复次数有界，重复故障给出原生可操作的恢复视图；不记录聊天/凭据、不自动清数据。官方回跳/通知路由与旧插件清理须经过生命周期回归。

## Risks and verification

重点验证旧v1兼容、保存失败/密钥故障、clear与旧写并发、Activity销毁；代理旧stop/clear迟到、官方退出/切换时挂起刷新；登录/vault超时与迟到回调；真实renderer terminate后的同App恢复。采用latch、fake transport/clock、独立合成服务，禁止改变系统时间或用真实secret做故障注入。

按issue顺序完成；同一issue内只并行独立文件所有权。最终TypeScript/相关Node/JVM、隔离Web/APK完整审计与签名连续性、API33/35/36原生运行。每个模拟器按精确任务AVD及ranchu/goldfish核验，保留失败记录和修正后结果。部署前确认空闲与备份，保留账号/聊天/记忆/代理/guardian/更新信任/正式下载和旧资源；没有变更的服务不重复重启。

## Deferred storage boundary

本轮保守保留既有及失败候选的不可导出KeyStore alias，不在clear队列做可能卡住的密钥删除。频繁退出/重登可能累积更多条目；安全GC须独立核查当前base/rollback引用并通过独立有界队列执行，本轮没有混入未经验证的GC。旧密文、旧key和故障可恢复性优先，不能称为所有存储资源已完全有界。

