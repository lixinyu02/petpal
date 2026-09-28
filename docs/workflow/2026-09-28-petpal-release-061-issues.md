# 发布 PetPal 0.6.1

- Complexity: L0。复用已验收的 Windows EXE 和相同构建的 Web 资源，不修改运行代码。
- Design Note: 创建明确的 Git 标签，发布 Windows x64 / Web 两个平台资产、校验摘要、Ed25519 公钥及签名更新清单；GitHub 自动提供标签源码。私钥仅在忽略且受限的本机目录保存。没有本版 Ubuntu/Android 安装包，发布说明不得暗示已提供或验收。

## issue-14
- ID: issue-14
- 标题: 发布首个 GitHub Release v0.6.1
- 范围: 发布说明、Web ZIP、签名清单、公钥、SHA-256、标签、GitHub 资产和实际下载验证
- 依赖: issue-12/13 done
- 验收标准: 标签指向审核源码；EXE 与既有验收哈希一致；ZIP 与 dist 逐文件相同；更新清单验签通过；所有上传资产完整；正式 Release 可访问且为 latest
- 状态: done
- 验证方式: 本地资产哈希/清单自验证、Git 暂存扫描、GitHub 资产摘要及下载校验
- commit: `docs(issue-14): publish PetPal 0.6.1 release`；文档提交位于不可变的运行代码标签之后

## 发布结果

- 正式版本：[v0.6.1](https://github.com/lixinyu02/petpal/releases/tag/v0.6.1)，Release ID `398327475`，发布时间 `2026-09-28T15:12:11Z`。GitHub latest API 已确认 `draft=false`、`prerelease=false` 和标签 `v0.6.1`。
- 注解标签指向运行代码 `adac3b3ef3c9626d06a6041b8ee9f1ccdac930da`，未移动标签。GitHub 自动提供标签源码归档。
- 发布资产严格为 Windows EXE、Web ZIP、`petpal-update.json`、`petpal-update-public-key.txt`、`SHA256SUMS.txt` 共 5 项；没有 Ubuntu / Android 0.6.1 二进制。
- Windows EXE 为 180,858,957 bytes，SHA-256 `f34f8d7ead1e418cb33dbe48fdd13f6ec445997b8e308a5373b99b6d4d30fd68`。Web ZIP 为 17,216,021 bytes，SHA-256 `f68bbfbf72d53b09dc3eaa199ff385a2095e870268dbb695299a773ef0b885db`。
- 5 项均实际下载并与本地原件核对 SHA-256、GitHub size/state/digest。Windows 通过 16 个严格检查 Content-Range 的分段完成完整下载、重组及摘要验证；单连接的未完成副本已替换为通过校验的完整文件。
- 下载公钥与仓库公钥及固定 SPKI DER 指纹一致；实际应用的 `verifyUpdateEnvelope` 验证清单签名、有效期、sequence 1、版本和包大小/哈希通过。公开发布后，不带认证下载 `/releases/latest/download/petpal-update.json` 再验签通过。
- 公钥指纹为 `5e649530901ba590d7ed894e74c3f77e29f34e0ca0ac4c5a5bfe1dfefa300d6c`。清单有效期至 `2027-09-28T00:00:00Z`；后续重签必须增加 sequence。管理员仍需首次配置客户端对该公钥的信任。
- Windows 运行验收与 Web ZIP 逐文件验收复用 issue-12/13 已完成证据，本 issue 没有重新构建二进制或更改个人配置、后台服务、路由器。
- 本机发布证据保留于忽略目录 `releases/v0.6.1/download-verification.json`、`publication-receipt.json` 与 `.release-private/release-v0.6.1.json`。私钥仅保留受限且忽略的 `.release-private/`，未提交或上传。
