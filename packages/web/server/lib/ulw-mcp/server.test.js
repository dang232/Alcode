// JSON-RPC shape tests for the bundled ULW MCP server: the wire contract
// from packages/sdk/examples/tools-only/mcp.ts (initialize, tools/list,
// ping, tools/call, JSON-RPC error codes, notification silence).
import { describe, expect, it, vi } from 'vitest';

import { createUlwMcpHandler } from './server.js';
import { ULW_MCP_TOOL_DEFS } from './tools.js';

const createStubTools = () => {
  const callTool = vi.fn(async (name, args) => ({
    content: [{ type: 'text', text: JSON.stringify({ name, args }) }],
    structuredContent: { name, args },
  }));
  return { toolDefs: ULW_MCP_TOOL_DEFS, callTool };
};

const request = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

describe('ulw-mcp json-rpc handler', () => {
  it('answers initialize with the negotiated protocol version and server info', async () => {
    const handler = createUlwMcpHandler({ tools: createStubTools() });

    const response = await handler.handleObject(request('initialize', { protocolVersion: '2024-11-05' }));

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ulw-mcp', version: expect.any(String) },
      },
    });
  });

  it('lists all ten control-plane tools', async () => {
    const handler = createUlwMcpHandler({ tools: createStubTools() });

    const response = await handler.handleObject(request('tools/list', {}));

    expect(response.result.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'checkpoint',
        'complete',
        'create-goals',
        'dispatch',
        'inspect',
        'record-child-failure',
        'record-child-result',
        'record-evidence',
        'revise-goals',
        'status',
      ].sort(),
    );
  });

  it('answers ping with an empty result', async () => {
    const handler = createUlwMcpHandler({ tools: createStubTools() });

    await expect(handler.handleObject(request('ping', {}))).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    });
  });

  it('routes tools/call to the tool dispatcher with name and arguments', async () => {
    const tools = createStubTools();
    const handler = createUlwMcpHandler({ tools });

    const response = await handler.handleObject(
      request('tools/call', { name: 'status', arguments: { cwd: '/work', sessionId: 'ses-1' } }),
    );

    expect(tools.callTool).toHaveBeenCalledWith('status', { cwd: '/work', sessionId: 'ses-1' });
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ name: 'status', args: { cwd: '/work', sessionId: 'ses-1' } }) }],
        structuredContent: { name: 'status', args: { cwd: '/work', sessionId: 'ses-1' } },
      },
    });
  });

  it('stays silent on notifications without an id', async () => {
    const handler = createUlwMcpHandler({ tools: createStubTools() });

    await expect(handler.handleObject({ jsonrpc: '2.0', method: 'ping', params: {} })).resolves.toBeNull();
    await expect(handler.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }))).resolves.toBeNull();
  });

  it('rejects unknown methods with -32601', async () => {
    const handler = createUlwMcpHandler({ tools: createStubTools() });

    const response = await handler.handleObject(request('tools/burn', {}, 7));

    expect(response).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'Method not found' } });
  });

  it('rejects malformed requests with -32600', async () => {
    const handler = createUlwMcpHandler({ tools: createStubTools() });

    const response = await handler.handleLine(JSON.stringify({ method: 'ping', id: 3 }));

    expect(JSON.parse(response)).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32600, message: 'Invalid request' },
    });
  });

  it('rejects unparsable lines with -32700', async () => {
    const handler = createUlwMcpHandler({ tools: createStubTools() });

    const response = await handler.handleLine('not json at all');

    expect(JSON.parse(response)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  });
});
