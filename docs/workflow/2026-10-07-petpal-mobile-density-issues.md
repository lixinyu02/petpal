# PetPal 手机聊天区域压缩

- Date: 2026-10-07
- Complexity: L0
- Related design: none
- Current status: issue-1 done，已更新当前本机运行网页。

## Design Note

按截图压缩手机端顶栏、模式/模型/执行电脑/项目目录与消息输入区。保留浅白与绿色的安静界面，以对话正文为主；缩小控制区留白而不缩小44px触控目标。闲置输入使用图片/文字/发送同一行，多行按内容增高；执行中保留追加/排队/停止工具行。人物仍可触达，菜单继续使用现有浮层与过渡。桌面布局、服务接口、账号及任务语义保持。

仅调整共享前端CSS，不新增低价值的样式断言测试；通过独立Chrome隔离数据环境验收412×960、360×800、短视口和桌面。优先Chrome插件；若MXC内核无法启动，继续使用缓存Playwright CLI独立Chrome。TypeScript及隔离build检查后，更新当前已启动本机网页的静态构建；本轮不重打安装包或推送远程。

## Issue List

- [x] issue-1 压缩手机顶部控制和输入区

## issue-1

- ID: issue-1
- 标题: 压缩手机顶部控制和输入区
- 范围: 最终移动端样式覆盖、紧凑输入排版与本机网页构建。
- 依赖: none
- 验收标准: 412/360宽无横向溢出；顶部和空输入区高度减少，模式/模型/主机/目录/权限/语音/图片/发送触控目标至少44px；执行中追加/排队/停止、附件、多行文字和菜单可用；桌面布局不变。
- 状态: done
- 验证方式: TypeScript、隔离build和本机dist构建通过；Chrome移动触控模拟412×960/360×800、412×480短视口和1280×800通过。实际尺寸及边界见下方记录；自审与独立只读审查发现的附件错误窄列问题已修复，真实上传失败路径复验通过。
- commit: this issue implementation commit (see Git history)

## 验收记录

基线dc0d093对应上一轮无插桩final-build；新版隔离build使用当前源码。两者使用相同独立账号、模拟模型与任务，没有读取生产账号或执行真实电脑操作；Chrome以`--mobile`启用触控媒体查询。

412×960、Agent闲置且输入为空时的真实DOM高度：

| 区域 | 调整前 | 调整后 |
| --- | ---: | ---: |
| 顶栏 | 74.39px | 58px |
| 模式/模型/执行电脑/目录控制区 | 181.19px | 150px |
| 两个顶部区域合计 | 255.58px | 208px |
| 输入框（含图片与发送按钮） | 122.59px | 54px |
| 完整输入区（含权限与语音） | 231.59px | 150px |
| 正文可用高度 | 472.83px | 602px |

正文增加129.17px。模式按钮、模型、主机、目录、权限、语音、图片及发送入口均至少44px高；人物高48px，保留安全区。桌面1280×800前后topbar/controls/composerArea/composer/textarea/reading六项高度差均为0。

- 360×800 Agent实际模拟执行中：无横向溢出；追加/排队选择124px宽，图片/停止/发送44px方形，工具行不重叠。实际加入队列后显示1条待执行消息。
- 412×480短视口：documentWidth=412，输入区在屏幕内；主机菜单320×306px、权限菜单350×162.80px均在可视边界内。这里验证CSS短视口与`data-short-viewport=true`，不等同于实体手机软键盘验收。
- 12行输入按内容增高至116px，上限后scrollHeight=596px并可纵向滚动；清空恢复44px。强制固定field-sizing模拟旧引擎时，仍为44px且长文字可滚动；不支持field-sizing的旧浏览器不会自动展开。
- 实际上传有效PNG，再选择9MiB超限PNG：保留缩略图，错误文本“请选择8MB以内的PNG、JPG或WebP图片”显示在全宽362px区域，页面宽度仍412。已修复独立审查指出的`.attachment-error`可能落入44px网格列的问题。
- 模型菜单的长名称可见并可选。Chat模拟流式发送完成，Markdown标题正常，闲置输入框同为54px，Chat正文高度692px。
- Chrome错误0条。Agent闲置/执行中、Chat、附件失败截图已查看。仅CSS变化，无新增样式镜像单元测试或重复全量回归。

原始脚本、尺寸日志和截图保存在ignored `evidence/mobile-density-20261007/`，例如`baseline-idle-412.log`、`current-idle-412-final.log`、`agent-busy-360.log`、`short-busy-412x480.log`（实际为重载后的闲置短屏）、`multiline-final.log`、`attachment-error-final.log`、`current-desktop.log`。最终手机截图为`output/playwright/current-idle-412-final.png`及`chat-final-412.png`。

最终构建通过`--emptyOutDir false`更新现有dist，保留下载文件。当前http://127.0.0.1:4318健康true、网页HTTP200；原后台未重启。测试Chrome与本轮模拟服务正常退出。本轮未推送远程仓库、未更新远程部署主机、未重打客户端或进行实体安卓/Ubuntu/Windows客户端验收。
