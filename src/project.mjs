/** The Remotion project in a directory: whether it is ready, and its own @remotion/lambda,
 * which is the version its function must have. When this package runs through npx it sits
 * outside the project, so Remotion is resolved from the project directory, not from here. */
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function inspectProject(dir = process.cwd()) {
  const packagePath = join(dir, 'package.json');
  if (!existsSync(packagePath)) return {ready: false, reason: 'no package.json here'};
  let pkg; try { pkg = JSON.parse(readFileSync(packagePath, 'utf8')); } catch { return {ready: false, reason: 'package.json is not valid JSON'}; }
  const deps = {...pkg.dependencies, ...pkg.devDependencies};
  if (!deps.remotion) return {ready: false, reason: 'remotion is not a dependency of this project'};
  if (!existsSync(join(dir, 'node_modules'))) return {ready: false, reason: 'node_modules is missing; run npm install first'};
  if (!deps['@remotion/lambda']) return {ready: false, reason: '@remotion/lambda is not installed; run npm install @remotion/lambda'};
  const entryPoint = ['src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx', 'remotion/index.ts', 'remotion/index.tsx'].find(candidate => existsSync(join(dir, candidate)));
  let version = null;
  try { version = JSON.parse(readFileSync(join(dir, 'node_modules/remotion/package.json'), 'utf8')).version; } catch {}
  return {ready: true, dir, name: pkg.name, entryPoint, version};
}

/** The project's own @remotion/lambda and @remotion/lambda-client, else the ones next to this package. */
export async function remotionFrom(dir = process.cwd()) {
  try {
    const require = createRequire(join(dir, 'package.json'));
    // A CommonJS entry imported from ESM exposes only what the lexer detects; merge default and named exports.
    const load = async id => { const m = await import(pathToFileURL(require.resolve(id)).href); return m.default && typeof m.default === 'object' ? {...m.default, ...m} : m; };
    const [lambda, client, constants] = await Promise.all([load('@remotion/lambda'), load('@remotion/lambda-client'), load('@remotion/lambda-client/constants')]);
    const version = JSON.parse(readFileSync(require.resolve('remotion/package.json'), 'utf8')).version;
    return {lambda, client, constants, version, source: dir};
  } catch {
    const [lambda, client, constants] = await Promise.all([import('@remotion/lambda'), import('@remotion/lambda-client'), import('@remotion/lambda-client/constants')]);
    const version = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('remotion/package.json'), 'utf8')).version;
    return {lambda, client, constants, version, source: 'package'};
  }
}
