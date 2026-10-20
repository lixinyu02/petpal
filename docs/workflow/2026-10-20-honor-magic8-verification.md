# 荣耀 Magic8 适配验收

日期：2026-10-20；基线：`aff8802`；目标：标准 Magic8（1256 × 2760）。参考：[荣耀参数页](https://www.honor.com/cn/phones/honor-magic8/spec/)与[UL 设备参数](https://benchmarks.ul.com/en-sc/hardware/phone/Honor%2BMagic8%2Breview)。官网动态参数没有在文本抓取中返回具体分辨率，数值以 UL/GSMArena 的一致规格交叉核实。

## 实现

- API30+ 原生只由 ScreenInsetsController 合并 systemBars/displayCutout/IME，使用各边最大值而非相加；消费 insets，避免 WebView/CSS 重复留白。旧系统保持平台 fit 和 adjustResize。
- 返回键先收起输入法；主题通过受限 PetScreen 桥更新系统栏图标与安全区背景。桥只接受 day/night，不接受 URL/脚本/权限参数。
- ModelPicker、权限和 Chat+Agent 面板统一使用可见视口与四侧安全矩形；测量缓存，避免滚动时反复布局测量。
- 横屏人物区不再被短屏 300px 高度规则覆盖；登录、侧栏、通用弹窗与远程桌面抽屉使用共享可用尺寸/安全区；输入框最小高度包含一行实际行高与内边距。

## 结果

| 验收 | 结果与边界 |
| --- | --- |
| TypeScript + Vite | 通过；构建到独立 `.data/magic8-web-20261020`，未修改正式 dist |
| 前端相关测试 | 111/111；含实际组件弹层、缩放偏移、安全区、账号恢复顺序与 APK 审计单元测试 |
| Java 单元测试 | 98/98，0 failure/error |
| API36 native runtime | 手势导航 density480、三键导航 density480、三键导航 density560；每组4/4通过，共12次测试；均有实际 hole 切口 |
| 输入法/返回 | 真实 IME 弹出后 WebView 矩形变小；发送按钮可见；第一次返回只收键盘，第二次交给页面；收起后恢复高度 |
| 横竖屏/主题 | 切换后安全矩形重新计算；CSS env 为0，无重复补偿；受限原生主题桥实际改变系统栏图标及背景 |
| 大字体 | 当前 APK 实际 App CSS + WebView textZoom100/160/200%；逻辑宽419与359；一行文字不裁切、发送按钮未遮挡、无横向溢出 |
| Chrome 插件 | 实测360×380、400×879、412×912、412×400、440×969、912×412；登录、Live2D、语音面板、Chat/Agent、模型菜单、权限、Chat+Agent、设置/模型表单与设备设置正常显示 |
| APK 静态审计 | 通过：签名、zipalign、全部 ZIP/CRC、349个 Web 资产与35个原生类闭包、Cubism/Mihomo；未打包测试类或私有数据 |

Chrome 的临时 viewport override 受桌面缩放影响，所有尺寸均由页面 innerWidth/innerHeight 校准；截图与 DOM 几何分开核实。设置窗口在360×380时位于(18,18)，大小324×344，内容可内部滚动。412×400时权限面板在屏内，输入区底边为400。

原生字体200%时实测：font32px、line48px、padding20px、textareaClient88px；逻辑宽359下发送按钮仍可见且没有横向溢出。原生测试禁用网络并使用本地表单，没有调用生产模型、ASR/TTS或操作用户设备。

## 产物与证据

- 独立测试 APK：`releases/android-magic8-20261020/PetPal-0.9.13-Android-debug.apk`
- 大小：150011492 bytes。
- SHA256：`88e2c5a674d0beb58ef39a4bd95f27ce9c0d64528291269bec9ca0dc9cffe621`。
- 版本仍为0.9.13/code25，使用原有开发签名；这是本次适配测试包，未替换正式下载/升级清单。
- 私有证据目录：`evidence/honor-magic8-20261020/`；含构建、111项测试、三组原生运行测试、布局日志、Chrome截图和APK审计。
- 首次 native 3项测试中仅主题断言失败（测试仍预期旧背景色），修正为主题真实色后重新完成全部12项；首次Web打包的theme扩展名解析错误与原VM fixture缺少新增hook映射也均已修正，保留初次日志。

## 尚未验收

没有连接荣耀 Magic8 真机。模拟器为 Android16/API36，并非 MagicOS；荣耀原厂输入法、系统手势和实际120Hz观感仍需在手机上确认。本轮没有测试语音/模型上游，也未进行生产远程桌面连接；远程桌面改动仅为响应式抽屉布局。捏合缩放时原 useViewport 的布局防抖策略保持，弹层安全矩形本身支持 visualViewport scale/offset。
