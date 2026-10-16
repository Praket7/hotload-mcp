# Hotload MCP

Hotload MCP is a stable MCP gateway for developing child MCP servers. Codex and Claude Code connect to the same fixed Hotload tools while Hotload reloads children and refreshes their catalogs.

Use Node.js 20 or newer. Version 0.3.0 adds safe reload draining and cancellation, child `tools/list_changed` support, and a Claude Code project installer. The default gateway remains stable for both clients.

## Install

Run the CLI directly with `npx` or install it globally:

```bash
npm install --global hotload-mcp@0.3.0
hotload-mcp --help
```

Hotload stores its configuration at `~/.hotload-mcp/config.json`. Set `HOTLOAD_MCP_CONFIG` to use another file. The previous `CODEX_MCP_HOTLOAD_CONFIG` environment variable and `~/.codex-mcp-hotload/config.json` location remain supported for existing installations.

## Connect Codex

Add this entry to `~/.codex/config.toml`:

```toml
[mcp_servers.hotload-mcp]
command = "npx"
args = ["--yes", "hotload-mcp@0.3.0", "serve"]
```

Restart Codex once after adding the gateway. Add child servers through the CLI:

```bash
hotload-mcp add my-server --cwd ~/Projects/my-server -- node dist/index.js
```

After changing a child, call `hotload_reload_server`, then search for its current tools with `hotload_search_tools`. Call them with `hotload_call_tool` and the current `schemaHash`. Hotload validates arguments and rejects missing or stale schema hashes.

## Connect Claude Code

From the project directory, run:

```bash
hotload-mcp claude install
hotload-mcp claude status
```

Install safely adds a `hotload-mcp` entry to `.mcp.json` at project scope. It preserves other MCP entries and refuses to replace a conflicting entry with the same name. Status checks for the `claude` executable, a parseable project config, and the expected package/version/command. In Claude Code, use `/mcp` to verify the connection.

To remove the project entry:

```bash
hotload-mcp claude uninstall
```

Uninstall removes only the recognized Hotload entry and preserves the rest of the config. Claude Code uses the same gateway tools as Codex:

- `hotload_list_servers`
- `hotload_search_tools`
- `hotload_call_tool`
- `hotload_reload_server`
- `hotload_server_status`

Reloading a child keeps the Claude conversation connected to Hotload. Search again after reload to discover changed tools, then call through the gateway with the new schema hash.

### Claude Code smoke check

1. Run `hotload-mcp claude install` and confirm the new project entry in `.mcp.json`.
2. Start Claude Code and verify Hotload MCP in `/mcp`.
3. Search for and call a child tool through Hotload.
4. Change or rebuild the child, then call `hotload_reload_server`.
5. Search again and call the updated or newly added child tool in the same conversation.

## Reload and catalog behavior

Intentional reloads mark the child as draining. New calls receive `RELOAD_IN_PROGRESS`; active calls can finish during the configured `reloadDrainTimeoutMs` window, which defaults to 5000 ms. When the window expires, Hotload aborts remaining requests, closes the old child connection to settle any requests the transport does not cancel, and starts the replacement. Interrupted calls return `CALL_INTERRUPTED_BY_RELOAD`. Calls active during an unexpected child disconnect return `CHILD_DISCONNECTED` and the child follows bounded recovery backoff.

Child servers can also change their tool catalog without restarting. Hotload subscribes to child tool-list changes, fetches the updated catalog, atomically replaces that server's registry entries, increments its revision, and logs one concise catalog event. Hotload's own gateway tool list stays fixed.

Set `reloadDrainTimeoutMs` per child to change the drain window:

```json
{
  "version": 1,
  "servers": {
    "my-server": {
      "transport": "stdio",
      "command": "node",
      "args": ["dist/index.js"],
      "reloadDrainTimeoutMs": 5000
    }
  }
}
```

Reload events are written to stderr as one-line JSON. They include tool counts, sorted added/removed/changed names, revision, outcome, and duration. Tool schemas, call arguments, and credentials are not logged.

## Codex native controls

When Hotload can reach the Codex app-server control socket, `hotload_list_servers` and `hotload_server_status` include directly configured Codex servers. `hotload_reload_server` can request Codex to reload its directly configured servers. Codex queues that refresh for a later active turn; the stable Hotload gateway remains the same-chat path for dynamic child tools.

By default, Hotload checks `$CODEX_HOME/app-server-control/app-server-control.sock`, or `~/.codex/app-server-control/app-server-control.sock` when `CODEX_HOME` is unset. Set `codexControl.socketPath` or `codexControl.url` to use a different endpoint. These controls are optional.

## Development and verification

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Unit tests cover drain completion, forced cancellation and recovery, same-process dynamic catalog updates, and Claude config merge/refusal/uninstall behavior. The Codex app-server end-to-end check covers same-thread gateway discovery, reload, stale-schema rejection, and crash recovery. The interactive Claude Code smoke check above requires Claude Code installed and is not part of automated tests.

## Security

Only register child servers you trust because their commands run as your user. Keep credentials out of the configuration file and use environment variables for secrets. Hotload uses stdio and does not open a network listener.

See [SECURITY.md](SECURITY.md) for more information.
