/**
 * Who calls the MCP endpoint, as a manifest caller: the application's command-line resolvers when a plugin registered
 * any (an agents plugin tells a person from a run and attaches the business actions held), otherwise the person the
 * authentication plugin recognizes, holding no business actions, so that commands naming one are withheld.
 */
import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import type { AppPluginApplication } from '@nocobase/app-server/plugins';
import {
  ApiError,
  apiErrorHandler,
  cliToken,
  type CliCaller,
} from '@nocobase/app-server/router';
import type { Context } from 'hono';

/** The caller, or the response that refuses the request. */
export type CallerResolution =
  { readonly caller: CliCaller } | { readonly refusal: Response };

const MCP_DOMAIN = 'mcp';

function unauthenticated(context: Context): Response {
  return apiErrorHandler(
    new ApiError({
      status: 'UNAUTHENTICATED',
      reason: 'MCP_UNAUTHENTICATED',
      domain: MCP_DOMAIN,
      message: 'Sign in, or present an API key.',
    }),
    context,
  );
}

/** Resolves who calls `context`, the way the command-line manifest does. */
export async function resolveCaller(
  app: AppPluginApplication,
  context: Context,
): Promise<CallerResolution> {
  const { container } = app;
  const cli = container.resolve(cliToken);
  if (cli.hasCallers()) {
    const caller = await cli.callerOf(context);
    return caller ? { caller } : { refusal: unauthenticated(context) };
  }
  const authentication = container.resolve(authenticationToken);
  let caller: CliCaller | undefined;
  const authenticated = context as Context<AuthEnv, string>;
  const refusal = await authentication.required()(authenticated, async () => {
    const auth = authenticated.get('auth');
    if (!auth) return;
    caller = {
      kind: 'person',
      userId: auth.user.id,
      displayName: auth.user.name || auth.user.email,
    };
  });
  if (refusal instanceof Response) return { refusal };
  return caller ? { caller } : { refusal: unauthenticated(context) };
}
