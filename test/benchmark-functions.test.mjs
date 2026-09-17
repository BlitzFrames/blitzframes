import test from 'node:test';
import assert from 'node:assert/strict';
import {withBenchmarkFunctions} from '../src/benchmark-functions.mjs';

function setup({alreadyExisted = false, deployError} = {}) {
  const deleted = [], calls = [];
  const remotion = {version: '4.0.523',
    constants: {DEFAULT_MEMORY_SIZE: 2048, DEFAULT_EPHEMERAL_STORAGE_IN_MB: 2048, DEFAULT_TIMEOUT: 120},
    lambda: {deleteFunction: async args => deleted.push(args.functionName)}};
  return {deleted, calls, deps: {remotion, checkToken: async () => calls.push('token'),
    deployStock: async () => { calls.push('stock'); return {functionName: 'stock', alreadyExisted}; },
    deployBlitzFrames: async () => { calls.push('bf'); if (deployError) throw deployError;
      return {functionName: 'bf', stockFunctionName: 'stock'}; }}};
}

test('benchmark owns its stock function and removes it after the callback', async () => {
  const f = setup();
  const value = await withBenchmarkFunctions({token: 'token', region: 'eu-central-1', compare: true}, async deployed => {
    assert.deepEqual(f.calls, ['token', 'stock', 'bf']);
    assert.equal(deployed.functionName, 'bf');
    assert.equal(deployed.stockFunctionName, 'stock');
    assert.deepEqual(f.deleted, []);
    return 'comparison';
  }, f.deps);
  assert.equal(value, 'comparison');
  assert.deepEqual(f.deleted, ['stock']);
});

test('benchmark preserves a customer stock function on success and render failure', async () => {
  for (const fail of [false, true]) {
    const f = setup({alreadyExisted: true});
    const run = withBenchmarkFunctions({token: 'token', region: 'eu-central-1', compare: true}, async () => {
      if (fail) throw new Error('render failed');
    }, f.deps);
    if (fail) await assert.rejects(run, /render failed/); else await run;
    assert.deepEqual(f.deleted, []);
  }
});

test('benchmark removes its temporary stock when BlitzFrames deployment fails', async () => {
  const error = new Error('deployment failed'), f = setup({deployError: error});
  await assert.rejects(withBenchmarkFunctions({token: 'token', region: 'eu-central-1', compare: true}, async () => {
    assert.fail('comparison must not start');
  }, f.deps), error);
  assert.deepEqual(f.deleted, ['stock']);
});

test('benchmark removes its temporary stock when setup or rendering fails', async () => {
  const f = setup(), error = new Error('composition unavailable');
  await assert.rejects(withBenchmarkFunctions({token: 'token', region: 'eu-central-1', compare: true}, async () => {
    throw error;
  }, f.deps), error);
  assert.deepEqual(f.deleted, ['stock']);
});

test('without compare, only the BlitzFrames function is deployed and nothing is deleted', async () => {
  const f = setup();
  const value = await withBenchmarkFunctions({token: 'token', region: 'eu-central-1'}, async deployed => {
    assert.deepEqual(f.calls, ['token', 'bf']);
    assert.equal(deployed.functionName, 'bf');
    assert.equal(deployed.stockFunctionName, undefined);
    return 'numbers';
  }, f.deps);
  assert.equal(value, 'numbers');
  assert.deepEqual(f.deleted, []);
});
