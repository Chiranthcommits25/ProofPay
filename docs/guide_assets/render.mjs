// Render HTML to PDF with headless Chrome via CDP.
// usage: node render.mjs <input.html> <output.pdf>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , htmlPath, outPath] = process.argv;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9700 + (process.pid % 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--force-color-profile=srgb',
  'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });

for (let i = 0; i < 140; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {}
  await sleep(120);
}

const url = 'file://' + path.resolve(htmlPath);
const created = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
const pending = new Map();
let id = 0;
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
});
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(1100);
await send('Runtime.evaluate', {
  expression: `(async () => {
    try { await document.fonts.ready; } catch (e) {}
    await Promise.all(Array.from(document.images).map(img => img.complete ? 0 : new Promise(r => {
      img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true });
    })));
    return Array.from(document.images).filter(i => !i.naturalWidth).length;
  })()`,
  awaitPromise: true, returnByValue: true,
});
await sleep(500);

const pdf = await send('Page.printToPDF', {
  printBackground: true, paperWidth: 8.27, paperHeight: 11.69,
  marginTop: 0.62, marginBottom: 0.58, marginLeft: 0.7, marginRight: 0.7,
  displayHeaderFooter: true,
  headerTemplate: `<div style="width:100%;padding:0 10mm;font-size:7.4px;color:#64748b;font-family:Helvetica,Arial;display:flex;justify-content:space-between;">
    <span>ProofPay Master Guide &mdash; from zero to technical defence</span><span>Learning Textbook</span></div>`,
  footerTemplate: `<div style="width:100%;padding:0 10mm;font-size:8px;color:#475569;font-family:Helvetica,Arial;display:flex;justify-content:space-between;">
    <span>ProofPay &middot; Chainlink CRE &middot; Hardhat &middot; React</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(pdf.data, 'base64'));
ws.close(); chrome.kill('SIGKILL');
console.log(JSON.stringify({ wrote: outPath, bytes: fs.statSync(outPath).size }));
