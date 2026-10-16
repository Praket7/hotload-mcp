import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ChildCallError, Manager } from '../src/manager.js';

async function fixture(config: { reloadDrainTimeoutMs: number }) {
  const directory = await mkdtemp(join(tmpdir(), 'hotload-manager-'));
  const state = join(directory, 'version');
  await writeFile(state, '1');
  const manager = new Manager({ fixture: { transport: 'stdio', command: process.execPath, args: [resolve('tests/fixtures/changing-server.mjs')], env: { FIXTURE_STATE: state, EXTENDED_FIXTURE: '1' }, ...config } });
  await manager.startAll();
  return { manager, directory };
}

test('reload drains a call that completes inside the configured window', async () => {
  const { manager, directory } = await fixture({ reloadDrainTimeoutMs: 500 });
  try {
    const call = manager.callTool('fixture', 'slow', { ms: 100 });
    await delay(20);
    const started = Date.now();
    const reload = await manager.reload('fixture');
    assert.ok(Date.now() - started >= 50, 'reload waits for the active call');
    const result = await call;
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.equal(manager.status()[0]?.state, 'ready');
    assert.ok(reload);
  } finally { await manager.close(); await rm(directory, { recursive: true, force: true }); }
});

test('reload cancels an overlong call, restarts child, and leaves no active call entries', async () => {
  const { manager, directory } = await fixture({ reloadDrainTimeoutMs: 100 });
  try {
    const call = manager.callTool('fixture', 'slow', { ms: 5000 }).then((value) => ({ value }), (error: unknown) => ({ error }));
    await delay(30);
    await manager.reload('fixture');
    const result = await call;
    assert.ok('error' in result && result.error instanceof ChildCallError && result.error.code === 'CALL_INTERRUPTED_BY_RELOAD');
    assert.equal(manager.status()[0]?.state, 'ready');
    assert.equal(manager.status()[0]?.activeCallCount, 0);
    await manager.reload('fixture');
    assert.equal(manager.status()[0]?.activeCallCount, 0, 'repeated reload leaves no tracked abort controllers');
  } finally { await manager.close(); await rm(directory, { recursive: true, force: true }); }
});

test('child tools/list_changed refreshes catalog entries without restarting the child', async () => {
  const { manager, directory } = await fixture({ reloadDrainTimeoutMs: 100 });
  try {
    const beforeGeneration = manager.status()[0]?.generation;
    await manager.callTool('fixture', 'add_tool', {});
    const deadline = Date.now() + 3000;
    while (!manager.registry.get('fixture', 'added_later') && Date.now() < deadline) await delay(20);
    assert.ok(manager.registry.get('fixture', 'added_later'), 'new tool appears in the current registry');
    assert.equal(manager.status()[0]?.generation, beforeGeneration, 'the child process was not restarted');
  } finally { await manager.close(); await rm(directory, { recursive: true, force: true }); }
});
