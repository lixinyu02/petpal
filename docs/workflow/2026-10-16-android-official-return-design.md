# Android 官方授权返程修复

- Date: 2026-10-16
- Complexity: L2
- Status: final

## Background

用户在小米17 Pro Max／Android16完成ChatGPT官方授权后看到“可以回到小伴”，浏览器没有返回App。源码确认：loopback回调只返回纯文本，没有返程入口；该响应早于token交换和验签。Plugin销毁还会关闭Runtime，前端首次mount也会clearScope，导致Activity重建丢失授权。

## Goal

真实loopback回调提供自动尝试与可点击的返回小伴入口；固定打开官方账号设置并更新真实验证状态；授权等待期间保护本机listener，Activity重建同账号不中断。保留原来账号隔离与官方授权协议。

## Non-goals

不更换官方OAuth redirect_uri，不将OAuth code/state/token放入App深链、WebView事件、中央服务或日志；不绕过Android后台启动限制；不修改用户已有官方授权或替其确认新授权。此次交付修复候选APK，保留0.9.13正式包直到新候选验证。

## Solution

1. 仍使用官方要求的`http://127.0.0.1:<port>/auth/callback`，保持PKCE/state/nonce/JWKS验证。来源：https://developers.openai.com/siwc/token-sharing-open-source/sign-in （本轮已读取）。
2. 有效回调返回无外部资源HTML，明确“收到授权，正在验证”，显示“返回小伴”按钮。返程使用固定package的intent URI和独立随机一次性导航票据；自动唤起可能被浏览器限制，按钮始终可用。响应no-store、no-referrer及严格CSP，绝不声称尚未完成的绑定成功。
3. 独立`petpal://official-account/return`入口仅消费有界TTL、当前小伴scope、当前attempt的导航票据，不能完成OAuth或替换账号。启动和onNewIntent在交给Capacitor前剥离返程Intent的data/extras，固定进入本地官方设置，不重载已打开的正常WebView。
4. application scope host持有Runtime和可解绑listener，不保留销毁的Activity。当前前台可信Plugin显式打开系统浏览器。临时、可取消的specialUse前台服务只保活当前授权等待，完成/失败/取消/超时停止；START_NOT_STICKY，强关后不伪造恢复。通知取消绑定具体attempt，旧通知不能取消新授权。
5. JS只在小伴会话恢复完成后首次绑定；同账号重建由原生bind验证并复用pending。JS组件卸载只移除本页面listener/代际，不撤销原生scope；真实退出/换账号/换服务立即撤销旧scope。

## Impact

Android Runtime、Plugin、MainActivity、Manifest、新host/短期服务及前端生命周期。无中央API或数据库迁移，不改变桌面登录和Android代理配置。

## Risks

Chrome可能禁止无手势自动唤起，必须保留按钮。OEM仍可能强制终止进程；强关后要求重新授权，不保留未完成code。不能将模拟器、合成token验签夹具称为用户真实官方绑定通过。

## Verification Plan

Android-free策略单测与现有原生回调/验签回归；前端会话恢复、同账号重建、退出和迟到结果回归；Android16模拟器实际loopback HTML→返程intent→固定设置，后台通知保活、Activity重建、验证失败及完成后服务停止。验证伪造/重复/过期/跨账号票据拒绝，代码不出现在HTML或WebView事件。构建同证书更高code候选APK并审核、提供下载；真机官方授权由用户完成。
