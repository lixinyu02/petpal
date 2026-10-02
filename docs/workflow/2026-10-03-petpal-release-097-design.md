# PetPal 0.9.7 正式客户端与最新下载入口

- Date: 2026-10-03
- Complexity: L2
- Status: completed

## Background

用户要求客户端下载仅保留最新正式版，并发布一轮新正式客户端。当前 GitHub latest 是 0.9.6，下载目录混有历史预览包；源码已包含最新 Cubism V11、区域互动与倾听过渡。

## Goal

发布 0.9.7 Windows x64 EXE/ZIP、Ubuntu x64/ARM64、Android 与 Web 更新资产；下载中心仅展示最新正式版本，GitHub 与服务器签名更新清单一致。

## Non-goals

不改模型外观或运行时依赖，不调整账号/API/聊天配置，不重试历史 Agent 任务，不操作 RK3566 板或其 WSL。历史 GitHub Release 作为回退记录保留。

## Solution

只接受非 draft、非 prerelease 且稳定语义版本的最新 release；同一版保留各系统/架构/格式，不按平台回填旧版。使用独立构建输出，冻结当前源码与资产，保持 Android 原签名和递增 versionCode。Windows 包实际启动，所有归档做完整读回与必要原生依赖审计。准备完整资产后发布 GitHub stable 与两源五目标 signed manifest（沿用各自发布密钥，递增 sequence）。服务器旧公共下载精确移入私有回退目录，保留当前 updates 入口。

## Impact

下载 API/前端文案、版本与构建文档、发布资产、在线静态入口与后端下载目录。在线业务数据必须保持，只有发布/升级状态可发生预期变化。

## Risks

Windows 无 Authenticode；Android 保持已有开发签名以兼容升级。Android/Ubuntu 如无可用设备，仅报告包审计边界。大包 GitHub 传输可能中断，重试前读取远端状态，不重复发布不完整资产。先完整备份发布入口与哈希再切换，清理采用可恢复移入私有目录。

## Verification Plan

稳定版本选择回归、TypeScript、相关 Cubism/安装/更新回归；客户端归档完整性、版本、签名、V11 默认与 MOC/纹理字节、CLI/MCP 闭包；Windows 独立启动及清理；两源签名/sequence/哈希/最新版本检查；Chrome 登录下载页与 412×960 布局；公网包下载摘要复核。
