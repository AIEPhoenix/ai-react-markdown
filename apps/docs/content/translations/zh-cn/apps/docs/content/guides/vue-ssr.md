# Vue SSR 与生命周期

使用同一份内容、配置和稳定文档身份生成服务端 HTML 与首帧客户端输出。Vue 3.5 的 useId 用于身份一致性，但宿主仍负责正确的渲染与水合流程。

## 服务端呈现

```ts
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import AIMarkdown from '@ai-markdown/vue';

const app = createSSRApp({
  render: () => h(AIMarkdown, { content: '# 你好', documentId: 'answer-1' }),
});
const html = await renderToString(app);
```

服务端使用完整解析。平滑组件的初始内容完整显示，不在水合时从空白回放。跨片段定义只在组件挂载并提交贡献后进入共享状态；不能把服务端输出当成已经协调完毕的整篇文档。

## 状态归属

每个组件持有自己的解析会话。文档容器拥有自己的 scope，不能在不同请求或无关消费者之间共享可变 session、registry 或 coordinator。树和引擎对象使用浅引用，避免深层 Vue 代理改变对象身份。

卸载时释放贡献、订阅、平滑控制器、光标观察器与动画帧；切换文档时也应清理旧身份。浏览器测量不能放进服务端渲染过程。

## 验证范围

已有验证覆盖 Vue SSR、水合和浏览器生命周期。Nuxt 专用打包、KeepAlive、Suspense 或其他宿主组合需要单独验证，不能由基础 Vue 支持推导出所有组合都已验证。

测试至少包括初始水合、追加、替换、晚到定义、文档切换与卸载。相关公共契约见 [Vue 参考](../reference/vue.md)和 [Core / Engine](api/core-engine-contracts.md)。
