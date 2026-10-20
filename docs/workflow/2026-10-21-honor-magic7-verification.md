# Magic7 / Magic7 Pro 适配验收

日期：2026-10-21；源码基线：949915c。用户追加的两个要求均纳入：标准版与Pro一起适配；读取系统/手机信息，隐藏其他品牌不适用设置。

## 实现

- 原生只读公开 Build 字段，返回真实 manufacturer/brand/model、Android RELEASE/API。前端显示设备和系统标签；不按UA或屏宽猜型号，不把内部型号代码伪装为市场名，不推断MagicOS具体版本。旧客户端缺字段时仍能显示通用信息。
- 后台面板仅显示当前厂商的指南，原生未解析到的入口隐藏；HONOR使用“应用启动管理”，未知厂商使用通用应用后台入口。识别失败时不套用小米/华为等厂商路径。元数据按登录scope/请求代次处理，迟回包不能覆盖当前页面。
- 增加现代 `com.hihonor.systemmanager` 包可见性与两条已查证的固定候选；Huawei保持独立。实际打开前继续核对系统包、enabled/exported/permission，缺失则转本应用信息/标准系统设置。没有改系统开关或增加电话/设备标识权限。
- 安卓设备页隐藏不适用的本机中央服务器与桌面下载引导，保留手机代理、官方账号登录、远程Agent及远程服务器/MCP管理。控件触控高度至少44px。
- 复用已有通用原生安全区/IME消费者和可见视口，未为机型强制缩放/刷新率。原有人物30fps与移动端画布预算继续保留；不宣称真机120Hz性能已测。

## 官方规格与测试档位

官方原始HTML的动态参数已核实：[Magic7中国](https://www.honor.com/cn/phones/honor-magic7/spec/)、[Magic7全球](https://www.honor.com/global/phones/honor-magic7/spec/)、[Magic7 Pro中国](https://www.honor.com/cn/phones/honor-magic7-pro/spec/)、[Magic7 Pro全球](https://www.honor.com/global/phones/honor-magic7-pro/spec/)。

标准版6.78英寸、1264×2800；Pro6.8英寸、1280×2800；出厂均为MagicOS9/Android15。当前用户手机可能升级，故增加Android16兼容组。测试密度不代表荣耀默认密度。

| 目标尺寸与压力档位 | 导航/模拟切口 | 两OS实测WebView CSS尺寸 |
| --- | --- | --- |
| 标准1264×2800 / density480 | 手势 / hole | 422×864 |
| 标准1264×2800 / density560 | 三键 / hole | 362×714 |
| Pro1280×2800 / density480 | 手势 / tall | 427×864 |
| Pro1280×2800 / density560 | 三键 / tall | 366×714 |

Pro的tall切口只是Android模拟切口风险覆盖，不能当真实胶囊挖孔尺寸；官网的“灵动胶囊”软件功能也未用作硬件切口证据。

## 验证结果

- TypeScript与最终Vite构建通过；Node相关216/216，含真实设置组件handlers、平台筛选、旧客户端兼容、账号切换迟回包、现有每日陪伴/Agent菜单/通知回归。
- `:app:testDebugUnitTest` 107/107，0失败/错误/跳过。
- Android15/API35 r09与Android16/API36，八组各4项屏幕instrumentation，共32/32。覆盖实际systemBars/cutout/IME矩形、CSS不重复补偿、真实键盘弹出/收起、返回顺序、横竖屏、主题桥，以及打包App CSS在textZoom100/160/200%的表现。200%时font32/line48/padding20/textarea88，发送按钮无遮挡、无页面/容器横向溢出。
- 两OS各1项真正打包前端启动，共2/2。保持真实JS/React/Capacitor本地HTML，仅禁止外部WebView网络；实际登录表单和四个控件均可见且命中可达，没有登录账号或提交生产任务。API35 WebView124与API36 WebView133均通过。Activity启动至可用登录约1996/4197ms，仅属该模拟器测量，不当作真机冷启动数据。
- 两OS各1项只读HONOR候选解析，共2/2：AOSP缺少HONOR私有组件时，实际resolve到自身应用信息；没有打开系统设置或改变权限。以上合计36/36、无失败或跳过。
- Chrome插件验证421×933人物/语音、933×421横屏语音/聊天/模型菜单、427×400短屏模型与权限面板、361×800设置滚动；无页面横向溢出。浏览器只报告Web身份，未伪造原生HONOR元数据。未发送模型或语音请求。
- APK验证通过：758 ZIP/CRC、306 Web资产、37原生类闭包、v1/v2签名、16KB zipalign；强校验新HONOR包query。与当前正式APK包名/签名一致。

首次使用已弃用sdkmanager分号路径被新版CLI拆包，改用官方新CLI的斜杠路径完成；安装进程虽exit1，package.xml/镜像文件与API35真实开机均独立核实。首次未限定module的Gradle命令触发了非产品Cordova插件的instrumentation重复旧Kotlin依赖，改为本app命名空间的任务后通过；没有为此修改产品依赖。保留原日志，不将这些工具问题冒称产品失败或抹去。

## 安装包、保留与边界

- 独立测试包：`releases/android-honor-magic7-20261021/PetPal-0.9.13-Android-debug.apk`；149937188字节，SHA256 `4380a8c285de688b7c34b4fe35de353ff5e0910f8fba262e551f6274e30021f4`。
- 仍为0.9.13/code25开发签名测试包；当前正式包签名一致，但没有提升正式发布版本、替换下载包或升级清单。没有卸载/重置用户客户端，没有改变业务服务、账号、认证、代理或记忆。
- 新SDK镜像及两套任务AVD独立存放，旧授权AVD未触碰。任务模拟器、qemu、QA服务和Chrome临时视口均已收尾；原业务服务PID/监听保持。
- 本机证据在 `evidence/honor-magic7-20261021/`：native-acceptance-summary/report、native-shutdown-receipt、Chrome、Java/JS、APK审计及正式包签名对比。测试和打包不包含私有资料。
- 尚无荣耀Magic7/Pro真机：现代HONOR私有管家候选、原厂输入法、MagicOS菜单、真实Pro切口及长期后台提醒留存不能宣称验收；按实际resolve保留安全回退。

## Self-review

核对原生设备信息不可由UI参数切换厂商，HONOR/Huawei分支隔离，未知厂商仅通用路径，不可用入口隐藏，旧字段缺失兼容，当前账号迟回包隔离，保留Android代理/官方登录/远程Agent能力，以及APK主代码与instrumentation隔离。未发现需阻塞交付的源码问题。
