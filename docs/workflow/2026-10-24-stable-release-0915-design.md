# 0.9.15 正式发布设计

- Date: 2026-10-24
- Complexity: L2
- Status: completed; stable release and production acceptance recorded

## Background and Goal

用户在 UI/连接排查后明确要求完成后正式发布。将已经上线并通过 182 项定向回归的修复，以及 0.9.14 后已有产品改动，交付为 0.9.15 正式客户端；Android code27，更新序号预计16→17，签名前重读。

## Scope

六包：Windows x64 便携 EXE/ZIP、Ubuntu x64/ARM64 tar.gz、Android APK、Web ZIP。沿用既有 Android 签名身份和两份更新信任锚。Windows ARM64/macOS 不加入此次既有发行矩阵。保留旧正式 tag、旧包、业务数据和私有凭据。

## Implementation

冻结版本修改后的源码，在隔离构建根打包，避免 Linux 对 root/dist 的依赖覆盖在线网页。各平台并行仅执行同一个打包验收 issue，输出互不覆盖。复用锁定依赖与官方缓存，依赖安装不改变生产服务配置。

先完成归档全条目/CRC/逐字节、私有数据和许可证审计，再运行 Windows EXE/ZIP、Android 独占模拟器升级与登录保持、Ubuntu x64 WSLg；ARM64 做原生架构和命令运行验证并明确 GUI 边界。不能用旧版平台验收替代新版。

通过 prepare-stable-release prepare/sign 建立最终聚合记录，GitHub draft 资产上传后完整下载读回。正式 latest 发布并将六包复制到服务器新路径，最后晋升下载目录与签名更新信封。所有写入使用本轮新脚本，拒绝重放旧版硬编码发布工具。必要的服务版本切换使用当前 receipt/guardian 身份和保全门禁，保留回退资源。

## Risks and Validation

便携 EXE 需解压并可能冷启动较慢；ZIP 必须完整解压。Android 延续已有 development signing，保持原位升级能力，不宣称商店签名或真机验收。ARM64 GUI 和实体硬件未测时明确记录。私有配置不得进入源码/包/报告。发布时重新确认版本、签名序号、冻结 commit 和全包 SHA，不能伪填验收 true。
