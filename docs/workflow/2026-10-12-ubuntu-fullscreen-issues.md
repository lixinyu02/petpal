# Ubuntu 自启与全屏 Issues

- Date: 2026-10-12
- Complexity: L1
- Related design: 2026-10-12-ubuntu-fullscreen-design.md

## Task Overview

- Goal: 完善 Ubuntu 自启与全屏使用体验。
- Ordering rule: Complete issues in sequence.
- Current status: all done; ARM64 实屏与真实系统登录自启未验范围已记录

## Issue List

- [x] issue-1 本机全屏设置与安全退出
- [x] issue-2 Ubuntu 原生验收与使用记录

## issue-1

- ID: issue-1
- 标题: 本机全屏设置与安全退出
- 范围: preferences、主窗口、IPC/preload、UI 与相关测试
- 依赖: none
- 验收标准: 自启已有能力保留；新全屏启动偏好持久化；支持 F11/Esc/托盘和设置即时切换；启动最小化不抢焦点；旧客户端仍可使用旧设置；登录检查与账号切换保护保持
- 状态: done
- 验证方式: 七个相关测试文件 131/131 pass；TypeScript/Vite build pass；自审检查保留账号授权、最小化与旧 bridge、graphics 参数白名单。尚未以此结果代替 Ubuntu native 验收。
- commit: 80597de

## issue-2

- ID: issue-2
- 标题: Ubuntu 原生验收与使用记录
- 范围: 独立 Ubuntu 实测、启动项与显示范围核查、Ubuntu 本地预览包和缓存打包修复、验收记录
- 依赖: issue-1
- 验收标准: Ubuntu 上实际全屏和退出验证；两架构包审计及最终 x64 包原生启动；下载缓存不入客户端且网页原缓存保留；记录自启入口、退出方法与未测平台
- 状态: done
- 验证方式: Ubuntu24.04 x64/WSLg源码5次与完整包2次 native exit0；稳定全屏1920×1080；F11/Esc/UI/XDG、真实CLI版本通过；两arch独立归档审计及current源比对通过；打包修复75/75 tests。截图／日志／哈希及ARM边界见 acceptance.md。测试PID与自启项清理；未发布正式Release。
- commit: 本 issue 提交，见 Git history
