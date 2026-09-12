# Vue 定制与样式

仅修改颜色、间距或外观时，优先使用 CSS、class 与 style。需要改变 HTML 元素的呈现行为时，使用 `components` 映射或同名元素插槽。

## 元素组件与插槽

元素插槽优先于 components 中同名项。插槽上下文提供 node、properties、已经转换的 children、streaming 和 metadata。映射组件接收清洗后的元素属性以及 node、streaming、metadata，子内容通过默认插槽传递。

```ts
import { defineComponent, h } from 'vue';
import AIMarkdown from '@ai-markdown/vue';

const AppLink = defineComponent({
  inheritAttrs: false,
  props: ['node', 'streaming', 'metadata'],
  setup(_props, { attrs, slots }) {
    return () => h('a', { ...attrs, class: 'answer-link' }, slots.default?.());
  },
});

const components = { a: AppLink };

export default defineComponent({
  setup() {
    return () => h(AIMarkdown, { content: '[Read more](https://example.com)', components });
  },
});
```

保留传入的 children 与必要属性，否则会丢失语义、链接和可访问性。node 是渲染用的 HAST 节点，不要修改共享解析结果。

## 元数据与光标

metadata 可向自定义元素传递应用数据。它不自动产生业务权限或安全保证。Vue 不提供 React 的元数据 Hooks。

cursor 插槽接收 `{ streaming: true }`，用于替换测量光标壳内部的内容；它不是普通元素插槽上下文。通过 `streamingCursor=false` 关闭光标。平滑组件的 waiting 插槽没有参数，用于等待前序片段时的占位。

## 样式与安全

导入 `@ai-markdown/vue/styles.css`；数学另需 KaTeX CSS。React typography 变量与 Mantine 组件不是 Vue API。自定义组件是受信任的应用代码，其输出不会重新经过 Markdown 清洗器；它创建的 URL 也需要应用策略。

完整属性与上下文类型见 [Vue API 参考](../reference/vue.md)。
