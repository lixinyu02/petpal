# Android 官方授权返程 Issues

- Date: 2026-10-16
- Complexity: L2
- Related design: 2026-10-16-android-official-return-design.md

## Task Overview

- Goal: 修复系统浏览器完成官方授权后无法返回小伴的问题。
- Ordering rule: issue顺序完成；同一issue内部可并行独立组件。
- Current status: issue-1、issue-2 done，已交付可覆盖的修复候选。

## Issue List

- [x] issue-1 原生返程与授权生命周期修复
- [x] issue-2 实际Android16验收与候选APK交付

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
