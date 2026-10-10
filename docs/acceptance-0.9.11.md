# PetPal 0.9.11 正式版验收

2026-10-10：六包已正式公开发布，GitHub Release [v0.9.11](https://github.com/lixinyu02/petpal/releases/tag/v0.9.11)（ID `408885025`）为 latest，`draft=false / prerelease=false`。两源签名清单均为 stable / sequence13。源码与发布标签固定为 `9ff5eeca4c8117fdf14fe082053f41b7b3381121`；后续验收文档提交不改变安装包来源。

本版永久移除 3D 小猫的入口、渲染器和资源，只保留二次元伙伴。旧 cat 偏好回落为二次元显示，原偏好和聊天设置保留。旧 Android wire kind / URL 保持兼容，实际覆盖层始终渲染二次元；不包含猫模型。Three.js 仍用于 AnimeScene 恢复渲染。首轮带猫候选与失败证据保留，未作为正式版上传。

## 六个发布文件

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| PetPal-0.9.11-Windows-x64.exe | 218951182 | `60a73e3433e942a4f204aee072fad3eb90c2285c039d2fed84f3839ee0e803e3` |
| PetPal-0.9.11-Windows-x64.zip | 368189023 | `881910fd896d8e83ec537bcaaa2e212cea6569880928e88a7e92cca343025054` |
| PetPal-0.9.11-Ubuntu-x64.tar.gz | 338816806 | `459ece9250d45caeea549a885b96186e71f0b0b0cf1396bf3d9da085adda7365` |
| PetPal-0.9.11-Ubuntu-arm64.tar.gz | 333006059 | `d4b4449c22c5b9c7f0abe135b77bab6e988cd9e2b9e7e4640351ff320ed3e7db` |
| PetPal-0.9.11-Android-debug.apk | 55588785 | `11627a53744320d5a5b580cb966600a7ee669e82e42ed8af3d8ae11bcbf86b6a` |
| PetPal-0.9.11-Web.zip | 50819512 | `901d942344271a3c753e68c74af713567580e79f193ba44ad6b09925eb70906d` |

Windows EXE 是便携自解压入口，无需独立安装 Node/npm；推荐完整解压 ZIP 后运行 PetPal.exe。Ubuntu 解压到新目录后运行 start-petpal.sh。Android 包名 com.petpal.app，versionCode21，沿用原开发证书；没有内置桌面 Codex/OpenCLI，Agent 在选定电脑执行。

## Windows 实际验收

最终 EXE 完整读回5066项文件，其中275项 canonical Web资源；1404项冻结输入保持。真实启动、执行器在线、Codex0.143.0/OpenCLI1.8.8与Computer Use7.4.0可用、登录保护、Cubism V12和手势烟测通过。主窗口／伙伴窗口、重载及旧 cat 偏好回落共十个角色状态验证：display v3/anime/catEnabled:false，真实 Core／渲染帧，退休入口不存在，原始偏好保持。退出后本轮自有进程为0。Authenticode为NotSigned，签名更新清单不替代平台签名。

ZIP 全量解码10882条目／946383555字节，10881个runtime文件与最终EXE payload相同。中文及空格目录下两次真实冷启动exit0、health0.9.11，Codex/OpenCLI可用，退出清理通过。9.826／7.982秒是 wrapper生命周期，不是首帧性能基准。本轮没有单独完成ZIP完整手势或中央服务器UI重复验收，不复用旧版本证据宣称已验证。

原辅助工具的asar路径分隔符、PS5 ExitCode=null失败保留，针对辅助器精确修正后最终真实结果通过。Windows没有真实上游模型、音乐、网站或媒体设备任务验收。

## Ubuntu 与 Android 包级验收

Ubuntu x64／ARM64每包12880条目全部读取并核对字节、模式、canonical资源、来源、CLI/native架构与许可；ELF machine62／183，Computer Use要求glibc2.34。每架构11423个文件扫描11个已知私密值无命中。动态查询目录32站点／80查询（23公开、57浏览器）和相关模块导入闭合通过。真实Core读取MOC5/V12：16drawables、22parameters、3774vertices；RGBA WebP及preview alpha核对通过。

Ubuntu没有本版本目标机CLI／GUI运行验收，runtimeVerified=false；此前0.9.10板端运行不能充当0.9.11验收。本轮没有板端部署、路由器／固件操作。

Android完整读取718个APK条目及CRC，275项canonical资源、19个原生类和开发签名连续性通过；v1/v2与16KB zipalign通过，minSdk23／targetSdk35。signer SHA-256为 `8ae49ee6b09900eee2e2996a0c4ecd659f94631f81b64c5df7fb53935835713c`，与0.9.10相同，versionCode严格递增。包中没有桌面CLI、后台服务器或已知私密值。本轮未在手机或模拟器安装运行，也未验证OEM省电限制、后台通知、相机与真实语音设备。

## Web 与性能优化

Web ZIP完整解码275个文件／56165096字节，与canonical资源及冻结来源相同；Cubism V12/Core/许可、原生五官／头发／手部资源保持。纹理无损WebP为1504778字节，原PNG3142568字节，精确RGBA保持；384×576预览58004字节。优化包含轻量预览、空闲／不可见轮询暂停、单飞请求与取消，以及登录后语音状态复用。

静态部署275个资源，2项改写、28项新增，index最后切换；HTTPS首页完整body等于canonical index，下载目录未被静态部署改写。70个旧猫资源（两个媒体文件及68个PetScene chunk）精确移入受保护的可恢复备份，没有广泛删除其他历史资源。

Chrome插件实际登录test，首页412×960／scrollWidth412，真实canvas renderer=cubism、ready=true、renderFrames3889，退休控件为0；个性设置没有猫选择。正式发布后下载页只列0.9.11，服务器链接优先；Windows EXE/ZIP、Ubuntu x64/ARM64实际切换并核href通过，412×960无横向溢出。视口已恢复，推荐ZIP/x64选项还原。完整页面截图曾超时，成功的视口截图和结构化收据保留；没有点击下载重复读取包体。浏览器视口验收不等于安卓或Ubuntu原生运行验收。

## 后端恢复与业务保留

原backend-restart helper在stop阶段失败：旧PID77168已停，started=false，没有一次成功的手动重启收据。既有guardian随后自动恢复服务；未重放restart、回滚或覆盖状态。

独立只读对账观察95.412秒，相同后端PID39900与guardian57452身份保持；本机／公网共6次health200／0.9.11，唯一4318listener归属正确。stderr0，maintenance flag不存在，旧PID及其直接已知子进程为0。14项业务字段规范化hash保持 `8bbd8a71fc2162258823d69d858145b1c8eb6c1d3a37fbdba915e45f2305171d`：2用户、5providers、46会话、1附件等业务保留。settings／guardian JSON及PS1字节保持。sessions、executionHosts、notifications、updateTrustState四项动态字段明确排除。

原inner exception未保存，具体stop失败根因仍unknown；不能写成无中断升级或手动helper成功。恢复后的运行态通过，与上游模型／语音／实体设备验收分别报告。

## GitHub 与服务器正式发布

初次gh上传超时留下EXE starter，原进程终态和attempt保留；只删除精确未完成ID627726949。HTTP/1随后完成四项metadata，但ZIP返回HTTP408（17727488字节／258秒）；根代理只停止同批两个task-owned curl，父进程自行settle。三项starter精确清理；后续GET失败后仅只读协调，确认原四metadata ID保持，未重复DELETE。所有失败和清理凭据保留。旧gh内部HTTP POST次数unknown，不能称为无重试的一次wire发送。

最终GitHub Actions [run38049645841](https://github.com/lixinyu02/petpal/actions/runs/38049645841)／attempt1／候选 `2fe8c138897a78782489967d5f7bfcc0c49effb6` 成功。六包由固定HTTPS服务器的48个range片段组装，片段长度、整包SHA和落盘SHA分别验证；六次应用层单POST，没有自动重试。四个metadata按原ID复用。云端从官方API/CDN完整读取全部十项资产，bytes／SHA与同一冻结合同一致，最终资产ID再次保持。API bearer仅首跳，未发送给CDN或公共服务器，TLS验证启用，没有执行安装程序。

本机归一化严格绑定run/head/attempt、30个origin/body/final事件、48片段、六整包和十ID；github-draft-readback.json是云端完整body证明，本机未重复下载十包。发布后identity核对继承该完整回读，不能称为另一次published完整body读回。正式Release已公开且latest，标签9ff来源和全部资产ID保持。

服务器六个download包与五个update包共11条流均完整HTTPS读回。更新清单由sequence12原子提升为13，旧清单私有备份保留，新清单公网完整body核对通过。GitHub信任锚 `5e649530901ba590d7ed894e74c3f77e29f34e0ca0ac4c5a5bfe1dfefa300d6c`；服务器信任锚 `1841fdaf57bb74769dc94049d07fc79d675f29c4633f156c3b1ec65781f8d5d3`；两源继续使用各自既有私钥，不能混用。

13个旧服务器公开文件精确移入可恢复私有归档，15个当前文件保留；实际HTTP核对旧13项404、新15项200。GitHub历史版本保留。两源真实更新服务各五目标从0.9.10发现0.9.11／sequence13，Android21；当前Web0.9.11没有升级。验证使用隔离store，未改生产更新配置。

## 证据与边界

聚合release-acceptance.json绑定12份实际验收收据与六包；contract hash `03b8d9c4f61874164ee4bf85c6b1207ade311f04c4f9e121f7a2bdcc241a38cc`，plan hash `78a035627d17b3f09b2ca222db148cf6e6addfe5d5753e3991d7f8920641a99b`。全部本轮ignored证据位于 `evidence/release-0911-20261010-r2/`，失败证据不覆盖：windows-final-verification.json、windows-exe-smoke/result.json、windows-zip-private-audit.json、ubuntu-package-audit.json、android/android-apk-audit.json、web-archive-audit.json、static-deployment.json、live-cat-retirement.json、backend-reconciliation.json、github-publication.json、server-promotion.json、live-update-sources.json、previous-archive.json、archive-http-acceptance.json、chrome-release-acceptance.json及github-transfer-cloud-final/cloud-verification-38049645841.json。

本轮没有重新执行真实LLM/ASR/CosyVoice端到端对话、音乐播放、网站控制、实体麦克风／扬声器／相机或Ubuntu／Android真机验收。既有功能实现与先前证据继续保留，不扩写为本版全部实测成功。
