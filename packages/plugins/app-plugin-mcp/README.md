# @nocobase/app-plugin-mcp

Serves the application as an [MCP](https://modelcontextprotocol.io) server at `<APP_BASE_PATH>/api/mcp`, over Streamable HTTP, so an agent host such as a desktop assistant, an IDE or another application's agent can use the application's API as tools.

## What the tools are

The tools are the application's command manifest, the same one the command line and the online agent's shell use: every operation the API document describes becomes a command, and this plugin offers each command the caller may run as a tool named by the command's words joined with `_`, such as `expense_claims_list`. The tool's input properties are the command's parameters, as they appear on the command line; its description carries the operation's summary and the request it runs. This version offers reads only: a `GET` command that neither sends a file nor answers with one. Writes are planned, with their `confirm` question carried to the host.

A tool call sends the command's request through the application's own router, with the credential headers of the MCP request (`authorization`, `cookie`, `x-api-key` and every `x-nocobase-*` header), so the route sees the same caller and applies its own permission checks. The tool answers the operation's JSON as text, or a tool error with the HTTP status and body when the request fails.

## Who may call

A request authenticates the way `GET /api/cli/manifest` does. When a plugin registered command-line callers (the agents plugin does, telling a person from an agent's run and attaching the business actions the caller holds), the same resolvers decide who calls and which commands they are offered. Without one, the authentication plugin's session or API key names the person; such a caller holds no business actions, so a command naming one is withheld, while every route still authorizes each request itself. An anonymous request answers `401 MCP_UNAUTHENTICATED` before any MCP exchange.

The transport is stateless: no MCP session is kept between requests, each `POST` answers JSON rather than opening an event stream, and `GET` and `DELETE` answer `405` with `Allow: POST`, since there is no server-to-client stream to open and no session to end.

## Connecting a host

Register the plugin in the application's `server/plugins.ts`, then give the host the URL and a credential, for example an API key created with `POST <APP_BASE_PATH>/api/apiKeys`:

```json
{
  "mcpServers": {
    "nocobase": {
      "type": "http",
      "url": "http://127.0.0.1:13000/main/api/mcp",
      "headers": { "x-api-key": "<key>" }
    }
  }
}
```

A session token works the same way as `Authorization: Bearer <token>` when the application's authentication issues bearer sessions.

## Verification

```bash
pnpm --filter @nocobase/app-plugin-mcp lint
pnpm --filter @nocobase/app-plugin-mcp typecheck
pnpm --filter @nocobase/app-plugin-mcp test
pnpm --filter @nocobase/app-plugin-mcp build
```
