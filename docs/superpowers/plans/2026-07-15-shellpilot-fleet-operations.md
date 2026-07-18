# ShellPilot Fleet Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ShellPilot 增加稳定的多服务器只读状态总览、服务自动发现选择器和 AI API/模型自动健康检测。

**Architecture:** 使用现有 Electerm 会话进程创建可取消的后台只读 SSH 采集任务，复用已有 `server-status` 探针、解析器和状态模型。渲染层新增独立的 fleet-status 工作区与小型 store，AI 健康检测由独立调度器维护，避免把网络副作用塞进展示组件。

**Tech Stack:** Electron 41、React 19、Manate、Ant Design 6、Stylus、`@electerm/ssh2`、Node test runner、Playwright。

---

## 文件结构

新增模块：

- `apps/electerm-agent/src/client/components/fleet-status/fleet-status-workspace.jsx`：状态总览页面组合层。
- `apps/electerm-agent/src/client/components/fleet-status/fleet-status-table.jsx`：服务器表格、选择和行操作。
- `apps/electerm-agent/src/client/components/fleet-status/fleet-status-toolbar.jsx`：筛选、刷新和批量只读操作。
- `apps/electerm-agent/src/client/components/fleet-status/fleet-service-selector.jsx`：服务自动发现、多选和结果入口。
- `apps/electerm-agent/src/client/components/fleet-status/fleet-status-store.js`：任务状态、缓存、取消和并发调度。
- `apps/electerm-agent/src/client/components/fleet-status/fleet-status-model.js`：快照与错误的标准化。
- `apps/electerm-agent/src/client/components/fleet-status/fleet-status.styl`：状态总览样式。
- `apps/electerm-agent/src/client/common/fleet-status-client.js`：渲染进程到本地服务的请求封装。
- `apps/electerm-agent/src/app/server/fleet-status-service.js`：后台 SSH 连接、探针执行和资源清理。
- `apps/electerm-agent/src/client/components/ai/ai-health-check.js`：AI 自动检测调度、错误分类和有效期。

修改模块：

- `apps/electerm-agent/src/client/components/sidebar/index.jsx`：增加“状态总览”图标。
- `apps/electerm-agent/src/client/components/main/main.jsx`：在 Layout 与状态总览间切换。
- `apps/electerm-agent/src/client/store/init-state.js`：增加 `mainWorkspaceMode`。
- `apps/electerm-agent/src/client/store/common.js`：增加打开和关闭状态总览的方法。
- `apps/electerm-agent/src/app/server/dispatch-center.js`：注册 fleet status 请求。
- `apps/electerm-agent/src/app/server/session-process.js`：提供后台会话显式关闭能力。
- `apps/electerm-agent/src/client/components/server-status/server-status-probes.js`：支持按层级和按选择执行探针。
- `apps/electerm-agent/src/client/components/side-panel-r/side-panel-r.jsx`：接入 AI 自动状态和立即检测入口。
- `apps/electerm-agent/src/client/components/ai/ai-profiles.js`：扩展状态字段和过期判断。
- `apps/electerm-agent/src/client/components/ai/ai-config.jsx`：复用健康检测并增加“检测全部模型”。
- `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`：新增中英文文案。
- `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`：补充状态总览和模型检测说明。

## Task 1: 稳定性基线与空数据保护

**Files:**
- Modify: `apps/electerm-agent/src/client/components/main/main.jsx`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/side-panel-r.jsx`
- Test: `apps/electerm-agent/test/unit-ci/aigshell-self-check-regressions.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-chat-stability-matrix.spec.js`

- [ ] **Step 1: 增加失败测试**

覆盖空 `currentTab`、空 AI 配置、空异步响应和组件卸载后返回结果，断言不得读取 `null.data`。

- [ ] **Step 2: 运行定向测试并确认失败**

Run: `cd apps/electerm-agent && node --test test/unit-ci/aigshell-self-check-regressions.spec.js test/unit-ci/ai-chat-stability-matrix.spec.js`

Expected: 新增空响应场景失败，现有场景继续通过。

- [ ] **Step 3: 增加响应规范化和卸载保护**

所有异步结果先经过以下形态再进入状态：

```js
export function normalizeAsyncResult (result) {
  if (result == null) return { ok: false, data: null, error: 'empty-response' }
  if (result.error) return { ok: false, data: result.data ?? null, error: result.error }
  return { ok: true, data: result.data ?? result, error: '' }
}
```

- [ ] **Step 4: 运行稳定性测试**

Run: `cd apps/electerm-agent && node --test test/unit-ci/aigshell-self-check-regressions.spec.js test/unit-ci/ai-chat-stability-matrix.spec.js`

Expected: PASS。

- [ ] **Step 5: 提交稳定性基线**

Commit: `fix: harden renderer empty async states`

## Task 2: 状态总览导航和工作区骨架

**Files:**
- Create: `apps/electerm-agent/src/client/components/fleet-status/fleet-status-workspace.jsx`
- Create: `apps/electerm-agent/src/client/components/fleet-status/fleet-status.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/index.jsx`
- Modify: `apps/electerm-agent/src/client/components/main/main.jsx`
- Modify: `apps/electerm-agent/src/client/store/init-state.js`
- Modify: `apps/electerm-agent/src/client/store/common.js`
- Test: `apps/electerm-agent/test/unit-ci/fleet-status-navigation.spec.js`

- [ ] **Step 1: 写导航状态失败测试**

断言“状态总览”位于“服务器”之前，点击后 `mainWorkspaceMode === 'fleet-status'`，返回终端后标签状态保持不变。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-navigation.spec.js`

Expected: FAIL，当前不存在 fleet status 导航。

- [ ] **Step 3: 增加工作区状态**

状态只允许两个值：

```js
mainWorkspaceMode: 'terminal'
```

Store 方法为 `openFleetStatus()` 和 `closeFleetStatus()`；不持久化该状态，应用重启默认进入终端。

- [ ] **Step 4: 接入左侧图标和中心工作区**

使用 Ant Design `DashboardOutlined`，标签为“状态总览”。状态总览打开时隐藏 `Layout` 的视觉输出但不销毁终端标签和会话。

- [ ] **Step 5: 运行导航测试和布局回归**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-navigation.spec.js test/unit-ci/aigshell-layout.spec.js`

Expected: PASS。

- [ ] **Step 6: 提交工作区骨架**

Commit: `feat: add fleet status workspace entry`

## Task 3: Fleet 快照模型和错误分类

**Files:**
- Create: `apps/electerm-agent/src/client/components/fleet-status/fleet-status-model.js`
- Test: `apps/electerm-agent/test/unit-ci/fleet-status-model.spec.js`

- [ ] **Step 1: 写模型失败测试**

覆盖正常、警告、严重、离线、取消、权限不足和不支持，验证空探针不会被标记为正常。

- [ ] **Step 2: 运行模型测试并确认失败**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-model.spec.js`

Expected: FAIL，模型模块不存在。

- [ ] **Step 3: 实现标准快照**

```js
export const emptyFleetSnapshot = Object.freeze({
  connection: { status: 'pending', latencyMs: null, error: '' },
  resources: { cpu: null, memory: null, disk: null, load: null, uptime: '' },
  services: [],
  network: { interfaces: [], defaultRoute: null, dns: [] },
  firewall: { provider: '', enabled: null },
  collectedAt: '',
  overallStatus: 'pending'
})
```

错误分类固定为 `timeout`、`auth`、`host-key`、`permission`、`unsupported`、`cancelled` 和 `unknown`。

- [ ] **Step 4: 运行模型测试**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-model.spec.js`

Expected: PASS。

- [ ] **Step 5: 提交快照模型**

Commit: `feat: define fleet status snapshot model`

## Task 4: 可取消后台 SSH 采集

**Files:**
- Create: `apps/electerm-agent/src/app/server/fleet-status-service.js`
- Create: `apps/electerm-agent/src/client/common/fleet-status-client.js`
- Modify: `apps/electerm-agent/src/app/server/dispatch-center.js`
- Modify: `apps/electerm-agent/src/app/server/session-process.js`
- Modify: `apps/electerm-agent/src/client/components/server-status/server-status-probes.js`
- Test: `apps/electerm-agent/test/unit-ci/fleet-status-collector.spec.js`

- [ ] **Step 1: 写并发、超时和取消失败测试**

使用 12 个模拟目标，断言最大同时执行数为 5；单台超时后其他结果仍返回；取消后未开始目标不连接，已启动后台会话全部关闭。

- [ ] **Step 2: 运行采集器测试并确认失败**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-collector.spec.js`

Expected: FAIL，采集器不存在。

- [ ] **Step 3: 增加后台会话生命周期接口**

`session-process.js` 增加：

```js
exports.closeTerminal = function (pid) {
  const entry = activeTerminals.get(pid)
  if (!entry) return false
  entry.child.kill()
  activeTerminals.delete(pid)
  return true
}
```

- [ ] **Step 4: 实现只读采集服务**

服务接收书签连接参数、探针层级、超时和任务 ID；复用会话进程完成 SSH 代理、私钥和跳板连接；在 `finally` 中关闭临时会话。返回值必须经过脱敏，不返回密码、私钥内容或 API Key。

- [ ] **Step 5: 注册请求和取消请求**

本地 action 固定为 `collect-fleet-status` 与 `cancel-fleet-status`。任务 ID 由渲染层生成，服务端维护 `AbortController` 映射。

- [ ] **Step 6: 运行采集器测试**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-collector.spec.js`

Expected: PASS，测试结束后活动临时会话数为 0。

- [ ] **Step 7: 提交后台采集器**

Commit: `feat: add cancellable fleet ssh collector`

## Task 5: 并发调度、缓存和状态表格

**Files:**
- Create: `apps/electerm-agent/src/client/components/fleet-status/fleet-status-store.js`
- Create: `apps/electerm-agent/src/client/components/fleet-status/fleet-status-toolbar.jsx`
- Create: `apps/electerm-agent/src/client/components/fleet-status/fleet-status-table.jsx`
- Modify: `apps/electerm-agent/src/client/components/fleet-status/fleet-status-workspace.jsx`
- Modify: `apps/electerm-agent/src/client/components/fleet-status/fleet-status.styl`
- Test: `apps/electerm-agent/test/unit-ci/fleet-status-store.spec.js`
- Test: `apps/electerm-agent/test/e2e/023.fleet-status.spec.js`

- [ ] **Step 1: 写调度与 UI 失败测试**

覆盖并发 5、缓存 60 秒、单台重试、取消、分组筛选、状态筛选、搜索和多选工具条。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-store.spec.js`

Expected: FAIL。

- [ ] **Step 3: 实现调度器**

Store 公开 `refreshAll()`、`refreshOne(bookmarkId)`、`cancel()`、`setFilters()` 和 `toggleSelected()`；同一书签在缓存有效期内共享 Promise，避免重复连接。

- [ ] **Step 4: 实现表格和批量只读工具条**

表格列与第一张预览一致；选择服务器后显示“检查服务、检查端口、收集日志、AI 批量诊断、导出报告”。本任务只接通“检查服务”和“AI 批量诊断”，其余按钮保持禁用并显示明确说明，不能伪装成已完成。

- [ ] **Step 5: 运行单元和 E2E 测试**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-store.spec.js && npx playwright test test/e2e/023.fleet-status.spec.js --workers=1`

Expected: PASS；1440×900、1920×1080 和 125% 缩放截图无重叠、竖排文字或横向截断。

- [ ] **Step 6: 提交状态总览主体**

Commit: `feat: build fleet status overview table`

## Task 6: 服务自动发现和多选查询

**Files:**
- Create: `apps/electerm-agent/src/client/components/fleet-status/fleet-service-selector.jsx`
- Modify: `apps/electerm-agent/src/client/components/server-status/server-status-probes.js`
- Modify: `apps/electerm-agent/src/client/components/server-status/server-status-parsers.js`
- Modify: `apps/electerm-agent/src/client/components/fleet-status/fleet-status-workspace.jsx`
- Test: `apps/electerm-agent/test/unit-ci/fleet-service-discovery.spec.js`
- Test: `apps/electerm-agent/test/e2e/024.fleet-service-selector.spec.js`

- [ ] **Step 1: 写服务发现失败测试**

准备 systemd、OpenRC、Docker、Supervisor 和 PM2 输出样本，断言名称准确、分组正确、状态可筛选且支持多选。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-service-discovery.spec.js`

Expected: FAIL。

- [ ] **Step 3: 拆分服务发现与详细查询**

发现阶段只读取服务清单；用户选择后才读取 `status`、最近日志、端口和进程，避免对所有服务逐个执行 `systemctl show`。

- [ ] **Step 4: 实现搜索、多选和只读动作**

默认显示“全部、运行中、已停止、异常”；提供“一键选择全部异常”。只读动作直接执行，不弹风险确认；高级命令预览默认折叠。

- [ ] **Step 5: 运行单元和 E2E 测试**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-service-discovery.spec.js && npx playwright test test/e2e/024.fleet-service-selector.spec.js --workers=1`

Expected: PASS。

- [ ] **Step 6: 提交服务选择器**

Commit: `feat: add discovered service multi-select workflow`

## Task 7: AI API 与模型自动健康检测

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/ai-health-check.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-profiles.js`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/side-panel-r.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Test: `apps/electerm-agent/test/unit-ci/ai-health-check.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-profiles.spec.js`

- [ ] **Step 1: 写健康状态失败测试**

覆盖未配置、检测中、接口可达、可用、鉴权失败、模型错误、配额错误、网络错误和状态过期；验证切换模型会取消上一检测。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/electerm-agent && node --test test/unit-ci/ai-health-check.spec.js test/unit-ci/ai-profiles.spec.js`

Expected: 新健康状态场景失败。

- [ ] **Step 3: 实现检测调度器**

调度器公开 `checkActiveModel(config, options)`、`cancel(profileId)` 和 `isStale(profile)`。同一配置指纹在 5 分钟内复用结果；切换配置或模型后 400ms 防抖检测。

- [ ] **Step 4: 实现两阶段检测**

先调用模型列表或兼容端点验证网络与鉴权；再只对当前模型发送最小请求。真实对话结果应调用同一错误分类器立即更新状态。

- [ ] **Step 5: 更新 AI 顶部状态 UI**

状态标签显示结果和延迟，例如“可用 86ms”；悬停显示配置名、模型、最后检测时间和脱敏错误；点击可立即重测。

- [ ] **Step 6: 增加受控批量检测**

API 设置中的“检测全部模型”并发上限为 2，可取消，不在打开设置时自动执行。

- [ ] **Step 7: 运行 AI 定向测试**

Run: `cd apps/electerm-agent && node --test test/unit-ci/ai-health-check.spec.js test/unit-ci/ai-profiles.spec.js test/unit-ci/ai-model-api-config-matrix.spec.js`

Expected: PASS，测试日志不包含 API Key。

- [ ] **Step 8: 提交 AI 健康检测**

Commit: `feat: auto-check active ai model health`

## Task 8: Fleet 与 AI 联动

**Files:**
- Create: `apps/electerm-agent/src/client/components/fleet-status/fleet-status-ai-context.js`
- Modify: `apps/electerm-agent/src/client/components/fleet-status/fleet-status-workspace.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-context-actions.js`
- Test: `apps/electerm-agent/test/unit-ci/fleet-status-ai-context.spec.js`

- [ ] **Step 1: 写脱敏和上下文限制失败测试**

断言 AI 上下文包含选中服务器的资源和异常服务，但不包含密码、API Key、私钥正文和完整历史日志。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-ai-context.spec.js`

Expected: FAIL。

- [ ] **Step 3: 实现结构化上下文**

上下文上限为 20 台服务器；超过时先按严重、警告、离线排序并提示用户缩小范围。单台只传摘要和用户主动选取的日志片段。

- [ ] **Step 4: 接通两个入口**

接通“分析异常服务器”和“对比选中服务器”。两者只填入 AI 上下文，不自动发送消息。

- [ ] **Step 5: 运行联动测试**

Run: `cd apps/electerm-agent && node --test test/unit-ci/fleet-status-ai-context.spec.js test/unit-ci/ai-chat-context-actions.spec.js`

Expected: PASS。

- [ ] **Step 6: 提交 AI 联动**

Commit: `feat: connect fleet snapshots to ai diagnostics`

## Task 9: 帮助、主题、完整回归和本地打包

**Files:**
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- Test: `apps/electerm-agent/test/unit-ci/help-center.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/real-server-smoke-script.spec.js`

- [ ] **Step 1: 更新帮助和文案测试**

帮助中心说明状态含义、刷新规则、服务多选、AI 检测费用提示、取消方式和隐私边界。

- [ ] **Step 2: 运行全部 unit-ci**

Run: `cd apps/electerm-agent && npm run test-unit-ci`

Expected: 全部 PASS。

- [ ] **Step 3: 执行视觉矩阵**

Run: `cd apps/electerm-agent && npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/023.fleet-status.spec.js test/e2e/024.fleet-service-selector.spec.js --workers=1`

Expected: 日间、夜间、1440×900、1920×1080 和 125% 缩放无布局回归。

- [ ] **Step 4: 执行真实服务器只读回归**

凭据只通过环境变量传入现有 smoke 脚本，不写入仓库。验证连接、状态采集、服务发现、取消和资源清理；不得执行修改命令。

- [ ] **Step 5: 本地打包和安装验收**

Run: `cd apps/electerm-agent && npm run compile && npm run prepare-file && npm run test-package-smoke`

Expected: 打包成功，安装版启动、状态总览、SSH、SFTP 和 AI 原有流程均可使用。

- [ ] **Step 6: 停止在本地验收门**

不修改版本号、不创建 tag、不上传发布资产。用户验收通过后再另建发布计划。

## 自检结果

- 需求覆盖：状态总览、服务自动发现、多选、API 自动检测、AI 联动、性能限制、取消和真实服务器回归均有独立任务。
- 安全边界：本计划只增加只读批量采集，不加入批量修复；敏感信息不进入快照和日志。
- 依赖顺序：稳定性与数据模型先于采集器，采集器先于 UI，AI 检测可在 UI 主体之后独立交付。
- 发布边界：计划明确停在本地安装包验收，不触发在线更新。
