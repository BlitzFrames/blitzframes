/** The numbers: the composition rendered on the BlitzFrames function, cold then three warm; with a
 * stock function, the comparison, interleaved. */
import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {remotionFrom} from './project.mjs';

export const PRICE_PER_FRAME = 0.00001; // US$ per rendered frame
export const BF_AWS_COST = 0.0001; // US$ per render, assumed AWS cost of a BlitzFrames render
// Temporary: Remotion's cost estimate falls below billed Lambda durations, most for short renders.
export const STOCK_COST_FACTOR = 1.3;
const SITE = 'blitzframes-benchmark';

/** Input props as the Remotion CLI takes them: inline JSON, or the path of a JSON file. */
export function readProps(text, cwd = process.cwd()) {
  const file = resolve(cwd, text);
  const source = existsSync(file) ? readFileSync(file, 'utf8') : text;
  try { return JSON.parse(source); } catch {
    throw new Error(`Input props must be JSON or the path of a JSON file; got: ${text}`);
  }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Uploads the project as a site with the project's own Remotion CLI, so Remotion finds the entry point
 * and applies its config. Runs before any function is deployed, so a project it cannot upload costs nothing. */
export async function uploadSite({projectDir, region}) {
  const output = await new Promise(resolve => {
    // The project's own CLI. A nested "npx remotion" under "npx --package" inherits npm_config_package
    // and runs the Remotion CLI installed next to this package instead.
    const local = join(projectDir, 'node_modules/.bin/remotion');
    const [command, prefix] = existsSync(local) ? [local, []] : ['npx', ['remotion']];
    const {npm_config_package, ...env} = process.env;
    const child = spawn(command, [...prefix, 'lambda', 'sites', 'create', '--site-name=' + SITE, '--region=' + region, '--log=info'],
      {cwd: projectDir, env, stdio: ['ignore', 'pipe', 'pipe']});
    let text = ''; child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
    child.on('close', code => resolve({code, text}));
    child.on('error', error => resolve({code: 1, text: String(error)}));
  });
  const url = output.text.match(/https:\/\/\S+\/index\.html/)?.[0];
  if (output.code === 0 && url) return {serveUrl: url};
  const tail = output.text.trim().split('\n').slice(-12).join('\n');
  throw new Error(`The Remotion CLI could not upload the site (${output.code === 0 ? 'no serve URL in its output' : 'exit code ' + output.code}):\n${tail}`);
}

/** Errors raised by the composition itself, in the browser, carry inComposition: reading the compositions runs its
 * calculateMetadata, and a render fails with a browser error when its React code throws. Both are what a
 * composition that needs input props does; the other errors are Remotion's or AWS's and props cannot fix them. */
export async function listCompositions({remotion, region, functionName, serveUrl, inputProps}) {
  try {
    return await remotion.lambda.getCompositionsOnLambda({region, functionName, serveUrl, inputProps: inputProps ?? {}, envVariables: {}});
  } catch (error) { error.inComposition = true; throw error; }
}

async function render({remotion, region, functionName, serveUrl, composition, inputProps}) {
  const started = performance.now();
  const {renderId, bucketName} = await remotion.lambda.renderMediaOnLambda({region, functionName, serveUrl, composition, inputProps: inputProps ?? {}, envVariables: {}, codec: 'h264'});
  for (;;) {
    const p = await remotion.lambda.getRenderProgress({region, functionName, renderId, bucketName});
    if (p.fatalErrorEncountered) {
      const first = p.errors?.find(e => e.isFatal) ?? p.errors?.[0];
      const error = new Error('Render failed: ' + (first?.message ?? JSON.stringify(p.errors)) + (first?.explanation ? `\n${first.explanation}` : ''));
      error.inComposition = first?.type === 'browser';
      throw error;
    }
    if (p.done) return {renderId, wallMs: performance.now() - started, remotionMs: p.timeToFinish, chunks: p.chunks, frames: p.framesRendered,
      estimatedCostUsd: p.costs?.accruedSoFar ?? null, dimensions: p.renderMetadata?.dimensions, outputSize: p.outputSizeInBytes, outputUrl: p.outputFile ?? null};
    if (performance.now() - started > 900000) throw new Error('Render exceeded 15 minutes');
    await wait(500);
  }
}

export async function benchmark({projectDir, region, serveUrl, composition, inputProps, stockFunction, bfFunction, log = () => {},
  spin = (text, work) => { log(text + '…'); return work(); }}, deps = {}) {
  const remotion = deps.remotion ?? await remotionFrom(projectDir);
  const results = {stock: [], bf: []};
  const order = stockFunction
    ? [['stock', stockFunction], ['bf', bfFunction], ['stock', stockFunction], ['bf', bfFunction], ['bf', bfFunction], ['stock', stockFunction], ['stock', stockFunction], ['bf', bfFunction]]
    : [['bf', bfFunction], ['bf', bfFunction], ['bf', bfFunction], ['bf', bfFunction]];
  for (const [mode, functionName] of order) {
    const phase = results[mode].length ? 'warm ' + results[mode].length + '/3' : 'cold';
    const r = await spin(`Rendering ${composition} on ${mode === 'stock' ? 'Remotion Lambda' : 'BlitzFrames'} (${phase})`,
      () => render({remotion, region, functionName, serveUrl, composition, inputProps}));
    r.costUsd = mode === 'bf' ? r.frames * PRICE_PER_FRAME + BF_AWS_COST
      : r.estimatedCostUsd === null ? null : r.estimatedCostUsd * STOCK_COST_FACTOR;
    results[mode].push(r);
    log(`  ${(r.wallMs / 1000).toFixed(1)} s end to end, ${r.chunks} chunks`);
  }
  const s = results.stock, b = results.bf;
  const median = v => { const x = [...v].sort((a, c) => a - c); const m = Math.floor(x.length / 2); return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };
  const warm = rows => rows.slice(1);
  const medianOf = (rows, key) => { const v = warm(rows).map(r => r[key]).filter(x => typeof x === 'number'); return v.length ? median(v) : null; };
  const stats = rows => ({coldMs: rows[0].wallMs, warmMs: medianOf(rows, 'wallMs'), warmSamplesMs: warm(rows).map(r => r.wallMs), costUsd: medianOf(rows, 'costUsd')});
  const first = s[0] ?? b[0];
  const summary = {
    composition, frames: first.frames, chunks: first.chunks, dimensions: first.dimensions, region,
    stock: s.length ? stats(s) : null, bf: stats(b), fasterPct: null, cheaperPct: null, outputUrl: b[0].outputUrl,
  };
  if (summary.stock) {
    summary.fasterPct = Math.round((1 - summary.bf.warmMs / summary.stock.warmMs) * 100);
    summary.cheaperPct = summary.bf.costUsd === null || !summary.stock.costUsd ? null : Math.round((1 - summary.bf.costUsd / summary.stock.costUsd) * 100);
  }
  return {results, summary};
}

export function formatSummary({composition, frames, chunks, dimensions, region, stock, bf, fasterPct, cheaperPct, outputUrl}) {
  const s = ms => ((ms / 1000).toFixed(1) + ' s').padStart(8);
  const usd = v => (v === null || v === undefined ? '—' : '$' + v.toFixed(4)).padStart(9);
  const samples = v => v.map(ms => (ms / 1000).toFixed(1)).join(' / ') + ' s';
  const row = (name, r) => name.padEnd(15) + s(r.coldMs) + s(r.warmMs) + usd(r.costUsd) + '   ' + samples(r.warmSamplesMs);
  const lines = [
    '',
    `Composition ${composition}, ${frames} frames${dimensions ? `, ${dimensions.width}×${dimensions.height}` : ''}, ${chunks} chunks, ${region}`,
    '',
    ''.padEnd(15) + 'cold'.padStart(8) + 'warm'.padStart(8) + 'cost'.padStart(9) + '   warm samples',
    ...(stock ? [row('Remotion Lambda', stock)] : []),
    row('BlitzFrames', bf),
    '',
    stock
      ? `Warm render (median of three) ${fasterPct >= 0 ? fasterPct + '% faster' : Math.abs(fasterPct) + '% slower'}` +
        (cheaperPct === null ? '' : cheaperPct >= 0 ? `, ${cheaperPct}% cheaper` : `, ${Math.abs(cheaperPct)}% more expensive`) + '.'
      : `Warm render (median of three) ${(bf.warmMs / 1000).toFixed(1)} s, cold ${(bf.coldMs / 1000).toFixed(1)} s.`,
    ...(stock ? [`Remotion Lambda cost is Remotion's AWS estimate +${Math.round((STOCK_COST_FACTOR - 1) * 100)}%, as its estimate falls below billed costs.`] : []),
    `BlitzFrames cost is US$${PRICE_PER_FRAME} per rendered frame plus an assumed US$${BF_AWS_COST} AWS cost; see https://blitzframes.com/terms.`,
    ...(outputUrl ? ['', `Rendered video: ${outputUrl}`] : []),
  ];
  return lines.join('\n');
}
