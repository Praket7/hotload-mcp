import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export type ChildConfig = {
  transport: 'stdio' | 'streamable-http'; command?: string; args?: string[]; cwd?: string;
  url?: string; headers?: Record<string, string>; env?: Record<string, string>;
  watch?: string[]; build?: { command: string; args?: string[] };
  restartDebounceMs?: number; startupTimeoutMs?: number; toolTimeoutMs?: number; maxRestartAttempts?: number; reloadDrainTimeoutMs?: number;
};
export type Config = { version: 1; servers: Record<string, ChildConfig>; codexControl?: { url?: string; socketPath?: string } };
const legacyConfigPath = () => join(homedir(), '.codex-mcp-hotload', 'config.json');
export const configPath = () => process.env.HOTLOAD_MCP_CONFIG ?? process.env.CODEX_MCP_HOTLOAD_CONFIG ?? join(homedir(), '.hotload-mcp', 'config.json');

export async function readConfig(path = configPath()): Promise<Config> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Config;
    if (value.version !== 1 || !value.servers || typeof value.servers !== 'object') throw new Error('expected version 1 and a servers object');
    if (value.codexControl !== undefined) {
      const control = value.codexControl;
      if (!control || typeof control !== 'object' || Array.isArray(control) || (control.url !== undefined && typeof control.url !== 'string') || (control.socketPath !== undefined && typeof control.socketPath !== 'string') || (control.url !== undefined && control.socketPath !== undefined) || (control.url === undefined && control.socketPath === undefined)) throw new Error('expected codexControl to contain either a URL or socketPath');
      if (control.url && !['ws:', 'wss:'].includes(new URL(control.url).protocol)) throw new Error('codexControl.url must use ws or wss');
    }
    for (const [name, server] of Object.entries(value.servers)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error(`invalid server name: ${name}`);
      if (!['stdio', 'streamable-http'].includes(server.transport)) throw new Error(`invalid transport for ${name}`);
      if (server.transport === 'stdio' && !server.command) throw new Error(`stdio server ${name} needs a command`);
      if (server.transport === 'streamable-http' && !server.url) throw new Error(`HTTP server ${name} needs a URL`);
      if (server.url && !['http:', 'https:'].includes(new URL(server.url).protocol)) throw new Error(`invalid URL for ${name}`);
      if (server.reloadDrainTimeoutMs !== undefined && (!Number.isSafeInteger(server.reloadDrainTimeoutMs) || server.reloadDrainTimeoutMs < 0)) throw new Error(`reloadDrainTimeoutMs for ${name} must be a non-negative integer`);
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (path === configPath() && path !== legacyConfigPath()) {
        try { return await readConfig(legacyConfigPath()); } catch (legacyError) { if (!(legacyError as NodeJS.ErrnoException).message.startsWith(`Invalid config ${legacyConfigPath()}: ENOENT`)) throw legacyError; }
      }
      return { version: 1, servers: {} };
    }
    throw new Error(`Invalid config ${path}: ${(error as Error).message}`);
  }
}

export async function writeConfig(config: Config, path = configPath()): Promise<void> {
  const absolute = resolve(path);
  await mkdir(join(absolute, '..'), { recursive: true, mode: 0o700 });
  await writeFile(absolute, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
