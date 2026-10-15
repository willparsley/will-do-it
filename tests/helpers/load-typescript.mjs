import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');

// Exercise the real TS/TSX modules with Node's runner, without adding a second
// frontend bundler. Optional overrides let handler tests isolate HTTP and hooks.
export function loadTypeScript(relativePath, overrides = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const localRequire = name => {
      if (name in overrides) return overrides[name];
      // Node handler tests do not render CSS; browser checks use Next's emitted styles.
      if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? resolve(root, name.slice(2)) : resolve(dirname(filename), name);
        for (const suffix of ['.ts', '.tsx']) if (existsSync(base + suffix)) return load(base + suffix);
      }
      return require(name);
    };
    new Function('require', 'module', 'exports', code)(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load(resolve(root, relativePath));
}
