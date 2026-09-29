# 412×960 自适应 Issues

- Date: 2026-09-30
- Complexity: L1
- Related design: 2026-09-30-petpal-adaptive-screen-design.md
- Current status: issue-35 done; issue-36 done

## issue-35

- ID: issue-35
- 标题: 宠物与多端窗口响应布局
- 范围: 共享陪伴页/工作台布局、视口和原生窗口边界
- 依赖: issue-34 done
- 验收标准: 412×960 两种角色完整、主要操作可达、无横向溢出；窄 Ubuntu 窗口不强制 760px；安卓视口变化有对应处理
- 状态: done
- 验证方式: TypeScript、隔离 Vite 构建通过；32 项定向测试通过；Android Java 编译与 25 项单元测试通过。Chrome 实测 412×960 两种伙伴、Chat/Agent、菜单与设置；360×640、412×560、650×412、700×412、960×412、1280×800 未见页面横向溢出，输入区可达。自审修复模型标签折行、中等宽度矮窗口的主机挤压、Linux 新窗口模块校验正则遗漏（新增清单测试 1/1）。Ubuntu/Android 原生实机仍未验收。
- commit: 9e78591

## issue-36

- ID: issue-36
- 标题: 跨尺寸验收与网页上线
- 范围: Chrome 视口矩阵、备份部署、公开页面和数据保持验证
- 依赖: issue-35
- 验收标准: 核心矩阵通过、上线包与隔离构建一致、保留数据、注明原生实机/包限制
- 状态: done
- 验证方式: Chrome 视口矩阵、生产 412×960 小猫/Agent 复验通过；公网 23/23 静态 SHA-256 一致、health 正常、匿名状态和语音 401；2 个账号/16 个会话及完整配置、参考音频保留；隔离预览已停止。详见 2026-09-30-petpal-adaptive-screen-acceptance.md。
- commit: 本 issue 验收提交
