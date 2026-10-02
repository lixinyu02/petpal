# 最新正式客户端下载规则

下载中心先在 GitHub 元数据中选出全局最高的纯数字 `major.minor.patch`
版本，再显示该版本的 Android、Windows、Ubuntu 资产。只接受明确为
`draft=false`、`prerelease=false` 的 Release；即使 GitHub 错误标成正式版，
带 `-rc`、`-preview` 等后缀的标签也不会进入目录。版本比较按三个数字段
进行，不按发布时间或字符串字典顺序。

同版的多架构和 Windows ZIP／EXE 都保留。最新版本缺少某个平台或包未上传
完成时，该平台显示等待发布，不从历史版本补包。历史 GitHub Release 仍保留
用于回退，下载页不列出历史版。前端还会过滤旧后端返回的混合目录。

资产原有的文件名／版本、仓库与下载 URL 精确匹配、上传状态、大小、ID 和
可选 SHA-256 校验规则保持。GitHub 读取仍限制大小、时限且不携带用户凭据；
最多读取 100 条元数据。若 GitHub 声明还有下一页，当前实现拒绝把不完整的
列表当作全局最新，并显示读取错误；已有缓存会明确标成缓存，不伪造新包。

正式发布通道与平台证书是两回事。Android 的 `debug` 文件名会如实显示
“沿用开发证书签名”，不把正式 Release 错标成仅供试用。

服务器 `/downloads` 文件区与 SPA 路由分开：已存在的安装包正常下载，已归档
或不存在的包返回 404，不能把首页 HTML 当作成功下载的客户端。普通 SPA
页面和需要登录的 `/api/downloads` 行为不变。

回归入口：`node --test tests/downloads.test.mjs tests/downloads-view.test.mjs tests/downloads-static.test.mjs`。

## 0.9.7 发布验收

GitHub latest 和两源 sequence 9 更新清单均已验证。下载页只显示 0.9.7 的 Android、Windows EXE/ZIP 与 Ubuntu x64/ARM64。34 个服务器历史文件（5,568,933,887 bytes）已在摘要保持的前提下移入私有归档，并完成旧路径 HEAD 404、新版六包 HEAD 200/长度验收；完整包摘要另有真实读回证据。历史 GitHub Release 保留。Chrome 已完成登录页面、真实链接、版本和 412×960 无横向溢出检查。
