# 从 ai-react-markdown 迁移到 ai-markdown

新组织支持共享引擎与多框架适配器。最重要的变化是旧 core 名称原本表示 React 渲染器，而新 core 是无框架编排层。

## 包与导入

| 旧应用用途                            | 新入口                                              |
| ------------------------------------- | --------------------------------------------------- |
| @ai-react-markdown/core 的 React 渲染 | @ai-markdown/react                                  |
| Mantine React 集成                    | @ai-markdown/react-mantine，并安装兼容 React 适配器 |
| Vue 应用                              | @ai-markdown/vue                                    |
| 通用会话与协调                        | @ai-markdown/core                                   |
| 解析与树算法                          | @ai-markdown/engine                                 |

同时检查 CSS 导入与插件子路径。React 插件位于 @ai-markdown/react/plugins；Vue 从根入口导出插件。只使用公开入口，不把内部 dist 路径替换成另一个内部路径。

## 框架边界

React 和 Vue 共享解析与贡献机制，不共享所有属性、上下文和缓存。Vue 使用 components/插槽、实时 getter 和 computed ref；React 使用 customComponents、Hooks 和 blockMemo。

## 验证迁移

重新安装并检查锁文件、peer、ESM/CJS、类型与样式。测试完整输入、流式追加、跨片段定义、SSR 与水合。服务器只看到本地定义，不应期待跨片段贡献已提交。

精确的旧包映射与预发布 API 差异见[英文迁移表](english:docs/guides/framework-transition/)。
