import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export const CLAUDE_SERVER_NAME = 'hotload-mcp';
const PACKAGE = 'hotload-mcp@0.3.0';
const configPath = (cwd = process.cwd()) => join(cwd, '.mcp.json');
type ClaudeConfig = { mcpServers?: Record<string, unknown>; [key: string]: unknown };

async function readProjectConfig(cwd = process.cwd()): Promise<{ path: string; config: ClaudeConfig; exists: boolean }> {
  const path = configPath(cwd);
  try {
    const config = JSON.parse(await readFile(path, 'utf8')) as ClaudeConfig;
    if (!config || typeof config !== 'object' || Array.isArray(config) || (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)))) throw new Error('.mcp.json must contain an object with an optional mcpServers object');
    return { path, config, exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, config: {}, exists: false };
    throw new Error(`Cannot read ${path}: ${(error as Error).message}`);
  }
}

async function writeProjectConfig(path: string, config: ClaudeConfig) {
  await mkdir(join(path, '..'), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function expectedEntry(value: unknown): value is { type: 'stdio'; command: 'npx'; args: ['--yes', string, 'serve'] } {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  const args = entry.args;
  return entry.type === 'stdio' && entry.command === 'npx' && Array.isArray(args) && args.length === 3 && args[0] === '--yes' && args[1] === PACKAGE && args[2] === 'serve';
}

export async function claudeInstall(cwd = process.cwd()) {
  const { path, config } = await readProjectConfig(cwd);
  const servers = config.mcpServers ?? {};
  if (servers[CLAUDE_SERVER_NAME] !== undefined && !expectedEntry(servers[CLAUDE_SERVER_NAME])) throw new Error(`Refusing to replace unrelated MCP server "${CLAUDE_SERVER_NAME}" in ${path}`);
  config.mcpServers = { ...servers, [CLAUDE_SERVER_NAME]: { type: 'stdio', command: 'npx', args: ['--yes', PACKAGE, 'serve'] } };
  await writeProjectConfig(path, config);
  return { installed: true, scope: 'project', path, server: CLAUDE_SERVER_NAME, command: `npx --yes ${PACKAGE} serve` };
}

async function findClaude() {
  const pathExt = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) for (const extension of pathExt) {
    const candidate = join(directory, `claude${extension}`);
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue PATH search */ }
  }
  return null;
}

export async function claudeStatus(cwd = process.cwd()) {
  const [binary, project] = await Promise.all([findClaude(), readProjectConfig(cwd)]);
  const entry = project.config.mcpServers?.[CLAUDE_SERVER_NAME];
  const installed = expectedEntry(entry);
  return { claudeBinary: binary, configPath: project.path, configExists: project.exists, configValid: true, hotloadInstalled: installed, ...(entry !== undefined && !installed ? { hotloadEntryMatchesExpected: false } : {}), expectedCommand: `npx --yes ${PACKAGE} serve`, inSessionCheck: '/mcp' };
}

export async function claudeUninstall(cwd = process.cwd()) {
  const { path, config, exists } = await readProjectConfig(cwd);
  const servers = config.mcpServers ?? {};
  if (servers[CLAUDE_SERVER_NAME] === undefined) return { removed: false, path, reason: 'not_installed' };
  if (!expectedEntry(servers[CLAUDE_SERVER_NAME])) throw new Error(`Refusing to remove unrelated MCP server "${CLAUDE_SERVER_NAME}" from ${path}`);
  const next = { ...servers };
  delete next[CLAUDE_SERVER_NAME];
  if (Object.keys(next).length) config.mcpServers = next;
  else delete config.mcpServers;
  await writeProjectConfig(path, config);
  return { removed: true, path, configPreviouslyExisted: exists };
}
