/** npx blitzframes with no arguments: token, credentials, project, functions, benchmark, setup. */
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {requestCode, startTrial, tokenStatus, verifyCode} from './account.mjs';
import {TOKEN_KEY, hasAwsCredentials, loadEnv, writeEnvKey} from './env.mjs';
import {inspectProject, remotionFrom} from './project.mjs';
import {withBenchmarkFunctions} from './benchmark-functions.mjs';
import {benchmark, formatSummary, listCompositions, uploadSite} from './benchmark.mjs';
import {checkVersion} from './version.mjs';
import {spin} from './progress.mjs';

const SETUP = 'https://www.remotion.dev/docs/lambda/setup';
const SAMPLE = 'https://github.com/remotion-dev/template-skia';

export async function guided({region: regionFlag, composition: compositionFlag, inputProps} = {}) {
  // Lines are queued as they arrive, so answers piped in ahead of a question are not lost.
  const rl = createInterface({input: process.stdin, terminal: false});
  const queue = [], waiters = []; let closed = false;
  rl.on('line', line => { if (waiters.length) waiters.shift()(line); else queue.push(line); });
  rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(''); });
  const ask = async (question, fallback) => {
    process.stdout.write(question + (fallback ? ` [${fallback}] ` : ' '));
    const line = queue.length ? queue.shift() : closed ? '' : await new Promise(resolve => waiters.push(resolve));
    if (!process.stdin.isTTY) process.stdout.write(line + '\n');
    const answer = line.trim(); return answer || fallback || '';
  };
  const yes = async (question, fallback = true) => /^y/i.test(await ask(question + (fallback ? ' (Y/n)' : ' (y/N)'), fallback ? 'y' : 'n'));
  const say = text => console.log(text);
  try {
    let dir = process.cwd();
    loadEnv(dir);
    say('BlitzFrames: faster Remotion Lambda renders, one variable on your own function.\n');

    // 1. Token
    let token = process.env[TOKEN_KEY];
    if (!token) {
      const email = await ask('Your email address:');
      await requestCode(email);
      say('A six-digit code is on its way to ' + email + '.');
      let standing;
      for (;;) {
        const code = await ask('Code:');
        try { standing = await verifyCode(email, code); break; } catch (error) { say(error.message); if (/expired|Too many/.test(error.message)) return 1; }
      }
      if (standing.status === 'none') {
        say('\nThis address has no subscription yet.');
        say('Starting a trial means you act for a business and accept the service terms and privacy');
        say('notice at https://blitzframes.com/terms and https://blitzframes.com/privacy.');
        const choice = await ask('Free trial (US$5 of rendering, no card) or paid subscription? (trial/paid)', 'trial');
        if (/^p/i.test(choice)) { say('Subscribe at https://blitzframes.com/#pricing, then run npx blitzframes again.'); return 0; }
        standing = await startTrial(standing.proof);
      } else if (standing.status === 'ended') {
        say('The free trial for this address is used up. Subscribe at https://blitzframes.com/#pricing, then run npx blitzframes again.'); return 1;
      }
      token = standing.token;
      writeEnvKey(TOKEN_KEY, token, dir);
      say(`\nYour token is saved as ${TOKEN_KEY} in .env. Keep that file out of version control, as Remotion's setup guide already asks.`);
    }
    const status = await tokenStatus(token);
    if (status.status === 'inactive') { say(`Your token is inactive (${status.reason}). Subscribe at https://blitzframes.com/#pricing.`); return 1; }
    say(status.status === 'trial'
      ? `Free trial: ${Math.floor(status.trial.secondsLeft).toLocaleString('en-US')} renderer seconds left. Account: https://blitzframes.com/account`
      : status.status === 'subscribed' ? 'Subscription active. Account: https://blitzframes.com/account'
      : 'Token accepted. Account: https://blitzframes.com/account');

    // 2. Credentials
    if (!hasAwsCredentials()) {
      say(`\nRenders run on your own AWS account, as with every Remotion Lambda render, so the AWS credentials from Remotion's setup guide are needed: ${SETUP}`);
      if (!(await yes('Enter REMOTION_AWS_ACCESS_KEY_ID and REMOTION_AWS_SECRET_ACCESS_KEY now and save them to .env?'))) return 0;
      writeEnvKey('REMOTION_AWS_ACCESS_KEY_ID', await ask('REMOTION_AWS_ACCESS_KEY_ID:'), dir);
      writeEnvKey('REMOTION_AWS_SECRET_ACCESS_KEY', await ask('REMOTION_AWS_SECRET_ACCESS_KEY:'), dir);
    }
    const region = regionFlag ?? process.env.REMOTION_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

    // 3. Project
    let project = inspectProject(dir);
    if (!project.ready) {
      say(`\nNo ready Remotion project here (${project.reason}).`);
      if (!(await yes("Clone Remotion's Skia template into ./blitzframes-sample and benchmark that?"))) { say(`Run npx blitzframes inside a Remotion project, or npx blitzframes lambda functions deploy to deploy without a benchmark.`); return 0; }
      const sample = resolve(dir, 'blitzframes-sample');
      if (!existsSync(sample)) execSync(`git clone --depth 1 ${SAMPLE} blitzframes-sample`, {cwd: dir, stdio: 'inherit'});
      execSync('npm install --no-audit --no-fund && npm install --no-audit --no-fund @remotion/lambda', {cwd: sample, stdio: 'inherit'});
      writeEnvKey(TOKEN_KEY, token, sample);
      for (const key of ['REMOTION_AWS_ACCESS_KEY_ID', 'REMOTION_AWS_SECRET_ACCESS_KEY']) if (process.env[key]) writeEnvKey(key, process.env[key], sample);
      dir = sample; project = inspectProject(dir);
    }
    say(`\nProject: ${project.name ?? dir}, Remotion ${project.version}, region ${region}.`);
    const version = checkVersion(project.version);
    if (version.note) say(version.note);
    if (!(await yes('Benchmark it against stock Remotion Lambda?'))) { say('Deploy any time with: npx blitzframes lambda functions deploy'); return 0; }

    // 4. Functions
    const remotion = await remotionFrom(dir);
    say('');
    return await withBenchmarkFunctions({token, region, projectDir: dir, spin}, async deployed => {
      say(`  ${deployed.functionName} (BlitzFrames, ${deployed.memorySizeInMb} MB)\n  ${deployed.stockFunctionName} (stock)\n`);

      // 5. Site and composition
      const {serveUrl, via} = await spin('Uploading the project as a Remotion site', () => uploadSite({projectDir: dir, region, entryPoint: project.entryPoint, remotion, log: say}));
      say(`  ${serveUrl} (${via})`);
      const compositions = await spin('Reading the compositions', () => listCompositions({remotion, region, functionName: deployed.stockFunctionName, serveUrl, inputProps}));
      let composition = compositionFlag;
      if (!composition) {
        if (compositions.length === 1) composition = compositions[0].id;
        else { say('Compositions: ' + compositions.map(c => c.id).join(', ')); composition = await ask('Which one?', compositions[0]?.id); }
      }
      const chosen = compositions.find(c => c.id === composition);
      if (!chosen) { say(`No composition named ${composition}.`); return 1; }

      // 6. Benchmark
      say('');
      const {summary} = await benchmark({projectDir: dir, region, token, serveUrl, composition, inputProps, stockFunction: deployed.stockFunctionName,
        bfFunction: deployed.functionName, bfMemoryMb: deployed.memorySizeInMb, diskMb: remotion.constants.DEFAULT_EPHEMERAL_STORAGE_IN_MB, log: say, spin}, {remotion});
      say(formatSummary(summary));

      // 7. Setup
      say(`\nKeep rendering with BlitzFrames:
  - use ${deployed.functionName} as functionName in renderMediaOnLambda;
  - when you deploy a new function, for example after upgrading Remotion, run: npx blitzframes lambda functions deploy
      or call deployFunctionBlitzFrames({...}) from the blitzframes package; both read ${TOKEN_KEY} from .env.`);
      if (status.status === 'trial') say('Your trial continues until its renderer seconds are used; subscribe at https://blitzframes.com/#pricing to keep going.');
      return 0;
    }, {remotion});
  } finally { rl.close(); }
}
