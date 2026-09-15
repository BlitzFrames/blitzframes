import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
const mocks = {
  [new URL('../src/project.mjs', import.meta.url).href]: `
    export const inspectProject = () => ({});
    export const remotionFrom = async () => ({constants: {DEFAULT_MEMORY_SIZE: 3072, DEFAULT_TIMEOUT: 180}});
  `,
  [new URL('../src/index.mjs', import.meta.url).href]: `
    export const isBlitzFramesName = () => true;
    export const deployFunctionBlitzFrames = async (options, deps) => {
      if (!deps.remotion) throw new Error('Missing resolved Remotion');
      console.log('OPTIONS:' + JSON.stringify(options, (key, value) => Number.isNaN(value) ? 'NaN' : value));
      return {functionName: 'bf', memorySizeInMb: options.memorySizeInMb};
    };
  `,
};
const loader = moduleUrl(`
  const mocks = ${JSON.stringify(mocks)};
  export async function load(url, context, nextLoad) {
    if (mocks[url]) return {format: 'module', source: mocks[url], shortCircuit: true};
    return nextLoad(url, context);
  }
`);
const bootstrap = moduleUrl(`import {register} from 'node:module'; register(${JSON.stringify(loader)});`);

test('deploy CLI supplies project Remotion defaults and preserves explicit flags for validation', () => {
  for (const [flags, memory, timeout] of [
    [[], 3072, 180],
    [['--memory', '4096', '--timeout', '90'], 4096, 90],
    [['--memory', '0', '--timeout', 'invalid'], 0, 'NaN'],
  ]) {
    const result = spawnSync(process.execPath, ['--import', bootstrap,
      new URL('../src/cli.mjs', import.meta.url).pathname,
      'lambda', 'functions', 'deploy', '--region', 'eu-central-1', '--token', 'a'.repeat(64), ...flags,
    ], {encoding: 'utf8', timeout: 15000});
    assert.equal(result.status, 0, result.stderr);
    const options = JSON.parse(result.stdout.split('\n').find(line => line.startsWith('OPTIONS:')).slice(8));
    assert.equal(options.region, 'eu-central-1');
    assert.equal(options.memorySizeInMb, memory);
    assert.equal(options.timeoutInSeconds, timeout);
  }
});
