/** The Remotion project in a directory: whether it is ready, and its own @remotion/lambda,
 * which is the version its function must have. When this package runs through npx it sits
 * outside the project, so Remotion and its AWS SDK are resolved from the project, never from here. */
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const dependsOn = (pkg, name) => Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
const parents = function* (dir) { for (let d = resolve(dir); ; d = dirname(d)) { yield d; if (dirname(d) === d) return; } };

/** The nearest directory at or above dir whose package.json depends on remotion, else dir. */
export function findProject(dir = process.cwd()) {
  for (const d of parents(dir)) if (dependsOn(readJson(join(d, 'package.json')), 'remotion')) return d;
  return resolve(dir);
}

const MANAGERS = [['pnpm-lock.yaml', 'pnpm install', 'pnpm add --save-exact'], ['yarn.lock', 'yarn install', 'yarn add --exact'],
  ['bun.lock', 'bun install', 'bun add --exact'], ['bun.lockb', 'bun install', 'bun add --exact'], ['package-lock.json', 'npm install', 'npm install --save-exact']];

/** Install and add commands for the package manager whose lockfile is nearest, npm without one. */
export function packageManager(dir) {
  for (const d of parents(dir)) for (const [lockfile, install, add] of MANAGERS) if (existsSync(join(d, lockfile))) return {install, add};
  return {install: 'npm install', add: 'npm install --save-exact'};
}

const installedVersion = (require, name) => { try { return JSON.parse(readFileSync(require.resolve(name + '/package.json'), 'utf8')).version; } catch { return null; } };

/** ready, or the reason it is not and, where one command fixes it, that command. */
export function inspectProject(dir = process.cwd()) {
  const pkg = readJson(join(dir, 'package.json'));
  if (!pkg) return {ready: false, reason: existsSync(join(dir, 'package.json')) ? 'package.json is not valid JSON' : 'no package.json here'};
  if (!dependsOn(pkg, 'remotion')) return {ready: false, reason: 'remotion is not a dependency of this project'};
  const require = createRequire(join(dir, 'package.json')), {install, add} = packageManager(dir);
  const version = installedVersion(require, 'remotion');
  if (!version) return {ready: false, reason: 'Remotion is not installed', fix: install};
  const lambda = `@remotion/lambda@${version}`;
  if (!dependsOn(pkg, '@remotion/lambda')) return {ready: false, reason: '@remotion/lambda is not a dependency', fix: `${add} ${lambda}`};
  const lambdaVersion = installedVersion(require, '@remotion/lambda');
  if (!lambdaVersion) return {ready: false, reason: '@remotion/lambda is not installed', fix: install};
  if (lambdaVersion !== version) return {ready: false, reason: `@remotion/lambda ${lambdaVersion} does not match Remotion ${version}`, fix: `${add} ${lambda}`};
  return {ready: true, dir, name: pkg.name, version};
}

/** The project's own @remotion/lambda, its client and constants, and the AWS SDK clients it ships. */
export async function remotionFrom(dir = process.cwd()) {
  const require = createRequire(join(dir, 'package.json'));
  let entry;
  try { entry = require.resolve('@remotion/lambda'); } catch {
    throw new Error(`No @remotion/lambda found in ${dir}. Run this inside your Remotion project, with @remotion/lambda installed.`);
  }
  // Resolved next to @remotion/lambda, so strict layouts such as pnpm find its own dependencies.
  const fromLambda = createRequire(entry);
  // A CommonJS entry imported from ESM exposes only what the lexer detects; merge default and named exports.
  const load = async id => { const m = await import(pathToFileURL(fromLambda.resolve(id)).href); return m.default && typeof m.default === 'object' ? {...m.default, ...m} : m; };
  const [lambda, client, constants, lambdaSdk, logsSdk] = await Promise.all([load('@remotion/lambda'), load('@remotion/lambda-client'),
    load('@remotion/lambda-client/constants'), load('@aws-sdk/client-lambda'), load('@aws-sdk/client-cloudwatch-logs')]);
  const version = installedVersion(require, 'remotion') ?? installedVersion(fromLambda, 'remotion');
  return {lambda, client, constants, aws: {lambda: lambdaSdk, logs: logsSdk}, version, source: dir};
}
