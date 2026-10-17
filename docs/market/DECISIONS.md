# 在 N01 与 I02 通过之前不进入实现的事项

N01 要的是固定提交、插件覆盖和差距表。`docs/market/n01.md` 是这份证据，基线提交是 `6c0b83d790234c318dc2d1f2243dcc6e093095d5`。

I02 要的是独立协议、schema、profile、参考验证器和 conformance fixtures。这些工件不在本仓库。

在这份 N01 记录被接受，并且 I02 工件可以单独验证之前，下面各项都不进入实现。

- 市场业务表。这包括 publishers、resources、releases、source mappings、plans、approvals 和 installation projections。
- `/market/v1` 的路由和写入接口。
- Multica 适配器、DSH 宿主适配器，以及 LobsterAI 导出。
- 用 `@nocobase/plugin-workflow` 的 `manual` 指令实现发布审核或 `planHash` 批准。该指令只是本树里的人工节点。
- 用 `@nocobase/plugin-audit-logs` 实现市场审计。预设 `deprecated` 已包含该包，包描述写明不要使用。
- 把 `@nocobase/plugin-license` 的源码写成企业授权已经覆盖。覆盖范围仍是 UNKNOWN。
- 按方案里的 `v3-develop` 开工。`origin` 没有这个分支。若要更换基线，先改 `docs/market/n01.md` 里的提交。

N02 在方案里依赖 N01 和 I01。I01 还要 Multica 与 DSH 的身份证据，那些证据不在本仓库。因此目录表还要等 I01。协议形状的接口还要等 I02。

`@nocobase/flow-engine` 继续只作为前端 flow 引擎使用。不要把它当成审批或队列实现。
