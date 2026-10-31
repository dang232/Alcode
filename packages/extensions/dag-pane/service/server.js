/**
 * Loopback entry for the alcode-builtin-dag-pane guest service.
 *
 * Source for the committed `main.js` bundle: edit this file (and
 * `handlers.js` plus the upstream bridge/engine modules), then regen with
 * `bun ./main.regen.mjs` in this directory. Never hand-edit `main.js`.
 */

import http from 'node:http';
import { Buffer } from 'node:buffer';

import { DAG_SERVICE_MAX_BODY_BYTES, createDagServiceHandlers } from './handlers.js';

const port = Number.parseInt(process.env.ALCODE_SERVICE_PORT ?? process.env.OPENCHAMBER_SERVICE_PORT ?? '', 10);
const token = process.env.ALCODE_SERVICE_TOKEN ?? process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('alcode-builtin-dag-pane service: ALCODE_SERVICE_PORT is missing or invalid.');
  process.exit(1);
}
if (token.length === 0) {
  console.error('alcode-builtin-dag-pane service: ALCODE_SERVICE_TOKEN is missing.');
  process.exit(1);
}

const { handleRequest } = createDagServiceHandlers();

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > DAG_SERVICE_MAX_BODY_BYTES) {
      reject(new Error('body_too_large'));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  request.on('error', reject);
});

const server = http.createServer(async (request, response) => {
  try {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, code: 'OMO_DAG_UNAUTHORIZED' }));
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    let body = {};
    if (request.method === 'POST') {
      const text = await readBody(request);
      if (text.trim().length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: false, code: 'DAG_SERVICE_BODY_MALFORMED' }));
          return;
        }
      }
    }
    const answer = await handleRequest({
      method: request.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    });
    response.writeHead(answer.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer.body));
  } catch {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, code: 'OMO_DAG_SERVICE_FAILED' }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`alcode-builtin-dag-pane service ready on 127.0.0.1:${port}`);
});
