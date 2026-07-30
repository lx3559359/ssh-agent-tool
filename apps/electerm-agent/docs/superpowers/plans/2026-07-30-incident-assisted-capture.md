# 半自动故障档案实施计划

## 任务 1：扩展数据库和领域模型

涉及文件：

- `src/app/lib/incidents/incident-migrations.js`
- `src/app/lib/incidents/incident-model.js`
- `src/app/lib/incidents/incident-repository.js`
- `src/app/lib/incidents/incident-service.js`
- `test/unit-ci/incident-model.spec.js`
- `test/unit-ci/incident-repository.spec.js`

步骤：

1. 先添加候选事件、时间线验证和迁移失败测试。
2. 添加 schema v2 表、索引和映射函数。
3. 实现候选事件去重、分页、忽略、重新打开、确认建档。
4. 实现幂等时间线追加和时间线查询。
5. 运行 incident model/repository/database 测试。

## 任务 2：开放 IPC 和客户端 Store

涉及文件：

- `src/app/lib/ipc.js`
- `src/client/components/incidents/incident-client.js`
- `src/client/store/incident-archives.js`
- `src/client/store/init-state.js`
- `test/unit-ci/incident-ipc.spec.js`
- `test/unit-ci/incident-store.spec.js`

步骤：

1. 先添加 IPC 与 Store 行为测试。
2. 增加候选事件和时间线 API。
3. 增加列表状态、计数、转换和忽略操作。
4. 保证自动采集失败只记录错误，不向原调用链抛出。

## 任务 3：接入事件来源

涉及文件：

- `src/client/components/incidents/incident-capture.js`
- `src/client/store/operations-toolkit.js`
- `src/client/components/fleet-status/fleet-status-store.js`
- `src/client/common/safety-transactions/transaction-store.js`
- 对应 unit-ci 测试

步骤：

1. 先为事件归一化、指纹和敏感信息过滤添加测试。
2. 实现状态中心快照转候选事件。
3. 实现运维任务最终状态转候选事件/正式时间线。
4. 通过安全事务现有 change event 追加安全操作时间线。
5. 验证任何归档错误不会影响原任务完成。

## 任务 4：实现待确认事件 UI

涉及文件：

- `src/client/components/incidents/incident-workspace.jsx`
- `src/client/components/incidents/incident-candidate-list.jsx`
- `src/client/components/incidents/incident-detail.jsx`
- `src/client/components/incidents/incidents.styl`
- i18n 覆盖文件
- `test/unit-ci/incident-ui.spec.js`

步骤：

1. 先添加界面结构与文案测试。
2. 工作区增加正式档案/待确认事件切换和待确认数量。
3. 候选卡片增加查看、忽略和确认建档。
4. 确认时预填现有编辑表单，不跳过人工确认。
5. 正式档案详情展示统一时间线。

## 任务 5：关联成果物

涉及文件：

- `src/client/components/incidents/incident-report.js`
- `src/client/components/incidents/incident-detail.jsx`
- `src/client/components/artifacts/artifact-client.js`
- 对应 unit-ci 测试

步骤：

1. 先添加复盘报告草稿和引用测试。
2. 从正式档案生成 `incident-review` 草稿。
3. 成果物创建成功后追加关联时间线。
4. 在故障档案中提供打开成果物入口。

## 任务 6：回归与发布前验证

执行：

1. 运行全部 incident、artifact、operations、fleet-status 和 safety 单元测试。
2. 运行 lint 与生产构建。
3. 检查日间/夜间、1366×768 和 1920×1080 布局。
4. 验证现有 SSH、SFTP、AI、更新和回滚测试没有回归。
5. 仅在所有阻断项通过后准备发布说明；本任务默认不自动发布。
