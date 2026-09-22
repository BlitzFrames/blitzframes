/** npx blitzframes with no arguments: token, credentials, project, function, render, setup. With
 * --benchmark, or on request, the render is a comparison against a stock function. */
import {createInterface} from 'node:readline';
import {existsSync, readFileSync} from 'node:fs';
import {execSync, spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {requestCode, startTrial, tokenStatus, verifyCode} from './account.mjs';
import {TOKEN_KEY, hasAwsCredentials, loadEnv, writeEnvKey} from './env.mjs';
import {inspectProject, packageManager, remotionFrom} from './project.mjs';
import {withBenchmarkFunctions} from './benchmark-functions.mjs';
import {benchmark, formatSummary, listCompositions, readProps, uploadSite} from './benchmark.mjs';
import {spin} from './progress.mjs';
import {compareVersions} from './version.mjs';

const SETUP = 'https://www.remotion.dev/docs/lambda/setup';
const SAMPLE = 'https://github.com/remotion-dev/template-skia';

export async function guided({projectDir, region: regionFlag, composition: compositionFlag, inputProps, benchmark: benchmarkFlag} = {}) {
  // On a terminal the questions are drawn as in Remotion's own create-video, with the same library.
  // Piped answers keep the plain line-by-line form, queued as they arrive so none read ahead is lost.
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const prompts = tty ? (await import('prompts')).default : null;
  const prompt = async question => (await prompts({name: 'value', ...question}, {onCancel: () => process.exit(130)})).value;
  const rl = tty ? {close() {}} : createInterface({input: process.stdin, terminal: false});
  const queue = [], waiters = []; let closed = false;
  if (!tty) {
    rl.on('line', line => { if (waiters.length) waiters.shift()(line); else queue.push(line); });
    rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(''); });
  }
  const line = async (question, fallback) => {
    process.stdout.write(question + (fallback ? ` [${fallback}] ` : ' '));
    const text = queue.length ? queue.shift() : closed ? '' : await new Promise(resolve => waiters.push(resolve));
    process.stdout.write(text + '\n');
    return text.trim() || fallback || '';
  };
  const ask = (question, fallback, {secret = false} = {}) => tty
    ? prompt({type: secret ? 'password' : 'text', message: question.replace(/:$/, ''), initial: fallback}).then(value => String(value ?? '').trim() || fallback || '')
    : line(question, fallback);
  const yes = async (question, fallback = true) => tty
    ? prompt({type: 'toggle', message: question, initial: fallback, active: 'Yes', inactive: 'No'})
    : /^y/i.test(await line(question + (fallback ? ' (Y/n)' : ' (y/N)'), fallback ? 'y' : 'n'));
  /** One of choices, each {title, value, description}; piped answers match a value by its first letters. */
  const choose = async (question, choices, fallback = choices[0].value) => {
    if (tty) return prompt({type: 'select', message: question, choices, initial: Math.max(0, choices.findIndex(c => c.value === fallback))});
    const answer = (await line(`${question} (${choices.map(c => c.value).join('/')})`, fallback)).toLowerCase();
    return (choices.find(c => c.value.toLowerCase() === answer) ?? choices.find(c => answer && c.value.toLowerCase().startsWith(answer)) ?? {value: answer}).value;
  };
  const say = text => console.log(text);
  try {
    let dir = projectDir ?? process.cwd();
    const saved = loadEnv(dir);
    // The updated copy continues a run that has already introduced itself.
    if (!process.env.BLITZFRAMES_UPDATED) say('BlitzFrames: faster Remotion Lambda renders, one variable on your own function.\n');

    // 0. A project that has this package runs its own copy under npx, and so stays on that version until
    // it is updated. Asked on a terminal only, and only here: the other commands never ask anything.
    if (tty && !process.env.BLITZFRAMES_UPDATED) {
      const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
      const local = join(dir, 'node_modules/blitzframes/package.json');
      const latest = existsSync(local) ? await fetch('https://registry.npmjs.org/blitzframes/latest', {signal: AbortSignal.timeout(2000)})
        .then(response => response.ok ? response.json() : null).then(body => body?.version).catch(() => null) : null;
      if (latest && compareVersions(latest, own) > 0) {
        const command = `${packageManager(dir).addRange} blitzframes@latest`;
        if (await yes(`blitzframes ${latest} is available; this project has ${own}. Update? Runs "${command}"`)) {
          try {
            await spin(`Updating blitzframes to ${latest}`, async () => execSync(command, {cwd: dir, stdio: 'pipe'}));
            return spawnSync(process.execPath, [join(dir, 'node_modules/blitzframes/src/cli.mjs'), ...process.argv.slice(2)],
              {cwd: process.cwd(), stdio: 'inherit', env: {...process.env, BLITZFRAMES_UPDATED: '1'}}).status ?? 1;
          } catch { say(`The update failed; continuing with ${own}. Update later with: ${command}`); }
        }
      }
    }

    // 1. Token. One the service has no record of, for example from a deleted account or another
    // environment, is replaced by signing in again rather than ending the run.
    let token = process.env[TOKEN_KEY], status = token ? await tokenStatus(token) : null;
    if (status?.status === 'unknown') {
      const fromShell = saved[TOKEN_KEY] !== token;
      say(`The token in ${fromShell ? `your shell's ${TOKEN_KEY}` : join(dir, '.env')} is not known to blitzframes.com.`);
      if (!(await yes(`Sign in by email and ${fromShell ? 'save a new one to .env' : 'replace it'}?`))) { say('Copy your token from https://blitzframes.com/account, or run npx blitzframes again to sign in.'); return 1; }
      if (fromShell) say(`${TOKEN_KEY} in your shell takes precedence over .env; unset it, or later runs will use the old token again.`);
      token = null;
    }
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
        const choice = await choose('Free trial or paid subscription?', [{title: 'Free trial', value: 'trial', description: 'US$5 of rendering, no card'},
          {title: 'Paid subscription', value: 'paid', description: 'subscribe on blitzframes.com'}]);
        if (choice === 'paid') { say('Subscribe at https://blitzframes.com/#pricing, then run npx blitzframes again.'); return 0; }
        standing = await startTrial(standing.proof);
      } else if (standing.status === 'ended') {
        say('The free trial for this address is used up. Subscribe at https://blitzframes.com/#pricing, then run npx blitzframes again.'); return 1;
      }
      token = standing.token;
      writeEnvKey(TOKEN_KEY, token, dir);
      say(`\nYour token is saved as ${TOKEN_KEY} in .env. Keep that file out of version control, as Remotion's setup guide already asks.`);
      status = await tokenStatus(token);
    }
    if (status.status === 'inactive') { say(`Your token is inactive (${status.reason}). Subscribe at https://blitzframes.com/#pricing.`); return 1; }
    say(status.status === 'trial'
      ? `Free trial: ${status.trial.framesLeft.toLocaleString('en-US')} frames left. Account: https://blitzframes.com/account`
      : status.status === 'subscribed' ? 'Subscription active. Account: https://blitzframes.com/account'
      : 'Token accepted. Account: https://blitzframes.com/account');

    // 2. Credentials
    if (!hasAwsCredentials()) {
      say(`\nRenders run on your own AWS account, as with every Remotion Lambda render, so the AWS credentials from Remotion's setup guide are needed: ${SETUP}`);
      if (!(await yes('Enter REMOTION_AWS_ACCESS_KEY_ID and REMOTION_AWS_SECRET_ACCESS_KEY now and save them to .env?'))) return 0;
      writeEnvKey('REMOTION_AWS_ACCESS_KEY_ID', await ask('REMOTION_AWS_ACCESS_KEY_ID:'), dir);
      writeEnvKey('REMOTION_AWS_SECRET_ACCESS_KEY', await ask('REMOTION_AWS_SECRET_ACCESS_KEY:', undefined, {secret: true}), dir);
    }
    const region = regionFlag ?? process.env.REMOTION_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

    // 3. Project. Whatever keeps this project from rendering, an error or a declined change, leads to
    // the sample, which leaves the project as it is.
    let project, usingSample = false;
    // Makes dir ready, running the one command that fixes each problem; asks first unless confirmed.
    // Returns nothing when ready, else what stands in the way and the command that was not run.
    const prepare = async confirmed => {
      for (;;) {
        project = await inspectProject(dir);
        if (project.ready) return null;
        if (!project.fix) return {problem: `${project.reason}.`};
        if (!confirmed) {
          say(`\n${project.reason}.`);
          if (!(await yes(`Run "${project.fix}" in ${dir}?`))) return {problem: `${dir} needs "${project.fix}" before it can render.`, command: project.fix};
        }
        const {reason, fix} = project;
        try { execSync(fix, {cwd: dir, stdio: 'inherit'}); } catch { return {problem: `"${fix}" failed in ${dir}.`, command: fix}; }
        if ((await inspectProject(dir)).reason === reason) return {problem: `${reason}, also after "${fix}".`, command: fix};
      }
    };
    // The sample goes into the directory the command was run in. False when declined or not ready.
    const useSample = async ({problem, command}) => {
      say(`\n${problem}`);
      if (!(await yes("Clone Remotion's Skia template into ./blitzframes-sample and render that?"))) {
        say((command ? `Run "${command}" in ${dir}, then npx blitzframes again.` : 'Run npx blitzframes inside a Remotion project.') +
          '\nTo deploy without rendering: npx blitzframes lambda functions deploy');
        return false;
      }
      const sample = resolve(process.cwd(), 'blitzframes-sample');
      if (!existsSync(sample)) execSync(`git clone --depth 1 ${SAMPLE} blitzframes-sample`, {cwd: process.cwd(), stdio: 'inherit'});
      writeEnvKey(TOKEN_KEY, token, sample);
      for (const key of ['REMOTION_AWS_ACCESS_KEY_ID', 'REMOTION_AWS_SECRET_ACCESS_KEY']) if (process.env[key]) writeEnvKey(key, process.env[key], sample);
      dir = sample; usingSample = true;
      const blocked = await prepare(true);
      if (blocked) say(`\nThe sample is not ready: ${blocked.problem}`);
      return !blocked;
    };
    const describe = () => say(`\nProject: ${project.name ?? dir}, Remotion ${project.version}, region ${region}.`);
    // This package in the project, as Remotion's CLI is in every Remotion project: npx blitzframes then
    // runs the project's copy, and deployFunctionBlitzFrames can be imported. The newest version, not
    // pinned; who wants a fixed one sets it in package.json. The render does not need it, so a no or a
    // failure only names the command for later.
    const addPackage = async () => {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.dependencies?.blitzframes ?? pkg.devDependencies?.blitzframes) return;
      const command = `${packageManager(dir).addRange} blitzframes@latest`;
      if (!usingSample && !(await yes(`Add blitzframes to this project? Runs "${command}"`))) { say(`Add it any time with: ${command}`); return; }
      try { await spin('Adding blitzframes to the project', async () => execSync(command, {cwd: dir, stdio: 'pipe'})); }
      catch { say(`blitzframes could not be added; rendering continues. Add it later with: ${command}`); }
    };
    const blocked = await prepare(false);
    if (blocked && !(await useSample(blocked))) return usingSample ? 1 : 0;
    describe();
    await addPackage();
    // The sample was asked for together with the render.
    if (!usingSample && !(await yes('Deploy a BlitzFrames function and render a composition on it?'))) { say('Deploy any time with: npx blitzframes lambda functions deploy'); return 0; }
    const compare = benchmarkFlag ?? await yes('Also benchmark it against stock Remotion Lambda (a temporary stock function and four more renders)?', false);

    // 4. Site, before any function exists
    const upload = () => { say(''); return spin('Uploading the project as a Remotion site', () => uploadSite({projectDir: dir, region})); };
    let serveUrl;
    try { ({serveUrl} = await upload()); } catch (error) {
      if (usingSample) throw error;
      if (!(await useSample({problem: error.message}))) return 1;
      describe();
      await addPackage();
      ({serveUrl} = await upload());
    }
    say(`  ${serveUrl}\n`);
    const remotion = await remotionFrom(dir);

    // 5. Functions and composition
    return await withBenchmarkFunctions({token, region, projectDir: dir, compare, spin}, async deployed => {
      say(`  ${deployed.functionName} (BlitzFrames, ${deployed.memorySizeInMb} MB)` + (compare ? `\n  ${deployed.stockFunctionName} (stock)` : '') + '\n');
      // A composition that needs input props fails in the browser, while its compositions are read or while it
      // renders; the props are then asked for, as the Remotion CLI takes them, and the step tried again. An
      // empty answer stops. Other errors are not the composition's and end the run as before.
      let props = inputProps, composition = compositionFlag, answered = null;
      for (;;) {
        try {
          const compositions = await spin('Reading the compositions', () => listCompositions({remotion, region, functionName: deployed.stockFunctionName ?? deployed.functionName, serveUrl, inputProps: props}));
          if (!composition) {
            if (compositions.length === 1) composition = compositions[0].id;
            else composition = await choose('Which composition?', compositions.map(c => ({title: c.id, value: c.id, description: `${c.durationInFrames} frames, ${c.width}×${c.height}`})));
          }
          if (!compositions.some(c => c.id === composition)) { say(`No composition named ${composition}.`); return 1; }

          // 6. Render, or the benchmark
          say('');
          const {summary} = await benchmark({projectDir: dir, region, serveUrl, composition, inputProps: props, stockFunction: deployed.stockFunctionName,
            bfFunction: deployed.functionName, log: say, spin}, {remotion});
          say(formatSummary(summary));
          break;
        } catch (error) {
          if (!error.inComposition) throw error;
          say(`\n${error.message}\n\nThe composition failed in the browser; one that needs input props${props ? ' other than the given ones' : ''} does this.`);
          for (;;) {
            const answer = await ask('Input props, as JSON or the path of a JSON file (empty to stop):');
            if (!answer) return 1;
            try { props = readProps(answer, dir); answered = answer; break; } catch (problem) { say(problem.message); }
          }
        }
      }

      // 7. Setup. Props typed in are worth repeating: as the flag that skips the question, and as
      // the inputProps a render outside the CLI needs as well. A file path is shown as given; JSON is
      // quoted for the shell.
      const propsFlag = answered === null ? '' : ' --props ' + (existsSync(resolve(dir, answered)) ? answered : `'${JSON.stringify(props).replaceAll("'", "'\\''")}'`);
      say(`\nKeep rendering with BlitzFrames${usingSample ? ' (the sample is in ./blitzframes-sample; cd there first)' : ''}:
  - use ${deployed.functionName} as functionName in renderMediaOnLambda${propsFlag ? ', with the same inputProps' : ''};
  - when you deploy a new function, for example after upgrading Remotion, run: npx blitzframes lambda functions deploy
      or call deployFunctionBlitzFrames({...}) from the blitzframes package; both read ${TOKEN_KEY} from .env.`);
      if (propsFlag) say(`Skip the input props question next time with: npx blitzframes${propsFlag}`);
      if (!compare) say(`Compare with stock Remotion Lambda any time with: npx blitzframes benchmark${propsFlag}`);
      if (status.status === 'trial') say('Your trial continues until its frames are used; subscribe at https://blitzframes.com/#pricing to keep going.');
      return 0;
    }, {remotion});
  } finally { rl.close(); }
}
