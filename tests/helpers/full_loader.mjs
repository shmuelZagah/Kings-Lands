import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const helpersDir = path.dirname(fileURLToPath(import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { shortCircuit: true, url: pathToFileURL(path.join(helpersDir, 'three_mock.mjs')).href };
  }
  if (specifier.startsWith('three/')) {
    return { shortCircuit: true, url: pathToFileURL(path.join(helpersDir, 'three_extras_mock.mjs')).href };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const content = fs.readFileSync(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${content};`
    };
  }
  return nextLoad(url, context);
}
