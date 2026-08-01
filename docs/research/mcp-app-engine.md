# 将 NocoBase 二次开发为 MCP App 引擎 — 深度调研分析

> 调研对象：MCP Apps 扩展规范（SEP-1865，`2026-01-26` Stable）与 NocoBase 2.1.x 现有能力
> 目标：把 NocoBase 改造为「MCP App 开发引擎（CLI + 可视化界面）」与「MCP App 运行引擎」，并与传统页面、工作流、权限体系共存协作。
> 结论先行：**NocoBase 已经具备该目标 60%~70% 的底层设施**，缺的是 MCP Apps 的 *UI 侧协议实现*（`ui://` 资源、`_meta.ui` 绑定、postMessage 桥、CSP 沙箱）与围绕它的产品化封装。核心技术抓手是把 NocoBase 前端的 `APIClient` 适配到 MCP 的 `tools/call` 通道上，从而让**现有 FlowModel 区块无需改造即可在 MCP 宿主的沙箱 iframe 中运行**。

---

## 一、MCP Apps 规范要点（SEP-1865）

### 1.1 定位

MCP Apps 是 MCP 的**扩展（extension）**，不是核心协议的一部分。它允许 MCP Server 除了返回文本/结构化结果外，再返回一个**可交互的 HTML 界面**，由宿主（Claude、ChatGPT 等）在受控 iframe 中渲染。

### 1.2 关键标识符（务必按字面实现）

| 类别 | 标识符 |
|---|---|
| 扩展 ID | `io.modelcontextprotocol/ui` |
| 资源 URI scheme | `ui://` （如 `ui://nocobase/orders-board.html`） |
| MIME 类型 | `text/html;profile=mcp-app` |
| 工具侧元数据 | `_meta.ui = { resourceUri, visibility }` |
| 资源侧元数据 | `_meta.ui = { csp, permissions, domain, prefersBorder }` |
| CSP 结构 | `McpUiResourceCsp = { connectDomains, resourceDomains, frameDomains, baseUriDomains }` |
| 已废弃扁平键 | `_meta["ui/resourceUri"]`（兼容用，新实现不要产出） |

能力协商是 `capabilities.extensions` 下的一个映射（标识符 → 设置对象，`{}` 表示"支持但无设置"）：

```jsonc
{ "capabilities": { "extensions": {
  "io.modelcontextprotocol/ui": { "mimeTypes": ["text/html;profile=mcp-app"] }
} } }
```

> **协议版本提示（2026-08 更新）**：上式是 `2025-11-25` 及更早的形态，经由 `initialize` 传递 —— 这也是 `@modelcontextprotocol/sdk@1.29.0`（NocoBase 当前解析到的版本，`LATEST_PROTOCOL_VERSION = '2025-11-25'`）today 支持的形态，`extensions` 字段已在其 ClientCapabilities/ServerCapabilities 上就位。
> 但 `2026-07-28` 修订**移除了 `initialize`**：客户端能力改为随每个请求走 `params._meta["io.modelcontextprotocol/clientCapabilities"]`，服务端改为通过新的 `server/discover` 广告能力。详见 `docs/research/mcp-features-fit.md` 第 0 节。

### 1.3 `ui/` 命名空间方法

**请求（View → Host）**：`ui/initialize`、`ui/open-link`、`ui/message`、`ui/request-display-mode`、`ui/update-model-context`

**通知**：
- Host → View：`ui/notifications/tool-input`、`ui/notifications/tool-input-partial`、`ui/notifications/tool-result`、`ui/notifications/tool-cancelled`、`ui/notifications/host-context-changed`、`ui/resource-teardown`
- View → Host：`ui/notifications/initialized`、`ui/notifications/size-changed`
- 沙箱内部：`ui/notifications/sandbox-proxy-ready`、`ui/notifications/sandbox-resource-ready`（双 iframe 代理层专用，不透传）

`ui/initialize` 的响应 `McpUiInitializeResult` 含 `protocolVersion` / `hostCapabilities` / `hostInfo` / `hostContext`；`HostContext` 提供 `toolInfo`、`theme`、`styles`（CSS 变量）、`displayMode`、`availableDisplayModes`、`containerDimensions`、`locale`、`timeZone`、`safeAreaInsets` 等。

### 1.4 View 的能力边界（对方案影响最大的一条）

View 本身是一个**运行在 iframe 里的 MCP Client**，通过 postMessage 承载 JSON-RPC 2.0，**只被允许使用 MCP 协议的一个子集**：`tools/call`、`resources/read`、以及通知。

> **这意味着：iframe 内没有、也不应该有 NocoBase 的 access token；View 想读写业务数据，唯一合法路径是 `tools/call` 回到宿主，再由宿主转给 NocoBase MCP Server。**

这条约束直接否定了「把现有 `/embed/:uid?token=xxx` 页面塞进 `ui://` 资源」的偷懒做法，也是第五章桥接层设计的出发点。

### 1.5 安全模型

- **双 iframe 沙箱**：外层 sandbox proxy 接宿主消息，内层 iframe 载入 HTML 并施加 CSP。
- **CSP 白名单强制**：宿主依据资源 `_meta.ui.csp` 声明的域构造 CSP 头；**未声明的域一律禁止**；未提供 CSP 元数据时按 `default-src 'none'` 处理。
- **资源预声明**：宿主在连接建立阶段即通过 `resources/list` 拿到全部 UI 模板，可在执行前审查。
- **可审计**：所有 View↔Host 交互都是结构化 JSON-RPC，可完整日志化。

### 1.6 官方 SDK 形态

- `@modelcontextprotocol/ext-apps` — `App` 类、`PostMessageTransport`（View 侧）
- `@modelcontextprotocol/ext-apps/react` — React hooks
- `@modelcontextprotocol/ext-apps/app-bridge` — 宿主侧嵌入
- `@modelcontextprotocol/ext-apps/server` — `registerAppTool()`、`registerAppResource()`、`RESOURCE_MIME_TYPE`

服务端典型写法：

```ts
const resourceUri = 'ui://get-time/mcp-app.html';
registerAppTool(server, 'get-time',
  { title: 'Get Time', description: '...', inputSchema: {}, _meta: { ui: { resourceUri } } },
  async () => ({ content: [{ type: 'text', text: new Date().toISOString() }] }));
registerAppResource(server, resourceUri, resourceUri, { mimeType: RESOURCE_MIME_TYPE },
  async () => ({ contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] }));
```

View 侧：

```ts
import { App } from '@modelcontextprotocol/ext-apps';
const app = new App({ name: 'Get Time App', version: '1.0.0' });
app.ontoolresult = (result) => { /* ... */ };
await app.callServerTool({ name: 'get-time', arguments: {} });
app.connect();
```

---

## 二、NocoBase 现状盘点：可复用资产清单

### 2.1 `plugin-mcp-server` — 已有的 MCP Server（关键资产）

位置：`packages/plugins/@nocobase/plugin-mcp-server/`（约 1650 行）

**端点与传输**（`src/server/plugin.ts:198-211`）：

```ts
this.app.resourceManager.define({
  name: 'mcp',
  actions: { list: mcpHandler, create: mcpHandler },  // GET/POST → /api/mcp
  only: ['list', 'create'],
});
this.app.acl.allow('mcp', '*', 'loggedIn');
```

传输用 `StreamableHTTPServerTransport`，**`sessionIdGenerator: undefined` 即无状态模式**，每次 POST 新建 server 实例、用完 `server.close()`（`mcp-server.ts:87-105`）。

**能力声明**（`mcp-server.ts:113-118`）：目前只有 `capabilities: { tools: {} }` —— **没有 `resources`，没有 extensions 协商**。

**工具来源有两条**：

1. **OpenAPI/Swagger 自动转换**（`mcp-tools.ts:298`）：`collectMcpToolsFromSwagger()` 读取所有启用插件的 `src|lib|dist/swagger`，合并成一份 OpenAPI 文档，再经 `openapi-mcp-generator` 转为工具。
   - 工具名由路径推导：`parseResourceActionFromPath()` 把 `/users/{id}:update` 变成 `users_update`。
   - ⚠️ **`DEFAULT_MCP_PACKAGE_PATTERNS = []`（`mcp-tools.ts:23`）**，而 `shouldIncludePackage()` 用 `patterns.some(...)`，所以**不带 `x-mcp-packages` 请求头时，Swagger 工具一个都不加载**。这是一个容易踩的默认行为。
2. **通用 CRUD 工具**（`crud-tool.ts:722`）：`resource_list` / `resource_get` / `resource_create` / `resource_update` / `resource_destroy` / `resource_query` 六个工具，参数含 `dataSource` + `resource`，可覆盖**任意数据源的任意 collection 及关系资源**（`users.roles`、`posts.comments`）。

**调用链是整个方案的基石**（`crud-tool.ts:275`、`mcp-tools.ts:361`）：

```ts
const response = await inject(app.callback(), { method, url, query, headers, payload });
```

用 `light-my-request` 向**应用自身的 Koa callback 发起进程内请求**，并把 MCP 的 Bearer token 塞进 `headers.authorization`。

> **含义：MCP 工具调用完整走一遍 NocoBase 的中间件栈 —— 认证、ACL、数据源路由、审计、字段级权限全部自动生效，零重复实现。** 这是「复用现有能力」最有价值的一点，MCP Apps 改造必须继续沿用这条通道。

**OAuth 2.1 授权**（`plugin.ts:41-110`）：通过 `plugin-idp-oauth` 注册 resource server（scope `mcp offline_access`，RS256 JWT），并实现 RFC 9728 `.well-known/oauth-protected-resource` 与 401 时的 `WWW-Authenticate` 头 —— 这正是 MCP 授权规范要求的形态，**已经就绪**。

**结果后处理**：`McpToolsManager.registerToolResultPostProcessor(resource, action, fn)`（`packages/core/ai/src/mcp-tools-manager.ts:58`）。已有使用者：`plugin-data-source-manager/src/server/mcp-post-processors.ts`、`plugin-data-source-main/src/server/mcp-post-processors.ts`（用于精简返回体、控制 token 消耗）。**这个钩子正是注入 `_meta.ui` 的天然位置。**

### 2.2 `flow-surfaces` — 已经存在的「应用生成引擎」（最大惊喜）

位置：`packages/plugins/@nocobase/plugin-flow-engine/src/server/flow-surfaces/`（141 个文件）

`FLOW_SURFACE_ACTION_DEFINITIONS`（`flow-surfaces/constants.ts:23-75`）定义了约 **50 个声明式页面编排动作**：

| 分组 | 动作 |
|---|---|
| 探查/只读 | `catalog`、`context`、`get`、`describeSurface`、`exportBlueprint`、`getReactionMeta`、`getEventFlowMeta`、`listTemplates`、`getTemplate` |
| 页面/菜单 | `createMenu`、`updateMenu`、`createPage`、`destroyPage`、`addTab`、`updateTab`、`moveTab`、`removeTab`、`addPopupTab`… |
| 区块/字段/动作 | `addBlock(s)`、`addField(s)`、`addAction(s)`、`addRecordAction(s)`、`updateSettings`、`setLayout`、`moveNode`、`removeNode` |
| 联动规则 | `setFieldValueRules`、`setBlockLinkageRules`、`setFieldLinkageRules`、`setActionLinkageRules` |
| 事件流 | `addEventFlow`、`setEventFlow`、`setEventFlows`、`removeEventFlow` |
| 蓝图/模板 | `applyBlueprint`、`applyApprovalBlueprint`、`saveTemplate`、`updateTemplate`、`convertTemplateToCopy`、`compose`、`configure` |
| 批处理 | `mutate`、`apply` |

且 `packages/plugins/@nocobase/plugin-flow-engine/src/swagger/flow-surfaces.ts` 已提供 OpenAPI 描述（含 `flow-surfaces.examples.ts`、`flow-surfaces.template-action-docs.ts`）。

> **结论：只要请求头带上 `x-mcp-packages: @nocobase/plugin-flow-engine`，AI Agent 今天就已经能通过 MCP 远程"编写"NocoBase 页面。** 「MCP App 开发引擎」的服务端 API 层基本不用重写，只需增加 MCP App 特有的语义（工具绑定、CSP、displayMode）。
>
> 同时 `exportBlueprint` / `applyBlueprint` 天然就是 **MCP App 的"源码格式"与 GitOps 载体**。

### 2.3 `plugin-embed` — 已有的 iframe 渲染管线

位置：`packages/plugins/@nocobase/plugin-embed/src/client-v2/`

```ts
// plugin.tsx
this.app.layoutManager.registerLayout({
  routeName: 'embed', routePath: '/embed',
  uid: EMBED_LAYOUT_MODEL_UID, layoutModelClass: EMBED_LAYOUT_MODEL_CLASS,
  authCheck: false,
});
```

`beforeLoad()` 从 URL `?token=` 取令牌，并**换用带随机前缀的 sessionStorage**，避免与主站会话串号。配套 `EmbedAccessGuard.tsx` 独立跑一遍 `auth:check` + `roles:check` 并注入 `ACLContext` / `CurrentUserContext`。

> 价值：证明了 **"任意 FlowModel 可以脱离主布局、在独立 iframe 中带权限渲染"** 这条链路是通的。
> 但 **`?token=` 的做法绝不能照搬到 MCP App**（见 1.4/1.5：凭证不得进入沙箱）。MCP App 需要的是"无凭证 View + tools/call 回宿主"的模型。

`LayoutRegisterOptions`（`packages/core/client-v2/src/layout-manager/types.ts:10`）：`{ routeName, routePath, uid, layoutModelClass, rootPageModelClass?, childPageModelClass?, authCheck? }` —— 新增一个 `/mcp-app` 布局是标准动作。`plugin-public-forms` 同样用 `authCheck: false` 做匿名渲染，可作第二参考。

### 2.4 工作流：已有 workflow → tool 的桥

`packages/plugins/@nocobase/plugin-ai/src/server/tools/workflow-caller.ts`：把 `type: 'ai-employee'` 的工作流按 `workflow.config.parameters` 构建 zod schema 注册为工具，调用 `workflowPlugin.trigger()` 并取 `processor.execution.output`。

已有可复用的工作流触发器插件：`plugin-workflow-action-trigger`、`plugin-workflow-custom-action-trigger`、`plugin-workflow-manual`（人工节点/待办）、`plugin-workflow-javascript`、`plugin-workflow-loop` 等。

### 2.5 权限体系

- `packages/core/acl` + `plugin-acl`：角色 / 资源动作 / 字段白名单 / snippet（如 `ui.flowSql`）/ 作用域。
- 因为 MCP 工具经 `inject()` 走中间件栈，**数据面权限天然复用**。
- 但**控制面缺口明确**：`getTools()` 与 `mcpToolsCache`（`plugin.ts:125-152`）**只按 package pattern 缓存，完全不看调用者角色** —— 即 `tools/list` 对所有角色返回同一份清单。这是必须修的（见 5.4）。

### 2.6 NocoBase 作为 MCP Client（反向能力）

`packages/core/ai/src/mcp-manager/`（`index.ts`、`user-context-client-manager.ts`、`options-renderer.ts`）+ `plugin-ai/src/server/resource/aiMcpClients.ts` + `ai-mcp-clients` collection + 前端 `MCPSettings.tsx` / `MCPToolsList.tsx`。

> 意味着 NocoBase 已能**消费**外部 MCP Server。做 MCP App 引擎时，这条链路可反向复用为"在 NocoBase 页面里渲染第三方 MCP App"（NocoBase 自身成为 MCP Apps *宿主*），形成双向闭环。

### 2.7 CLI 基座

`packages/core/cli/src/commands/`：已有 `scaffold`（`plugin.ts` / `migration.ts`）、`plugin`（enable/disable/import/list）、`pm`、`skills`、`build`、`dev`、`api`。新增 `mcp-app` 命令组是同构扩展。

---

## 三、差距分析（Gap Analysis）

| 能力项 | 现状 | 差距 | 难度 |
|---|---|---|---|
| MCP Server 端点 / 传输 | ✅ `/api/mcp` StreamableHTTP（无状态） | ~~需可选有状态会话~~ → **判断反转**：`2026-07-28` 主动删除了会话（SEP-2567/2575），无状态即目标形态，NocoBase 的选择是对的。真正要补的是 `subscriptions/listen` 长连接请求 | 低 |
| OAuth 2.1 / RFC 9728 | ✅ 完整 | scope 需细化到 App 粒度 | 低 |
| `tools/list`、`tools/call` | ✅ | 未按角色过滤；缓存跨用户 | **中（安全）** |
| `resources/list`、`resources/read` | ❌ 未实现 | 需新增 resources capability 与 `ui://` 路由 | 中 |
| extensions 能力协商 | ❌ | 需声明 `io.modelcontextprotocol/ui` 并按宿主能力降级 | 低 |
| 工具 ↔ UI 绑定 `_meta.ui` | ❌ | 需在工具定义与 `postProcessToolResult` 注入 | 低 |
| CSP / 沙箱元数据 | ❌ | 需按 App 配置产出 `csp.connectDomains` 等 | 中 |
| View 侧 postMessage 桥 | ❌ | **需 APIClient→`tools/call` 适配器（核心）** | **高** |
| UI 资源产物构建 | 部分（rsbuild/`plugin-build`） | 需 MCP App 专用打包：单文件 HTML / 瘦引导壳 | 中 |
| 可视化设计器 | ✅ flow-surfaces + v2 设计器 | 需 MCP App 应用类型、工具绑定面板、inputSchema 生成器、调试器 | 中 |
| CLI | ✅ 基座 | 需 `mcp-app create/dev/build/publish/inspect` | 中 |
| 工作流联动 | ✅ 雏形（ai-employee） | 需 `mcp` 触发器 + 工作流返回 UI 视图 | 中 |
| 传统页面共存 | ✅ FlowModel 已多处渲染 | 需第三渲染目标 `/mcp-app/:uid` | 低 |
| 审计 | ✅ auditManager | 需覆盖 `ui/*` 交互 | 低 |

---

## 四、目标架构

```
┌──────────────────────────────────────────────────────────────┐
│  MCP 宿主 (Claude / ChatGPT / NocoBase 自身)                  │
│   ├─ tools/list · tools/call · resources/read                │
│   └─ 双 iframe 沙箱 ── postMessage JSON-RPC ──┐               │
└───────────────────────────────────────────────┼──────────────┘
                                                │ ui/* 子集
┌───────────────────────────────────────────────▼──────────────┐
│  View (ui:// 资源)  ← @nocobase/mcp-app-runtime               │
│   ├─ McpAppAPIClient  (APIClient → tools/call 适配器) ★核心   │
│   ├─ FlowEngine + FlowModel  (复用全部 v2 区块)               │
│   └─ HostContext → NocoBase theme / locale / displayMode      │
└───────────────────────────────────────────────┬──────────────┘
                                                │
┌───────────────────────────────────────────────▼──────────────┐
│  NocoBase MCP Server（扩展现有 plugin-mcp-server）            │
│   ├─ tools:      swagger 工具 + CRUD 工具 + 工作流工具        │
│   ├─ resources:  ui://  ← 由 mcpApps 表 + 构建产物驱动 (新增) │
│   └─ inject(app.callback())  →  Koa 中间件栈                  │
└───────────────────────────────────────────────┬──────────────┘
                                                │
┌───────────────────────────────────────────────▼──────────────┐
│  NocoBase 内核：ACL · 数据源 · 审计 · 工作流 · flowModels      │
└──────────────────────────────────────────────────────────────┘
```

**建议的包/插件划分**（遵循 `AGENTS.md`：新插件放 `packages/plugins/@nocobase/plugin-<name>/`）：

| 包 | 职责 |
|---|---|
| `plugin-mcp-server`（改造） | 增补 resources capability、extensions 协商、`_meta.ui` 注入、按角色过滤工具 |
| `plugin-mcp-app`（新增） | MCP App 领域模型（`mcpApps` / `mcpAppTools` 表）、`ui://` 资源解析与构建、设计器 UI（client-v2）、`/mcp-app/:uid` 布局 |
| `@nocobase/mcp-app-runtime`（新增 core 包） | View 侧运行时：`McpAppAPIClient`、HostContext 桥、`App` 生命周期封装 |
| `core/cli` 增补 | `commands/mcp-app/` 命令组 |

> 注意 `AGENTS.md` 的单向依赖约束：**v2 客户端不得 import `@nocobase/client`**。运行时包只依赖 `@nocobase/client-v2` / `@nocobase/flow-engine`。

---

## 五、核心设计要点

### 5.1 数据模型

```
mcpApps         id, name(唯一, 用于 ui:// 路径), title, description,
                uid(关联 flowModels), mode('flow-model'|'bundle'|'custom-html'),
                displayMode, availableDisplayModes, prefersBorder,
                csp: { connectDomains[], resourceDomains[], frameDomains[], baseUriDomains[] },
                permissions[], enabled, version
mcpAppTools     appId, toolName, visibility('model'|'app')[],
                inputSchema(JSON Schema), bindingType('crud'|'workflow'|'action'|'custom')
```

`uid` 复用 `flowModels`（`plugin-flow-engine/src/server/collections/flowModels.ts`），使 MCP App 与普通页面共用同一套模型树、模板（`plugin-ui-templates`）与设计器。

> 按 `AGENTS.md`：新建 collection/字段由 `yarn nocobase upgrade` 自动同步，无需迁移文件；后续对已发布表的结构变更才需要 `src/server/migrations/`。

### 5.2 `ui://` 资源的三种产出模式

**Mode A — 瘦引导壳（FlowModel 直渲，主推）**
`resources/read` 返回一段极小 HTML：内联 `@nocobase/mcp-app-runtime`，建立 `App` 连接，再通过 `tools/call` 拉取模型树并用 FlowEngine 渲染。

- 优点：**完全复用现有 v2 区块生态**，设计器所见即所得；应用改动无需重新打包。
- 代价：资源体积与首屏；CSP 需允许运行时脚本。
- CSP 要点：若运行时与静态资源从 NocoBase 源加载，必须在 `resourceDomains` 声明该源；若全部内联则可收紧到 `default-src 'none'` + 少量 `connectDomains`。**推荐尽量内联，把网络面收敛到零**——因为数据一律走 `tools/call`，View 理论上不需要任何 `connect-src`。

**Mode B — 构建期自包含单文件**
用 rsbuild 把选定区块子集打成单个 HTML（JS/CSS/字体全内联），发布时快照。适合对外分发、需强安全审查的场景。

**Mode C — 自定义 HTML / RunJS**
面向开发者的逃生舱，直接写 HTML+JS，借 `flow-engine` 已有的 `JSRunner` / `compileRunJs` / `runjs-context` 能力提供受控 API。

### 5.3 桥接层：`McpAppAPIClient`（**整个方案的技术核心**）

NocoBase v2 前端所有数据访问都收敛在 `APIClient`（`packages/core/client-v2/src/APIClient.ts`），区块代码写的是 `api.resource('orders').list({...})`。

而 `crud-tool.ts` 提供的六个通用工具 `resource_list/get/create/update/destroy/query` 的入参 —— `dataSource` + `resource` + `filter/sort/page/appends/fields` + `filterByTk` + `values` —— **与 NocoBase resource action 的参数模型几乎一一对应**。

因此可以实现一个子类，把 HTTP 请求翻译成 MCP 工具调用：

```
api.resource('orders').list({ filter, page })
      ↓  McpAppAPIClient 拦截
app.callServerTool({ name: 'resource_list',
  arguments: { dataSource: 'main', resource: 'orders', filter, page } })
      ↓  宿主转发
NocoBase MCP Server → inject(app.callback()) → ACL/数据源 → 结果回传
```

**这一层的战略意义**：
1. **FlowModel 区块零改造**即可在沙箱内运行 —— 复用最大化。
2. 凭证不出宿主，符合 1.4/1.5 的安全约束。
3. 权限自动生效，无需在 View 侧做任何鉴权。

**必须处理的落差**（务实评估，不要低估）：
- **非 CRUD 请求**：`flowSql:runById`、`variables:resolve`、自定义 action、文件上传、导入导出。需要一个 `nocobase_action` 通用逃生工具（参数 `resource`/`action`/`params`），但要按 App 白名单限定可调用的 action，否则等于开放整个 API 面。
- **文件/附件**：二进制不适合走 JSON-RPC，需签名 URL；而签名 URL 又要求 CSP `resourceDomains` 放行 NocoBase 源 —— 需在 App 配置里显式声明。
- **WebSocket / 实时**：`WebSocketClient.ts` 在沙箱内不可用，实时区块需降级为轮询或禁用。
- **延迟**：多一跳宿主转发，列表类交互需谨慎设计分页与预取。

### 5.4 权限：三层模型

1. **工具可见性（控制面，当前缺失，必须补）**
   `getTools(ctx)` 需按调用者角色用 `app.acl.can({ role, resource, action })` 过滤 `tools/list`；同时 `mcpToolsCache` 的 key 必须并入角色维度（现在只按 package pattern 缓存，会跨用户串权限）。
2. **数据面（已有）**
   `inject()` 走完整中间件栈，ACL/字段白名单/作用域自动生效。
3. **MCP App 资源级（新增）**
   `resources/list` 只返回当前角色可见的 `ui://`；`resources/read` 二次校验。建议新增 ACL snippet（如 `mcp.apps`）管理设计态权限，与已有 `ui.flowSql` 风格一致。

`_meta.ui.visibility` 的 `["model","app"]` 语义要落到产品上：`app` 表示该工具仅供 View 内部调用、不暴露给模型 —— 这正好用来隐藏 View 私有的细粒度数据工具，避免污染模型的工具列表。

### 5.5 与工作流协作

三个方向，价值递增：

1. **工作流即工具**：扩展 `workflow-caller.ts`，从只支持 `type: 'ai-employee'` 扩展到显式的 `mcp` 触发器类型（新增 `plugin-workflow-mcp-trigger`，对齐现有 `plugin-workflow-action-trigger` 的写法）。
2. **工作流返回 MCP App 视图**：工作流末节点可指定 `mcpApp`，其结果经 `registerToolResultPostProcessor` 注入 `_meta.ui.resourceUri`，宿主随即渲染交互界面 —— 这是「对话中直接出现业务界面」的主场景。
3. **人工节点即 MCP App**：`plugin-workflow-manual` 的待办表单是天然的 MCP App 候选 —— 审批/补录直接在对话内完成，`ui/update-model-context` 把处理结果回写给模型。

### 5.6 与传统页面共存

同一份 `flowModels` 记录，三种渲染目标：

| 目标 | 路由 | 认证 | 数据通道 |
|---|---|---|---|
| 传统页面 | `/admin/...` | 主会话 | `APIClient` → HTTP |
| 嵌入页 | `/embed/:uid` | `?token=` + 隔离 sessionStorage | `APIClient` → HTTP |
| **MCP App** | `ui://` 资源 / 设计态 `/mcp-app/:uid` | **无凭证** | `McpAppAPIClient` → `tools/call` |

差异用**能力标志（capability flags）**在 FlowModel 上表达，让区块自行降级（如实时刷新、文件预览在 MCP 模式下关闭），而不是复制三套区块实现。

---

## 六、MCP App 开发引擎

### 6.1 可视化界面

- **新应用类型「MCP App」**：在 v2 设计器中以现有页面设计器为底座（flow-surfaces 全部动作可直接复用），额外提供：
  - **工具绑定面板**：选择/新建工具，由 collection 字段元数据**自动生成 `inputSchema`**（可复用 `crud-tool.ts` 里 `createListToolSchema()` 等 schema 构造思路，以及 `schema-utils.ts:sanitizeJsonSchemaForOpenAITools`）。
  - **`_meta.ui` 配置**：`visibility`、`displayMode`、`prefersBorder`。
  - **CSP 白名单编辑器**：四类域分别配置，并给出"当前配置下 View 能/不能做什么"的实时提示。
  - **调试器**：内置 MCP Inspector 式面板 —— 左侧模拟宿主发 `ui/notifications/tool-input`，右侧真实 iframe 渲染，中间显示 JSON-RPC 消息流。这是开发体验的胜负手。
- **预览路由** `/mcp-app/:uid`：用 `layoutManager.registerLayout({ routeName: 'mcp-app', routePath: '/mcp-app', authCheck: true })`，在登录态下模拟宿主环境，免去反复发布。

### 6.2 CLI

落在 `packages/core/cli/src/commands/mcp-app/`：

| 命令 | 作用 |
|---|---|
| `nocobase mcp-app create <name>` | 脚手架（复用 `commands/scaffold/plugin.ts` 模式） |
| `nocobase mcp-app dev` | 本地 dev server + 沙箱模拟宿主 + HMR |
| `nocobase mcp-app build` | 产出 `ui://` 资源（Mode B 单文件 / Mode A 引导壳） |
| `nocobase mcp-app inspect` | 连到 `/api/mcp`，dump `tools/list`、`resources/list`、校验 `_meta.ui` 完整性与 CSP 合法性 |
| `nocobase mcp-app pull / push` | 与 `exportBlueprint` / `applyBlueprint` 对接，**蓝图即源码，纳入 Git** |
| `nocobase mcp-app publish` | 版本化发布、灰度、回滚 |

> `pull/push` 直接复用 flow-surfaces 已有的蓝图导出/应用动作，是投入产出比最高的一条 —— 它让"可视化搭建"与"代码化管控"在同一份产物上闭环。

---

## 七、MCP App 运行引擎

1. **能力协商**：`initialize` 中声明 `extensions["io.modelcontextprotocol/ui"]`；宿主不支持时**自动降级**为纯文本工具结果（规范明确要求 graceful degradation），不能报错。
2. **`resources/list` / `resources/read`**：由 `mcpApps` 表驱动；`read` 时按 mode 组装 HTML 并附 `_meta.ui.csp`。需做产物缓存 + 版本失效（现有 `mcpToolsCache` 可作参考，但**务必加入角色维度**）。
3. **会话模式（已修正）**：当前 `sessionIdGenerator: undefined` 无状态。**`2026-07-28` 移除了 `initialize` 与 `Mcp-Session-Id`，无状态成为规范要求的形态**，因此不应再规划"有状态会话"。若要把设计器改动实时反映到已连接宿主，正确出口是 `subscriptions/listen`（长连接 POST 响应流，替代旧的 `resources/subscribe` + HTTP GET 流），且其在 OSS 部署下还受限于缺少 pubsub 适配器 —— 见 `mcp-features-fit.md` §2.7。
4. **多应用/多租户**：`plugin-multi-app-manager` 场景下，`ui://` 命名需带子应用维度，避免跨租户碰撞。
5. **可观测性**：`auditManager` 已覆盖 `flowModels:*` 等动作；扩展到 `ui/*` 交互与 `tools/call`，形成"模型说了什么 → View 做了什么 → 数据改了什么"的完整链路。

---

## 八、安全专项

| 风险 | 对策 |
|---|---|
| 凭证泄漏进沙箱 | **禁止** 复用 embed 的 `?token=`；View 无凭证，一律 `tools/call` |
| 过宽 CSP | 默认 `default-src 'none'`；域名白名单在 App 配置显式声明并在设计器给出风险提示 |
| 逃生工具滥用（`nocobase_action`） | 按 App 白名单限定 resource:action；默认关闭 |
| `tools/list` 越权枚举 | 按角色过滤 + 缓存键含角色（当前缺陷） |
| 提示注入经业务数据回流 | 业务数据在 View 内渲染为数据而非指令；`ui/update-model-context` 写回内容需标注来源并做长度/结构约束 |
| 第三方 MCP App 在 NocoBase 内渲染 | 复用 `mcp-manager` 时同样施加双 iframe + CSP，不得直连主站会话 |

---

## 九、实施路线图

**阶段 0 — 打地基（1~2 周）**
修 `tools/list` 的角色过滤与缓存键缺陷；把 `DEFAULT_MCP_PACKAGE_PATTERNS` 的默认行为显式化（当前默认零工具易误解）；补 extensions 能力协商。

**阶段 1 — 最小可用 MCP App（3~4 周）**
`mcpApps` 数据模型 + `resources/list`/`read` + `_meta.ui` 注入 + Mode B 单文件产物 + 一个真实示例（如"订单看板"）跑通 Claude 宿主。

**阶段 2 — 运行时桥（4~6 周，最难）**
`@nocobase/mcp-app-runtime` + `McpAppAPIClient`，打通 Mode A（FlowModel 直渲），验证 3~5 类主力区块（表格/表单/详情/图表）在沙箱内可用，明确降级清单。

**阶段 3 — 开发引擎（4~6 周）**
设计器 MCP App 应用类型 + 工具绑定 + CSP 编辑器 + 内置调试器；CLI `create/dev/build/inspect`。

**阶段 4 — 生态协同（3~4 周）**
工作流 `mcp` 触发器 + 工作流返回 UI 视图 + 人工节点 MCP App 化；蓝图 `pull/push` GitOps；审计闭环。

---

## 十、关键判断与开放问题

**三条核心判断**
1. **最大的复用点不是 UI，而是 `inject(app.callback())` 这条调用通道** —— 它让 MCP 天然继承 NocoBase 的权限、数据源与审计，任何改造都不应绕开它。
2. **`flow-surfaces` 意味着"开发引擎"的服务端 API 已基本就绪**，工作重心应放在 UI 协议实现与产品化封装，而非重造编排能力。
3. **`McpAppAPIClient` 的成败决定整个方案的性价比** —— 它成立，则 NocoBase 全部 v2 区块一次性变成 MCP App 素材；它不成立，就退化为"每个 App 手写前端"，复用价值大幅缩水。**建议在阶段 2 之前先做一个 spike 验证**。

**开放问题（需要决策）**
- Mode A 的引导壳体积能否压到可接受范围？内联全部 FlowEngine 运行时是否现实，还是必须允许 `resourceDomains` 指向 NocoBase 源？
- 富交互区块（拖拽看板、甘特、地图）对 `connect-src`/字体/图片的依赖，是否与"零网络面"目标冲突？
- ~~有状态会话是否要做？~~ **已由规范回答：不做**（`2026-07-28` 删除会话）。改为：`subscriptions/listen` 何时做？其前置是补齐 Redis pubsub 适配器。
- 商业化边界：MCP App 引擎属于开源侧还是 Pro 插件（`packages/pro-plugins`）？影响包划分。

---

## 附：关键文件索引

| 主题 | 路径 |
|---|---|
| MCP Server 传输/能力 | `packages/plugins/@nocobase/plugin-mcp-server/src/server/mcp-server.ts` |
| MCP 端点/OAuth/工具缓存 | `packages/plugins/@nocobase/plugin-mcp-server/src/server/plugin.ts` |
| Swagger→工具 | `packages/plugins/@nocobase/plugin-mcp-server/src/server/mcp-tools.ts` |
| 通用 CRUD 工具 | `packages/plugins/@nocobase/plugin-mcp-server/src/server/crud-tool.ts` |
| 工具管理器/后处理钩子 | `packages/core/ai/src/mcp-tools-manager.ts` |
| NocoBase 作为 MCP Client | `packages/core/ai/src/mcp-manager/` |
| 页面编排动作定义 | `packages/plugins/@nocobase/plugin-flow-engine/src/server/flow-surfaces/constants.ts` |
| 页面编排 OpenAPI | `packages/plugins/@nocobase/plugin-flow-engine/src/swagger/flow-surfaces.ts` |
| flowModels 资源 | `packages/plugins/@nocobase/plugin-flow-engine/src/server/server.ts` |
| iframe 渲染参考 | `packages/plugins/@nocobase/plugin-embed/src/client-v2/` |
| 布局注册 | `packages/core/client-v2/src/layout-manager/LayoutManager.tsx` |
| 工作流→工具 | `packages/plugins/@nocobase/plugin-ai/src/server/tools/workflow-caller.ts` |
| CLI 基座 | `packages/core/cli/src/commands/` |

---

## 参考来源

- [SEP-1865: MCP Apps — Interactive User Interfaces for MCP](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)
- [MCP Apps 规范（2026-01-26, Stable）](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [MCP Apps API 文档](https://apps.extensions.modelcontextprotocol.io/api/)
- [MCP Apps Quickstart](https://apps.extensions.modelcontextprotocol.io/api/documents/Quickstart.html)
- [MCP 官方博客：MCP Apps](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/)
</content>
