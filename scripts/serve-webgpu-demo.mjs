import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.wasm': 'application/wasm' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const requested = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404); response.end('Not found'); return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(response);
});
server.listen(4173, '127.0.0.1', () => console.log('WebGPU demo: http://localhost:4173/examples/webgpu-demo/'));
