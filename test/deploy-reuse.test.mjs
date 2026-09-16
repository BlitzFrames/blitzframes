import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {remotionFrom} from '../src/project.mjs';
import {blitzFramesName, deployFunctionBlitzFrames} from '../src/index.mjs';
import {installValue} from '../src/install.mjs';

// Run each Remotion version in its own process; Remotion rejects loading multiple versions.
// REMOTION_TEST_PROJECT=/path/to/project node --test test/deploy-reuse.test.mjs
const project = process.env.REMOTION_TEST_PROJECT ?? process.cwd();
const required = {region: 'eu-central-1', memorySizeInMb: 2048, timeoutInSeconds: 120};

test(`reuses with the project's actual Remotion name calculation: ${project}`, async t => {
  const remotion = await remotionFrom(resolve(project));
  assert.equal(remotion.source, resolve(project), 'must use the selected installation, not fall back');
  t.diagnostic(`Remotion ${remotion.version}`);

  const token = 'a'.repeat(64);
  const stockName = remotion.client.speculateFunctionName({...required,
    diskSizeInMb: remotion.constants.DEFAULT_EPHEMERAL_STORAGE_IN_MB});
  const functionName = blitzFramesName(stockName);
  const calls = [];
  const noDeploy = {...remotion, lambda: {...remotion.lambda,
    deployFunction: () => assert.fail('Reuse must not call stock deployment')}};
  const deps = {remotion: noDeploy, fetch: async () => new Response('', {status: 200}),
    lambdaClient: {send: async command => {
      calls.push(command.constructor.name);
      assert.equal(command.constructor.name, 'GetFunctionCommand');
      assert.equal(command.input.FunctionName, functionName);
      return {Configuration: {Environment: {Variables: {NODE_OPTIONS: installValue(token)}}}};
    }}, logsClient: {send: () => assert.fail('Reuse must not touch logs')}};
  for (const optional of [{}, {diskSizeInMb: null, customRoleArn: null, customLayerArns: null,
    enableLambdaInsights: null, runtimePreference: null}, {runtimePreference: 'invalid'}]) {
    const result = await deployFunctionBlitzFrames({...required, ...optional, token}, deps);
    assert.deepEqual(result, {functionName, stockFunctionName: stockName,
      alreadyExisted: true, memorySizeInMb: 2048, blitzframes: 'already set'});
  }
  assert.deepEqual(calls, ['GetFunctionCommand', 'GetFunctionCommand', 'GetFunctionCommand']);
});
