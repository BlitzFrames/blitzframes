#!/usr/bin/env node
/** npx blitzframes                                    the guided flow
 *  npx blitzframes lambda functions deploy [flags]    Remotion's deploy plus the BlitzFrames function
 *  npx blitzframes lambda functions ls [--region]     the functions, marking BlitzFrames ones
 *  npx blitzframes benchmark [--composition] [--props] the comparison for this project */
import {existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {deployFunctionBlitzFrames, isBlitzFramesName} from './index.mjs';
import {TOKEN_KEY, loadEnv} from './env.mjs';
import {findProject, remotionFrom, inspectProject} from './project.mjs';
import {tokenStatus} from './account.mjs';
import {guided} from './guided.mjs';
import {benchmark, formatSummary, listCompositions, uploadSite} from './benchmark.mjs';
import {withBenchmarkFunctions} from './benchmark-functions.mjs';
import {spin} from './progress.mjs';

const usage = `Usage:
  npx blitzframes                                       guided: token, credentials, deploy, benchmark
  npx blitzframes lambda functions deploy [options]     Remotion's deploy, then the BlitzFrames function
  npx blitzframes lambda functions ls [--region]        list functions, marking the BlitzFrames ones
  npx blitzframes benchmark [--composition <id>] [--props <json>] [--json <file>]

The token is read from ${TOKEN_KEY} in .env, or --token. Credentials and region are read as
Remotion reads them: REMOTION_AWS_* from .env or the environment, then the AWS default chain;
--region, REMOTION_AWS_REGION, AWS_REGION or us-east-1.

Deploy options, as in "npx remotion lambda functions deploy", with the same defaults:
  --region --memory --disk --timeout --retention-period --disable-cloudwatch
  --enable-lambda-insights --custom-role-arn --custom-layer-arns --vpc-subnet-ids
  --vpc-security-group-ids --runtime-preference
`;

const parse = config => { try { return parseArgs(config); } catch (error) {
  if (error.code !== 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && error.code !== 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') throw error;
  console.error(`${error.message.split('. ')[0].replaceAll("'", '').replace(/\.?$/, '.')}\n\n${usage}`); process.exit(1);
} };
const {values, positionals} = parse({allowPositionals: true, options: {
  token: {type: 'string'}, region: {type: 'string'}, memory: {type: 'string'}, disk: {type: 'string'}, timeout: {type: 'string'},
  'retention-period': {type: 'string'}, 'disable-cloudwatch': {type: 'boolean'}, 'enable-lambda-insights': {type: 'boolean'},
  'custom-role-arn': {type: 'string'}, 'custom-layer-arns': {type: 'string'}, 'vpc-subnet-ids': {type: 'string'},
  'vpc-security-group-ids': {type: 'string'}, 'runtime-preference': {type: 'string'},
  composition: {type: 'string'}, props: {type: 'string'}, json: {type: 'string'}, help: {type: 'boolean', short: 'h'},
}});
if (values.help) { console.log(usage); process.exit(0); }
// Any directory inside the project works, as with git.
const projectDir = findProject();
loadEnv(projectDir);
const command = positionals.join(' ');
const region = () => values.region ?? process.env.REMOTION_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const token = () => { const t = values.token ?? process.env[TOKEN_KEY]; if (!t) { console.error(`No token: run npx blitzframes once, or pass --token, or set ${TOKEN_KEY} in .env.`); process.exit(1); } return t; };
const number = (name) => values[name] === undefined ? undefined : Number(values[name]);

try {
  if (command === '') process.exit(await guided({projectDir, region: values.region, composition: values.composition, inputProps: values.props ? JSON.parse(values.props) : undefined}));

  if (command === 'lambda functions deploy') {
    const remotion = await remotionFrom(projectDir);
    const result = await deployFunctionBlitzFrames({
      token: token(), projectDir, region: region(), onNote: console.warn,
      memorySizeInMb: number('memory') ?? remotion.constants.DEFAULT_MEMORY_SIZE,
      diskSizeInMb: number('disk'),
      timeoutInSeconds: number('timeout') ?? remotion.constants.DEFAULT_TIMEOUT,
      cloudWatchLogRetentionPeriodInDays: number('retention-period'), createCloudWatchLogGroup: !values['disable-cloudwatch'],
      enableLambdaInsights: values['enable-lambda-insights'] ?? false, customRoleArn: values['custom-role-arn'],
      customLayerArns: values['custom-layer-arns']?.split(','), vpcSubnetIds: values['vpc-subnet-ids'], vpcSecurityGroupIds: values['vpc-security-group-ids'],
      runtimePreference: values['runtime-preference'] ?? 'default',
    }, {remotion});
    console.log(`Region = ${region()}\nMemory = ${result.memorySizeInMb} MB\n${result.blitzframes === 'already set' ? 'Already deployed' : 'Deployed'}: ${result.functionName}` +
      (result.stockKept ? `\nYour stock function was left in place: ${result.stockFunctionName}` : ''));
    process.exit(0);
  }

  if (command === 'lambda functions ls') {
    const {LambdaClient, ListFunctionsCommand} = (await remotionFrom(projectDir)).aws.lambda;
    const client = new LambdaClient({region: region(), credentials: process.env.REMOTION_AWS_ACCESS_KEY_ID ? {accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY} : undefined});
    let marker; const names = [];
    do { const page = await client.send(new ListFunctionsCommand({Marker: marker})); names.push(...page.Functions.map(f => f.FunctionName)); marker = page.NextMarker; } while (marker);
    for (const name of names.filter(n => n.startsWith('remotion-render-')).sort()) console.log(`${isBlitzFramesName(name) ? 'BlitzFrames ' : 'stock       '} ${name}`);
    process.exit(0);
  }

  if (command === 'benchmark') {
    const t = token();
    const status = await tokenStatus(t);
    if (status.status === 'inactive') { console.error(`Token inactive (${status.reason}).`); process.exit(1); }
    const project = inspectProject(projectDir);
    if (!project.ready) { console.error(`Not a ready Remotion project: ${project.reason}.` + (project.fix ? ` Run: ${project.fix}` : '')); process.exit(1); }
    const remotion = await remotionFrom(projectDir);
    const log = text => console.log(text);
    console.log(`Remotion ${remotion.version}, region ${region()}.`);
    const {serveUrl} = await spin('Uploading the project as a Remotion site', () => uploadSite({projectDir, region: region()}));
    console.log(`  ${serveUrl}`);
    await withBenchmarkFunctions({token: t, region: region(), projectDir, spin}, async deployed => {
      console.log(`  ${deployed.functionName} (BlitzFrames)\n  ${deployed.stockFunctionName} (stock)\n`);
      const inputProps = values.props ? JSON.parse(values.props) : undefined;
      const compositions = await spin('Reading the compositions', () => listCompositions({remotion, region: region(), functionName: deployed.stockFunctionName, serveUrl, inputProps}));
      const composition = values.composition ?? compositions[0]?.id;
      if (!compositions.some(c => c.id === composition)) throw new Error('Compositions: ' + compositions.map(c => c.id).join(', '));
      const {summary, results} = await benchmark({projectDir, region: region(), serveUrl, composition, inputProps, stockFunction: deployed.stockFunctionName,
        bfFunction: deployed.functionName, log, spin}, {remotion});
      console.log(formatSummary(summary));
      if (values.json) writeFileSync(values.json, JSON.stringify({completedAt: new Date().toISOString(), remotion: remotion.version, region: region(),
        composition, inputProps: inputProps ?? {}, summary, results}, null, 2) + '\n');
    }, {remotion});
    process.exit(0);
  }

  console.error(usage); process.exit(1);
} catch (error) {
  // Outside a project next to the sample the guided flow cloned, name the directory to change to.
  const hint = error.message.startsWith('No @remotion/lambda found') && existsSync(join(process.cwd(), 'blitzframes-sample')) ? '\nFor the sample project: cd blitzframes-sample' : '';
  console.error((process.env.BLITZFRAMES_DEBUG ? error.stack : error.message) + hint); process.exit(1);
}
