import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeInstall, claudeStatus, claudeUninstall } from '../src/claude.js';

test('Claude project install preserves unrelated configuration and uninstalls only Hotload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hotload-claude-'));
  try {
    const path = join(directory, '.mcp.json');
    const initial = { custom: { keep: true }, mcpServers: { existing: { command: 'existing-server', args: [] } } };
    await writeFile(path, JSON.stringify(initial));
    const install = await claudeInstall(directory);
    assert.equal(install.scope, 'project');
    const installed = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(installed.custom, initial.custom);
    assert.deepEqual(installed.mcpServers.existing, initial.mcpServers.existing);
    assert.equal((await claudeStatus(directory)).hotloadInstalled, true);
    assert.equal((await claudeUninstall(directory)).removed, true);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), initial);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Claude install refuses to overwrite a conflicting Hotload-named server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hotload-claude-conflict-'));
  try {
    await writeFile(join(directory, '.mcp.json'), JSON.stringify({ mcpServers: { 'hotload-mcp': { command: 'other' } } }));
    await assert.rejects(claudeInstall(directory), /Refusing to replace unrelated/);
    await assert.rejects(claudeUninstall(directory), /Refusing to remove unrelated/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Claude install rejects malformed project configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hotload-claude-invalid-'));
  try {
    await writeFile(join(directory, '.mcp.json'), '{');
    await assert.rejects(claudeInstall(directory), /Cannot read .*Expected property name/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
