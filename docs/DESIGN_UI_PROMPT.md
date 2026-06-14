# VoiceCanvas 前端设计系统提示词

> 给 AI 写前端时，整段粘贴本文件，并说明要改的页面/组件。

---

## 一、设计定位

- **产品气质**：纯语音 AI 绘图工作台 —— 自由、专注、有创造力，像一位随叫随到的语音画板搭档
- **视觉温度**：温暖、明亮、略俏皮，手绘感但不幼稚
- **观看距离**：笔记本 1m 内，评委 Demo 投屏可读
- **核心识别**：奶油底色 + 1px 纯黑描边 + 天蓝主色 + 鸭黄点缀
- **禁止**：紫色渐变 SaaS 风、玻璃拟态、过重阴影、emoji 当图标、深色全屏「程序员审美」

---

## 二、色彩系统（CSS 变量，勿改语义）

```css
:root {
  --bg: #f5f0e8;
  --surface-1: #fffdf9;
  --surface-2: #ffffff;
  --surface-3: #f0ebe3;

  --border: #1a1a1a;
  --border-soft: rgba(26, 26, 26, 0.14);
  --text: #2d2d2d;
  --text-strong: #1a1a1a;
  --muted: #5c5650;
  --muted-dim: #8a847c;

  --accent: #a5d8ff;
  --accent-hover: #8ec8f5;
  --accent-soft: rgba(165, 216, 255, 0.35);
  --duck-yellow: #ffde00;
  --brand2: #ff9538;
  --success: #16a34a;
  --danger: #dc2626;

  /* VoiceCanvas 模块色带（卡片顶栏 4px） */
  --module-voice: #6fc2ff;   /* 语音面板 */
  --module-draw: #53dbc9;    /* 自由画布 */
  --module-grid: #ffde00;    /* 九宫格 */
  --module-ai: #a5d8ff;      /* AI 生图状态 */
  --module-3d: #ff7169;      /* 3D 创作 */

  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 8px;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);

  --font-display: "DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-body: "DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

---

## 三、布局骨架

```
.shell（min-height 100vh，padding 20–24px，背景 --bg）
  └── .frame（max-width 1200px，margin auto，1px solid --border，radius-lg，bg surface-1）
        ├── .topbar（品牌 VoiceCanvas + 连接状态 pill + 当前模式）
        └── .content（padding 16–18px）
              ├── .workspace-split（grid: 320px | 1fr，gap 14px）
              │     ├── .panel.card（语音侧栏，module-voice 色带）
              │     └── .screen.card（画布区，按模式换 module 色带）
              └── 卡片内部：section-title + bordered boxes，无 box-shadow
```

---

## 四、组件规范

| 组件 | 规则 |
|------|------|
| **卡片 .card** | 白底 surface-2，1px 黑描边，圆角 6–8px，**无阴影** |
| **色带 .card-strip** | 顶部 4px 实色条，标识模块 |
| **Pill .pill** | 描边 1px 黑，圆角 999px，padding 4px 10px，字号 12px |
| **状态 listening** | 天蓝底 accent-soft + 黑描边，mic 环轻微 scale 动画 |
| **文本框** | surface-3 底 + 黑描边，等宽字体显示识别/反馈 |
| **画布区** | 浅底 #fffdf9，内嵌 1px 黑框，占满剩余高度 |
| **九宫格** | 格线黑色 1px，选中格 duck-yellow 描边 2px |
| **链接** | 文字下划线，hover 变 brand2，不用纯蓝默认链 |

---

## 五、交互与动效

- 过渡 150–220ms，`var(--ease-out)`
- 聆听脉冲：仅 scale 1→1.06，不用 glow 阴影
- 禁止 framer-motion 大面积入场动画

---

## 六、VoiceCanvas 页面模块映射

| 视图 | 色带 | 顶栏文案 |
|------|------|----------|
| 自由画布 | --module-draw | 自由画布 |
| 九宫格 | --module-grid | 九宫格画布 |
| 3D | --module-3d | 3D 创作 |
| 语音侧栏 | --module-voice | 语音控制 |

---

## 七、给 AI 的实现清单

实现或改版时请确认：

1. 使用 CSS 变量，不硬编码深色 `#16162a` 类背景
2. 移除 emoji 图标，改用 inline SVG（麦克风、状态点）
3. 侧栏与画布同处 `.frame` 内，评委一眼看到「语音 + 作品」
4. Fabric 画布背景 `#ffffff`，与外壳奶油色有层次
5. 保持纯语音：侧栏无按钮，仅状态只读

---

## 八、英文短版（给国际模型）

```
VoiceCanvas UI: warm neo-brutalist light theme. Cream bg #f5f0e8, 1px #1a1a1a borders, no shadows. Sky blue #a5d8ff accents, duck yellow #ffde00 highlights. DM Sans + JetBrains Mono. Centered frame max-width 1200px: topbar + split (voice panel | canvas). Cards with 4px module color strips. No purple gradients, no glassmorphism, no emoji icons. Voice-only sidebar (read-only status).
```
