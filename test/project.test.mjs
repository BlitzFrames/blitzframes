import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findProject, inspectProject, packageManager, remotionFrom} from '../src/project.mjs';

/** A directory with the given package.json dependencies, lockfile and installed package versions. */
function project({dependencies, lockfile, installed = {}} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'blitzframes-project-'));
  if (dependencies) writeFileSync(join(dir, 'package.json'), JSON.stringify({name: 'video', dependencies}));
  if (lockfile) writeFileSync(join(dir, lockfile), '');
  for (const [name, version] of Object.entries(installed)) {
    mkdirSync(join(dir, 'node_modules', name), {recursive: true});
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({name, version}));
  }
  return dir;
}

test('each project state names its problem and the one command that fixes it', () => {
  const both = {remotion: '4.0.524', '@remotion/lambda': '4.0.524'};
  for (const [options, reason, fix] of [
    [{}, 'no package.json here', undefined],
    [{dependencies: {next: '15.0.0'}}, 'remotion is not a dependency of this project', undefined],
    [{dependencies: {remotion: '4.0.524'}}, 'Remotion is not installed', 'npm install'],
    [{dependencies: {remotion: '4.0.524'}, lockfile: 'pnpm-lock.yaml', installed: {remotion: '4.0.524'}},
      '@remotion/lambda is not a dependency', 'pnpm add --save-exact @remotion/lambda@4.0.524'],
    [{dependencies: both, lockfile: 'yarn.lock', installed: {remotion: '4.0.524'}}, '@remotion/lambda is not installed', 'yarn install'],
    [{dependencies: both, lockfile: 'bun.lock', installed: {remotion: '4.0.524', '@remotion/lambda': '4.0.500'}},
      '@remotion/lambda 4.0.500 does not match Remotion 4.0.524', 'bun add --exact @remotion/lambda@4.0.524'],
  ]) {
    const result = inspectProject(project(options));
    assert.equal(result.ready, false);
    assert.equal(result.reason, reason);
    assert.equal(result.fix, fix);
  }
  const ready = project({dependencies: both, lockfile: 'package-lock.json', installed: both});
  assert.deepEqual(inspectProject(ready), {ready: true, dir: ready, name: 'video', version: '4.0.524'});
});

test('the project is found from any directory inside it, and the lockfile from a workspace root', () => {
  const dir = project({dependencies: {remotion: '4.0.524'}});
  mkdirSync(join(dir, 'src/scenes'), {recursive: true});
  assert.equal(findProject(join(dir, 'src/scenes')), dir);
  const outside = mkdtempSync(join(tmpdir(), 'blitzframes-outside-'));
  assert.equal(findProject(outside), outside);

  const workspace = project({lockfile: 'pnpm-lock.yaml'});
  mkdirSync(join(workspace, 'apps/video'), {recursive: true});
  assert.equal(packageManager(join(workspace, 'apps/video')).add, 'pnpm add --save-exact');
});

test('Remotion and its AWS SDK come from the project, with no fallback outside one', async () => {
  const remotion = await remotionFrom(process.cwd());
  assert.equal(typeof remotion.aws.lambda.LambdaClient, 'function');
  assert.equal(typeof remotion.aws.logs.CloudWatchLogsClient, 'function');
  await assert.rejects(remotionFrom(mkdtempSync(join(tmpdir(), 'blitzframes-empty-'))), /No @remotion\/lambda found .* Run this inside your Remotion project/);
});

test('outside a project, the CLI says where to run it, naming the sample directory when there is one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blitzframes-cli-'));
  const cli = new URL('../src/cli.mjs', import.meta.url).pathname;
  const run = () => spawnSync(process.execPath, [cli, 'lambda', 'functions', 'ls'], {cwd: dir, encoding: 'utf8', timeout: 15000});
  let result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run this inside your Remotion project/);
  assert.doesNotMatch(result.stderr, /blitzframes-sample/);
  mkdirSync(join(dir, 'blitzframes-sample'));
  result = run();
  assert.match(result.stderr, /For the sample project: cd blitzframes-sample/);
});
