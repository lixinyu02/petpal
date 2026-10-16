# Android 官方授权返程 Issues

- Date: 2026-10-16
- Complexity: L2
- Related design: 2026-10-16-android-official-return-design.md

## Task Overview

- Goal: 修复系统浏览器完成官方授权后无法返回小伴的问题。
- Ordering rule: issue顺序完成；同一issue内部可并行独立组件。
- Current status: issue-1、issue-2、issue-3 done；issue-4待候选交付。

## Issue List

- [x] issue-1 原生返程与授权生命周期修复
- [x] issue-2 实际Android16验收与候选APK交付
- [x] issue-3 手动回调输入与双通道单次处理
- [ ] issue-4 备用入口实际验收与更新候选

## issue-1

- ID: issue-1
- 标题: 原生返程与授权等待恢复
- 范围: callback HTML/导航票据、MainActivity入口、application host和短期前台服务、JS恢复生命周期及定向回归。
- 依赖: none
- 验收标准: 不更改官方redirect或暴露授权参数，返程固定打开官方设置，同账号Activity重建保留attempt，退出/取消撤销，服务只保活当前等待，验证错误不显示为成功。
- 状态: done
- 验证方式: Java88项、前端会话/授权55项、自动化导航及包审计97项通过；tsc、Vite、原生编译通过。Android16真实loopback/Activity重建/FGS及验签夹具15项通过；Chrome一项因隔离模拟器首次初始化条款页面跳过，原失败与环境证据保留，未代用户确认条款。独立组件自审与最终产品差异自审完成。
- commit: 3152671

## issue-2

- ID: issue-2
- 标题: 原生实际验收与修复包
- 范围: Android16模拟器回调到App流程、覆盖安装候选、签名/包审核及可用下载。
- 依赖: issue-1
- 验收标准: 真实Android入口与后台生命周期有证据，同证书更高code可覆盖，明确真实官方授权和小米真机边界；不替换已发布0.9.13文件。
- 状态: done
- 验证方式: Android16原生15通过/Chrome初始条款环境1跳过；实际候选覆盖code25和强关后普通登录恢复通过；APK完整审核与同签名升级通过；候选公网149300903字节及SHA一致；正式Web/下载/升级指针保持，详见acceptance.md。
- commit: 本issue的docs(issue-2)交付提交

## issue-3

- ID: issue-3
- 标题: 本机输入回调地址备用登录
- 范围: 原生输入框、严格本次URL解析、一次性授权竞争/摘要收据、可选原生桥和UI入口及定向测试。
- 依赖: issue-2
- 验收标准: 用户可手动粘贴最终回调地址；原文不进入JS/后端/日志；只接受本次登录，重复/双通道不重复兑换，取消输入不撤销等待，账号和Activity变化关闭失效输入框。
- 状态: done
- 验证方式: Java91项、前端/登录/桥/UI回归161项通过；TypeScript、Vite和原生编译通过。Android16完整26项原生验收25通过、Chrome首次初始化条款环境1跳过；其中真实产品WebView/Capacitor桥到原生输入框5项全部通过。覆盖双通道竞争、占用socket、重复回调收据、过期与invalid_grant；组件及最终差异自审完成。
- commit: 本issue的fix(issue-3)实现提交

## issue-4

- ID: issue-4
- 标题: 手动备用入口实际验收及候选交付
- 范围: Android16原生对话框/桥/账户恢复实际验证，dev.2 code27构建、审核、公开候选下载。
- 依赖: issue-3
- 验收标准: APK同签名可覆盖dev.1及0.9.13，公网文件完整校验，正式Web/下载/升级清单保持，真机/官方授权边界准确。
- 状态: todo
- 验证方式: instrumentation/App验收、包完整审核和公网回读。
- commit: pending
