# 轮次五：异步状态、可观测性与资源生命周期自检

## 结论

本轮确认并修复五项实际问题：恢复提示错误地忽略主进程确认值、恢复加载失败完全不可见、MCP 监听器重复安装、SFTP 意外数据包重试分支永久不可达，以及 SFTP 卸载/重复调度漏清 timer 与 debounce。

问题的共同根因不是单个语法错误，而是异步操作的“成功确认、状态提交、资源所有权”没有被建模。修复将这些边界提成三个小型可注入模块，巨型 store mixin 和 React class 只保留接线。

## 发现与修复

| ID | 严重度 | 发现 | 根因 | 修复 |
| --- | --- | --- | --- | --- |
| R5-01 | P1 | 用户点击忽略恢复提示后，即使主进程返回 `false`，本地通知仍被清空 | 主进程把管理器缺失/异常转换成布尔确认值；渲染端只 `await`，不检查返回值并无条件提交本地状态 | `dismissRecoveryPlanOperation` 只在结果严格为 `true` 后调用 `clearPlan`；失败保留通知、返回错误并走 `store.onError` |
| R5-02 | P2 | 恢复计划 IPC reject 或计划验证异常被空 `catch` 吞掉 | 启动降级行为与诊断行为混在 store 方法中，没有稳定事件契约 | `loadRecoveryPlanOperation` 安全返回 `null` 计划，同时记录不含异常文本/路径/凭据的稳定 quality event |
| R5-03 | P1 | 每次启动 MCP server widget 都增加一个匿名 `mcp-request` listener | `initMcpHandler` 没有保存 listener，也没有在再次初始化前 `ipcOffEvent` | `installMcpRequestListener` 替换旧 listener，重复初始化仍只有一个；同时忽略 malformed/unrelated IPC |
| R5-04 | P1 | SFTP 遇到 `Unexpected packet` 时声明的重试永远不会发生 | `retryCount` 初始为 0，条件要求 `this.retryCount` 为真，而计数只在该分支中递增，形成不可达分支 | 纯策略 `shouldRetryUnexpectedSftpPacket` 允许每次连接尝试重试一次，第二次同类错误停止；成功后重置计数 |
| R5-05 | P2 | SFTP 卸载漏清 `timer` 和 `retryHandler`，重复 blur/refresh 还会覆盖旧 handle；lodash debounce 未取消 | timer 分散在巨型 class 的多个方法，卸载只记得 `timer4`/`timer5` | `replaceSftpEntryTimer` 先取消旧 callback；`disposeSftpEntryScheduling` 清四个 timer 并取消两个 debounce |

## 恢复流程数据流证据

修复前：

```text
recovery manager exception/missing
  -> main IPC returns false
  -> renderer await resolves normally
  -> renderer clears store.recoveryPlan
```

因此仅给 renderer 的 `catch` 加日志不能修复问题，因为 `false` 根本不会进入 `catch`。修复后的提交顺序为：

```text
main acknowledgement === true
  -> clear local recovery plan

false/rejection
  -> keep local recovery plan
  -> record stable failure event
  -> show existing sanitized error notification
```

加载失败仍应允许应用启动；其事件只包含：

```json
{
  "module": "recovery",
  "action": "load-plan",
  "phase": "failed",
  "result": "ignored",
  "messageCode": "recovery-plan-load-failed"
}
```

测试使用包含用户目录和假 token 的错误消息，确认事件 JSON 不包含这些值。

## 生命周期配对审查

| 区域 | 创建/注册 | 取消/释放 | 结果 |
| --- | --- | --- | --- |
| SFTP entry | ready、blur、refresh、retry timer；remote/local debounce；SFTP client | 新 helper 在替换和 unmount 时统一清理；client destroy 保持原逻辑 | 修复两项 timer 漏清、覆盖旧 timer 和 debounce 未 cancel |
| Terminal | reconnect scheduler、`this.timers`、WebSocket、xterm、addons、safety entrypoint | unmount invalidate session、dispose scheduler、clear timers、close socket、dispose xterm、清 addon 引用 | 未发现可复现的重复 listener/未关闭 socket；延迟脚本等待在 unmount 清 timer 后不显式 resolve，登记为 P3 设计债务 |
| MCP renderer | `mcp-request` IPC listener；AbortSignal listener；poll timer | listener 重装先 off；abortable helpers 在 settle/abort 时移除 listener 并清 timer | 修复重复 listener；AbortSignal helper 配对完整 |
| SSH server | jump connections、tunnel runtime、probe socket/timeout、channel | probe connect/error 均 clear timeout + destroy；`endConns`/`doKill` 关闭 tunnels、connections、channel | 未发现本轮可复现泄漏 |
| AI main process | health/chat/agent AbortController maps；stream timers/listeners/session map | finally 删除 active map；stop/error abort + destroy；完成 session 有 TTL cleanup | 核心路径配对完整；retry delay 正常 resolve 后不主动移除一次性 abort listener，最多两次重试，登记 P3 |
| Recovery snapshot | 文件原子写、内存 recovery plan | 写失败 warnOnce 并降级；dismiss manager 更新内存确认 | 主进程 best-effort catch 属于刻意降级；渲染端现在尊重确认值 |

## 测试质量优化

`crash-recovery-ui.spec.js` 原先通过读取 `load-data.js` 并搜索正则，推断启动不会自动恢复。该实现文本断言已由以下真实行为测试替代：

- recovery plan operation 的成功/失败/确认语义；
- client recovery state 始终创建 disconnected、`recoveryPending` 的 tab shell；
- recovery snapshot 不执行命令；
- E2E 仍覆盖用户主动恢复和重连。

保留的源码读取断言只检查 JSX 挂载、安全动作和 Stylus 编译契约，这些属于接线/构建边界。

## TDD 证据

| 模块 | 首次 RED | GREEN |
| --- | --- | --- |
| `recovery-plan-operations.js` | 5/5 因模块不存在而按预期失败 | 5/5 通过 |
| `mcp-request-listener.js` | 2/2 因模块不存在而按预期失败 | 2/2 通过 |
| `sftp-entry-lifecycle.js` | 2/2（扩展后 3 项）因模块不存在而按预期失败 | 3/3 通过 |

## 回归结果

| 范围 | 结果 |
| --- | --- |
| 恢复快照、client state、UI、quality event | 19/19 通过 |
| MCP listener + agent cancellation/structured tools/fleet harness | 31/31 通过 |
| 17 个 `sftp-*.spec.js` 文件 | 158 tests，0 失败 |
| 本轮核心组合 | 18/18 通过 |
| `npm run lint` | 通过 |

Node 对少数混合 CommonJS/ESM 测试文件仍发出既有 `MODULE_TYPELESS_PACKAGE_JSON` 性能提示；测试通过，且不能直接给应用根 package 增加 `type: module`，否则会破坏主进程 CommonJS。轮次六将把它作为测试结构债务检查，而不是误改生产模块类型。
