import fs from 'fs';
import path from 'path';

globalThis.document = {
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    appendChild() {},
    remove() {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getContext: () => ({
      fillRect() {}, clearRect() {}, drawImage() {},
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}
    }),
    toDataURL: () => 'data:image/png;base64,MOCK'
  }),
  getElementById: () => null,
  querySelectorAll: () => [],
  body: { appendChild() {} },
  head: { appendChild() {} },
  hidden: false,
  addEventListener() {}
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  location: { pathname: '/', search: '' },
  devicePixelRatio: 1
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.self = globalThis;

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk('/working_dir/c_67074dbfa15258e5/project/src').sort();
let failures = 0;
for (const f of files) {
  // worker.js immediately attaches self.onmessage; safe with globalThis.self
  try {
    await import(`file://${f}`);
  } catch (err) {
    console.error(`IMPORT FAILED: ${f}\n  -> ${err.stack || err.message}`);
    failures++;
  }
}
console.log(`Imported ${files.length} modules. Failures: ${failures}`);
if (failures > 0) process.exit(1);
