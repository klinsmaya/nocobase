import {
  authenticationToken,
  type Auth,
} from '@nocobase/app-plugin-authentication';
import { createAppPaths } from '@nocobase/app-server/config';
import type { AppPluginApplication } from '@nocobase/app-server/plugins';
import {
  ApiDocsService,
  apiDocsToken,
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  CliService,
  cliRoute,
  cliToken,
  dataResponse,
  describeRoute,
  emptyResponse,
  findUndeclaredApiRoutes,
  generateApiDocument,
  listResponse,
  type CliCaller,
} from '@nocobase/app-server/router';
import { ServiceContainer } from '@nocobase/service-provider';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { apiRoutes } from '../../server/routes/api.js';
import routes from '../../server/routes/index.js';

const Issue = z
  .object({ id: z.string(), title: z.string() })
  .meta({ ref: 'TrackerIssue' });

/** A small documented API: two reads, one of them behind a business action, and one write. */
function trackerRouter(): Hono {
  const router = new Hono();
  router.onError(apiErrorHandler);
  router.get(
    '/tracker/issues',
    describeRoute({
      tags: ['Tracker'],
      summary: 'List issues',
      operationId: 'trackerListIssues',
      responses: { 200: listResponse(Issue), ...apiErrorResponses },
    }),
    apiValidator(
      'query',
      z.object({
        q: z.string().optional().meta({ description: 'Text to find.' }),
        pageSize: z.coerce.number().int().default(20),
      }),
    ),
    (context) => {
      const { q, pageSize } = context.req.valid('query');
      return context.json({
        data: [{ id: 'i1', title: `Found ${q ?? 'everything'}` }],
        meta: { pageSize, seenBy: context.req.header('authorization') },
      });
    },
  );
  router.get(
    '/tracker/issues/:issueId',
    describeRoute({
      tags: ['Tracker'],
      summary: 'Get an issue',
      operationId: 'trackerGetIssue',
      responses: { 200: dataResponse(Issue), ...apiErrorResponses },
    }),
    apiValidator('param', z.object({ issueId: z.string() })),
    (context) =>
      context.json({
        data: { id: context.req.valid('param').issueId, title: 'A' },
      }),
  );
  router.get(
    '/tracker/stats',
    describeRoute({
      tags: ['Tracker'],
      summary: 'Get the statistics',
      operationId: 'trackerGetStats',
      responses: {
        200: dataResponse(z.object({ open: z.number() })),
        ...apiErrorResponses,
      },
      ...cliRoute({ action: 'tracker.stats/view' }),
    }),
    (context) => context.json({ data: { open: 1 } }),
  );
  router.post(
    '/tracker/issues/:issueId/close',
    describeRoute({
      tags: ['Tracker'],
      summary: 'Close an issue',
      operationId: 'trackerCloseIssue',
      responses: { 204: emptyResponse(), ...apiErrorResponses },
    }),
    (context) => context.body(null, 204),
  );
  return router;
}

const person = { id: 'u1', name: 'Ann', email: 'ann@example.com' };

const allowAuthentication = {
  required: () => async (context, next) => {
    context.set('auth', { user: person, session: {} });
    await next();
  },
} as unknown as Auth;

const denyAuthentication = {
  required: () => (context) =>
    context.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required' },
      401,
    ),
} as unknown as Auth;

interface TestApplication {
  readonly app: AppPluginApplication;
  readonly cli: CliService;
  /** The whole application, `/api` included. */
  readonly root: Hono;
}

async function createApplication(
  authentication: Auth,
  publicBasePath = '',
): Promise<TestApplication> {
  const container = new ServiceContainer();
  const root = new Hono();
  const api = new Hono();
  api.route('/', trackerRouter());
  const docs = new ApiDocsService();
  docs.attach({
    api,
    describe: () => ({
      info: { title: 'Tracker', version: '0.0.0' },
      ...(publicBasePath ? { servers: [{ url: publicBasePath }] } : {}),
    }),
  });
  const cli = new CliService();
  container.instance(authenticationToken, authentication);
  container.instance(apiDocsToken, docs);
  container.instance(cliToken, cli);
  const app: AppPluginApplication = {
    appName: 'main',
    publicBasePath,
    config: { app: { name: 'main', publicBasePath } },
    paths: createAppPaths({ rootDir: '/missing' }),
    router: root,
    container,
  };
  api.route('/', await apiRoutes.createRouter(app));
  // The host strips the base path before the application's router, as `publicBasePath` describes a public URL.
  root.route('/api', api);
  return { app, cli, root };
}

async function connect(
  application: TestApplication,
  headers: Record<string, string> = { authorization: 'Bearer token-1' },
): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' });
  const transport = new StreamableHTTPClientTransport(
    new URL('http://application/api/mcp'),
    {
      fetch: (url, init) => application.root.request(url, init),
      requestInit: { headers },
    },
  );
  await client.connect(transport);
  return client;
}

describe('@nocobase/app-plugin-mcp', () => {
  it('offers the read commands the API document describes as tools', async () => {
    const application = await createApplication(allowAuthentication);
    const client = await connect(application);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'tracker_issues_get',
      'tracker_issues_list',
    ]);
    const list = tools.find((tool) => tool.name === 'tracker_issues_list');
    expect(list).toMatchObject({
      description: expect.stringContaining('GET /api/tracker/issues'),
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Text to find. Query parameter.' },
          'page-size': { type: 'integer', default: 20 },
        },
      },
      annotations: { readOnlyHint: true },
    });
    expect(list?.inputSchema.required).toBeUndefined();
    await client.close();
  });

  it('runs a tool through the application with the caller’s credential', async () => {
    const application = await createApplication(allowAuthentication);
    const client = await connect(application);
    const result = await client.callTool({
      name: 'tracker_issues_list',
      arguments: { q: 'bugs', 'page-size': 5 },
    });
    expect(result.isError).toBeFalsy();
    const [content] = result.content as { type: string; text: string }[];
    expect(content?.type).toBe('text');
    expect(JSON.parse(content?.text ?? '')).toEqual({
      data: [{ id: 'i1', title: 'Found bugs' }],
      meta: { pageSize: 5, seenBy: 'Bearer token-1' },
    });
    const one = await client.callTool({
      name: 'tracker_issues_get',
      arguments: { issueId: 'i9' },
    });
    expect(
      JSON.parse((one.content as { text: string }[])[0]?.text ?? ''),
    ).toEqual({ data: { id: 'i9', title: 'A' } });
    await client.close();
  });

  it('keeps the application’s base path out of the forwarded request', async () => {
    const application = await createApplication(allowAuthentication, '/main');
    const client = await connect(application);
    const { tools } = await client.listTools();
    expect(tools[1]?.description).toContain('GET /main/api/tracker/issues');
    const result = await client.callTool({
      name: 'tracker_issues_list',
      arguments: {},
    });
    expect(result.content).toMatchObject([{ type: 'text' }]);
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it('answers a failed request as a tool error, and an unknown tool too', async () => {
    const application = await createApplication(allowAuthentication);
    const client = await connect(application);
    const result = await client.callTool({
      name: 'tracker_issues_list',
      arguments: { 'page-size': 'many' },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toMatch(
      /^HTTP 400/u,
    );
    const unknown = await client.callTool({ name: 'nothing', arguments: {} });
    expect(unknown.isError).toBe(true);
    await client.close();
  });

  it('rejects an anonymous request before any MCP exchange', async () => {
    const application = await createApplication(denyAuthentication);
    const response = await application.root.request('/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });

  it('asks the command-line resolvers who calls once a plugin registered one', async () => {
    const application = await createApplication(denyAuthentication);
    const caller: CliCaller = {
      kind: 'person',
      userId: 'u2',
      displayName: 'Bob',
      actions: new Set(['tracker.stats/view']),
    };
    application.cli.addCaller((context) =>
      context.req.header('x-api-key') === 'k1' ? caller : null,
    );
    const client = await connect(application, { 'x-api-key': 'k1' });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('tracker_stats_list');
    await client.close();
    const refused = await application.root.request('/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-api-key': 'other',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(refused.status).toBe(401);
    await expect(refused.json()).resolves.toMatchObject({
      error: { reason: 'MCP_UNAUTHENTICATED' },
    });
  });

  it('withholds a command whose action the caller does not hold', async () => {
    const application = await createApplication(allowAuthentication);
    const client = await connect(application);
    const { tools } = await client.listTools();
    // Without an agents plugin nobody attaches business actions, so a command naming one is withheld.
    expect(tools.map((tool) => tool.name)).not.toContain('tracker_stats_list');
    expect(tools.map((tool) => tool.name)).toContain('tracker_issues_list');
    await client.close();
  });

  it('declares one hidden API Route and stays out of the API document', async () => {
    expect(routes).toEqual([apiRoutes]);
    const application = await createApplication(allowAuthentication);
    const router = await apiRoutes.createRouter(application.app);
    expect(findUndeclaredApiRoutes(router)).toEqual([]);
    const document = await generateApiDocument(router, {
      info: { title: 'MCP', version: '0.0.0' },
    });
    expect(document.paths ?? {}).toEqual({});
  });
});
