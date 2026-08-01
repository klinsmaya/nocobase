# MCP 新特性 × NocoBase 契合度分析：能结合什么，怎么做

> 配套文档：`docs/research/mcp-app-engine.md`（MCP Apps / `ui://` 专项）。本文覆盖 **MCP 扩展框架下的全部特性面**，按契合度排序，逐项给出做法。
> 调研基线：MCP `2026-07-28` 规范（SEP-2577/2575/2567/2322/2549）、扩展框架 SEP-2133、四个官方扩展、NocoBase 2.1.33。
> 结论先行：契合度最高的三项是 **MCP Apps、Tasks 扩展、Elicitation/MRTR**——它们分别对上 NocoBase 的**页面引擎、异步任务管理器、工作流人工节点**，都是已存在且成熟的子系统。但**三项都不能直接接线**，各有一处必须先修的既有缺陷。

---

## 0. 先看两个决定性的时间事实

**事实一：`2026-07-28` 规范发布仅 4 天**（今天 2026-08-01）。它是自 2024-11-05 以来最大的破坏性修订：

- **MCP 变成无状态协议**。`initialize` / `notifications/initialized` **被移除**（SEP-2575），`Mcp-Session-Id` 头**被移除**（SEP-2567）。每个请求通过 `_meta` 自描述：`io.modelcontextprotocol/protocolVersion`（必需）、`io.modelcontextprotocol/clientCapabilities`（必需）、`io.modelcontextprotocol/clientInfo`（SHOULD）。服务端**必须**实现新的 `server/discover`。
- **服务端发起的请求全部取消**，由 **MRTR**（Multi Round-Trip Requests，SEP-2322）取代：服务端返回 `resultType: "input_required"` + `inputRequests` + 不透明 `requestState`，客户端**用一个新的 JSON-RPC id** 重发原请求并带上 `inputResponses`。
- `resources/subscribe`/`unsubscribe` 与 HTTP GET 流 → **`subscriptions/listen`**。
- **Roots、Sampling、Logging 全部废弃**（SEP-2577，最早移除时间为 2027-07-28 之后的首个修订）。
- Tasks **移出实验性核心**，成为官方扩展 `io.modelcontextprotocol/tasks`（SEP-2663）。
- 所有结果必须带 `resultType`；六类可缓存结果必须带 `ttlMs` + `cacheScope`（SEP-2549）。
- 错误码重编号：`-32020` HeaderMismatch、`-32021` MissingRequiredClientCapability、`-32022` UnsupportedProtocolVersion。

**事实二：v2 SDK 换了包名，且已是 2.0.0 GA。**

> ⚠️ **本节曾有一处判断错误，已更正。** 早先的结论是"TS SDK 停在 `2025-11-25`，不要现在追 `2026-07-28`"。那是**查错了包**——`@modelcontextprotocol/sdk` 是 v1 线，v2 拆成了全新的包名。

| 包 | 最新版本 | 说明 |
|---|---|---|
| `@modelcontextprotocol/sdk` | `1.30.0` | **v1 线**，`LATEST_PROTOCOL_VERSION = '2025-11-25'`，已废弃 |
| **`@modelcontextprotocol/server`** | **`2.0.0`** | v2 服务端，GA |
| **`@modelcontextprotocol/client`** | **`2.0.0`** | v2 客户端，GA |
| `@modelcontextprotocol/core` | `2.0.0` | v2 共享内核（`server` 的依赖） |
| `@modelcontextprotocol/codemod` | `2.0.0` | 迁移工具：`npx @modelcontextprotocol/codemod v1-to-v2 .` |
| Python `mcp` | `2.0.0` | 已 GA（早期资料写的 `2.0.0b1` 已过期） |

实测 `@modelcontextprotocol/server@2.0.0` + `@modelcontextprotocol/core@2.0.0` 的 dist（出现次数）：

| 2026-07-28 特性 | 命中 | | 特性 | 命中 |
|---|---|---|---|---|
| `server/discover` | 166 | | `cacheScope` | 184 |
| `resultType` | 228 | | `ttlMs` | 190 |
| `subscriptions/listen` | 194 | | `extensions` | 74 |
| `inputRequests`（MRTR） | 200 | | `Mcp-Method` | 54 |
| `requestState`（MRTR） | 503 | | `io.modelcontextprotocol/clientCapabilities` | 12 |

协议版本串在 dist 中：`2026-07-28` 出现 842 次，`2025-11-25` 264 次（保留用于向后兼容）。**`2026-07-28` 在 TS 上已完全可用。**

**但有一个真实的断层——MCP Apps 扩展 SDK 还挂在 v1 上：**

```
@modelcontextprotocol/ext-apps@1.7.5
  peerDependencies: { "@modelcontextprotocol/sdk": "^1.29.0", ... }
```

`ext-tasks` / `ext-auth` **在 npm 上根本不存在**（只有 GitHub 规范仓库）。

**关键澄清：装了 v2 包 ≠ 就在跑 `2026-07-28`。** 据官方迁移指南（`ts.sdk.modelcontextprotocol.io/v2/migration/`），v2 SDK **默认仍是 2025 era 行为**（`legacy: 'stateless'`），采用新协议是**显式 opt-in**，且被拆成两份互不重叠的指南：

| 指南 | 内容 | 可否 codemod |
|---|---|---|
| `upgrade-to-v2.html` | 包拆分、import 重写、API 改名 | ✅ `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` |
| `support-2026-07-28.html` | `createMcpHandler`、MRTR、`versionNegotiation` | ❌ 官方明说"architectural and not codemod-automatable" |

**对 NocoBase 是好消息，有三点：**

1. **`createMcpHandler` 一个端点同时服务两个 era**（"One factory, one endpoint, both eras"），按请求信封自动路由；要拒绝旧协议才用 `{ legacy: 'reject' }`。**不需要二选一。**
2. **它的语义与 NocoBase 现有实现 1:1 吻合**——指南原话是"builds a fresh server per request and there is no `Mcp-Session-Id`"，而 `mcp-server.ts:87-105` 正是每个 POST 新建 server、`sessionIdGenerator: undefined`、用完 `close()`。**NocoBase 等于已经手写了 `createMcpHandler` 的行为**，迁移是把手写换成官方入口。
3. **MRTR 写一次两边都能跑**：用 `inputRequired({ inputRequests, requestState })` 写的处理器，在 2025 era 连接上由内建 legacy shim 自动降级成真正的 server→client 请求。所以工作流挂起/恢复的对接**不必等协议切换**。

**迁移时 NocoBase 会踩到的四处具体改动**（都在 `plugin-mcp-server/src/server/mcp-server.ts`）：

| 现状 | v2 | 风险 |
|---|---|---|
| `StreamableHTTPServerTransport`（`:31`） | `NodeStreamableHTTPServerTransport`（来自 `@modelcontextprotocol/node`），或直接改用 `createMcpHandler` | 中 |
| `setRequestHandler(ListToolsRequestSchema, …)`（`:119`、`:135`） | `setRequestHandler('tools/call', …)` 字符串形式 | 低——**`McpSdkModules`（`:13-38`）里那两个 Schema 导入可以整个删掉**，动态导入垫片随之变薄 |
| `resolveTokenFromExtra(extra)`（`:58-72`）读 `extra.authInfo` / `extra.requestInfo.headers` | `ctx.http?.authInfo` / `ctx.http?.req.headers` | **高（静默失败）**——v2 的 headers 是 Web Standard `Headers`，必须 `.get('authorization')`；现有 `headers.authorization \|\| headers.Authorization` 的方括号取值**会静默返回 undefined**，导致鉴权失效而非报错 |
| zod `^3.25 \|\| ^4` | **zod ≥ 4.2.0**，且裸 shape `{a: z.string()}` 弃用，须 `z.object({...})` | 中——影响 `crud-tool.ts` 与 workflow-caller 的 schema 构造 |

外加：**Node 20+**；`ProtocolError`（原 `McpError`）/ `SdkError` / `SdkHttpError` 三类错误分离。

**两个与本文其他章节相关的修正：**

- **§4 第 4 步说的"`requestState` 必须自己 HMAC"——SDK 已内建。** 用 `createRequestStateCodec({ key })` + `ServerOptions.requestState.verify`。仍需自己管密钥与轮换，但不用手写 AEAD。
- **§2.3 Tasks：v2 SDK 并未把 tasks 做成一等公民。** 指南明说 task 词汇"remains exportable but excluded from typed method maps"，要用 custom-method `request()` 配显式 schema。与"npm 上没有 `ext-tasks`"互相印证——**Tasks 扩展目前只能自行实现**。

**一个会咬到 MCP Apps 的坑（可能正是 ext-apps 迁移卡住的原因之一）**：在 2026 era 连接上 **`getClientCapabilities()` 返回 `undefined`**（因为没有 initialize 握手了），客户端身份改从 `ctx.mcpReq.envelope` 读。而 ext-apps 的能力探测恰恰是 `getUiCapability(server.server.getClientCapabilities())`——**这个模式在 2026 era 下直接失效**，必须改读 per-request 信封。自行实现时务必按 `ctx.mcpReq.envelope` 走。

> **修正后的实施策略**：
> - 新建 MCP 服务端 → 直接用 `@modelcontextprotocol/server@2.0.0`；先跑 2025 era（零行为变化），再用 `createMcpHandler` opt-in `2026-07-28`。
> - 但**要做 MCP Apps，就得在"用官方 `ext-apps` 助手（被拖回 v1 SDK）"和"在 v2 上手写 `_meta.ui` 表面"之间二选一**。后者工作量其实不大——MCP Apps 服务端侧只是一个 `ui://` 资源 + 两处 `_meta.ui`，真正复杂的沙箱/CSP 逻辑在**宿主**侧，不在服务端。**推荐在 v2 上手写**，避免被 v1 锁死。
> - NocoBase 现有 `plugin-mcp-server` 基于 v1 `sdk@^1.27.1`，迁移到 v2 是独立的一步，可用官方 codemod 起步。

**一处对前文的修正**：`mcp-app-engine.md` 曾把 NocoBase 的 `sessionIdGenerator: undefined`（无状态）列为"需补有状态会话"的缺口。**这个判断在 `2026-07-28` 下反了**——规范主动删除了会话，无状态成了目标形态，NocoBase 的选择反而是对的。真正需要补的是 `subscriptions/listen` 这种**长连接请求**，而非会话。

---

## 1. 契合度总表

| MCP 特性 | 标识/方法 | NocoBase 对位子系统 | 契合度 | 一句话判断 |
|---|---|---|---|---|
| **MCP Apps** | `io.modelcontextprotocol/ui` | FlowEngine / flow-surfaces / plugin-embed | ★★★★★ | 页面引擎天然就是 View 工厂；最大机会 |
| **Tools + 结构化输出** | `outputSchema` / `structuredContent` | CRUD 工具 + swagger 工具 | ★★★★★ | 已有工具面，只差 schema 声明 |
| **Tasks 扩展** | `io.modelcontextprotocol/tasks` | plugin-async-task-manager | ★★★★☆ | 数据模型对得上，但状态机有 bug |
| **Elicitation / MRTR** | `elicitation/create`、`resultType:"input_required"` | plugin-workflow-manual | ★★★★☆ | 人工节点=天然 elicitation，但表单不可移植 |
| **Resources / 模板** | `resources/list`、`resources/templates/list` | data-source-manager + 后处理器 | ★★★★☆ | 摘要器已写好，缺的只是传输面 |
| **授权扩展** | `oauth-client-credentials`、`enterprise-managed-authorization` | plugin-idp-oauth | ★★★☆☆ | AS 内核扎实，但 scope 完全不强制 |
| **`subscriptions/listen`** | `subscriptions/listen` | WS + PubSubManager | ★★★☆☆ | 单进程可用，OSS 无 pubsub 适配器 |
| **Prompts** | `prompts/list`、`prompts/get` | 无直接对位 | ★★☆☆☆ | 可用 swagger/模板凑，价值一般 |
| **Completions** | `completion/complete` | 字段/变量补全 | ★★☆☆☆ | 有素材，优先级低 |
| **Roots / Sampling / Logging** | — | — | ✗ | **已废弃（SEP-2577），不要投入** |

---

## 2. 逐项做法

### 2.1 ★★★★★ MCP Apps —— 最该做的一件事

**为什么完美契合**：NocoBase 的核心资产就是"把数据表变成界面"。MCP Apps 要的正是"给工具结果配一个 HTML 界面"。`flow-surfaces` 的 ~50 个编排动作（`createPage`/`addBlock`/`addField`/`applyBlueprint`…）已经是一个可被 Agent 驱动的界面生成 API，且已有 OpenAPI 描述。

**怎么做**（细节见 `mcp-app-engine.md`，此处只列协议要点）：

1. 声明扩展：`capabilities.extensions["io.modelcontextprotocol/ui"] = { mimeTypes: ["text/html;profile=mcp-app"] }`。SDK 1.29.0 已支持该字段。
2. 增加 `resources` capability + `ListResourcesRequestSchema` / `ReadResourceRequestSchema` 处理器——目前 `mcp-server.ts:113-118` 只声明 `{tools:{}}`，且**只注册了 2 个处理器**（`:119` ListTools、`:135` CallTool），`McpSdkModules`（`:13-38`）也只导入了这两个 schema，需要一并加宽。
3. `_meta.ui` 放在 **`resources/read` 的 content item 上**，不是 resource 配置上。
4. 工具侧 `_meta.ui.resourceUri` 关联；`visibility` 省略时默认 `["model","app"]`。

**实测出来的坑（会真的踩到）**：

- MIME 串是 `text/html;profile=mcp-app`，**分号后无空格**。规范化 MIME 解析器会重新序列化成带空格，导致 `mimeTypes.includes()` 比较失败。
- **View 没有同源服务器**。所有来源都必须在 `_meta.ui.csp` 里声明，**包括开发期的 localhost**——这是采纳失败率最高的一项。
- 工具上的 `_meta.ui.csp` / `permissions` **会被宿主忽略**（类型上是 `never`），只有资源上的生效。
- 稳定规范文本与 SDK 有两处不一致：`ui/message` 的 `content` 规范写单对象、SDK 写 `ContentBlock[]`（**按数组实现**）；`ui/resource-teardown` 规范写 `{reason}`、SDK 写 `{}`（**不要依赖 reason**）。
- CSP 域名字符串是攻击者可控且直接进 header 的，必须按参考宿主的做法过滤 `[;\r\n'" ]`，否则可注入新指令。
- 服务端**可以**不在 `resources/list` 里列出 `ui://` 资源——宿主应通过工具 `_meta.ui.resourceUri` 发现。别把发现路径只压在 list 上。

---

### 2.2 ★★★★★ 结构化工具输出 —— 投入最小、收益立刻

**现状**：`mcp-server.ts:151-158` 把所有结果 `JSON.stringify` 成一个 `text` block 返回。`outputSchema` / `structuredContent` 完全没用上。

**怎么做**：`McpTool` 类型（`packages/core/ai/src/mcp-tools-manager.ts:12-21`）加 `outputSchema`；`crud-tool.ts` 的六个工具本就知道返回形状，直接声明；swagger 工具可从 OpenAPI 的 response schema 推导（`mcp-tools.ts` 目前只用了 request 侧）。

**顺带**：已有的七个结果摘要器（`plugin-data-source-manager/src/server/mcp-post-processors.ts`、`plugin-data-source-main/src/server/mcp-post-processors.ts`）是为省 token 写的，正好作为 `content`（给模型看的摘要）与 `structuredContent`（给 View 用的完整数据）的**天然分工点**。

---

### 2.3 ★★★★☆ Tasks 扩展 —— 对位精准，但**必须先修状态机**

**规范要求**：`tools/call` 是目前唯一可 task 化的方法。服务端**必须在任务持久化完成之后**才返回 `CreateTaskResult`（"until a `tasks/get` for the returned `taskId` would resolve"）。`CreateTaskResult = Result & Task` 是**扁平的**，没有嵌套 `task` 对象。需实现 `tasks/get`、`tasks/update`、`tasks/cancel`（`tasks/result` 和 `tasks/list` 已被删除，调用应返回 `-32601`）。

**NocoBase 对位得非常准**——`asyncTasks` 表（`plugin-async-task-manager/src/common/collections/asyncTasks.ts:19-77`）已有 uuid 主键、`status`、`result` jsonb、`progressTotal`/`progressCurrent`、`createdAt`/`startedAt`/`doneAt`；5 状态枚举（`src/common/constants.ts:12-18`）；`reportProgress()`（`task-type.ts:74-83`）；HTTP 面 `asyncTasks:list|get|stop|fetchFile`。

**但对抗性验证判定为 PARTLY_WRONG，三个必须先修**：

1. **CANCELED 不是终态（真 bug）**。`cancelTask` 写入 CANCELED（`base-task-manager.ts:289-292`）时 `run()` 仍在 `await execute()`；非协作式 `execute()` 返回后，`task-type.ts:114-119` 会把**同一条记录**改写成 SUCCEEDED。基类 `execute()`（`:66-68`）根本不看 `this.abortController`，只有 `CommandTaskType`（`command-task-type.ts:131-135`）真正接了信号。
2. **结果会被自动删除**。60 秒清理循环（`base-task-manager.ts:251`）按硬编码 30 分钟 `cleanupDelay`（`:49`）删除 SUCCEEDED/FAILED，并**无条件删除每一条 CANCELED**（`:171-182`）。取消后一分钟内 `tasks/get` 就 404。而 MCP 的 `ttlMs` 是**必填**字段（可为 `null` 表示无限），NocoBase 没有任何 per-task TTL。
3. **`cancelable` 是死代码**。`TaskType.cancelable`（`task-type.ts:22`）全仓无人读取；`stop` 动作查的是 DB 列（`resourcers/async-tasks.ts:50`），而 `defaults()`（`:24-26`）不填它——调用方忘了传 `cancelable: true` 就直接 400。

**外加持久性问题**：全仓唯一的队列适配器是 `MemoryEventQueueAdapter`（`packages/core/server/src/event-queue.ts:67`），无 DLQ、无 PENDING 恢复扫描，硬崩溃会让任务永久卡在 working。**不存在 `app.backgroundJobManager`**（全仓 grep 零命中）。

**做法**：先修上述三点 + 加 per-task `ttlMs` 列，再写 MCP 侧的 `tasks/*` 处理器。任务 ID 必须用 CSPRNG 生成（规范要求"第三方无法枚举或猜测"，ID 可当 bearer token 用）。**注意** `failed` 只用于执行期的 JSON-RPC 协议错误；工具返回 `isError: true` 属于 `completed`，把 `CallToolResult` 放进 `result`——搞错会破坏结果保真度。

**还有一个必须先决的冲突**：扩展规范与 SEP-2663 都写 MissingRequiredClientCapability = `-32003`，而已发布的核心 `schema.ts` 写的是 **`-32021`**。以核心 schema 为准。

---

### 2.4 ★★★★☆ Elicitation / MRTR —— 工作流人工节点的正确出口

**为什么契合**：MRTR 的语义就是"服务端执行到一半需要人给输入，先返回 `input_required`，客户端补齐后重发"。NocoBase 工作流的 PENDING job → `EXECUTION_STATUS.STARTED` → 稍后 `plugin.resume(job)` 是**同一个模式**——验证确认这套长时执行"是内建的，不是外挂的"，且已有 delay / manual / ai-employee 三个可抄的范例。

**验证同时否掉了一半**：`plugin-workflow` 本身**没有**人工任务概念，只有 `jobs:resume`（`src/server/actions/jobs.ts:16-57`）和 `userWorkflowTasks:listMine` 计数器。人工任务在**另一个包** `plugin-workflow-manual` 里（`workflowManualTasks:listMine|get|submit`，`src/server/Plugin.ts:269-274`），且**没有 OpenAPI 文档**，所以现有 swagger→工具管线抓不到它。

更关键：**表单不可移植**。它是 Formily/NocoBase UI schema（`node.config.schema`，渲染于 `WorkflowTodo.tsx:393-397`），`x-decorator`/`x-component` 只对 NocoBase React 渲染器有意义。唯一结构化的部分是 `node.config.forms[formKey] = {type,title,actions:[{key,status,values}],collection,dataSource}`。

**两条路，选一条**：

- **路线 A（快，推荐先做）**：把人工任务表单**当成 MCP App** 而非 elicitation schema——直接复用 2.1 的 `ui://` 通道渲染原生 Formily 表单，绕开 schema 翻译问题。这也是 MCP Apps 与工作流的最佳结合点。
- **路线 B（正统，成本高）**：写一个 `node.config.forms` → JSON Schema 的翻译层，产出标准 `elicitation/create` 请求。只覆盖得了基础字段类型，复杂联动会丢失。

**触发器侧是好消息**：`registerTrigger` 是稳定的一等扩展点（`plugin-workflow/src/server/Plugin.ts:288-296`），全仓已有三个包外范例（custom-action、request-interceptor、ai-employee，其中 `AIEmployeeTrigger` 只有 3 行）。注册一个 `mcp` 触发器是走熟了的路。**两个注意**：客户端也得注册同名 trigger（类型下拉框只读客户端注册表，`WorkflowPane.tsx:68-70` 遇未注册类型会抛错）；要拿到返回值必须用 sync/manual 模式，否则 `trigger()` 返回 void。

---

### 2.5 ★★★★☆ Resources / 资源模板

**规范**：`resources/list`、`resources/templates/list`、`resources/read`，均需带 `ttlMs` + `cacheScope`。

**NocoBase 素材已经齐了**：数据源注册表本身就是带生命周期钩子的键值映射（`data-source-manager.ts:25,48,123,130`），是天然的顶层资源命名空间；`getCollections()` → `collection.options`、`getFields()` → `field.options` 在所有数据源上是统一契约（`types.ts:27-65`），一套投影覆盖 main 与外部源；那**七个已写好的 LLM 尺寸摘要器**验证时被形容为"effectively finished resource bodies looking for a resource transport"。

**做法**：URI 设计 `nocobase://{dataSource}/{collection}`，模板 `nocobase://{dataSource}/{collection}/{id}`；读取仍走 `inject(app.callback())` 以继承 ACL、`x-data-source` 路由与角色。

---

### 2.6 ★★★☆☆ 授权扩展 —— 内核扎实，但有一个安全洞

**验证结论 PARTLY_WRONG**。真实的一面：`plugin-idp-oauth` 有货真价实的 OAuth 2.1/OIDC 内核——按 issuer 分provider、`registerResourceServer`（`service.ts:387`）、RFC 8707 resource indicators（`:866-897`）、RS256 JWT 且**审计受众隔离真的生效**（`jwtVerify` with `{issuer, audience}`，`:749-760`）、强制 PKCE（`:909-911`）、DCR、重写过的 discovery。MCP 的接入确实只有 ~40 行（`plugin-mcp-server/src/server/plugin.ts:70-110`）。

**但三处被高估**：

1. **RFC 9728 不在 idp-oauth 里**。全 grep 零命中；它是在 `plugin-mcp-server/src/server/plugin.ts:70-99` 手写的，`scopes_supported` 硬编码，且路径是 `/api/.well-known/oauth-protected-resource`，**不是 RFC 规范的 `/.well-known/oauth-protected-resource/api/mcp`**。客户端会先探路径插入式再探根路径——建议**两个都提供**。
2. **scope 从不被强制执行（安全洞）**。`authenticateResourceRequest`（`service.ts:719-797`）只校验 `iss` 和 `aud`，**从不读取 token 的 `scope` claim**。桥接 token（`:598-618`）只携带 `{userId, temp, signInTime}`、不带 `roleName`，于是通过 `setCurrentRole`（`plugin-acl/.../setCurrentRole.ts:84-93`）静默继承用户**默认角色**。**结论：一个 `mcp` scope 的 token 与 `api` scope 的 token 权限完全相同——都是该用户默认角色的全量 CRUD。** 对比 `plugin-api-keys` 是**会**把角色绑进 token 的（`actions/api-keys.ts:30-33`）。任何最小权限方案都是**新的强制代码**，不是配置。
3. **没有 client_credentials 授权类型**（`service.ts:856-898` 只开了 deviceFlow/registration/revocation/resourceIndicators），每个 token 都绑定到一行 `users`。所以 `io.modelcontextprotocol/oauth-client-credentials` 扩展**需要新开发**，不是配置。DCR 还硬编码拒绝一切非 loopback redirect URI（`provider-dispatch.ts:50-57,85-96`），无覆盖开关。

**做法**：先把 scope 强制补上（在 `authenticateResourceRequest` 里读 `scope` 并映射到 NocoBase 角色），这是**安全修复而非新功能**。EMA 扩展（ID-JAG / RFC 8693 令牌交换）是企业级需求，可作为 Pro 方向。

**坑**：`WWW-Authenticate` 和 PRM 的 `scopes_supported` 里**不要放 `offline_access`**（当前代码放了：`mcpScopes = ['mcp','offline_access']`，`plugin.ts:26`）——规范明确 refresh token 不是资源要求。

---

### 2.7 ★★★☆☆ `subscriptions/listen` —— 半通

**真的一半**：per-user 实时推送是生产在用的。`app.emit('ws:sendToUser', {userId, message})`（`ws-server.ts:191`）→ 按 `userId#<id>` + `app#<name>` 标签匹配（`:322-330`）。socket 身份是**真校验**的：浏览器发 `{type:'auth:token'}`，服务端 `auth.checkToken()` 通过后才打 `userId` 标签（`plugin-auth/src/server/plugin.ts:146-212`）。已有五个生产使用者（in-app 通知、异步任务、工作流、AI employee）。

**不通的一半**：

- **OSS 树里没有生产 pubsub 适配器**。`application.ts:1274` 构造 `PubSubManager` 时**不传适配器**，唯一实现 `MemoryPubSubAdapter` 只在测试装置里（`packages/core/test/src/server/memory-pub-sub-adapter.ts:21`）。`publish` 无适配器时直接 warn 返回（`pub-sub-manager.ts:103-108`）。**后果：多进程部署下，连在进程 A 的用户收不到进程 B 发出的事件。** `RedisConnectionManager` 存在（`redis-connection-manager.ts`）但**没接到 PubSubManager**。
- MCP 侧完全没有长连接：transport 是 `sessionIdGenerator: undefined` 且每个 POST 新建/关闭 server（`mcp-server.ts:87-105`）。
- WS 层还缺离线缓冲、重放/游标续传，`ws.send` 前无 readyState 守卫（`:292-294`）。

**做法**：优先级放在 Tasks 之后。要做就先补 Redis pubsub 适配器（对整个 NocoBase 集群部署都有价值，不只是 MCP），再实现 `subscriptions/listen` 的长连接 POST 响应流。

---

### 2.8 ✗ 不要碰的

**Roots、Sampling、Logging 已于 `2026-07-28` 废弃**（SEP-2577）。虽然仍可用至少 12 个月，但不应作为新方向投入。同样废弃的还有 HTTP+SSE 传输、DCR（转向 CIMD）、`includeContext: "thisServer"/"allServers"`（SEP-2596）。

---

## 3. 三个必须先修的既有缺陷（与 MCP 无关，但阻塞 MCP）

| # | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| 1 | `tools/list` 不按角色过滤，缓存键不含角色 | `mcp-server.ts:119-133`、`plugin.ts:125-130` | **已 CONFIRMED**。信息泄露（非提权——`tools/call` 仍走 ACL）。缓存的数组在同 package pattern 的所有调用者间逐字共享 |
| 2 | OAuth scope 完全不强制 | `service.ts:719-797` | **安全**。`mcp` token == 全量 API token |
| 3 | 异步任务 CANCELED 非终态 + 结果被无条件清理 | `base-task-manager.ts:171-182,289-292`、`task-type.ts:114-119` | 阻塞 Tasks 扩展；本身也是数据正确性 bug |

---

## 4. 建议路线

**第 0 步（1~2 周）— 修缺陷 + 结构化输出。** 上表三项 + `outputSchema`/`structuredContent`。零协议风险，立刻改善现有 MCP 体验。

**第 1 步（2~3 周）— 迁移到 v2 SDK。**（原计划把这步放在最后"观望"，**已提前**——v2 SDK 已 GA。）把 `plugin-mcp-server` 从 `@modelcontextprotocol/sdk@^1.27.1` 迁到 `@modelcontextprotocol/server@2.0.0`，用 `npx @modelcontextprotocol/codemod v1-to-v2 .` 起步。`McpSdkModules`（`mcp-server.ts:13-38`）是天然的收敛点，目前只导入了 4 个符号，迁移面很小。
收益立竿见影：NocoBase 的无状态实现（`sessionIdGenerator: undefined`）**正是 v2 的目标形态**，迁过去反而更顺；同时白拿 `Mcp-Method` 头路由、`ttlMs`/`cacheScope` 响应缓存。

**第 2 步（3~5 周）— MCP Apps。** 在 v2 上**手写** `_meta.ui` 表面，不要引 `ext-apps@1.7.5`（它会把依赖拖回 v1 `sdk@^1.29.0`）。加 `resources` capability，先用自包含单文件产物跑通一个真实场景。

**第 3 步（4~6 周）— Tasks 扩展 + 工作流触发器。** 修完任务状态机后接 `tasks/*`（注意：npm 上**没有** `ext-tasks` 包，需按规范自行实现）；同时注册 `mcp` 触发器，把工作流暴露成工具。人工节点走**路线 A**（复用 MCP Apps 渲染 Formily 表单）。

**第 4 步（3~4 周）— Resources + scope 强制细化 + MRTR。** v2 SDK 已带 MRTR（`inputRequests`/`requestState`），可与工作流挂起/恢复对接。**安全提醒**：`requestState` 是攻击者可控的，必须 HMAC/AEAD 保护并绑定主体与 TTL，否则是越权与跨用户重放通道。

---

## 5. 关键判断

1. **NocoBase 与 MCP 的契合点不是"AI 调用 API"，而是三处结构同构**：页面引擎 ↔ MCP Apps、异步任务 ↔ Tasks 扩展、工作流挂起/恢复 ↔ MRTR。这三处都是 NocoBase 已有的成熟子系统，不是要新造的东西。
2. **但三处都有"最后一公里"缺陷**——任务状态机、人工表单不可移植、scope 不强制。**这些缺陷本身与 MCP 无关，修了对 NocoBase 自身也是净收益**，这让第 0 步的投入很容易论证。
3. **~~不要现在追 `2026-07-28`~~ → 应当现在就迁。** v2 SDK 已作为新包名（`@modelcontextprotocol/server@2.0.0`）GA，`2026-07-28` 全套特性可用。真正的断层不在核心协议，而在 **MCP Apps 扩展 SDK（`ext-apps@1.7.5`）仍 peer-depend 于 v1 `sdk@^1.29.0`**——所以 Apps 要在 v2 上手写，别引那个包。

---

## 参考来源

- [MCP 2026-07-28 规范发布](https://blog.modelcontextprotocol.io/posts/2026-07-28/) · [RC 说明](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [理解 MCP 扩展机制](https://blog.modelcontextprotocol.io/posts/2026-03-11-understanding-mcp-extensions/) · [扩展总览](https://modelcontextprotocol.io/extensions/overview)
- [SEP-1865 MCP Apps](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) · [ext-apps 规范](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [ext-auth](https://github.com/modelcontextprotocol/ext-auth) · [ext-tasks / SEP-2663](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2663)
- [MCP Apps 公告](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
</content>
