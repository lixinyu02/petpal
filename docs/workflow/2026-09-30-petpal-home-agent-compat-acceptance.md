# 首页选择器与 Qwen 兼容验收

日期：2026-09-30。

## issue-57

Chrome独立预览从首页直接加载，未先访问工作台：旧版权限内容透明、padding0且字段为单行flex。修复后加载链仅包含首页资源，权限内容有背景/边框、17px padding与两行grid。412×960下padding15px、选择框44px高，两段权限说明完整；语音模型和Chat+Agent触发器分别为44px高的两行，document宽412无横向溢出。

模型菜单在412×960和缩小后的412×520 CSS viewport都位于屏幕内（短视口top78/bottom508），可滚动、搜索Qwen和键盘选择。随后独立导航工作台，共享权限背景/两行保持正常。以上是Chrome模拟尺寸与键盘验收，不替代实体手机软键盘/触摸验收；临时尺寸已清除。

TypeScript及独立Vite build-home通过；30个部署文件公网SHA256一致。保留旧hash资源，HTML最后原子替换，Windows0.9.1 EXE/ZIP大小、mtime和hash不变，未重启后端或改变生产权限。

## issue-58

待实施和验收。已只读确认两次用户失败的网关日志均为上游连接no route to host；原生Qwen单张合成红色图片Responses已回答红色。具体网络修复与Codex派发结果仍需单独验证，不能将原生图片探针当作Chat→Agent成功。
