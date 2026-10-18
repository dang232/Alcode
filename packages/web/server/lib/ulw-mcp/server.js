// Bundled ULW MCP JSON-RPC server over stdio.
//
// Shape follows `packages/sdk/examples/tools-only/mcp.ts`: newline-delimited
// JSON-RPC on stdin/stdout with `initialize`, `tools/list`, `ping`, and
// `tools/call`. Tool execution itself lives in `tools.js`, which delegates to
// the shared AgentToolkit; this module only translates the wire shape.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createUlwMcpTools } from './tools.js';

const SERVER_INFO = { name: 'ulw-mcp', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

const asId = (value) => (typeof value === 'string' || typeof value === 'number' ? value : null);

export const createUlwMcpHandler = ({ tools = createUlwMcpTools() } = {}) => {
  const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
  const failure = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  const handleObject = async (request) => {
    if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return failure(asId(request?.id), -32600, 'Invalid request');
    }
    if (request.id === undefined) return null;
    const id = asId(request.id);
    const params = request.params ?? {};
    switch (request.method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case 'tools/list':
        return reply(id, { tools: tools.toolDefs });
      case 'ping':
        return reply(id, {});
      case 'tools/call': {
        const name = params.name;
        const result = await tools.callTool(name, params.arguments ?? {});
        return reply(id, result);
      }
      default:
        return failure(id, -32601, 'Method not found');
    }
  };

  const handleLine = async (line) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return JSON.stringify(failure(null, -32700, 'Parse error'));
    }
    const response = await handleObject(parsed);
    return response === null ? null : JSON.stringify(response);
  };

  return { handleObject, handleLine, serverInfo: SERVER_INFO };
};

const isMainModule = () => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
};

if (isMainModule()) {
  const handler = createUlwMcpHandler();
  const lines = createInterface({ input: process.stdin });
  lines.on('line', async (line) => {
    const response = await handler.handleLine(line);
    if (response !== null) process.stdout.write(`${response}\n`);
  });
}
