/** The Remotion project in a directory: whether it is ready, and its own @remotion/lambda,
 * which is the version its function must have. When this package runs through npx it sits
 * outside the project, so Remotion and its AWS SDK are resolved from the project, never from here. */
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {FLOOR, compareVersions} from './version.mjs';

const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const dependsOn = (pkg, name) => Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
const parents = function* (dir) { for (let d = resolve(dir); ; d = dirname(d)) { yield d; if (dirname(d) === d) return; } };

/** The directory of the nearest package.json at or above dir, as Remotion's own CLI finds its root; dir without one. */
export function findProject(dir = process.cwd()) {
  for (const d of parents(dir)) if (existsSync(join(d, 'package.json'))) return d;
  return resolve(dir);
}

const MANAGERS = [['pnpm-lock.yaml', 'pnpm install', 'pnpm add'], ['yarn.lock', 'yarn install', 'yarn add'],
  ['bun.lock', 'bun install', 'bun add'], ['bun.lockb', 'bun install', 'bun add'], ['package-lock.json', 'npm install', 'npm install']];
const EXACT = {'yarn add': 'yarn add --exact', 'bun add': 'bun add --exact'};

/** Commands of the package manager whose lockfile is nearest, npm without one: install, add at an
 * exact version as Remotion's packages need, and addRange for a package that may move on. */
export function packageManager(dir) {
  const found = [...parents(dir)].flatMap(d => MANAGERS.filter(([lockfile]) => existsSync(join(d, lockfile))))[0];
  const [, install, addRange] = found ?? [null, 'npm install', 'npm install'];
  return {install, add: EXACT[addRange] ?? addRange + ' --save-exact', addRange};
}

/** A package resolved from dir's own node_modules, or a workspace root's above it. Node also
 * walks up into unrelated parents, which would count a project cloned into a directory with
 * its own Remotion as installed; those are not accepted. */
function ownPackage(dir, name) {
  for (const d of parents(dir)) {
    const file = join(d, 'node_modules', name, 'package.json');
    if (existsSync(file)) return d === resolve(dir) || readJson(join(d, 'package.json'))?.workspaces ? file : null;
  }
  return null;
}
const installedVersion = (dir, name) => { const file = ownPackage(dir, name); return file ? readJson(file)?.version ?? null : null; };

// Remotion's common entry points, in its own order. Without @remotion/cli no remotion.config can be in
// effect, since a config imports from it, and these paths are then all of Remotion's rule.
const ENTRY_CANDIDATES = ['src', 'remotion', 'src/remotion'].flatMap(d => (d === 'src' ? ['ts', 'tsx', 'js', 'mjs'] : ['tsx', 'ts', 'js', 'mjs']).map(ext => `${d}/index.${ext}`));
const NO_ENTRY = 'no Remotion entry point: none set in remotion.config, and no src/index.ts or other common path';

/** The project's @remotion/cli: its own, or the one its @remotion/lambda depends on, which strict
 * layouts such as pnpm do not show from the project root. */
function cliPath(dir) {
  if (ownPackage(dir, '@remotion/cli')) return createRequire(join(dir, 'package.json')).resolve('@remotion/cli');
  const lambda = ownPackage(dir, '@remotion/lambda');
  try { return lambda ? createRequire(lambda).resolve('@remotion/cli') : null; } catch { return null; }
}

// Runs in a process of its own, in the project: Remotion refuses to load twice into one process, and
// ours may go on to load another project's version.
const ENTRY_SCRIPT = `
const {CliInternals} = require(process.argv[1]);
const done = result => process.stdout.write('\\n' + JSON.stringify(result) + '\\n');
const dir = process.argv[2];
CliInternals.loadConfig(dir)
  .then(() => done({file: CliInternals.findEntryPoint({args: [], logLevel: 'error', remotionRoot: dir, allowDirectory: false}).file}))
  .catch(error => done({error: String(error.message).split('\\n')[0]}));
`;

/** The entry point as Remotion finds it. With the project's @remotion/cli, that CLI decides: set in
 * remotion.config, else a common path such as src/index.ts. Without one, the common paths. */
export function findEntryPoint(dir) {
  const cli = cliPath(dir);
  if (!cli) { const found = ENTRY_CANDIDATES.find(f => existsSync(join(dir, f))); return found ? {file: join(dir, found)} : {reason: NO_ENTRY}; }
  let output;
  try { output = execFileSync(process.execPath, ['-e', ENTRY_SCRIPT, cli, dir], {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000}); }
  catch (error) { return {reason: `@remotion/cli could not be loaded: ${String(error.stderr || error.message).trim().split('\n').find(line => /\S/.test(line) && !/^\s+at /.test(line)) ?? 'unknown error'}`}; }
  const result = JSON.parse(output.trim().split('\n').pop());
  if (result.error) return {reason: `remotion.config could not be loaded: ${result.error}`};
  return result.file ? {file: result.file} : {reason: NO_ENTRY};
}

/** ready, or the reason it is not and, where one command fixes it, that command. In Remotion's order of
 * what makes a project renderable: remotion, an entry point, and only then @remotion/lambda, so a
 * package that merely depends on remotion, with no video in it, is never offered a change. */
export async function inspectProject(dir = process.cwd()) {
  const pkg = readJson(join(dir, 'package.json'));
  if (!pkg) return {ready: false, reason: existsSync(join(dir, 'package.json')) ? 'package.json is not valid JSON' : 'no package.json here'};
  if (!dependsOn(pkg, 'remotion')) return {ready: false, reason: 'remotion is not a dependency of this project'};
  const {install, add} = packageManager(dir);
  const version = installedVersion(dir, 'remotion');
  if (!version) return {ready: false, reason: 'Remotion is not installed', fix: install};
  if (compareVersions(version, FLOOR) < 0) return {ready: false, reason: `Remotion ${version} is below ${FLOOR}, the oldest release BlitzFrames supports`};
  const entry = findEntryPoint(dir);
  if (!entry.file) return {ready: false, reason: entry.reason};
  if (!dependsOn(pkg, '@remotion/lambda')) return {ready: false, reason: '@remotion/lambda is not a dependency', fix: `${add} @remotion/lambda@${version}`};
  const lambdaVersion = installedVersion(dir, '@remotion/lambda');
  if (!lambdaVersion) return {ready: false, reason: '@remotion/lambda is not installed', fix: install};
  // Versions someone may have pinned on purpose are theirs to align.
  if (lambdaVersion !== version) return {ready: false, reason: `@remotion/lambda ${lambdaVersion} does not match remotion ${version}; run npx remotion versions`};
  return {ready: true, dir, name: pkg.name, version, entryPoint: entry.file};
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
  const version = readJson(require.resolve('remotion/package.json'))?.version ?? readJson(fromLambda.resolve('remotion/package.json'))?.version;
  return {lambda, client, constants, aws: {lambda: lambdaSdk, logs: logsSdk}, version, source: dir};
}
