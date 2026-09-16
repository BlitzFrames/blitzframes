/** Benchmark functions: a temporary stock function next to the BlitzFrames one. A stock
 * function that already existed is kept. */
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {deployFunctionBlitzFrames} from './index.mjs';
import {awsCredentials} from './env.mjs';
import {remotionFrom} from './project.mjs';
import {checkToken} from './install.mjs';
import {checkVersion} from './version.mjs';

async function deployStock(remotion, options) {
  const require = createRequire(join(remotion.source, 'package.json'));
  const dist = dirname(require.resolve('@remotion/lambda'));
  const {internalDeployFunction} = require(join(dist, 'api/deploy-function.js'));
  const {awsFullClientSpecifics} = require(join(dist, 'functions/full-client-implementation.js'));
  const provider = remotion.client.LambdaClientInternals.awsImplementation;
  const name = remotion.client.speculateFunctionName(options);
  // Look up this one name. Remotion's getFunctions invokes every remotion-render-* function for its
  // version and waits out any that does not answer, up to its timeout.
  const {GetFunctionCommand, LambdaClient} = remotion.aws.lambda;
  const client = new LambdaClient({region: options.region, credentials: awsCredentials()});
  const existing = await client.send(new GetFunctionCommand({FunctionName: name})).then(r => r.Configuration,
    error => { if (error.name === 'ResourceNotFoundException') return null; throw error; });
  return internalDeployFunction({
    ...options, indent: false, logLevel: 'info', customRoleArn: undefined,
    customLayerArns: null, enableLambdaInsights: false, runtimePreference: 'default',
    requestHandler: null, fullClientSpecifics: awsFullClientSpecifics,
    providerSpecifics: {...provider, getFunctions: async () => existing ? [{functionName: name, version: remotion.version,
      memorySizeInMb: existing.MemorySize, timeoutInSeconds: existing.Timeout, diskSizeInMb: existing.EphemeralStorage?.Size}] : []},
  });
}

export async function withBenchmarkFunctions({token, region, projectDir, spin = (text, work) => work(), ...resources}, run, deps = {}) {
  const remotion = deps.remotion ?? await remotionFrom(projectDir);
  checkVersion(remotion.version);
  await (deps.checkToken ?? checkToken)(token);
  const options = {region, createCloudWatchLogGroup: true,
    memorySizeInMb: remotion.constants.DEFAULT_MEMORY_SIZE,
    diskSizeInMb: remotion.constants.DEFAULT_EPHEMERAL_STORAGE_IN_MB,
    timeoutInSeconds: remotion.constants.DEFAULT_TIMEOUT, ...resources};
  const stock = await spin('Creating the stock function for the comparison (uploads Remotion\'s function code)',
    () => (deps.deployStock ?? deployStock)(remotion, options));
  try {
    const deployed = await spin('Deploying the BlitzFrames function', () => (deps.deployBlitzFrames ?? deployFunctionBlitzFrames)(
      {...options, token, projectDir}, {remotion}));
    return await run({...deployed, stockFunctionName: stock.functionName});
  } finally {
    if (!stock.alreadyExisted) await remotion.lambda.deleteFunction({region, functionName: stock.functionName});
  }
}
