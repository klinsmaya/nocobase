# 在对应任务落地之前不进入实现的事项

N01 的证据在 `docs/market/n01.md`。基线提交仍是 `6c0b83d790234c318dc2d1f2243dcc6e093095d5`。

N02 的目录表、草稿 CAS、租户列和身份映射在 `@nocobase/plugin-market-catalog`。记录是 `docs/market/n02.md`。它只覆盖 publishers、resources、drafts、identity mappings、principals 和 ownership events。

I02 的 draft-1 和 I01 的映射字段来自 `klinsmaya/agent-market-protocol` 的 PR #1 与 PR #3。协议仓库不在这里。NocoBase 不在加载插件时拉取那份 schema。

N03 的扫描报告、人工审核、不可变 release 和撤销审计在同一个插件里。记录是 `docs/market/n03.md`。

N04 的来源桩、同步作业和能力声明也在这个插件里。记录是 `docs/market/n04.md`。同步只拉元数据，不运行 Agent。

下面各项仍然不进入实现。

- plans、approvals 和 installation projections。
- `/market/v1` 的路由和写入接口。N02 使用集合资源动作。
- Multica 适配器、DSH 宿主适配器，以及 LobsterAI 导出。
- 用 `@nocobase/plugin-workflow` 的 `manual` 指令实现发布审核或 `planHash` 批准。该指令只是本树里的人工节点。
- 用 `@nocobase/plugin-ai` 的 `AI_WORKFLOW_TASK_STATUS` 充当市场审核。`pending_approval`、`approved`、`rejected` 只描述 AI 员工任务。
- 把 `PubSubManager` 当成已连接的队列。默认构造不设置 adapter，`publish` 在未连接时直接返回。
- 只读写 `rolesResourcesScopes` 来做行级可见性。数据权限写入查询的是 `dataSourcesRolesResourcesScopes`。
- 用 `@nocobase/plugin-audit-logs` 实现市场审计。预设 `deprecated` 已包含该包，包描述写明不要使用。
- 把 `@nocobase/plugin-license` 的源码写成企业授权已经覆盖。覆盖范围仍是 UNKNOWN。
- 按方案里的 `v3-develop` 开工。`origin` 没有这个分支。若要更换基线，先改 `docs/market/n01.md` 里的提交。

N02 按 I01 PR #3 与 I02 PR #1 的字段形状落了目录表和映射。Multica 与 DSH 的宿主适配器仍不在本仓库，不在这个插件里实现。

`@nocobase/flow-engine` 继续只作为前端 flow 引擎使用。不要把它当成审批或队列实现。
