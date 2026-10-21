/**
 * One MCP server per request, in stateless Streamable HTTP mode: the tools are the caller's read-only commands, and a
 * tool call sends the command's request through the application's own router with the caller's credential headers,
 * exactly as the command line would from outside.
 */
import { fillRequest } from '@nocobase/app-cli-client/request';
import type { AppPluginApplication } from '@nocobase/app-server/plugins';
import type { CliCommand } from '@nocobase/app-server/router';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { commandToolsOf, type CommandTool } from './tools.js';

/** Headers of the MCP request that travel with each command's request, so the route sees the same credential. */
const FORWARDED_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'x-api-key',
];
const FORWARDED_PREFIX = 'x-nocobase-';

/** A tool answer longer than this is cut, with a note, so one list cannot fill a model's context. */
const MAX_RESULT_CHARS = 200_000;

export interface McpRequestOptions {
  readonly app: AppPluginApplication;
  /** The MCP request. */
  readonly request: Request;
  /** The commands the caller may run. */
  readonly commands: readonly CliCommand[];
}

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers({
    accept: 'application/json',
    'x-nocobase-client': 'mcp',
  });
  request.headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (FORWARDED_HEADERS.includes(key) || key.startsWith(FORWARDED_PREFIX))
      headers.set(key, value);
  });
  return headers;
}

/** Sends `entry`'s command with `input` through the application's router. */
async function sendCommand(
  options: McpRequestOptions,
  entry: CommandTool,
  input: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<Response> {
  const { app, request } = options;
  const { command } = entry;
  const filled = fillRequest(
    command,
    command.parameters.map(
      (parameter) => [parameter, input[parameter.name]] as const,
    ),
  );
  const base = app.publicBasePath.replace(/\/+$/u, '');
  const path =
    base && filled.path.startsWith(`${base}/`)
      ? filled.path.slice(base.length)
      : filled.path;
  const headers = forwardedHeaders(request);
  const hasBody =
    command.body?.media === 'application/json' &&
    Object.keys(filled.fields).length > 0;
  if (hasBody) headers.set('content-type', 'application/json');
  return app.router.fetch(
    new Request(`http://application${path}`, {
      method: filled.method,
      headers,
      ...(hasBody ? { body: JSON.stringify(filled.fields) } : {}),
      signal,
    }),
  );
}

async function resultOf(response: Response): Promise<CallToolResult> {
  let text = await response.text();
  if (text.length > MAX_RESULT_CHARS)
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n… (${text.length - MAX_RESULT_CHARS} more characters left out)`;
  if (!response.ok)
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `HTTP ${response.status}${text ? `: ${text}` : ''}`,
        },
      ],
    };
  return { content: [{ type: 'text', text }] };
}

/** Answers one MCP request over Streamable HTTP. */
export async function handleMcpRequest(
  options: McpRequestOptions,
): Promise<Response> {
  const { app, request, commands } = options;
  const tools = commandToolsOf(commands);
  const server = new Server(
    { name: `nocobase:${app.appName}`, version: '1' },
    {
      capabilities: { tools: {} },
      instructions:
        'The tools are this NocoBase application’s documented API operations the caller may run, reads only. Each answers the operation’s JSON: `data`, and `meta` for a list.',
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...tools.values()].map(({ tool }) => tool),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
    const entry = tools.get(call.params.name);
    if (!entry)
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${call.params.name}` }],
      } satisfies CallToolResult;
    const response = await sendCommand(
      options,
      entry,
      call.params.arguments ?? {},
      extra.signal,
    );
    return resultOf(response);
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Stateless: nothing outlives the request.
    await transport.close();
  }
}
