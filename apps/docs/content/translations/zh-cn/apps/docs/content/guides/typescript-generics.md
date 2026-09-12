# React TypeScript 类型

AIMarkdownProps<TMetadata> 的泛型用于描述传递给自定义渲染器的元数据。组件通过 props 推断数据类型，读取方用对应的 useAIMarkdownMetadata<T>()。

## 保留泛型关系

编写包装器时保留 TMetadata 与基础 props 的联系，不要把所有数据降为 any，也不要在包装后丢掉元数据类型。Mantine 使用自己的扩展元数据类型，并继承 React 属性。

类型断言不验证运行时数据。外部响应必须由应用校验；没有元数据时 Hook 可返回 undefined，需要显式处理。

## 组件与扩展组

customComponents 使用 AIMarkdownCustomComponents，Typography 与 ExtraStyles 有独立的组件/属性类型。React 的状态和行为扩展组可通过声明合并为集成包提供窄 Hook，但组名是共享命名空间，必须避免冲突。

defineTheme、defineBehaviors、definePipeline 和 defineMantineBehaviors 提供冻结的类型化属性片段。它们不执行数据转换，也不自动 memo 每次调用。

包装器与声明合并的完整范例见[英文类型指南](english:docs/guides/typescript-generics/)及[开发 React 集成](extending-via-subpackage.md)。
