# Harness 项目约束

> Last Updated: 2026-04-06T04:27:18.000Z

## Technology Summary
- 包名：harness-runner
- 包管理器：npm
- 主要语言：TypeScript
- TypeScript 目标版本：ES2022
- TypeScript 模块格式：Node16
- 已启用 TypeScript strict 模式
- 源码主根目录：src
- 构建入口为 src/extension.ts，产物输出到 dist/extension.js
- ESLint 配置文件：eslint.config.mjs
- VS Code 扩展在 onStartupFinished 激活，并通过 Alt+R 打开命令菜单

## Build Commands
- npm run compile
- npm run package
- npm run vscode:prepublish
- npm run package:vsix

## Test Commands
- npm run test
- npm run pretest
- npm run compile-tests

## Lint Commands
- npm run lint
- npm run check-types

## Style Rules
- 保持 TypeScript strict 模式兼容，不要通过关闭类型检查或引入宽泛 any 来规避约束
- 源码文件应保持在 src/ 下，测试优先放在 src/test/ 或现有测试结构中
- 遵循 eslint.config.mjs 中的规则：导入命名保持 camelCase 或 PascalCase，并兼容 curly、eqeqeq、no-throw-literal 与 semi 约束
- 优先做小而聚焦的模块化修改，避免继续无界扩张像 extension.ts 这类已经较大的入口文件
- 涉及用户可见文案时，同步维护 package.nls.json 与 package.nls.zh-cn.json 的对应键值

## Git Rules
- 完成用户故事并准备 Git 提交时，提交标题和描述必须使用中文。
- 在已检测到 Git 仓库且启用自动提交的前提下，实现类故事应在故事内完成对应提交，不要额外拆分单独的 Git 提交故事。

## Architecture Rules
- 将可复用逻辑放到职责明确的独立模块中，避免在多个文件中复制相同实现
- extension.ts 主要承担扩展激活、命令注册和运行编排；可复用实现应优先下沉到 src/ 下的专用模块
- src 是主源码根目录，当前子目录包含 test，顶层其余 TypeScript 模块共同构成扩展运行时能力
- 菜单、状态栏、命令路由、本地化与帮助文档属于同一产品面，改动其中一项时要同步检查 package.json、localization.ts、helpManual.ts、README.md 与相关测试
- 构建产物 dist/extension.js 由 esbuild.js 生成，除非任务明确要求，否则不要把 dist/ 作为手工实现主位置

## Allowed Paths
- src/**
- src/test/**
- images/**
- README.md
- CHANGELOG.md
- package.json
- package.nls.json
- package.nls.zh-cn.json
- eslint.config.mjs
- tsconfig.json
- esbuild.js
- .vscodeignore
- .gitignore

## Forbidden Paths
- 不要直接编辑 node_modules/ 下的依赖代码
- 除非任务明确要求，否则不要手工修改 dist/ 产物文件
- 除非任务明确要求，否则不要手工修改 out/ 产物文件
- 除非任务明确要求，否则不要随意改写 .vscode-test/ 这类工具目录
- 除非任务明确要求生成或追加用户故事，否则不要修改 prd.json
- 除项目约束、memory、checkpoint、evidence 等明确产物流程外，不要随意改写 .harness-runner/ 运行状态文件

## Reuse Hints
- 新增能力前优先复用 src/ 下现有工具、共享类型和配置模式，不要平行复制一套新实现
- 修改菜单、状态栏或命令行为时，优先沿用现有 command id、菜单路由和状态栏更新机制
- 变更用户可见行为前，先核对 README.md、src/helpManual.ts、package.nls.json、package.nls.zh-cn.json 与 src/test/extension.test.ts 中的现有约束和示例
- 引入行为变化时补充或扩展聚焦测试，优先放在 src/test/extension.test.ts 或对应测试附近
- 构建、打包和发布流程优先复用 package.json 里的现有 npm scripts 与 esbuild.js，不要额外引入新的打包链路

## Delivery Checklist
- npm run lint
- npm run check-types
- npm run compile
- npm run test
- npm run package
- npm run vscode:prepublish
