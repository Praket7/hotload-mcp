import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
const version = Number(readFileSync(process.env.FIXTURE_STATE, 'utf8'));
if (readFileSync(process.env.FIXTURE_STATE, 'utf8') === 'crash-loop') setTimeout(() => process.exit(17), 100);
const server = new McpServer({ name: 'changing-fixture', version: String(version) });
server.registerTool('echo', { description: version >= 3 ? 'Convert numeric input to text.' : 'Return text.', inputSchema: { text: version >= 3 ? z.number() : z.string() } }, async ({ text }) => ({ content: [{ type: 'text', text: String(text) }] }));
if (process.env.EXTENDED_FIXTURE) {
  server.registerTool('slow', { description: 'Wait until its timer completes or the request is cancelled.', inputSchema: { ms: z.number().int().min(0) } }, async ({ ms }, extra) => await new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ content: [{ type: 'text', text: 'finished' }] }), ms);
    extra.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(extra.signal.reason ?? new Error('cancelled')); }, { once: true });
  }));
  let dynamicToolAdded = false;
  server.registerTool('add_tool', { description: 'Add a tool without restarting this child.', inputSchema: {} }, async () => {
    if (!dynamicToolAdded) {
      dynamicToolAdded = true;
      server.registerTool('added_later', { description: 'Added dynamically.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'dynamic' }] }));
    }
    return { content: [{ type: 'text', text: 'added' }] };
  });
}
server.registerTool('crash_child', { description: 'Crash the child to exercise recovery.', inputSchema: {} }, async () => { setTimeout(() => process.exit(17), 100); return { content: [{ type: 'text', text: 'child exiting' }] }; });
if (version >= 2) server.registerTool('git_branch', { description: 'Return the fixture branch.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'main' }] }));
serveStdio(() => server);
