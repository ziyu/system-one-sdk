import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.wasm': 'application/wasm' };
const server = createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Invalid path'); return; }
  const requested = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404); response.end('Not found'); return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size, 'cache-control': 'no-cache' });
  createReadStream(file).on('error', () => response.destroy()).pipe(response);
});
server.listen(4173, '127.0.0.1', () => console.log('Browser demos:\nOpenJev: http://localhost:4173/examples/webgpu-demo/\nLaya: http://localhost:4173/examples/laya-webgpu-demo/'));
