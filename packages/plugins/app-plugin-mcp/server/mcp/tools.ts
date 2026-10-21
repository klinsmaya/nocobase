/**
 * The MCP tools of a command manifest. Each command the API document describes becomes one tool whose input
 * properties are the command's parameters, so a model fills them the way a person fills the command line. This
 * version offers reads only: a `GET` command without files to send or a download to save.
 */
import type { CliCommand, CliParameter } from '@nocobase/app-server/router';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/** A tool and the command it runs. */
export interface CommandTool {
  readonly tool: Tool;
  readonly command: CliCommand;
}

/** One property of a tool's input schema. */
type PropertySchema = Record<string, unknown>;

/** A tool's name: the command's words joined by `_`, within the characters MCP tool names allow. */
export function toolNameOf(command: CliCommand): string {
  return command.id.replaceAll(':', '_').replaceAll(/[^A-Za-z0-9_-]/gu, '_');
}

/** Whether a command only reads: a `GET` that neither sends a file nor answers with one. */
export function isReadOnlyCommand(command: CliCommand): boolean {
  return (
    command.method === 'GET' &&
    command.output.kind !== 'download' &&
    !command.parameters.some(
      (parameter) => parameter.in === 'file' || parameter.binary,
    )
  );
}

function propertyOf(parameter: CliParameter): PropertySchema {
  const schema: PropertySchema = {};
  switch (parameter.type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
      schema.type = parameter.type;
      break;
    case 'string[]':
      schema.type = 'array';
      schema.items = { type: 'string' };
      break;
    case 'number[]':
      schema.type = 'array';
      schema.items = { type: 'number' };
      break;
    case 'json':
      // Any JSON value; the route validates it.
      break;
  }
  if (parameter.enum) schema.enum = [...parameter.enum];
  if (parameter.default !== undefined) schema.default = parameter.default;
  const description = [
    parameter.description,
    parameter.in === 'path'
      ? 'Path parameter.'
      : parameter.in === 'query'
        ? 'Query parameter.'
        : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  if (description) schema.description = description;
  return schema;
}

function descriptionOf(command: CliCommand): string {
  return [
    command.summary,
    command.description,
    `Runs \`${command.method} ${command.path}\`.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The tool of `command`. */
export function toolOf(command: CliCommand): CommandTool {
  const properties: Record<string, PropertySchema> = {};
  const required: string[] = [];
  for (const parameter of command.parameters) {
    properties[parameter.name] = propertyOf(parameter);
    if (parameter.required) required.push(parameter.name);
  }
  const tool: Tool = {
    name: toolNameOf(command),
    title: command.summary,
    description: descriptionOf(command),
    inputSchema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
    annotations: {
      title: command.summary,
      readOnlyHint: command.method === 'GET',
      destructiveHint: command.method === 'DELETE',
      idempotentHint: command.method !== 'POST',
      openWorldHint: false,
    },
  };
  return { tool, command };
}

/** The tools of the commands a caller may run, reads only, by tool name. */
export function commandToolsOf(
  commands: readonly CliCommand[],
): ReadonlyMap<string, CommandTool> {
  const tools = new Map<string, CommandTool>();
  for (const command of commands) {
    if (!isReadOnlyCommand(command)) continue;
    const entry = toolOf(command);
    // Two commands cannot share words, so two tools cannot share a name; the first wins should a derived name collide.
    if (!tools.has(entry.tool.name)) tools.set(entry.tool.name, entry);
  }
  return tools;
}
