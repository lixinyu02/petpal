# Android 官方账号 Issues

- Date: 2026-10-15
- Complexity: L2
- Related design: 2026-10-15-android-official-account-design.md

## Task Overview

- Goal: 补齐 Android 本机 SIWC 与现有 Chat / 远程 Agent 使用链路。
- Ordering rule: Complete issues in sequence; one active issue, parallel independent implementation components within it.
- Current status: issue-1/2 done; issue-3 in_progress. User authorized full stable 0.9.12 publication on 2026-10-16.

## Issue List

- [x] issue-1 原生授权、手机模型 relay 与前端接入
- [x] issue-2 组合回归、四端包与验收说明
- [ ] issue-3 正式发布、中央服务与签名更新清单

## issue-1

- ID: issue-1
- 标题: Android 安全授权与本机官方模型接入
- 范围: Native OAuth / Keystore / inference，进程内 relay，Android bridge / 设置入口；用户追加仅小伴应用内 Mihomo 代理、原生与WebView网络接入。
- 依赖: none
- 验收标准: token 不跨原生边界；用户隔离；模型走统一 Chat / Agent；撤销、超时、取消安全结束；相关单元和集成检查通过。
- 状态: done
- 验证方式: Android Java 77/77；模拟器仪器9/9；组合Node覆盖1420通过/1既有跳过（原失败及定向重跑保留）；relay13/13；代理与包检查17/17；TypeScript/Vite通过。
- commit: 11d6b0c

## issue-2

- ID: issue-2
- 标题: Android 构建与组合验收
- 范围: 跨端回归、APK 审核、可用设备与文档。
- 依赖: issue-1
- 验收标准: 通过可执行检查；真实授权 / 真机推理与模拟测试边界准确；提供测试 APK。
- 状态: done
- 验证方式: 六包全归档字节验证；Android 旧版覆盖和模拟器启动；Windows EXE/ZIP 实际启动及内置CLI；Ubuntu x64 WSLg 实跑、ARM64静态；Web286项CRC/字节/隐私/许可；发布工具30/30。详见 acceptance.md 与最终hash绑定回执。
- commit: 本提交（issue-2 发布源与验收）

## issue-3

- ID: issue-3
- 标题: 0.9.12 全平台正式发布
- 范围: 源码、六包、中央网页/后端、GitHub正式Release、sequence14签名升级与本地下载。
- 依赖: issue-2
- 验收标准: 版本/签名/校验一致；下载不缺平台；两源升级发现；生产服务健康，保留原用户数据；不宣称未做的真机官方授权。
- 状态: in_progress
- 验证方式: 正式资产回读、签名验证、HTTPS接口与下载验收。
- commit: pending
