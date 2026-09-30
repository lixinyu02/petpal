# 服务器更新源验收

验收时间：2026-10-01（Asia/Shanghai）。对应 issue-59。用户选择先上线网页与后端，之后再制作客户端。

## 上线结果

- 正式网页：[小伴](https://magicdatou.top:44318/)。在「连接与设置 → 软件更新」检查；管理员可选择 GitHub Releases 或服务器，成员只读配置。
- 正式签名清单：[petpal-update.json](https://magicdatou.top:44318/downloads/updates/petpal-update.json)。服务器使用独立 Ed25519 身份、sequence 7；GitHub 原身份保留。
- 服务器公钥：[update-public.pem](https://magicdatou.top:44318/downloads/updates/update-public.pem)。SPKI SHA-256 指纹：`1841fdaf57bb74769dc94049d07fc79d675f29c4633f156c3b1ec65781f8d5d3`。仅发布公钥，私钥保持私有。

| 平台 | 清单版本 | 文件字节数 | 验收 |
| --- | --- | ---: | --- |
| Windows x64 | 0.9.1 | 185,711,668 | 公网HEAD 200、长度正确；经真实更新管理器完整下载并校验SHA-256；未启动EXE |
| Ubuntu x64 | 0.9.0 | 274,812,853 | 公网HEAD 200、长度正确；本机镜像与原签名发布摘要一致 |
| Ubuntu ARM64 | 0.9.0 | 269,123,417 | 公网HEAD 200、长度正确；本机镜像与原签名发布摘要一致 |
| Android | 0.9.0 / versionCode 11 | 21,468,577 | 公网HEAD 200、长度正确；本机镜像与原签名发布摘要一致 |
| Web | 0.9.1 | 15,195,179 | 新网页ZIP、签名检查通过；正式部署30文件公网SHA-256读回一致 |

原生包保持历史版本和内容，它们尚未包含本轮的服务器来源选择。Web ZIP来自本轮构建；发布清单不会自动部署网页或自动安装客户端。后续原生新版需要单独打包并做安装验收。

## 源码与策略

Node定向测试64/64通过：`tests/update-source.test.mjs`、`tests/server-updates.test.mjs`、`tests/updates.test.mjs`、`tests/sign-update.test.mjs` 共41项；`tests/desktop-updates.test.mjs` 23项。覆盖旧GitHub迁移、五目标服务器发布、CAS、换源竞争、取消、退出登录、原始重定向越界、篡改、有效期、同公钥防回退与不同公钥独立记录，以及Windows最终交接与Ubuntu归档回归。

Android JVM JUnit17/17通过（UpdaterPolicy 12项、UpdaterIO 5项）；真实PetUpdaterPlugin Java编译通过。TypeScript检查、Vite独立生产构建和desktop/main.cjs语法检查通过。Electron和Linux打包器均包含`server/**`，确保新`server/update-source.mjs`随未来包分发。未运行Gradle/APK构建或重新制作桌面包。

保留可信TLS、Ed25519、长度、SHA-256及安装身份校验；服务器资产和重定向限定清单同源目录，不携带用户Bearer/Cookie。换源使旧检查与下载失效；同公钥+stable的序号高水位不会因切源或重启清空。

## 正式接口和数据

真实公网`test`登录后读取配置与五目标检查均200，修改来源403；匿名更新配置、更新检查、语音设置、ASR session和TTS合成接口均401。Web0.9.1返回已是最新，Windows0.9.0发现0.9.1，Ubuntu/Android0.8.0发现0.9.0。清单签名验证成功。

受控重启前确认无活动Chat/Agent/approval/非暂停队列及语音请求，并私有备份状态；精确核对PID、启动时间、node命令和4318监听后重启。迁移仅添加更新source与manifestUrl默认字段；管理员API只改变更新配置，检查只新增服务器身份的信任记录。2账号、5模型、28对话、1暂停队列、语音与其他设置均按字段比对保持。API验收临时登录已退出，原7个test登录会话保持。原下载根目录2文件摘要不变；HTML最后原子替换并留回退副本，旧哈希资源保留。

Chrome插件实测管理员来源选择在GitHub时显示仓库、服务器时显示清单地址；正式test页面显示服务器来源和检查成功。412×960的管理员与成员页面`innerWidth=scrollWidth=412`，服务器长地址自动换行。正式页保留供用户查看。

## 证据与边界

本机证据在被Git忽略的`evidence/server-updates-20260930/`：`server-publication.json`、`live-download.json`、`backend-migration.json`、`production-config.json`、`public-acceptance.json`、Android JVM/Java编译、预览/正式桌面与手机截图。静态部署及构建收据在`evidence/voice-upstream-20260930/`。私有状态备份和密钥不进入Git。

本轮证明服务器检查/传输和源码集成，未证明新版Windows EXE启动、Ubuntu客户端实机更新或Android系统安装完成。下载完整不等于运行安装验收；这些留到用户确认网页效果后的客户端打包。
