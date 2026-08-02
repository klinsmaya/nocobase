# NocoBase MCP App 架构与实施方案（细化）

> 前置文档：`mcp-app-engine.md`（MCP Apps 规范 + ext-apps 迁移僵局）、`mcp-features-fit.md`（MCP 特性 × NocoBase 契合度 + v2 SDK 迁移）。
> 本文只讲**怎么做**，不重复前两份的规范考据。

---

## 0. 核心判断

当前典型 MCP App **不是把传统 Web 应用搬进聊天框**，而是一种**对话式微前端**，职责三分：

| 角色 | 职责 |
|---|---|
| **模型** | 理解意图、启动任务、解释结果、给建议 |
| **MCP App** | 可视化、选择、编辑、确认 —— 确定性交互 |
| **后台系统** | 数据、权限、工作流、审计 |

**对 NocoBase 的含义**：不必重做前端，也**不应把整个后台页面塞进 iframe**；而是把已有的数据模型、FlowModel、权限、工作流发布成**面向 Agent 场景的精简任务界面**。

这一判断有生产证据支撑（见 §9）：目前最成熟的第三方 MCP App（draw.io、Excalidraw）的 View 都是**纯渲染器**，数据由 tool result 一次性推入，View 内部不做通用数据回调。

---

## 1. 五个关键架构决策

### D1 — Surface-first：一组固定 Surface，而非每个业务场景生成一个 App ✅

**决策**：建立 ~9 个稳定的 `ui://nocobase/surface/*` 资源，每个是**构建期预打包的自包含 HTML**（Mode B），由 tool 参数驱动渲染。**不**为每个业务场景生成独立 HTML。

**理由**：
- Mapbox 的 `render_map_tool` 用一个界面承载路线/搜索/等时圈/多边形/GeoJSON；draw.io 用一个 `ui://drawio/mcp-app.html` 承载全部 26 种图表类型。**业界一致收敛到"少量参数化 Surface"。**
- 每次生成完整 HTML 意味着每次都要重新过 CSP 审查、重新验证沙箱行为、无法共享缓存。
- Surface 内部仍用 FlowEngine 渲染传入的 FlowModel 片段——**FlowModel 复用照拿，不需要 `McpAppAPIClient`**。

**被否方案**：per-App 动态生成 HTML（安全面不可控、无法预声明给宿主审查）。

### D2 — 工具双层：模型可见的语义工具 + App-only 的细粒度工具 ✅

**决策**：

```
模型可见（visibility 省略或 ["model","app"]）
  open_customer_risk_workbench   ← 语义化、任务级、数量少
  analyze_customer_risk

App-only（visibility: ["app"]）
  nb_surface_list / nb_surface_get / nb_surface_save / nb_surface_action
  ← 细粒度、高频、确定性，不进模型工具列表
```

**理由（修正过的）**：常见论证是"50 张表 × CRUD = 几百个工具"——**在 NocoBase 不成立**。`crud-tool.ts:722-744` 生成的是 **6 个参数化工具**（`resource` 是入参不是工具名），表再多也是 6 个。

真正的理由是：**通用 CRUD 逼模型自己拼 `filter`/`appends`/`fields`，语义层级太低、易错、且绕过业务约束**。模型应该说"打开高风险客户工作台"，不是说"给我 SELECT * FROM customers WHERE risk>0.8"。

规范支持：`_meta.ui.visibility: ["app"]` 使工具"only callable by Apps (hidden from the model)"，官方 Patterns 文档明确其用途是"UI-driven actions like updating server-side state, polling, or other interactions that shouldn't appear in the model's tool list"。

> ⚠️ `visibility` **省略时默认 `["model","app"]`**。SDK 的 `isToolVisibilityModelOnly`/`isToolVisibilityAppOnly` 只对**单元素数组**返回 true，不是通用子集判断——别拿它们做权限判断。

### D3 — Blueprint 是源码，不是 HTML ✅

模型生成 **NocoBase Blueprint**（collection / dataSource / FlowModel tree / blocks / fields / actions / permissions / workflow bindings），经 `exportBlueprint` / `applyBlueprint` 落地，纳入 Git。**绝不让模型直接生成 HTML。**

参考 Excalidraw：它让模型生成标准 Excalidraw JSON，而不是 React 代码。中间格式稳定 → 可校验、可版本化、可回滚。

### D4 — Human / Agent 双体验，不做"一套页面响应式适配" ✅

```
同一业务模型
├── Human Experience：完整 NocoBase 页面（导航、多标签、设计器、面包屑）
└── Agent Experience：任务导向的精简 Surface
```

共享：数据源、FlowModel、区块/字段组件、Action、权限、工作流、模板、Blueprint。
不共享：页面密度、导航结构、工具栏、配置入口、管理菜单。

需要复杂操作时，Surface 用 `app.openLink({url})` 深链进完整页面（draw.io 的 "Open in draw.io" 即此模式）。

> 沙箱无 `allow-popups`，**必须用 `app.openLink()`，不能用 `<a target="_blank">`**。

### D5 — `McpAppAPIClient` / Mode A 降级为独立 spike ⚠️

**原计划**把"把 `APIClient.request()` 通用翻译成 `callServerTool`"作为主路线。**现降级。**

两个理由：

1. **与 D2 冲突**：通用翻译意味着 iframe 能发任意 `resource_list`——**等于把整个 CRUD 面重新暴露给沙箱**，D2 的分层收益被自己抵消。
2. **无生产先例**：drawio / Excalidraw / Mapbox / Elastic 都不这么做。没有先例意味着没有踩坑地图。

**新定位**：独立探索性 spike（2 周），成功是巨大杠杆（全部 v2 区块一次性可用），失败不阻塞 Surface-first 的交付。

---

## 2. Surface 目录（第一批）

所有 URI **必须是 `ui://` scheme**——`surface://` 之类自定义 scheme 会被宿主拒绝，且 SDK 的 `getToolUiResourceUri` 遇到非 `ui://` 开头会**抛异常而非返回 undefined**。

| URI | 用途 | 关键入参 |
|---|---|---|
| `ui://nocobase/surface/record-list` | 列表 + 筛选 + 分页 | collection, filter, fields, actions |
| `ui://nocobase/surface/record` | 单记录详情 | collection, filterByTk, appends |
| `ui://nocobase/surface/form` | 创建/编辑表单 | collection, mode, initialValues |
| `ui://nocobase/surface/dashboard` | 图表聚合 | charts[], filter |
| `ui://nocobase/surface/approval` | 审批工作台 | taskFilter, actions |
| `ui://nocobase/surface/timeline` | 时间线 | collection, dateField |
| `ui://nocobase/surface/kanban` | 看板 | collection, groupField |
| `ui://nocobase/surface/workflow-run` | 工作流执行态 | executionId |
| `ui://nocobase/surface/blueprint-preview` | Blueprint 预览（生成场景） | blueprint |

每个 Surface 的资源 `_meta.ui`：

```js
_meta: { ui: {
  csp: {
    resourceDomains: [<NocoBase 源，用于字体/附件>],
    connectDomains: [],          // 数据走 tools/call，不需要 connect-src
  },
  prefersBorder: true,
}}
```

> draw.io 的 CSP 只声明了实际用到的 `resourceDomains` + `connectDomains`，未声明 `frameDomains`/`baseUriDomains`/`permissions`。**最小声明原则**——每多一个域就是多一份攻击面。

---

## 3. 工具分层规范

### 命名与可见性

| 层 | 前缀 | `visibility` | 例 |
|---|---|---|---|
| 模型可见 | `open_*` / `analyze_*` / `explain_*` | 省略 | `open_customer_risk_workbench` |
| App-only | `nb_*` | `["app"]` | `nb_surface_list` |

### App-only 工具集（第一批，5 个）

```
nb_surface_list      { surfaceToken, filter?, sort?, page?, pageSize? }
nb_surface_get       { surfaceToken, filterByTk, appends? }
nb_surface_save      { surfaceToken, filterByTk?, values }
nb_surface_action    { surfaceToken, action, params }     // 自定义 action / 工作流触发
nb_surface_meta      { surfaceToken }                      // 字段元数据、可用 action
```

**关键设计：`surfaceToken`**。App-only 工具**不接受裸的 `resource` 名**——那等于把通用 CRUD 面暴露给沙箱（D5 否掉的正是这个）。改为：模型可见工具在返回时签发一个 `surfaceToken`，服务端据此解析出**已授权的** collection + 允许的 action + 行级 filter 范围。

`surfaceToken` 须 HMAC 签名并绑定：调用主体、角色、collection、允许的 action 集合、TTL。这与 MRTR 的 `requestState` 是同一类问题——v2 SDK 提供了 `createRequestStateCodec({key})` + `ServerOptions.requestState.verify`，可直接复用其思路。

### 结果双通道

```js
return {
  content: [{ type: "text", text: "找到 12 位高风险客户，最高 C1024（风险 0.93）" }],  // 给模型：紧凑摘要
  structuredContent: { rows: [...], total: 12, schema: {...} },                        // 给 UI：完整数据
  _meta: { ui: { resourceUri: "ui://nocobase/surface/record-list" } },
};
```

> `structuredContent` **不进模型上下文**，`_meta` 同理。已有的七个摘要器（`plugin-data-source-manager/src/server/mcp-post-processors.ts`、`plugin-data-source-main/src/server/mcp-post-processors.ts`）正好做 `content` 侧；`structuredContent` 走原始数据。

---

## 4. 数据模型

```
mcpApps            id, name, title, description, enabled, version,
                   surfaceType, flowModelUid, hostProfiles[]
mcpAppVersions     appId, version, blueprintSnapshot, htmlDigest, publishedAt
mcpAppTools        appId, toolName, visibility['model'|'app'], inputSchema,
                   bindingType('surface'|'workflow'|'action'|'custom')
mcpAppSurfaces     surfaceUri, collection, dataSource, allowedActions[],
                   fieldWhitelist[], rowFilter
mcpAppPermissions  appId, roleName, allowedTools[], scope
mcpAppDeployments  appId, env, status, deployedAt
mcpAppHostProfiles name, protocolFlavor('mcp-apps'|'openai-apps'|'mcp-ui'), quirks
```

> 新建 collection 由 `yarn nocobase upgrade` 自动同步，无需迁移文件；后续对已发布表的结构变更才需要 `src/server/migrations/`。

---

## 5. 四层落点

| 层 | 位置 | 职责 |
|---|---|---|
| **协议接入** | `plugin-mcp-server`（增强） | extensions 协商、`resources/*`、`_meta.ui` 注入、**按角色/App/visibility 过滤工具**、OAuth、审计、多宿主适配 |
| **App 管理** | `plugin-mcp-app`（新增） | 上述数据模型、Surface 注册表、`surfaceToken` 签发校验、设计器 UI（client-v2）、`/mcp-app/:uid` 预览布局 |
| **运行时** | `@nocobase/mcp-app-runtime`（新增 core 包） | Surface 渲染壳、HostContext 桥、`app.connect()` 生命周期、语义摘要生成 → `updateModelContext` |
| **CLI/设计器** | `packages/core/cli/src/commands/mcp-app/` | 见下 |

**依赖约束**（`AGENTS.md`）：runtime 只依赖 `@nocobase/client-v2` + `@nocobase/flow-engine`，**不得 import `@nocobase/client`**。

### CLI

```bash
nocobase mcp-app create <name>
nocobase mcp-app dev              # 本地 + 模拟宿主
nocobase mcp-app preview          # /mcp-app/:uid
nocobase mcp-app validate         # 校验 _meta.ui / CSP / ui:// scheme / visibility
nocobase mcp-app build            # 产出 Surface HTML
nocobase mcp-app export-blueprint / apply-blueprint    # 复用已有 flow-surfaces 动作
nocobase mcp-app publish
```

`export-blueprint`/`apply-blueprint` 直接对接 `flow-surfaces` 已有动作，**投入产出比最高**——让可视化搭建与代码化管控在同一份产物上闭环。

---

## 6. 三个 MVP App（难度已按真实成本排序）

### #1 数据查询工作台（最易，先做）

> "打开华北地区高风险客户，并显示最近三个月付款情况"

模型可见：`open_customer_risk_workbench`
App-only：`nb_surface_list`、`nb_surface_get`、`nb_surface_meta`
Surface：`record-list` + `record` + `timeline`

**验证点**：读权限、分页、筛选、关联字段（`appends`）、`updateModelContext` 上下文同步、`openLink` 深链。

### #2 记录编辑表单（中）

> "帮我登记一个新的合作伙伴"

模型生成初始值 → Surface 渲染确定性表单 → 用户补齐 → `nb_surface_save`。

**验证点**：Collection Schema → 表单映射、字段级权限、校验、默认值、关联选择、创建与更新。
**已知难点**：文件上传——二进制不适合走 JSON-RPC，需签名 URL，且要求 CSP `resourceDomains` 放行 NocoBase 源。

### #3 审批工作台（最难，最后做）

> "查看待我审批的高金额采购单"

**为什么最难**（核实过的事实）：依赖 `plugin-workflow-manual`，而该插件——

1. 在**独立包**里，不在 `plugin-workflow`；
2. **没有 OpenAPI 文档**，现有 swagger→工具管线抓不到它；
3. 表单是 Formily UI schema（`node.config.schema`，渲染于 `WorkflowTodo.tsx:393-397`），`x-decorator`/`x-component` 只对 NocoBase React 渲染器有意义。唯一结构化的部分是 `node.config.forms[formKey] = {type,title,actions:[{key,status,values}],collection,dataSource}`。

**做法**：走"用 Surface 直接渲染原生 Formily 表单"，绕开 schema 翻译。资源面用 `workflowManualTasks:listMine|get|submit`（`plugin-workflow-manual/src/server/Plugin.ts:269-274`）。

**验证点**：工作流节点权限、操作二次确认、审计、幂等、高风险工具调用。

> 高风险确认依赖一条规范事实：**View 的 `tools/call` 必须经宿主转发**，宿主 "MAY block or gate messages behind user approval"。这是审批场景安全性的支点——所以 §7 的时序必须画成 `App → Host → Server`，不能是 `App → Server`。

---

## 7. P0：两个缺陷让"权限运行"这一环是空的

本方案多处依赖"按用户、角色、App 过滤工具"和"按 App 隔离权限"。**这两件事目前在代码里都不成立。**

| # | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| 1 | `tools/list` 不做 ACL 过滤，缓存键不含角色 | `mcp-server.ts:119-133`、`plugin.ts:125-130` | 已 CONFIRMED。任意角色枚举同一份工具清单；memoized 数组在同 package pattern 的所有调用者间逐字共享 |
| 2 | **OAuth scope 从不强制** | `service.ts:719-797` | 只校验 `iss`/`aud`，**从不读 `scope` claim**；桥接 token（`:598-618`）不带 `roleName`，经 `setCurrentRole` 静默继承默认角色。**`mcp` token 与 `api` token 权限完全相同** |

缺陷 2 尤其致命：`mcpAppPermissions` 这张表在 token 层面**根本无法落地**——无论怎么配，token 拿到的都是用户默认角色的全量权限。

第三项（异步任务 CANCELED 非终态、结果被无条件清理）只阻塞 Tasks 扩展，可延后。

---

## 8. 路线图（Surface-first 重排）

**P0（1~2 周）— 修缺陷**
`tools/list` 角色过滤 + 缓存键并入角色；OAuth scope 强制并绑定角色；顺手补 `outputSchema`/`structuredContent`、工具 `annotations`（`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`——现在完全没声明，直接影响宿主是否要求用户确认）。

**P1（1~2 周）— 迁 v2 SDK**
`npx @modelcontextprotocol/codemod@latest v1-to-v2 .`。**人工复核 `resolveTokenFromExtra`（`mcp-server.ts:58-72`）**——v2 headers 是 Web Standard `Headers`，现有方括号取值会**静默返回 undefined 导致鉴权失效**。同时 `inputSchema` 全面改 `z.object({})`，zod 升 ≥4.2。

**P2（3~4 周）— MCP Apps 协议面**
插件内手写 `mcp-apps.ts`（~60 行：`registerAppTool`/`registerAppResource`/`getUiCapability`/`EXTENSION_ID`），**不引 `ext-apps`**（它 peer-depend v1 SDK，且 4 次 v2 迁移全部未合并）。加 `resources` capability。用官方 `ext-apps` 的 `basic-host` + 示例集**作为协议兼容性测试台**（这是它最大的价值，不是作为运行时依赖）。

**P3（4~5 周）— Surface #1 + #2**
`record-list` / `record` / `form` / `timeline` 四个 Surface；`surfaceToken` 签发与校验；MVP App #1、#2 跑通。

**P4（3~4 周）— 工作流协同 + Surface #3**
注册 `mcp` 触发器（`registerTrigger` 是稳定扩展点，已有 3 个包外范例；**客户端也须注册同名 trigger**，否则类型下拉框会抛错）；审批 Surface。

**并行 spike（2 周，随时可启动）— `McpAppAPIClient`**
验证 3~5 类主力区块能否在沙箱内跑通。成功则 Mode A 回归；失败不影响 P2~P4 交付。

---

## 9. 参考实现证据

### 四类项目

| 类别 | 代表 | 对 NocoBase 的价值 |
|---|---|---|
| 可视化查看器 | draw.io、Mapbox、官方 PDF/Map/3D | 最易落地；Surface 模式来源 |
| 生成与编辑器 | Excalidraw、mcp-use Builders | 中间格式 + 渐进预览 |
| **企业业务工作台** | **Elastic Security/Observability**、Azure Storage | **最接近 NocoBase；工具分层来源** |
| 框架与运行时 | `ext-apps`、MCP-UI、mcp-use | 协议测试集、兼容适配层 |

### draw.io 拆解（已完整读码）

`@drawio/mcp-app` v1.0.3，生产端点 `https://mcp.draw.io/mcp`。

**协议层**
- 依赖 `@modelcontextprotocol/sdk@^1.27.1` + `@modelcontextprotocol/ext-apps@^1.1.2` + `zod@^3.25` —— **全在 v1 线**，与 NocoBase 现状一致。
- Node 入口 `sessionIdGenerator: undefined`（**无状态**，与 NocoBase 一致）；Cloudflare Worker 入口反而**有状态**：4 个 Durable Object 分片，且**循环生成 UUID 直到首位十六进制字符 mod 4 命中目标分片**——这是 MCP v1 有状态设计的税，`2026-07-28` 删除会话正是为消灭它。
- 工具 `annotations` 用满四项；`_meta` 里 MCP Apps 标准键与 OpenAI 私有键（`openai/toolInvocation/invoking|invoked`）**并存**——多宿主兼容的实用做法。
- 工具 description 是重资产（40+ 行决策树）：**提示工程写在 description 里，不在 system prompt 里**。

**UI 层**
- 单资源 `ui://drawio/mcp-app.html` 承载全部 26 种图表类型 → **Surface 模式的直接证据**。
- HTML **混合内联**：MCP Apps SDK bundle（~319 KB）+ pako 内联；draw.io viewer / elk / mermaid 走 CDN 并在 `resourceDomains` 声明。**证明大依赖走 CDN + CSP 声明是可行的生产做法**，不必强求零网络面。
- **三个沙箱坑**（其 CLAUDE.md 明写）：沙箱是 `allow-scripts` 但**无 `allow-same-origin`**，Blob URL 的 ESM `import()` 静默失败 → 需 `stripEsmExportsAndAlias()` 剥掉 `export{}` 改 `globalThis.X =`；无 `allow-popups` → 必须 `app.openLink()`；`GraphViewer.processElements()` 要求容器 `offsetWidth` 非零 → 硬加 `min-width: 200px`。
- View 侧用到 `ontoolinputpartial` / `ontoolinput` / `ontoolresult` / `openLink` / `requestDisplayMode` / `getHostContext`；fullscreen 时读 `hostContext.safeAreaInsets.bottom` 给 Claude.ai 悬浮输入框留位，fallback 80px。
- **View 内部没有任何数据回调**——没有 `callServerTool`，数据全由 `ontoolresult` 一次推入。**这是 D5 降级的主要依据。**

### Excalidraw 拆解

`read_me`（返回绘图规范给模型）+ `create_view`（接收标准 Excalidraw JSON）。
**不嵌完整 Excalidraw React 编辑器**——用 `exportToSvg` 全量渲染 + morphdom DOM diff 换取轻量与流式。
流式：`parsePartialElements` 先 `JSON.parse`，失败则在最后一个 `}` 后补闭合数组；仅在元素数变化时重渲染。
终态：SVG 截为 **512px PNG** 经 `app.updateModelContext()` 回传给模型，让模型"看见"结果并迭代。

### 官方 `ext-apps` 的正确用法

**作为协议兼容性金标准与测试台，而非运行时依赖。** 用其示例集验证：extensions 协商、`ui://`、`_meta.ui.resourceUri`、`structuredContent`、`ontoolresult`、`callServerTool`、`updateModelContext`、HostContext、Theme/SafeArea/Fullscreen、CSP、teardown、App-only Tool。

注意其局限：除 `basic-host` 外**不提供生产级宿主**；peer-depend v1 SDK；4 次 v2 迁移尝试全部未合并（详见 `mcp-app-engine.md` §1.5.1）。

---

## 10. 关键实现细则（易错点集中）

| 细则 | 说明 |
|---|---|
| `ui://` scheme | 唯一合法；`getToolUiResourceUri` 遇非 `ui://` **抛异常** |
| MIME | `text/html;profile=mcp-app`，**分号后无空格**；规范化 MIME 解析器会加空格导致比较失败 |
| `_meta.ui` 放置 | 资源侧放在 **`resources/read` 的 content item 上**；工具上的 `csp`/`permissions` **会被宿主忽略**（类型是 `never`） |
| `visibility` 默认 | 省略 = `["model","app"]`；SDK 判别助手只对单元素数组有效 |
| 调用路径 | View 的 `tools/call` **经宿主转发**，宿主可拦截/要求用户确认——安全模型的支点 |
| `updateModelContext` | **覆盖语义**，每次 overwrite 前次；语义摘要必须是**全量快照**不能是增量 |
| 大数据回传 | 先 `updateModelContext` 设上下文，再 `sendMessage` 发简短触发语 |
| 流式安全 | 部分参数是宿主"healed"的 JSON（补齐括号），官方明确 "Don't rely on partial data for critical operations; use it only for preview UI" |
| 流式边界 | 可流式：页面预览、区块增加、图表预览。**不可流式**：建表、改权限、发布工作流、删除/审批/付款 |
| CSP 域名 | 攻击者可控且直接进 header，须过滤 `[;\r\n'" ]` |
| 2026 era 能力探测 | `getClientCapabilities()` 返回 `undefined`，须改读 `ctx.mcpReq.envelope` |
| 资源发现 | 服务端**可以**不在 `resources/list` 列出 `ui://`；宿主应经工具 `_meta.ui.resourceUri` 发现 |

---

## 11. 未决与风险

1. **`surfaceToken` 的粒度**：签发到 collection 级还是行级？行级更安全但要把 filter 塞进 token，长度与轮换是问题。
2. **Surface 与 FlowModel 版本同步**：Mode B 预构建产物内嵌组件版本，NocoBase 升级后旧 Surface 是否仍能渲染新 FlowModel？需要版本协商或强制重建。
3. **文件上传**：二进制不走 JSON-RPC，签名 URL 要求放宽 CSP `resourceDomains`——与最小声明原则冲突。
4. **实时区块**：`WebSocketClient` 在沙箱内不可用；且 OSS 树无 pubsub 适配器（`application.ts:1274` 构造 `PubSubManager` 不传适配器）。实时类区块需降级为轮询或禁用。
5. **多宿主差异**：即使都声称支持 MCP Apps，在 metadata 名称、CSP、`structuredContent`、全屏、HostContext、App-only Tool 上仍有差异——`mcpAppHostProfiles` 就是为此预留。
6. **`McpAppAPIClient` spike 结论**：决定 Mode A 是否回归。
</content>
