/** The comparison: the composition rendered on the stock and BlitzFrames functions, interleaved. */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {liveUsage} from './account.mjs';
import {remotionFrom} from './project.mjs';

export const RATE = 0.00005; // US$ per renderer second
export const GUARANTEE = 0.2; // a month costs at least this fraction less than stock Remotion Lambda
const SITE = 'blitzframes-benchmark';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Uploads the project as a site with the project's own Remotion CLI, so its config applies; falls back to the API. */
export async function uploadSite({projectDir, region, entryPoint, remotion, log}) {
  const output = await new Promise(resolve => {
    // The project's own CLI. A nested "npx remotion" under "npx --package" inherits npm_config_package
    // and runs the Remotion CLI installed next to this package instead.
    const local = join(projectDir, 'node_modules/.bin/remotion');
    const [command, prefix] = existsSync(local) ? [local, []] : ['npx', ['remotion']];
    const {npm_config_package, ...env} = process.env;
    const child = spawn(command, [...prefix, 'lambda', 'sites', 'create', ...(entryPoint ? [entryPoint] : []), '--site-name=' + SITE, '--region=' + region, '--log=info'],
      {cwd: projectDir, env, stdio: ['ignore', 'pipe', 'pipe']});
    let text = ''; child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
    child.on('close', code => resolve({code, text}));
    child.on('error', error => resolve({code: 1, text: String(error)}));
  });
  const url = output.text.match(/https:\/\/\S+\/index\.html/)?.[0];
  if (output.code === 0 && url) return {serveUrl: url, via: 'remotion cli'};
  log?.(`The Remotion CLI could not upload the site (${output.code === 0 ? 'no serve URL in its output' : 'exit code ' + output.code}); using the API instead.`);
  const {bucketName} = await remotion.lambda.getOrCreateBucket({region});
  const {serveUrl} = await remotion.lambda.deploySite({entryPoint: entryPoint ?? 'src/index.ts', siteName: SITE, region, bucketName,
    options: {onBundleProgress: () => {}, onUploadProgress: () => {}}});
  return {serveUrl, via: 'api'};
}

export async function listCompositions({remotion, region, functionName, serveUrl, inputProps}) {
  return remotion.lambda.getCompositionsOnLambda({region, functionName, serveUrl, inputProps: inputProps ?? {}, envVariables: {}});
}

async function render({remotion, region, functionName, serveUrl, composition, inputProps}) {
  const started = performance.now();
  const {renderId, bucketName} = await remotion.lambda.renderMediaOnLambda({region, functionName, serveUrl, composition, inputProps: inputProps ?? {}, envVariables: {}, codec: 'h264'});
  for (;;) {
    const p = await remotion.lambda.getRenderProgress({region, functionName, renderId, bucketName});
    if (p.fatalErrorEncountered) throw new Error('Render failed: ' + JSON.stringify(p.errors?.[0]?.message ?? p.errors));
    if (p.done) return {renderId, wallMs: performance.now() - started, remotionMs: p.timeToFinish, chunks: p.chunks, frames: p.framesRendered,
      estimatedCostUsd: p.costs?.accruedSoFar ?? null, dimensions: p.renderMetadata?.dimensions, outputSize: p.outputSizeInBytes};
    if (performance.now() - started > 900000) throw new Error('Render exceeded 15 minutes');
    await wait(500);
  }
}

async function usageFor(token, renderId, chunks, deps) {
  let last = null;
  for (let i = 0; i < 20; i++) {
    const usage = await liveUsage(token, renderId, deps).catch(() => null);
    if (usage && usage.attempts >= chunks) return usage;
    last = usage; await wait(500);
  }
  return last;
}

export async function benchmark({projectDir, region, token, serveUrl, composition, inputProps, stockFunction, bfFunction, bfMemoryMb, diskMb, log = () => {},
  spin = (text, work) => { log(text + '…'); return work(); }}, deps = {}) {
  const remotion = deps.remotion ?? await remotionFrom(projectDir);
  const results = {stock: [], bf: []};
  const order = [['stock', stockFunction], ['bf', bfFunction], ['stock', stockFunction], ['bf', bfFunction], ['bf', bfFunction], ['stock', stockFunction], ['stock', stockFunction], ['bf', bfFunction]];
  for (const [mode, functionName] of order) {
    const phase = results[mode].length ? 'warm ' + results[mode].length + '/3' : 'cold';
    const r = await spin(`Rendering ${composition} on ${mode === 'stock' ? 'Remotion Lambda' : 'BlitzFrames'} (${phase})`, async () => {
      const r = await render({remotion, region, functionName, serveUrl, composition, inputProps});
      if (mode === 'bf') {
        const usage = await usageFor(token, r.renderId, r.chunks, deps);
        r.usageSeconds = usage?.seconds ?? null; r.usageAttempts = usage?.attempts ?? null;
      }
      return r;
    });
    if (mode === 'bf') {
      r.awsCostUsd = remotion.client.estimatePrice({region, durationInMilliseconds: r.remotionMs + 1500, memorySizeInMb: bfMemoryMb, diskSizeInMb: diskMb, lambdasInvoked: 2});
      r.usageCostUsd = r.usageSeconds === null ? null : r.usageSeconds * RATE;
      r.totalCostUsd = r.usageCostUsd === null ? null : r.awsCostUsd + r.usageCostUsd;
    } else {
      r.awsCostUsd = r.estimatedCostUsd; r.totalCostUsd = r.estimatedCostUsd;
    }
    results[mode].push(r);
    log(`  ${(r.wallMs / 1000).toFixed(1)} s end to end, ${r.chunks} chunks` + (mode === 'bf' && r.usageSeconds !== null ? `, ${r.usageSeconds.toFixed(1)} renderer seconds` : ''));
  }
  const s = results.stock, b = results.bf;
  const median = v => { const x = [...v].sort((a, c) => a - c); const m = Math.floor(x.length / 2); return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };
  const warm = rows => rows.slice(1);
  const medianOf = (rows, key) => { const v = warm(rows).map(r => r[key]).filter(x => typeof x === 'number'); return v.length ? median(v) : null; };
  const summary = {
    composition, frames: s[0].frames, chunks: s[0].chunks, dimensions: s[0].dimensions, region,
    stock: {coldMs: s[0].wallMs, warmMs: medianOf(s, 'wallMs'), warmSamplesMs: warm(s).map(r => r.wallMs), costUsd: medianOf(s, 'totalCostUsd')},
    bf: {coldMs: b[0].wallMs, warmMs: medianOf(b, 'wallMs'), warmSamplesMs: warm(b).map(r => r.wallMs), awsCostUsd: medianOf(b, 'awsCostUsd'),
      usageSeconds: medianOf(b, 'usageSeconds'), usageCostUsd: medianOf(b, 'usageCostUsd'), costUsd: medianOf(b, 'totalCostUsd')},
  };
  summary.fasterPct = Math.round((1 - summary.bf.warmMs / summary.stock.warmMs) * 100);
  summary.cheaperPct = summary.bf.costUsd === null || !summary.stock.costUsd ? null : Math.round((1 - summary.bf.costUsd / summary.stock.costUsd) * 100);
  return {results, summary};
}

export function formatSummary({composition, frames, chunks, dimensions, region, stock, bf, fasterPct, cheaperPct}) {
  const s = ms => (ms / 1000).toFixed(1).padStart(6) + ' s';
  const usd = v => v === null || v === undefined ? '      —' : ('$' + v.toFixed(4)).padStart(8);
  const lines = [
    '',
    `Composition ${composition}, ${frames} frames${dimensions ? `, ${dimensions.width}×${dimensions.height}` : ''}, ${chunks} chunks, ${region}`,
    '',
    '                    cold      warm   AWS cost  BlitzFrames     total   warm samples',
    `Remotion Lambda   ${s(stock.coldMs)}  ${s(stock.warmMs)}   ${usd(stock.costUsd)}                ${usd(stock.costUsd)}   ${stock.warmSamplesMs.map(v => (v / 1000).toFixed(1)).join(' / ')}`,
    `BlitzFrames       ${s(bf.coldMs)}  ${s(bf.warmMs)}   ${usd(bf.awsCostUsd)}     ${usd(bf.usageCostUsd)}  ${usd(bf.costUsd)}   ${bf.warmSamplesMs.map(v => (v / 1000).toFixed(1)).join(' / ')}`,
    '',
    `Warm render (median of three) ${fasterPct >= 0 ? fasterPct + '% faster' : Math.abs(fasterPct) + '% slower'}` +
      (cheaperPct === null ? '; usage not reported yet, see your account page'
        : bf.costUsd > stock.costUsd * (1 - GUARANTEE) ? `, ${GUARANTEE * 100}% cheaper (price guarantee)` : `, ${cheaperPct}% cheaper`) + '.',
    'AWS costs are estimates from Remotion\'s price table. BlitzFrames usage is US$' + RATE + ' per renderer second.',
    `Price guarantee: a month with BlitzFrames costs at most ${100 - GUARANTEE * 100}% of what the same renders would have cost on stock Remotion Lambda; see https://blitzframes.com/terms.`,
  ];
  return lines.join('\n');
}
