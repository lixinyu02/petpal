# 0.9.15 四端正式发布验收

- Date: 2026-10-24
- 产品冻结源码：`d8f0040925b951aabaa5de669db9a6abfe8116fe`；正式 tag `v0.9.15`，Android code27。
- 正式链接：https://github.com/lixinyu02/petpal/releases/tag/v0.9.15
- 状态：正式发布、生产部署、下载及升级验收完成。

## 平台和源码

六包来自隔离 detached worktree，不覆盖在线构建目录。Windows x64 EXE/ZIP、Ubuntu x64/ARM64、Android APK、Web ZIP 各自精确绑定文件大小与 SHA256，聚合入口为 `.data/release-0.9.15/acceptance.json`。发布资产中的 `release-manifest.json` 和 `SHA256SUMS.txt` 可公开复核六包。

Windows EXE 完整烟测通过；ZIP 完整CRC/15091文件逐字节、独立正常启动/登录/UI/模型列表/CLI/Browser.close退出通过，剩余自有进程0。两次附加手势自动测试被额外固定鼠标移动打断，首趟 Page.close 等待退出超时，原失败全部保留；不把这些记录改为通过。EXE与ZIP共有15090文件逐字节相同，ZIP仅额外START-HERE.txt。两包未做发布者代码签名。

Ubuntu 两架构各17256条目/15722文件、源码与前端、16 ELF及274许可核验通过。x64在WSLg实际启动、执行器、NAPI、CLI及合成代理启停通过；ARM64所选Codex/Mihomo/ripgrep/zsh经QEMU运行通过。完整ARM64 Electron GUI、其NAPI/嵌入Node启动器与实体桌面未验，不扩大为硬件通过。

Android保持旧版开发签名，code26→27实际原位升级、旧会话及夜间主题保持、8日续期、断网恢复、WebView实际终止恢复、键盘/系统栏/权限、两种账号流式Chat等22项API36模拟器测试通过，另133 Java单测通过。实际APK完整解包765文件，45原生源码绑定，313运行Web资源逐字节；构建工具元数据`.vite/manifest.json`被aapt排除，单独绑定314→313精确复制及SHA收据，无泛化点文件排除。原先旧版主题/会话预期不匹配的测试工具失败仍保留，产品/APK未因此修改或重打。

Web314文件完整ZIP/CRC/逐SHA、14项许可核验通过，Chrome360px默认模型框无横向溢出、合成流式回复完成。各平台解包实际私有值扫描合计绑定17个现有敏感值，全部0命中；不输出私有值。

全量4024项首轮4017通过、6条件跳过、1短等待超时；同字节独立复验该文件5项全过。不能称首轮全绿。公开源码精确合成凭据映射经19项边界测试和全源扫描；没有放宽扫描主体规则。

## 正式资产传输

两份原更新信任锚保持，签名前重新读取验签旧序号16，再签17。十资产为六包及四份公开元数据，先draft后正式latest，非prerelease。唯一一次字节传输分支基于冻结源码，只含四份本轮workflow/配方文件，不进入main工作树。

GitHub Actions run `40019222523` / attempt1、传输commit `c0ceedaa2b3ac4ae8b5e24b54537928265bb37d2` 通过：6次唯一POST、48次Range GET、6个镜像整包、10份官方响应流与磁盘二次SHA回读、四元数据原ID及最终十资产ID/大小/digest一致。收据 `.data/release-0.9.15/github-draft-full-byte-readback.json`，正式晋升 `.data/release-0.9.15/github-publication.json`。旧0.9.14 tag及十资产身份/大小/digest逐项保持。

新版canonical下载在目录晋升前按现有规则404；原候选保留。实际传输使用固定updates镜像并补Windows ZIP全文回读，没有提前放开下载目录。所有版本化包先stage，旧49个下载文件在stage时保持；晋升后六个canonical包共1,633,334,237字节完整回读通过，合并既有五条updates为11流、共2,850,070,656字节。每流HTTP200/无跳转/大小/SHA均通过，TLS验证开启；额外Windows ZIP updates的独立回读仍单独保留。收据 `prepared/receipts/server-full-readback.json` SHA256 `a5b04d3220234fabdba6eb532d254e92fc7f13089118b16c946295f206d16dd9`。

## 生产版本与保全

后端与网页均为 `0.9.15`，本机及公网 health 200，匿名 state/downloads 401，CORS 204。入口 `index-CCnvzG2U.js` 与 OpenUI renderer `OpenUIBlock-C4MBg1r6.js` 的公网完整字节均与候选一致。目录提供五个非Web客户端包，版本全部0.9.15、来源server、error=null，Windows ZIP优先；两份升级清单均验签sequence17、五个更新目标，原信任锚保持。GitHub Release `422273614` 为latest、非draft、非prerelease。入口 `.data/release-0.9.15/final-online-acceptance.json`。

Chrome插件实际重载公网入口，1920×855下无横向溢出，账号登录门槛与伙伴插画正常，新入口脚本已加载。控制台观测到Zotero扩展自身连接错误，未观测到小伴origin错误；没有新建生产登录会话或聊天任务。截图 `.data/release-0.9.15/public-web-final.png`，结构化记录 `chrome-final-acceptance.json`。移动端360px包验收与412px UI回归的原证据保留，本次最终公网截图是桌面视口。

本轮受控切换保留了全部失败证据。第一次STOP只取得通用CHILD_EXIT_1，不能恢复其确切语句；只读后续成功不改写原失败。加入固定步骤和脱敏分类后，第二次精确定位到Node已退出、附属conhost尚未消失时的verify-children检查。维护标记按finally移除，原guardian随后实际恢复当前0.9.15后台；独立进程及service-restored/service-monitored事件确认旧Node/conhost均已退出、新PID62964由原guardian34088接管。随后独立审查的web-only恢复仅原子发布资源并最后切HTML，恢复阶段未再调用STOP/START，未写源文件或回滚业务。原run `run-20261023T212027779Z-6efffc9e` 的failure保持，真实completed明确recovery，再由原38a6工具生成 `verified-1792791866699.json`。恢复前另有一次API元数据比较失败、一次瞬时额外子进程门禁失败，后续三轮只读API及成功prepare不将这些失败改记通过；未放宽原比较。

最终保全 `.data/release-0.9.15/final-retention.json` 通过：4用户、62会话、10登录会话、1附件的全部state语义保持；completed另记录state原始字节保持；193个最终保护文件、3001个旧非mutable静态文件和314个effective前端文件通过。原61个下载文件中仅更新指针按计划替换，另新增本版SHA256SUMS及release-manifest，两者与prepared严格一致；未删除旧包。只允许三份记忆的两个既有顶层同步时间戳、同key同认证明文长度的links重加密、与实际进程身份一致的service receipt变化。守护配置和信任保持、维护标记不存在，没有回写旧state/DB。

静态资源中184项仅CRLF/LF不同，逐项严格UTF8/原SHA/候选SHA/长度/仅换行归一后SHA核验，旧字节保持。已有36条raw-hash链独立核验。生产effectiveWeb314与安装包原始314清单分开记录，不能称生产所有字节与包原始字节相同；主入口及新hashed资源严格使用候选。

运维比较仅对三份既有精确记忆路径允许两个顶层canonical ISO同步时间戳变化，长度和全部其他语义严格保持；新路径、记忆内容、账号、聊天、附件、DB、代理、信任等均无泛化例外。停止前后核查空闲和业务保全，不回写旧业务。本轮一次实际强制终止后，由原guardian恢复服务；guardian维护标记不是HTTP接入屏障，不声称零中断或已调用app.close。

## 边界

本轮实体手机/完整ARM64桌面/真实OpenAI套餐推理/真实录音播放未验。模拟器、WSLg、QEMU及合成模型的证据仅覆盖其明确范围。所有旧包、私有数据、失败尝试与回退证据保留。
