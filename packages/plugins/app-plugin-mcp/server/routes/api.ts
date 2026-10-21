import type { AppPluginApplication } from '@nocobase/app-server/plugins';
import {
  apiDocsToken,
  apiErrorHandler,
  cliToken,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import { resolveCaller } from '../mcp/caller.js';
import { handleMcpRequest } from '../mcp/server.js';

/**
 * `/api/mcp`: the application as an MCP server over Streamable HTTP. A request authenticates the way the command-line
 * manifest does (a session, an API key, or a credential another plugin recognizes), and its tools are the commands
 * that caller may run, reads only in this version.
 */
export const apiRoutes: AppApiRouteContribution<AppPluginApplication> =
  defineApiRoutes((app) => {
    const router = new Hono();
    router.onError(apiErrorHandler);
    const { container } = app;
    // The transport is stateless: no server-to-client stream to open with GET, no session to end with DELETE. A
    // client told 405 does not keep reconnecting the way it does to an empty stream.
    router.on(
      ['GET', 'DELETE'],
      '/mcp',
      // The same transport as below.
      describeRoute({ hide: true }),
      (context) => context.body(null, 405, { allow: 'POST' }),
    );
    router.post(
      '/mcp',
      // A JSON-RPC transport, not an operation of the API it serves; the API document would make it a command of itself.
      describeRoute({ hide: true }),
      async (context) => {
        const resolution = await resolveCaller(app, context);
        if ('refusal' in resolution) return resolution.refusal;
        const document = await container.resolve(apiDocsToken).getDocument();
        const manifest = container
          .resolve(cliToken)
          .manifestFor(document, resolution.caller);
        return handleMcpRequest({
          app,
          request: context.req.raw,
          commands: manifest.commands,
        });
      },
    );
    return router;
  });
