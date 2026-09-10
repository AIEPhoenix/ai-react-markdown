import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { readCatalogResource } from './storybook-readiness.mjs';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('catalog probe validates JSON and consumes a complete preview response', async () => {
  await withServer(
    (_req, res) => res.end('{"entries":{}}'),
    async (url) => {
      assert.deepEqual(await readCatalogResource(url, { json: true }), { entries: {} });
      assert.equal(await readCatalogResource(url), true);
    }
  );
});

test('catalog probe times out even after response headers and partial body arrive', async () => {
  await withServer(
    (_req, res) => res.write('<html>'),
    async (url) => {
      await assert.rejects(readCatalogResource(url, { timeoutMs: 50 }), /response timed out/);
    }
  );
});

test('catalog probe reports HTTP and malformed JSON failures', async () => {
  await withServer(
    (req, res) => {
      res.statusCode = req.url === '/missing' ? 404 : 200;
      res.end('not JSON');
    },
    async (url) => {
      await assert.rejects(readCatalogResource(`${url}/missing`), /HTTP 404/);
      await assert.rejects(readCatalogResource(url, { json: true }), /JSON/);
    }
  );
});
