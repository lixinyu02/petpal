# 客户端偏好 Issues

- Date: 2026-10-03
- Complexity: L1
- Current status: done

## issue-1

- ID: issue-1
- 标题: 添加启动与窗口行为设置
- 范围: 固定本机偏好文件、Windows/Ubuntu 自启、登录 IPC、窗口消费、四端设置入口与打包闭包
- 依赖: main 0e1fbc0；0.9.7 正式包冻结
- 验收标准: 五项设置持久有效，真实自启状态可读回，系统注册仅显式开启，退出语义正确，登录与旧客户端边界准确，窄屏可用
- 状态: done
- 验证方式: Windows/Linux 35 项系统 fixture、20 项 IPC、18 项窗口/启动、12 项 UI、3 项工作区聚焦回归，共 88/88；完整串行回归 1678/1678；TypeScript/生产构建、Chrome 412×960、Windows 隔离 Electron 真实 IPC/持久化/置顶/设置面板 exit 0；公网 12 项资源字节哈希与公开源码审计通过
- commit: 本文件所属 feat(issue-1) 提交

证据保存于 ignored evidence/client-preferences-20261003/。不修改系统真实开机项，不替换已发布包或更新清单。

复核修正：Windows 注册名与进程 ID 固定、含空格查询正确引用、内部登记目标支持旧便携路径的显式关闭/迁移及失败恢复、退出等待设置队列完成。工作区测试补充新设置组件依赖；既有 Agent relay 测试改为限时等待异步入队，保留所有凭据隔离与撤销断言，生产任务逻辑未变。

交付边界：本轮部署 Web 静态资源并同步源码，0.9.7 标签仍固定于 2d5b654be0d739a5a7b9524f8a98c53e8e913315。已有 Windows/Ubuntu/Android 下载包未重打。实际系统登录/重启自启、Ubuntu GUI 与 Android 设备验收未在本轮执行；系统自启覆盖以 fixture 为准。
