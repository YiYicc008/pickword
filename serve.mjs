#!/usr/bin/env node
/**
 * 拾词 · 电子英语单词本 —— 局域网静态服务器（Node 版，零依赖）
 *
 *   node serve.mjs [端口]
 *
 * 与 serve.py 等价，默认端口 8080；被占用时自动顺延。
 * 仅用于「在本机运行」这一种用法：手机、平板连同一 WiFi 打开打印出的地址即可。
 * 公开访问请使用 GitHub Pages 等静态托管，无需本脚本。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORTS = [8080, 8081, 8082, 8090, 8765, 9000];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function localIPv4() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function handler(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';

  // 只允许访问 ROOT 之内的文件
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

async function main() {
  const wanted = Number(process.argv[2]) || 0;
  const candidates = wanted ? [wanted, ...PORTS.filter((p) => p !== wanted)] : PORTS;

  let server = null;
  let port = 0;
  for (const p of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      server = await tryListen(p);
      port = p;
      break;
    } catch {
      /* 端口被占用，尝试下一个 */
    }
  }
  if (!server) {
    console.error('没有可用端口，请手动指定：node serve.mjs 8123');
    process.exit(1);
  }

  const lines = [
    '',
    '==============================================================',
    '  拾词 · 电子英语单词本',
    '==============================================================',
    '',
    `  本机访问（这台电脑）：http://127.0.0.1:${port}/index.html`,
    '  同一 WiFi 下的手机 / 平板访问：',
  ];
  for (const ip of localIPv4()) lines.push(`      http://${ip}:${port}/index.html`);
  lines.push('', '  按 Ctrl+C 停止服务。', '==============================================================', '');

  console.log(lines.join('\n'));

  // 尝试用默认浏览器打开（失败不影响服务）
  const opener = process.platform === 'win32' ? 'start ""'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} http://127.0.0.1:${port}/index.html`, () => {});

  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 800); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
