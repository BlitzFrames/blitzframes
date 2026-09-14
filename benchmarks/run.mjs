/** The frame-count benchmark on blitzframes.com: `blitzframes benchmark` on six public Remotion
 * compositions, each wrapped in a Loop so that every length exists, at 50, 100, 200 and 400 frames.
 *
 *   node benchmarks/run.mjs                          all six at every length
 *   ONLY=skia,tiktok SIZES=100 node benchmarks/run.mjs
 *
 * Credentials, region and token as for the CLI, in the environment or in benchmarks/.env. Writes
 * runs/<timestamp>/: the CLI's JSON for every composition and length, and sweep-summary.json. */
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnv} from '../src/env.mjs';
import {RATE} from '../src/benchmark.mjs';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(here);
const VERSION = process.env.REMOTION_VERSION ?? JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')).devDependencies['@remotion/lambda'];
const SIZES = (process.env.SIZES ?? '50,100,200,400').split(',').map(Number);
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const WORK = process.env.WORK ?? join(tmpdir(), 'blitzframes-benchmarks');
const region = process.env.REMOTION_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

// dir is where the composition lives; the wrapper becomes that directory's index.ts.
const TEMPLATES = [
  {key: 'skia', repo: 'remotion-dev/template-skia', dir: 'src'},
  {key: 'github-unwrapped', repo: 'remotion-dev/github-unwrapped', dir: 'remotion'},
  {key: 'tiktok', repo: 'remotion-dev/template-tiktok', dir: 'src'},
  {key: 'code-hike', repo: 'remotion-dev/template-code-hike', dir: 'src'},
  {key: 'music-visualization', repo: 'remotion-dev/template-music-visualization', dir: 'src'},
  {key: 'zurichjs', repo: 'JonnyBurger/zurichjs-scenes', dir: 'src'},
].filter(t => !ONLY.length || ONLY.includes(t.key));

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {cwd, stdio: 'inherit', env: process.env});
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
};

/** Clones the template once, pins Remotion to VERSION, and makes the looped wrapper its entry point. */
function prepare({key, repo, dir}) {
  const project = join(WORK, key);
  if (!existsSync(project)) run('git', ['clone', '--depth', '1', 'https://github.com/' + repo, project], WORK);
  const marker = join(project, '.blitzframes-benchmark');
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== VERSION) {
    const manifest = join(project, 'package.json'), pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    // Every @remotion package, eslint config included: Remotion refuses to bundle with mixed versions.
    for (const section of ['dependencies', 'devDependencies']) for (const name of Object.keys(pkg[section] ?? {})) {
      if (name === 'remotion' || name.startsWith('@remotion/')) pkg[section][name] = VERSION;
    }
    (pkg.dependencies ??= {})['@remotion/lambda'] = VERSION;
    writeFileSync(manifest, JSON.stringify(pkg, null, 2));
    for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']) rmSync(join(project, lock), {force: true});
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], project);
    writeFileSync(marker, VERSION);
  }
  copyFileSync(join(here, 'wrappers', key, 'BenchRoot.tsx'), join(project, dir, 'BenchRoot.tsx'));
  copyFileSync(join(here, 'wrappers', key, 'bench-index.ts'), join(project, dir, 'index.ts'));
  // The CLI uploads the first of src/index.* and remotion/index.*; outside src, remove the ones that would win.
  if (dir !== 'src') for (const ext of ['ts', 'tsx', 'js', 'jsx']) rmSync(join(project, 'src', 'index.' + ext), {force: true});
  return project;
}

const out = join(here, 'runs', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(out, {recursive: true});
mkdirSync(WORK, {recursive: true});
const summary = {measuredAt: new Date().toISOString(), completedAt: null, version: VERSION, region, rate: RATE, rows: []};
const save = () => writeFileSync(join(out, 'sweep-summary.json'), JSON.stringify(summary, null, 2) + '\n');

for (const template of TEMPLATES) {
  const project = prepare(template);
  for (const frames of SIZES) {
    console.log(`\n=== ${template.key}, ${frames} frames`);
    const file = join(out, `${template.key}-${frames}.json`);
    const result = spawnSync(process.execPath, [join(here, '../src/cli.mjs'), 'benchmark', '--composition', 'Bench',
      '--props', JSON.stringify({frames}), '--json', file], {cwd: project, stdio: 'inherit', env: process.env});
    const row = {key: template.key + '-loop', size: frames};
    if (result.status === 0 && existsSync(file)) {
      const {summary: s} = JSON.parse(readFileSync(file, 'utf8'));
      Object.assign(row, {chunks: s.chunks, width: s.dimensions?.width, height: s.dimensions?.height,
        stockMs: s.stock.warmMs, blitzMs: s.bf.warmMs, stockCost: s.stock.costUsd,
        blitzAws: s.bf.awsCostUsd, blitzUsage: s.bf.usageCostUsd, blitzTotal: s.bf.costUsd});
    } else {
      row.error = `blitzframes benchmark exited with ${result.status}`;
    }
    summary.rows.push(row);
    save();
  }
}
summary.completedAt = new Date().toISOString();
save();
console.log('\n' + join(out, 'sweep-summary.json'));
console.table(summary.rows.map(r => ({composition: r.key, frames: r.size, lambda: r.stockMs && (r.stockMs / 1000).toFixed(1) + ' s',
  blitzframes: r.blitzMs && (r.blitzMs / 1000).toFixed(1) + ' s', error: r.error ?? ''})));
