import path from 'node:path';

import {
  defineServerPlugin,
  type AppServerPlugin,
} from '@nocobase/app-server/plugins';

import routes from './routes/index.js';

const mcpPlugin: AppServerPlugin = defineServerPlugin({
  baseDir: path.resolve(import.meta.dirname, '..'),
  packageName: '@nocobase/app-plugin-mcp',
  routes,
});

export default mcpPlugin;
