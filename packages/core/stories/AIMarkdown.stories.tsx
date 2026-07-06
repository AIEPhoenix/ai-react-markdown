import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import AIMarkdown from '../src/index';
import 'katex/dist/katex.min.css';
import '../src/components/typography/variants/all.scss';
import { withThemedBackground } from './decorators';
import { useStreamedContent } from './streamingHelpers';
import { StreamingPlayground } from './streaming/StreamingPlayground';
import { BlockMemoComparison } from './streaming/BlockMemoComparison';
import { IsolatedComparison } from './streaming/IsolatedComparison';
import { IsolatedSide } from './streaming/IsolatedSide';
import { DEFAULT_PAYLOAD } from './streaming/scenarios';
import { getStreamingTheme } from './streaming/theme';

const meta: Meta<typeof AIMarkdown> = {
  title: 'Core/AIMarkdown',
  component: AIMarkdown,
  argTypes: {
    content: { control: 'text', description: 'Raw markdown content to render.' },
    streaming: { control: 'boolean', description: 'Whether content is actively being streamed.' },
    fontSize: { control: 'text', description: 'Base font size (e.g. `"0.9375rem"`, `"14px"`, or a number for px).' },
    variant: { control: 'select', options: ['default'], description: 'Typography variant name.' },
    colorScheme: { table: { disable: true } },
    config: {
      control: 'object',
      description: 'Partial render config, deep-merged with defaults. Array values are replaced entirely.',
    },
    metadata: { control: 'object', description: 'Arbitrary data passed to custom components via context.' },
    contentPreprocessors: { table: { disable: true } },
    customComponents: { table: { disable: true } },
    Typography: { table: { disable: true } },
    ExtraStyles: { table: { disable: true } },
    defaultConfig: { table: { disable: true } },
  },
  decorators: [withThemedBackground],
  render: (args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    return <AIMarkdown {...args} colorScheme={currentTheme} />;
  },
};

export default meta;
type Story = StoryObj<typeof AIMarkdown>;

export const Default: Story = {
  args: {
    content: '',
  },
};

export const Streaming: Story = {
  args: {
    content:
      '<thinking>我们被要求思考斐波那契数的实现过程。斐波那契数列的定义是：F(0)=0, F(1)=1, 对于n>=2，F(n)=F(n-1)+F(n-2)。有多种方法可以实现斐波那契数的计算，包括递归、迭代、矩阵快速幂、通项公式等。我们需要讨论这些方法的优缺点，可能还需要考虑时间复杂度和空间复杂度。\n\n由于用户只说了“思考一下斐波拉契数的实现过程”，我们需要给出一个全面的回答，可能包括不同的实现方法及其分析。\n\n我将用中文回答，因为用户的问题是中文的。\n\n首先，斐波那契数列是一个经典的数列，在计算机科学中常被用来演示算法和优化。以下是一些常见的实现方法：\n\n1. **递归实现**：直接根据定义递归地计算F(n)。这种方法简单直观，但效率极低，因为它会产生大量的重复计算。时间复杂度为O(2^n)，空间复杂度为O(n)（递归栈深度）。\n\n2. **记忆化递归（动态规划）**：使用一个数组或哈希表来存储已经计算过的斐波那契数，避免重复计算。时间复杂度为O(n)，空间复杂度为O(n)。\n\n3. **迭代实现（动态规划）**：使用循环从底向上计算，只保留前两个值。时间复杂度为O(n)，空间复杂度为O(1)（只存储两个变量）。\n\n4. **矩阵快速幂**：利用矩阵乘法可以将斐波那契数的计算转化为矩阵的幂运算。通过快速幂算法，可以在O(log n)时间内计算F(n)。空间复杂度为O(1)（存储矩阵）。\n\n5. **通项公式（比内公式）**：斐波那契数有通项公式：F(n) = (φ^n - ψ^n)/√5，其中φ=(1+√5)/2，ψ=(1-√5)/2。由于浮点数精度问题，对于较大的n可能不准确。时间复杂度取决于幂运算，通常为O(log n)（使用快速幂），但可能有精度误差。\n\n6. **其他方法**：如使用生成函数、递推关系等。\n\n在编程中，根据n的大小和对精度、性能的要求选择合适的方法。对于小n，递归或迭代都可以；对于大n，矩阵快速幂或通项公式更高效。\n\n此外，还需要注意整数溢出问题，当n很大时，斐波那契数可能超过整数范围，需要使用大整数运算。\n\n现在，我可以给出一个详细的回答，涵盖这些方法，并讨论它们的优缺点。\n\n由于用户没有指定n的范围或其他要求，我将提供一个全面的分析。\n\n最后，我将用中文总结。\n</thinking>\n\n>>>I\'ll create a simple Electron + Vue chat application demo. Here\'s the structure:\n\n[Star on GitHub](https://github.com/Simon-He95/markstream-vue)\n\n<a href="https://simonhe.me/">我是 a 元素标签</a>\n\nhttps://github.com/Simon-He95/markstream-vue\n\n[【Author: Simon】](https://simonhe.me/)\n\n- **[Link (Test 1)](https://simonhe.me/)**\n\n**[Link (Test 2)](https://simonhe.me/)**\n\n**Markdown链接**：  \n1. [GitHub官网](https://github.com)  \n2. [知乎 - 有问题就会有答案](https://www.zhihu.com)  \n3. **加粗链接**：[Google](https://www.google.com)  \n4. 嵌套格式的链接：[*斜体链接*](https://example.com)  \n\n**普通链接**：  \n1. https://www.wikipedia.org  \n2. http://example.com/path?query=test  \n3. 纯文本URL：https://markdown-guide.readthedocs.io\n\n![Vue Markdown Icon](/vue-markdown-icon.svg "Vue Markdown Icon")\n*Figure: Vue Markdown Icon (served from /vue-markdown-icon.svg)*\n\n这是 ~~已删除的文本~~，这是一个表情 :smile:。\n\n- [ ] Star this repo\n- [x] Fork this repo\n- [ ] Create issues\n- [x] Submit PRs\n\n##  表格\n\n| 姓名 | 年龄 | 职业 |\n|------|------|------|\n| 张三 | 25   | 工程师 |\n| 李四 | 30   | 设计师 |\n| 王五 | 28   | 产品经理 |\n\n### 对齐表格\n| 左对齐 | 居中对齐 | 右对齐 |\n|:-------|:--------:|-------:|\n| 内容1  |  内容2   |  内容3 |\n| 内容4  |  内容5   |  内容6 |\n\n我将为您输出泰勒公式的一般形式及其常见展开式。\n\n---\n\n## 0. 薛定谔方程（量子力学）\n$$i\\hbar \\frac{\\partial}{\\partial t} \\Psi(\\mathbf{r},t) = \\left[ -\\frac{\\hbar^2}{2m} \\nabla^2 + V(\\mathbf{r},t) \\right] \\Psi(\\mathbf{r},t)$$\n\n\n## 1. 泰勒公式（Taylor\'s Formula）\n\n### 一般形式（在点 \\(x = a\\) 处展开）：\n[\nf(x) = f(a) + f\'(a)(x-a) + \frac{f\'\'(a)}{2!}(x-a)^2 + \frac{f\'\'\'(a)}{3!}(x-a)^3 + cdots + \frac{f^{(n)}(a)}{n!}(x-a)^n + R_n(x)\n\\]\n\n其中：\n- \\(f^{(k)}(a)\\) 是 \\(f(x)\\) 在 \\(x=a\\) 处的 \\(k\\) 阶导数\n- \\(R_n(x)\\) 是余项，常见形式有拉格朗日余项：\n[\nR_n(x) = \frac{f^{(n+1)}(xi)}{(n+1)!}(x-a)^{n+1}, quad xi \text{ 在 } a \text{ 和 } x \text{ 之间}\n\\]\n\n---\n\n## 2. 麦克劳林公式（Maclaurin\'s Formula，即 \\(a=0\\) 时的泰勒公式）：\n[\nf(x) = f(0) + f\'(0)x + \frac{f\'\'(0)}{2!}x^2 + \frac{f\'\'\'(0)}{3!}x^3 + cdots + \frac{f^{(n)}(0)}{n!}x^n + R_n(x)\n\\]\n\n---\n\n## 3. 常见函数的麦克劳林展开（前几项）\n\n- **指数函数**：\n\\[\ne^x = 1 + x + \frac{x^2}{2!} + \frac{x^3}{3!} + cdots + \frac{x^n}{n!} + cdots, quad x in mathbb{R}\n\\]\n\n- **正弦函数**：\n\\[\nsin x = x - \frac{x^3}{3!} + \frac{x^5}{5!} - \frac{x^7}{7!} + cdots + (-1)^n \frac{x^{2n+1}}{(2n+1)!} + cdots\n\\]\n\n- **余弦函数**：\n\\[\ncos x = 1 - \frac{x^2}{2!} + \frac{x^4}{4!} - \frac{x^6}{6!} + cdots + (-1)^n \frac{x^{2n}}{(2n)!} + cdots\n\\]\n\n- **自然对数**（在 \\(x=0\\) 附近）：\n\\[\nln(1+x) = x - \frac{x^2}{2} + \frac{x^3}{3} - \frac{x^4}{4} + cdots + (-1)^{n-1} \frac{x^n}{n} + cdots, quad -1 < x le 1\n\\]\n\n- **二项式展开**（\\( (1+x)^m \\)，\\(m\\) 为实数）：\n[\n(1+x)^m = 1 + mx + \frac{m(m-1)}{2!}x^2 + \frac{m(m-1)(m-2)}{3!}x^3 + cdots, quad |x| < 1\n\\]\n\n- **矩阵**：\n\\[\n\begin{bmatrix}\n2x_2 - 8x_3 = 8 \\\n5x_1 - 5x_3 = 10\nend{bmatrix}\n\\]\n\n- **公式**\n\n\n- **代入数据**\n   \\[\n   \frac{363}{15,!135} \times 100% = 2.398%\n   \\]\n\n- **计算工具验证**\n   通过数学计算工具确认结果：\n   `363 ÷ 15,135 × 100 = 2.39841427...`\n\n- **差异说明**\n   $$E=mc^2$$\n\n---\n\n如果您需要某个特定函数在特定点的泰勒展开，请告诉我，我可以为您详细写出。\n\n::: warning\n这是一个警告块。\n:::\n\n::: tip 提示标题\n这是带标题的提示。\n:::\n\n::: error 错误块\n这是一个错误块。\n:::\n\nمرحبا بكم في عالم اللغة العربية!\n\n```plaintext\npackages/\n```\n\n1. First, let\'s set up the project:\n\n```shellscript\n# Create Vue project\nnpm create vue@latest electron-vue-chat\n\n# Navigate to project\ncd electron-vue-chat\n\n# Install dependencies\nnpm install\nnpm install electron electron-builder vue-router\n\n# Install dev dependencies\nnpm install -D electron-dev-server concurrently wait-on\n```\n\n2. Create the main Electron file:\n\n```javascript:electron/main.js\nconst { app, BrowserWindow } = require(\'electron\');\nconst path = require(\'path\');\nconst isDev = process.env.NODE_ENV === \'development\';\n\nlet mainWindow;\n\nfunction createWindow() {\n  mainWindow = new BrowserWindow({\n    width: 900,\n    height: 680,\n    webPreferences: {\n      nodeIntegration: true,\n      contextIsolation: false\n    }\n  });\n\n  const url = isDev\n    ? \'http://localhost:5173\'\n    : `file://${path.join(__dirname, \'../dist/index.html\')}`;\n\n  mainWindow.loadURL(url);\n\n  if (isDev) {\n    mainWindow.webContents.openDevTools();\n  }\n\n  mainWindow.on(\'closed\', () => {\n    mainWindow = null;\n  });\n}\n\napp.on(\'ready\', createWindow);\n\napp.on(\'window-all-closed\', () => {\n  if (process.platform !== \'darwin\') {\n    app.quit();\n  }\n});\n\napp.on(\'activate\', () => {\n  if (mainWindow === null) {\n    createWindow();\n  }\n});\n```\n\n3. Update package.json:\n\n```diff json:package.json\n{\n  "name": "markstream-vue",\n  "type": "module",\n- "version": "0.0.49",\n+ "version": "0.0.54-beta.1",\n  "packageManager": "pnpm@10.16.1",\n  "description": "A Vue 3 component that renders Markdown string content as HTML, supporting custom components and advanced markdown features.",\n  "author": "Simon He",\n  "license": "MIT",\n  "repository": {\n    "type": "git",\n    "url": "git + git@github.com:Simon-He95/markstream-vue.git"\n  },\n  "bugs": {\n    "url": "https://github.com/Simon-He95/markstream-vue/issues"\n  },\n  "keywords": [\n    "vue",\n    "vue3",\n    "markdown",\n    "markdown-to-html",\n    "markdown-renderer",\n    "vue-markdown",\n    "vue-component",\n    "html",\n    "renderer",\n    "custom-component"\n  ],\n  "exports": {\n    ".": {\n      "types": "./dist/types/exports.d.ts",\n      "import": "./dist/index.js",\n      "require": "./dist/index.cjs"\n    },\n    "./index.css": "./dist/index.css",\n    "./index.tailwind.css": "./dist/index.tailwind.css",\n    "./tailwind": "./dist/tailwind.ts"\n  },\n  "main": "./dist/index.js",\n  "module": "./dist/index.js",\n  "types": "./dist/types/exports.d.ts",\n  "files": [\n    "dist"\n  ],\n}\n```\n\n4. Create chat components \\(diversified languages\\):\n\n```python:src/server/app.py\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass Message(BaseModel):\n    sender: str\n    text: str\n\n@app.get("/health")\ndef health():\n    return {"status": "ok"}\n\n@app.post("/echo")\ndef echo(msg: Message):\n    return {"reply": f"Echo: {msg.text}"}\n```\n\n5. Create a native module example (C++):\n\n```cpp:src/native/compute.cpp\n#include <bits/stdc++.h>\nusing namespace std;\n\nint fibonacci(int n){\n  if(n<=1) return n;\n  int a=0,b=1;\n  for(int i=2;i<=n;++i){ int c=a+b; a=b; b=c; }\n  return b;\n}\n\nint main(){\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  cout << "fib(10)=" << fibonacci(10) << "\n";\n  return 0;\n}\n```\n\n6. Update the main App.vue:\n\n```vue:src/App.vue\n<template>\n  <router-view />\n</template>\n\n<style>\n* {\n  margin: 0;\n  padding: 0;\n  box-sizing: border-box;\n}\n\nbody {\n  font-family: Arial, sans-serif;\n}\n</style>\n```\n\n7. Set up the router:\n\n```javascript:src/router/index.js\nimport { createRouter, createWebHistory } from \'vue-router\';\nimport ChatView from \'../views/ChatView.vue\';\n\nconst routes = [\n  {\n    path: \'/\',\n    name: \'chat\',\n    component: ChatView\n  }\n];\n\nconst router = createRouter({\n  history: createWebHistory(),\n  routes\n});\n\nexport default router;\n```\n\n8. Update main.js:\n\n```javascript:src/main.js\nimport { createApp } from \'vue\';\nimport App from \'./App.vue\';\nimport router from \'./router\';\n\ncreateApp(App).use(router).mount(\'#app\');\n```\n\n9. Mermaid graphic:\n\n```mermaid\ngraph TD\n    Kira_Yamato[基拉·大和]\n    Lacus_Clyne[拉克丝·克莱因]\n    Athrun_Zala[阿斯兰·萨拉]\n    Cagalli_Yula_Athha[卡嘉莉·尤拉·阿斯哈]\n    Shinn_Asuka[真·飞鸟]\n    Lunamaria_Hawke[露娜玛丽亚·霍克]\n    COMPASS[世界和平监视组织COMPASS]\n    Foundation[芬德申王国]\n    Orphee_Lam_Tao[奥尔菲·拉姆·陶]\n    %% 节点定义结束，开始定义边\n    Kira_Yamato ---|恋人| Lacus_Clyne\n    Kira_Yamato ---|挚友| Athrun_Zala\n    Kira_Yamato -->|隶属| COMPASS\n    Kira_Yamato -->|前辈| Shinn_Asuka\n    Lacus_Clyne -->|初代总裁| COMPASS\n    Athrun_Zala ---|恋人| Cagalli_Yula_Athha\n    Athrun_Zala -.->|协力| COMPASS\n    Shinn_Asuka ---|恋人| Lunamaria_Hawke\n    Shinn_Asuka -->|隶属| COMPASS\n    Lunamaria_Hawke -->|隶属| COMPASS\n    COMPASS -->|对立| Foundation\n    Orphee_Lam_Tao -->|隶属| Foundation\n    Orphee_Lam_Tao -.->|追求| Lacus_Clyne\n```\n\n```mermaid\n  xychart\n    title "销售收入"\n    x-axis ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"]\n    y-axis "收入" 4000 --> 11000\n    line [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]\n```\n\n```infographic\ninfographic list-row-simple-horizontal-arrow\ndata\n  items\n    - label 步骤 1\n      desc 开始\n    - label 步骤 2\n      desc 进行中\n    - label 步骤 3\n      desc 完成\n```\n\n\n---\n# 复杂数学公式\n\n### 1. **理解 \\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 的含义**\n   - \\(\boldsymbol{alpha}\\) 和 \\(\boldsymbol{\beta}\\) 是三维列向量，因此 \\(\boldsymbol{alpha}^T \boldsymbol{\beta}\\) 表示它们的点积（内积）。\n   - \\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 意味着向量 \\(\boldsymbol{alpha}\\) 和 \\(\boldsymbol{\beta}\\) 正交（即垂直），因为点积为零表示它们之间的夹角为 90 度。\n\n### 2. **正交补空间的概念**\n   - 在线性代数中，对于一个子空间 \\(W\\)，它的正交补空间（记为 \\(W^perp\\)）定义为所有与 \\(W\\) 中每个向量正交的向量的集合。即：\n     [\n     W^perp = { mathbf{v} in mathbb{R}^3 mid mathbf{v} cdot mathbf{w} = 0 \text{ 对于所有 } mathbf{w} in W }\n     ]\n   - 例如，如果 \\(W\\) 是由一个向量 \\(\boldsymbol{alpha}\\) 张成的一维子空间（即 \\(W = operatorname{span}{\boldsymbol{alpha}}\\)），那么 \\(W^perp\\) 就是所有与 \\(\boldsymbol{alpha}\\) 正交的向量构成的二维平面。\n### 3. **\\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 与正交补空间的联系**\n   - 当 \\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 时，这意味着：\n     - \\(\boldsymbol{\beta}\\) 属于 \\(operatorname{span}{\boldsymbol{alpha}}\\) 的正交补空间，即 \\(\boldsymbol{\beta} in (operatorname{span}{\boldsymbol{alpha}})^perp\\)。\n     - 同样，\\(\boldsymbol{alpha}\\) 也属于 \\(operatorname{span}{\boldsymbol{\beta}}\\) 的正交补空间，即 \\(\boldsymbol{alpha} in (operatorname{span}{\boldsymbol{\beta}})^perp\\)。\n   - 换句话说，\\(\boldsymbol{\beta}\\) 与 \\(\boldsymbol{alpha}\\) 张成的直线正交，因此 \\(\boldsymbol{\beta}\\) 位于该直线的垂直平面（即正交补空间）上。反之亦然。\n\n### 4. **在三维空间中的几何意义**\n   - 在三维空间中，如果 \\(\boldsymbol{alpha}\\) 是一个非零向量，那么 \\(operatorname{span}{\boldsymbol{alpha}}\\) 是一条通过原点的直线，而它的正交补空间 \\((operatorname{span}{\boldsymbol{alpha}})^perp\\) 是一个通过原点且与该直线垂直的平面。\n   - \\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 表示 \\(\boldsymbol{\beta}\\) 位于这个垂直平面上。同样，如果 \\(\boldsymbol{\beta}\\) 非零，那么 \\(\boldsymbol{alpha}\\) 也位于与 \\(\boldsymbol{\beta}\\) 垂直的平面上。\n\n### 5. **推广到更一般的情况**\n   - 如果考虑多个向量，正交补空间的概念可以扩展。例如，如果有一组向量 \\({\boldsymbol{alpha}_1, \boldsymbol{alpha}_2, ldots, \boldsymbol{alpha}_k}\\)，那么它们的张成子空间 \\(W = operatorname{span}{\boldsymbol{alpha}_1, ldots, \boldsymbol{alpha}_k}\\) 的正交补空间 \\(W^perp\\) 包含所有与这些向量正交的向量。\n   - 在这种情况下，\\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 可以看作 \\(\boldsymbol{\beta}\\) 与 \\(W\\) 正交的一个特例（当 \\(W\\) 只由 \\(\boldsymbol{alpha}\\) 张成时）。\n总之，\\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 直接体现了正交补空间的关系：它表明一个向量属于另一个向量张成子空间的正交补空间。如果你有更多向量或子空间，这种联系可以进一步深化。\n\n**示例：** emm`1-(5)`、`3-(3)`、`3-(4)` complex test `1-(4)`”heiheihei”中，hello world。\n\n---\n\n## Blockquote\n\n> This is a blockquote with **bold**, *italic*, and `inline code`.\n>\n> > Nested blockquotes work too.\n\n## Heading Levels\n\n### Heading 3\n#### Heading 4\n##### Heading 5\n###### Heading 6\n\n## Inline Elements\n\nText with ==highlighted text==, <sub>subscript</sub> and <sup>superscript</sup>, and <ins>inserted text</ins>.\n\nUse `npm install` to install dependencies. The `--save-dev` flag marks it as a dev dependency.\n\n## Definition List\n\nToken System\n: A set of CSS custom properties that define colors, spacing, typography, and other visual attributes.\n\nDesign Token\n: An individual variable (e.g., `--ms-foreground`) that can be overridden to customize the theme.\n\n## Footnotes\n\nThe design token system[^1] enables full theme customization.\n\n[^1]: See `design/architecture.md` for the complete token specification.\n\n::: note\nThis is a note admonition for additional context.\n:::\n\n::: danger\nThis is a danger admonition for critical warnings.\n:::\n\n## Image\n\n![Vue Logo](https://vuejs.org/images/logo.png)',
    fontSize: '',
  },
  argTypes: {
    streaming: { table: { disable: true } },
  },
  parameters: {
    controls: { exclude: ['streaming'] },
  },
  render: (args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    const theme = getStreamingTheme(currentTheme);
    // Storybook `render` is a function-typed slot, not a React component named
    // with an uppercase or `use*` identifier — but Storybook calls it inside a
    // component context, so Hook usage is legitimate. Suppress the false
    // positive from rules-of-hooks for this pattern.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { content, streaming, restart } = useStreamedContent(args.content ?? '', {
      chunkSizeMin: 2,
      chunkSizeMax: 8,
      chunkDelayMin: 15,
      chunkDelayMax: 60,
    });
    return (
      <div style={{ color: theme.text }}>
        <button
          onClick={restart}
          style={{
            background: streaming ? 'transparent' : theme.primaryBg,
            border: `1px solid ${streaming ? theme.buttonBorder : theme.primaryBg}`,
            borderRadius: 6,
            color: streaming ? theme.buttonText : theme.primaryText,
            cursor: 'pointer',
            font: 'inherit',
            marginBottom: 12,
            padding: '4px 12px',
          }}
        >
          {streaming ? 'Streaming…' : 'Restart'}
        </button>
        <AIMarkdown {...args} content={content} streaming={streaming} colorScheme={currentTheme} />
      </div>
    );
  },
};

export const StreamingStress: Story = {
  args: {
    content:
      '# Markdown 脚注功能测试文档\n\n这是一个用于验证编辑器是否支持脚注（Footnotes）语法的测试文档。\n\n## 一、 基础引用\n这里是一个简单的脚注引用[^1]。\n这里是一个使用文本作为标识符的脚注引用[^ref]。\n\n## 二、 连续引用与重复引用\n脚注标识符不一定要按数字顺序排列，渲染时通常会自动重新编号。\n这是第三个脚注[^3]。\n我们可以再次引用第一个脚注[^1]，大多数渲染器会正确指向同一个注释。\n\n## 三、 多行与复杂内容\n脚注内可以包含多段文字或代码块[^complex]。\n\n## 四、 列表中的应用\n* 列表项一 [^item-1]\n* 列表项二 [^item-2]\n\n---\n\n## 脚注定义区\n(通常建议放在文档末尾，但其实写在文档任何位置都可以)\n\n[^1]: 这是第一个脚注的简单描述。\n[^ref]: 脚注标识符可以使用字母或单词，但在预览中通常会被转换成数字。\n[^3]: 乱序编写的脚注定义。\n\n[^complex]: 这是复杂脚注的第一段。\n\n    这是复杂脚注的第二段，通过缩进（4个空格或1个制表符）来包含在同一个脚注中。\n    \n    ```python\n    def hello():\n        print("Hello from a footnote!")\n    ```\n\n[^item-1]: 关于列表项一的补充说明。\n[^item-2]: 关于列表项二的补充说明。',
  },
  argTypes: {
    content: {
      control: 'text',
      description: 'Markdown payload streamed by every scenario. Edit to test your own content.',
    },
    streaming: { table: { disable: true } },
  },
  parameters: {
    controls: { exclude: ['streaming'] },
  },
  render: (args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    return (
      <StreamingPlayground
        colorScheme={currentTheme}
        showProfiler={false}
        initialScenario="randomTokens"
        payload={args.content ?? DEFAULT_PAYLOAD}
      />
    );
  },
};

export const StreamingProfiler: Story = {
  args: {
    content: DEFAULT_PAYLOAD,
  },
  argTypes: {
    content: {
      control: 'text',
      description: 'Markdown payload streamed by every scenario. Edit to test your own content.',
    },
    streaming: { table: { disable: true } },
  },
  parameters: {
    controls: { exclude: ['streaming'] },
    layout: 'fullscreen',
  },
  render: (args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    return (
      <StreamingPlayground
        colorScheme={currentTheme}
        showProfiler
        initialScenario="ultraFast"
        payload={args.content ?? DEFAULT_PAYLOAD}
      />
    );
  },
};

/**
 * Side-by-side comparison of the same content streamed through both render
 * paths simultaneously. Left column has `blockMemoEnabled: true` (default);
 * right column has it explicitly disabled. Each column has its own
 * `<React.Profiler>` boundary measuring commit cost in isolation, plus a
 * summary banner that reports the cumulative commit-time savings.
 *
 * The realistic-LLM scenario (`randomTokens`, 2-8 char chunks every 15-60ms)
 * is the most representative of real chat-UI rendering pressure.
 */
export const BlockMemoCompare: Story = {
  args: {
    content: DEFAULT_PAYLOAD,
  },
  argTypes: {
    content: {
      control: 'text',
      description: 'Markdown payload streamed by every scenario. Edit to test your own content.',
    },
    streaming: { table: { disable: true } },
  },
  parameters: {
    controls: { exclude: ['streaming'] },
    layout: 'fullscreen',
  },
  render: (args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    return (
      <BlockMemoComparison
        colorScheme={currentTheme}
        initialScenario="randomTokens"
        payload={args.content ?? DEFAULT_PAYLOAD}
      />
    );
  },
};

/**
 * Process-ISOLATED variant of {@link BlockMemoCompare}: each side runs in a
 * cross-site iframe (`localhost` vs `127.0.0.1`), which Chrome's Site
 * Isolation places in separate renderer processes — no shared main thread,
 * GC, or frame loop between the sides, so fps / slow frames / long tasks
 * become genuinely per-side. See IsolatedComparison.tsx for the full
 * tradeoff notes. Keep both stories: same-page = fairest JS-layer A/B;
 * isolated = the only shape that answers per-side browser-level questions.
 */
export const BlockMemoCompareIsolated: Story = {
  args: {
    content: DEFAULT_PAYLOAD,
  },
  argTypes: {
    content: {
      control: 'text',
      description: 'Markdown payload streamed by every scenario. Edit to test your own content.',
    },
    streaming: { table: { disable: true } },
  },
  parameters: {
    controls: { exclude: ['streaming'] },
    layout: 'fullscreen',
  },
  render: (args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    return (
      <IsolatedComparison
        colorScheme={currentTheme}
        initialScenario="randomTokens"
        payload={args.content ?? DEFAULT_PAYLOAD}
      />
    );
  },
};

/**
 * One SIDE of {@link BlockMemoCompareIsolated} — loaded by that story's
 * iframes with config in the URL (`bmcMode` / `bmcSpy` / `bmcScheme`).
 * Also usable standalone to profile a single render path in isolation.
 */
export const BlockMemoSide: Story = {
  args: {
    content: '',
  },
  parameters: {
    controls: { disable: true },
    layout: 'fullscreen',
  },
  render: () => <IsolatedSide />,
};

export const CJKRenderErrorFix: Story = {
  args: {
    content:
      '这是一个**“会引起”**渲染错误的**“已知问题”**，当加重符号\\*\\*遇到某些中文标点时，可能就会出现**“识别不了”**的情况。就如这句话展现的一样。\n\n**このアスタリスクは強調記号として認識されず、そのまま表示されます。**この文のせいで。\n\n**该星号不会被识别，而是直接显示。**这是因为它没有被识别为强调符号。\n\n**이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)**이 문장 때문에.\n\n**~~このアスタリスクは強調記号として認識されず、そのまま表示されます。~~**この文のせいで。\n\n**~~该星号不会被识别，而是直接显示。~~**这是因为它没有被识别为强调符号。\n\n**~~이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)~~**이 문장 때문에.',
    fontSize: '',
  },
};
