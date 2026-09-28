# 桌宠渲染选择

小伴使用 Three.js / WebGL 渲染同一只橘白卡通猫。模型由真实三维几何体、层级关节、灯光和材质构成，摄像机视角、头部朝向和肢体姿态在运行时计算。它是程序化三维卡通角色，不是毛发拟真角色，也不是预渲染动画卡片。

共享前端可在 Web 浏览器、Windows/Ubuntu 的 Electron、Android 的 WebView 中使用同一模型与行为代码。这样聊天、抚摸、投喂、休息和走动围绕同一只持续存在的小猫展开。移动设备可以降低像素密度、阴影与渲染频率；隐藏页面暂停，减少动态效果设置关闭自主运动。

UE5 的官方路线不提供常规 HTML5/WebAssembly 浏览器原生直接导出。浏览器接入通常需要 Pixel Streaming 一类远端 GPU 渲染方案，会增加常驻服务、网络延迟和运行成本。这里不引用本轮未在线核验的具体版本号或平台清单。对于轻量、离线可互动且需要四端共享的个人桌宠，Three.js 更符合当前交付方式。

WebGL 可用性、GPU 驱动和 Android WebView 行为仍取决于实际设备；跨平台构建不等于每个平台的图形运行验收。Electron 的透明置顶效果还受 X11/Wayland 和桌面合成器影响。

## 独立行为接口

`src/pet/behavior.ts` 导出 `createPetBehavior`、`createSeededRandom`、`MAX_STEP_SECONDS`、`PET_ACTIONS`，以及 `PetAction`、`PetInteraction`、`PetBehaviorOptions`、`PetBehaviorState`、`PetBehavior` 类型。状态机只接收时间和输入，不访问 DOM、网络、定时器或渲染器。

```ts
import { createPetBehavior, type PetBehaviorState } from './pet/behavior';

const behavior = createPetBehavior({ bounds: [-1.2, 1.2], seed: 42 });
behavior.setPointer(0.4, -0.2); // normalized canvas coordinates, clamped to [-1, 1]
behavior.interact('pet');
const pose: PetBehaviorState = behavior.step(1 / 60);
// Renderer uses pose.x / facing / lookX / lookY / action / actionProgress / jumpHeight / speed.
behavior.interact('sleep');
behavior.wake();               // only explicit wake ends persistent rest
behavior.setVisible(false);  // freezes all action clocks
behavior.setReducedMotion(true); // pauses autonomy; explicit pet/eat feedback remains available
```

`step` 的参数为秒，每帧最多推进 0.05 秒，避免恢复后台页面时突然跨越场景。移动限制在指定世界坐标边界内并在边缘回头；`speed` 为 0–1 的步态强度，`jumpHeight` 为 0–1 的跳跃弧线，渲染器自行决定实际高度和低动态效果时的姿态幅度。休息保持到明确唤醒，其他用户动作可以打断正在执行的自主行为。
