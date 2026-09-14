import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deployFunctionBlitzFrames} from '../src/index.mjs';
import {installValue} from '../src/install.mjs';
import {loadEnv, writeEnvKey} from '../src/env.mjs';

const token = 'a'.repeat(64);
const zip = new Uint8Array([80, 75, 3, 4]);
const STOCK = 'remotion-render-4-0-523-mem2048mb-disk2048mb-120sec';
const BF = 'remotion-render-4-0-523-bf-mem2048mb-disk2048mb-120sec';
const speculate = ({memorySizeInMb, diskSizeInMb, timeoutInSeconds}) => `remotion-render-4-0-523-mem${memorySizeInMb}mb-disk${diskSizeInMb}mb-${timeoutInSeconds}sec`;
const remotionFor = functions => ({
  version: '4.0.523',
  constants: {DEFAULT_MEMORY_SIZE: 2048, DEFAULT_EPHEMERAL_STORAGE_IN_MB: 2048, DEFAULT_TIMEOUT: 120},
  client: {speculateFunctionName: speculate},
  lambda: {deployFunction: async options => { const name = speculate(options); const alreadyExisted = functions.has(name);
    if (!alreadyExisted) functions.set(name, {Environment: {Variables: {}}}); return {functionName: name, alreadyExisted}; }},
});
let remotion;

function fakes({bfEnv = null, conflicts = 0, tokenStatus = 200} = {}) {
  const calls = [];
  const functions = new Map();
  remotion = remotionFor(functions);
  if (bfEnv) functions.set(BF, {Environment: {Variables: bfEnv}});
  let conflictsLeft = conflicts;
  const configuration = name => ({FunctionName: name, Role: 'arn:role', Runtime: 'nodejs24.x', Handler: 'index.handler', Description: 'Renders a Remotion video.',
    MemorySize: Number(name.match(/mem(\d+)mb/)[1]), Timeout: 120, Architectures: ['arm64'], Layers: [{Arn: 'arn:layer:1'}], EphemeralStorage: {Size: 2048}, State: 'Active', LoggingConfig: {LogFormat: 'Text', LogGroup: '/aws/lambda/' + STOCK},
    Environment: functions.get(name).Environment, RuntimeVersionConfig: {RuntimeVersionArn: 'arn:runtime:v29'}});
  const lambdaClient = {send: async command => {
    const kind = command.constructor.name, name = command.input.FunctionName; calls.push(kind + ':' + name);
    if (kind === 'GetFunctionCommand') {
      if (!functions.has(name)) { const e = new Error('nope'); e.name = 'ResourceNotFoundException'; throw e; }
      return {Configuration: configuration(name), Code: {Location: 'https://code.example/zip'}, Tags: {'remotion-lambda': 'true'}};
    }
    if (kind === 'DeleteFunctionCommand') { functions.delete(name); return {}; }
    if (kind === 'PutRuntimeManagementConfigCommand') { functions.get(name).runtime = command.input; return {}; }
    if (kind === 'CreateFunctionCommand') {
      if (conflictsLeft-- > 0) { const e = new Error('being deleted'); e.name = 'ResourceConflictException'; throw e; }
      functions.set(name, {Environment: command.input.Environment, input: command.input}); return {};
    }
    throw new Error('unexpected ' + kind);
  }};
  const fetchImpl = async url => url.startsWith('https://code.example') ? new Response(zip) : new Response('', {status: tokenStatus});
  const logsClient = {send: async command => { calls.push(command.constructor.name + ':' + command.input.logGroupName); return {}; }};
  return {calls, lambdaClient, logsClient, fetchImpl, functions, remotion, wait: async () => {}};
}

const deps = f => ({lambdaClient: f.lambdaClient, logsClient: f.logsClient, fetch: f.fetchImpl, wait: f.wait, remotion: f.remotion});

test('deploys with Remotion at its defaults, creates the BlitzFrames function with NODE_OPTIONS, deletes the stock one it created', async () => {
  const f = fakes();
  const result = await deployFunctionBlitzFrames({token, region: 'eu-central-1'}, deps(f));
  assert.deepEqual(f.calls, [`GetFunctionCommand:${BF}`, `GetFunctionCommand:${STOCK}`, `CreateLogGroupCommand:/aws/lambda/${BF}`, `PutRetentionPolicyCommand:/aws/lambda/${BF}`, `CreateFunctionCommand:${BF}`, `GetFunctionCommand:${BF}`, `PutRuntimeManagementConfigCommand:${BF}`, `DeleteFunctionCommand:${STOCK}`]);
  assert.deepEqual(f.functions.get(BF).runtime, {FunctionName: BF, UpdateRuntimeOn: 'Manual', RuntimeVersionArn: 'arn:runtime:v29'}, 'the runtime pin is copied');
  const created = f.functions.get(BF).input;
  assert.equal(created.Environment.Variables.NODE_OPTIONS, installValue(token));
  assert.deepEqual(created.Layers, ['arn:layer:1']); assert.equal(created.MemorySize, 2048); assert.deepEqual(created.Code.ZipFile, zip);
  assert.equal(created.LoggingConfig.LogGroup, `/aws/lambda/${BF}`, 'its own log group');
  assert.deepEqual(result, {functionName: BF, stockFunctionName: STOCK, alreadyExisted: false, memorySizeInMb: 2048, blitzframes: 'enabled', stockKept: false});
  assert.ok(!f.functions.has(STOCK));
});

test('respects explicit memory and deletes its temporary stock function', async () => {
  const f = fakes();
  const result = await deployFunctionBlitzFrames({token, region: 'eu-central-1', memorySizeInMb: 3000}, deps(f));
  assert.equal(result.memorySizeInMb, 3000);
  assert.equal(result.functionName, 'remotion-render-4-0-523-bf-mem3000mb-disk2048mb-120sec');
  assert.ok(!f.functions.has(result.stockFunctionName), 'temporary stock is deleted'); assert.equal(result.stockKept, false);
});

test('is a no-op when the BlitzFrames function already carries the install value', async () => {
  const f = fakes({bfEnv: {NODE_OPTIONS: installValue(token)}});
  const result = await deployFunctionBlitzFrames({token, region: 'eu-central-1'}, deps(f));
  assert.deepEqual(f.calls, [`GetFunctionCommand:${BF}`]);
  assert.equal(result.blitzframes, 'already set');
});

test('replaces a BlitzFrames function that carries another token, and retries while the name is reserved', async () => {
  const f = fakes({bfEnv: {NODE_OPTIONS: installValue('b'.repeat(64))}, conflicts: 2});
  const result = await deployFunctionBlitzFrames({token, region: 'eu-central-1'}, deps(f));
  assert.equal(result.blitzframes, 'updated');
  assert.equal(f.calls.filter(c => c.startsWith('CreateFunctionCommand')).length, 3);
  assert.equal(f.functions.get(BF).Environment.Variables.NODE_OPTIONS, installValue(token));
});

test('refuses an inactive or malformed token before touching anything', async () => {
  const f = fakes({tokenStatus: 403});
  await assert.rejects(deployFunctionBlitzFrames({token, region: 'eu-central-1'}, deps(f)), /no active BlitzFrames subscription/);
  assert.deepEqual(f.calls, []);
  await assert.rejects(deployFunctionBlitzFrames({token: 'nope', region: 'eu-central-1'}, deps(fakes())), /64 hexadecimal/);
});

test('.env: the token is written next to existing keys and read back without overriding the shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-env-'));
  writeFileSync(join(dir, '.env'), 'REMOTION_AWS_ACCESS_KEY_ID=AKIA\nREMOTION_AWS_SECRET_ACCESS_KEY="s3cret"\n');
  writeEnvKey('BLITZFRAMES_TOKEN', token, dir);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), `REMOTION_AWS_ACCESS_KEY_ID=AKIA\nREMOTION_AWS_SECRET_ACCESS_KEY="s3cret"\nBLITZFRAMES_TOKEN=${token}\n`);
  writeEnvKey('BLITZFRAMES_TOKEN', 'c'.repeat(64), dir);
  assert.match(readFileSync(join(dir, '.env'), 'utf8'), new RegExp(`^BLITZFRAMES_TOKEN=c{64}$`, 'm'));
  delete process.env.REMOTION_AWS_SECRET_ACCESS_KEY;
  process.env.REMOTION_AWS_ACCESS_KEY_ID = 'from-shell';
  const values = loadEnv(dir);
  assert.equal(values.REMOTION_AWS_SECRET_ACCESS_KEY, 's3cret');
  assert.equal(process.env.REMOTION_AWS_ACCESS_KEY_ID, 'from-shell');
});

test('the install value is the loader the account page shows', () => {
  const decoded = Buffer.from(installValue(token).replace('--import=data:text/javascript;base64,', ''), 'base64').toString();
  assert.match(decoded, /^await fetch\("https:\/\/blitzframes\.com\/api\/relay\.mjs\/a{64}",\{signal:AbortSignal\.timeout\(2000\)\}\)/);
});

test('deploys the minimum Remotion release and refuses releases below it', async () => {
  const f = fakes();
  await assert.rejects(deployFunctionBlitzFrames({token, region: 'eu-central-1'}, {...deps(f), remotion: {...f.remotion, version: '4.0.292'}}), /below 4\.0\.293/);
  const minimum = await deployFunctionBlitzFrames({token, region: 'eu-central-1'}, {...deps(f), remotion: {...f.remotion, version: '4.0.293'}});
  assert.equal(minimum.blitzframes, 'enabled');
  // There is no ceiling: a newer Remotion deploys.
  const newer = fakes();
  const result = await deployFunctionBlitzFrames({token, region: 'eu-central-1'}, {...deps(newer), remotion: {...newer.remotion, version: '4.0.600'}});
  assert.equal(result.blitzframes, 'enabled');
});

test('leaves a stock function that already existed, and reports it as kept', async () => {
  const f = fakes();
  // The customer already deployed this exact function with Remotion; it is theirs, not ours to delete.
  f.functions.set(STOCK, {Environment: {Variables: {}}});
  const result = await deployFunctionBlitzFrames({token, region: 'eu-central-1'}, deps(f));
  assert.ok(f.functions.has(STOCK), 'the pre-existing stock function stays');
  assert.equal(result.stockKept, true);
  assert.equal(result.functionName, BF);
  assert.ok(!f.calls.includes(`DeleteFunctionCommand:${STOCK}`), 'never deleted');
});

test('programmatic deploy reads the selected project .env, with explicit and shell tokens taking precedence', async () => {
  const previous = process.env.BLITZFRAMES_TOKEN;
  const dir = mkdtempSync(join(tmpdir(), 'bf-api-env-'));
  const fileToken = 'd'.repeat(64), shellToken = 'e'.repeat(64), explicitToken = 'f'.repeat(64);
  writeFileSync(join(dir, '.env'), `BLITZFRAMES_TOKEN=${fileToken}\n`);
  try {
    for (const scenario of [
      {shell: undefined, explicit: undefined, expected: fileToken},
      {shell: shellToken, explicit: undefined, expected: shellToken},
      {shell: shellToken, explicit: explicitToken, expected: explicitToken},
    ]) {
      if (scenario.shell === undefined) delete process.env.BLITZFRAMES_TOKEN;
      else process.env.BLITZFRAMES_TOKEN = scenario.shell;
      const f = fakes();
      await deployFunctionBlitzFrames({token: scenario.explicit, projectDir: dir, region: 'eu-central-1'}, deps(f));
      assert.equal(f.functions.get(BF).input.Environment.Variables.NODE_OPTIONS, installValue(scenario.expected));
    }
  } finally {
    if (previous === undefined) delete process.env.BLITZFRAMES_TOKEN;
    else process.env.BLITZFRAMES_TOKEN = previous;
  }
});
