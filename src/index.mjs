/** deployFunctionBlitzFrames: Remotion's deployFunction, then a copy of the function with
 * BlitzFrames enabled. The stock function is deleted only when this call created it. */
import {CreateFunctionCommand, DeleteFunctionCommand, GetFunctionCommand, LambdaClient, PutRuntimeManagementConfigCommand} from '@aws-sdk/client-lambda';
import {CloudWatchLogsClient, CreateLogGroupCommand, PutRetentionPolicyCommand} from '@aws-sdk/client-cloudwatch-logs';
import {checkToken, installValue} from './install.mjs';
import {remotionFrom} from './project.mjs';
import {TOKEN_KEY, awsCredentials, loadEnv} from './env.mjs';
import {checkVersion} from './version.mjs';

export const MARKER = '-bf';
/** The BlitzFrames twin of a stock function name: the marker goes inside the version segment, so that
 * Remotion's own parser still reads the memory, disk and timeout out of the name. Appending it at the
 * end would not parse, and getRenderProgress({skipLambdaInvocation: true}) throws on a name it cannot read. */
export const blitzFramesName = stockName => stockName.replace('-mem', MARKER + '-mem');
export const isBlitzFramesName = name => name.includes(MARKER + '-mem');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function deployFunctionBlitzFrames({token, projectDir, onNote, ...options}, deps = {}) {
  loadEnv(projectDir);
  token ??= process.env[TOKEN_KEY];
  const fetchImpl = deps.fetch ?? fetch;
  await checkToken(token, fetchImpl);
  const value = installValue(token);
  const remotion = deps.remotion ?? await remotionFrom(projectDir);
  const version = checkVersion(remotion.version);
  if (version.note) onNote?.(version.note);
  for (const key of ['region', 'memorySizeInMb', 'timeoutInSeconds']) {
    if (options[key] == null) throw new TypeError(`Missing required option: ${key}`);
  }
  const {memorySizeInMb} = options;
  const client = deps.lambdaClient ?? new LambdaClient({region: options.region, credentials: awsCredentials()});
  const stockName = remotion.client.speculateFunctionName({...options,
    diskSizeInMb: options.diskSizeInMb ?? remotion.constants.DEFAULT_EPHEMERAL_STORAGE_IN_MB});
  const name = blitzFramesName(stockName);

  const existing = await client.send(new GetFunctionCommand({FunctionName: name})).catch(error => { if (error.name === 'ResourceNotFoundException') return null; throw error; });
  // Reuse does not apply deployment options or run Remotion's full deployment validation.
  if (existing?.Configuration?.Environment?.Variables?.NODE_OPTIONS === value) {
    return {functionName: name, stockFunctionName: stockName, alreadyExisted: true, memorySizeInMb, blitzframes: 'already set'};
  }

  const deployed = await remotion.lambda.deployFunction(options);
  const current = await client.send(new GetFunctionCommand({FunctionName: deployed.functionName}));
  const c = current.Configuration;
  if (existing?.Configuration?.Environment?.Variables?.NODE_OPTIONS !== value) {
    if (existing) await client.send(new DeleteFunctionCommand({FunctionName: name}));
    // Its own log group, as Remotion gives the stock function one; the copied logging config would point at the stock group.
    const logGroup = '/aws/lambda/' + name;
    if (options.createCloudWatchLogGroup !== false) {
      const logs = deps.logsClient ?? new CloudWatchLogsClient({region: options.region, credentials: awsCredentials()});
      await logs.send(new CreateLogGroupCommand({logGroupName: logGroup})).catch(error => { if (error.name !== 'ResourceAlreadyExistsException') throw error; });
      await logs.send(new PutRetentionPolicyCommand({logGroupName: logGroup, retentionInDays: options.cloudWatchLogRetentionPeriodInDays ?? remotion.constants.DEFAULT_CLOUDWATCH_RETENTION_PERIOD ?? 14}));
    }
    const code = new Uint8Array(await (await fetchImpl(current.Code.Location)).arrayBuffer());
    const request = {
      FunctionName: name, Role: c.Role, Runtime: c.Runtime, Handler: c.Handler, Description: c.Description,
      MemorySize: c.MemorySize, Timeout: c.Timeout, Architectures: c.Architectures,
      Layers: (c.Layers ?? []).map(layer => layer.Arn), EphemeralStorage: c.EphemeralStorage,
      ...(c.VpcConfig?.SubnetIds?.length ? {VpcConfig: {SubnetIds: c.VpcConfig.SubnetIds, SecurityGroupIds: c.VpcConfig.SecurityGroupIds}} : {}),
      ...(c.LoggingConfig ? {LoggingConfig: {...c.LoggingConfig, LogGroup: logGroup}} : {}),
      Environment: {Variables: {...(c.Environment?.Variables ?? {}), NODE_OPTIONS: value}}, Code: {ZipFile: code}, Tags: current.Tags,
    };
    // The name is reserved for a few seconds after a delete; Lambda answers with a conflict until it is free.
    for (let attempt = 0; ; attempt++) {
      try { await client.send(new CreateFunctionCommand(request)); break; }
      catch (error) { if (error.name !== 'ResourceConflictException' || attempt >= 30) throw error; await (deps.wait ?? wait)(2000); }
    }
    for (let attempt = 0; ; attempt++) {
      const {Configuration: state} = await client.send(new GetFunctionCommand({FunctionName: name}));
      if (state.State === 'Active') break;
      if (state.State === 'Failed' || attempt >= 120) throw new Error(`${name} did not become active: ${state.StateReason ?? state.State}`);
      await (deps.wait ?? wait)(1000);
    }
    // Keep the runtime build Remotion pinned for the stock function.
    const pinned = c.RuntimeVersionConfig?.RuntimeVersionArn;
    if (pinned) await client.send(new PutRuntimeManagementConfigCommand({FunctionName: name, UpdateRuntimeOn: 'Manual', RuntimeVersionArn: pinned}));
  }
  // Only ever delete the stock function this run created. One that was already in the account is the
  // customer's own infrastructure and is left alone.
  const stockKept = deployed.alreadyExisted;
  if (!stockKept) await client.send(new DeleteFunctionCommand({FunctionName: deployed.functionName}));
  return {functionName: name, stockFunctionName: deployed.functionName, alreadyExisted: deployed.alreadyExisted, memorySizeInMb,
    blitzframes: existing ? 'updated' : 'enabled', stockKept};
}

export {installValue, checkToken} from './install.mjs';
