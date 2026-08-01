# Aurora Lift Design QA

- 设计目标：B 版 Aurora Lift，年轻化、强双层立体阴影、大圆角。
- 产品版本：ShellPilot `0.4.23`。
- 分支：`codex/ui-modernization`。
- 最终结果：passed。

## Visual evidence

- 新版页面截图：`F:\SSH工具开发\ui-modernization-worktree\release-verification\aurora-lift-2026-08-01`。
- 基线截图：`F:\SSH工具开发\ui-modernization-worktree\release-verification\aurora-ui-2026-08-01`。
- 同视口前后对照：`F:\SSH工具开发\ui-modernization-worktree\release-verification\aurora-lift-comparisons-2026-08-01`。
- 共捕获 20 张新版截图，均为 1920×1032；17 个页面完成基线与新版并排对照。
- 已人工检查全页面联系表和前后对照联系表，并抽查全部独立页面截图。

## Visual findings

- L3 页面容器、操作卡、弹层采用可见的双层强阴影和顶部高光；深色主题使用黑色深度阴影与紫色外环。
- 圆角层级统一为：小元素 10px、控件 14px、工具条 18px、卡片 22px、面板/弹层 28px。
- 表格行、日志行、文件行和终端字符画布保持平面层级，避免高密度区域堆叠阴影。
- Cloud Indigo、Graphite Night 及其余内置主题未发现内容裁切、阴影裁切、异常圆角、布局位移或新增横向溢出。
- 没有可执行的 P0、P1 或 P2 视觉问题。

## Automated visual matrix

- 尺寸矩阵：590×400、820×600、1100×700、1600×900。
- 缩放矩阵：100%、125%、150%。
- 语言矩阵：简体中文、英文。
- 主题矩阵：5 套主题，覆盖 590×400 与 1100×700。
- 共检查 408 个真实应用页面/弹层状态。
- `SECONDARY_VISUAL_FAILURES=0`。
- `SECONDARY_OVERFLOW_ADDED=0`。
- 焦点状态检查 408 项，禁用态对比度检查 312 项。

## Functional regression guardrail

- 全量单元测试：3071 项，3065 passed、0 failed、6 skipped。
- ESLint：passed。
- 生产编译：passed；仅有既有 chunk-size 警告。
- 适用的 Electron UI 回归及补充独立复验：passed。
- 外部 SFTP 用例未执行：当前环境未提供 `TEST_HOST`、`TEST_USER`、`TEST_PASS`。
- 故障档案备份用例未纳入 UI 判定：该测试调用当前 `0.4.23` 基线中不存在的 `createIncidentBackup` 接口；同文件其余 3 个故障档案流程均通过。

## UI-only audit

- 相对 Aurora Lift 调整前基线 `0975cc2`，生产代码变更仅包含主题 token 文件与 `.styl` 样式文件。
- 未修改功能组件 JSX、路由、API、状态模型、数据结构、快捷键、终端、SFTP、AI 或业务流程。
- 未使用文字阴影、位移或滤镜伪造立体效果；深度仅由边框、圆角、背景和 box-shadow 构成。

final result: passed
