import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {benchmark, formatSummary, listCompositions, readProps, PRICE_PER_FRAME, BF_AWS_COST, PRICE_GUARANTEE, STOCK_COST_FACTOR} from '../src/benchmark.mjs';

// Each render finishes at once; the wall time is taken from the function name so the order shows in the results.
function fakeRemotion(ms) {
  const calls = [];
  const remotion = {lambda: {
    renderMediaOnLambda: async ({functionName}) => { calls.push(functionName); return {renderId: 'r' + calls.length, bucketName: 'b'}; },
    getRenderProgress: async ({functionName}) => ({done: true, timeToFinish: ms[functionName], chunks: 4, framesRendered: 100,
      costs: {accruedSoFar: 0.01}, renderMetadata: {dimensions: {width: 1920, height: 1080}}, outputSizeInBytes: 1, outputFile: 'https://s3/out.mp4'}),
  }};
  return {remotion, calls};
}

test('by default the composition renders on BlitzFrames only, cold then three warm, with no comparison', async () => {
  const {remotion, calls} = fakeRemotion({bf: 1});
  const {results, summary} = await benchmark({region: 'eu-central-1', serveUrl: 'u', composition: 'Main', bfFunction: 'bf'}, {remotion});
  assert.deepEqual(calls, ['bf', 'bf', 'bf', 'bf']);
  assert.equal(results.stock.length, 0);
  assert.equal(results.bf.length, 4);
  assert.equal(summary.stock, null);
  assert.equal(summary.fasterPct, null);
  assert.equal(summary.cheaperPct, null);
  assert.equal(summary.frames, 100);
  assert.equal(summary.bf.warmSamplesMs.length, 3);
  assert.equal(summary.bf.costUsd, 100 * PRICE_PER_FRAME + BF_AWS_COST);
  const text = formatSummary(summary);
  assert.match(text, /Composition Main, 100 frames, 1920×1080, 4 chunks, eu-central-1/);
  assert.match(text, /BlitzFrames/);
  assert.doesNotMatch(text, /Remotion Lambda/);
  assert.match(text, /Warm render \(median of three\) \d+\.\d s, cold \d+\.\d s\./);
  assert.equal(summary.outputUrl, 'https://s3/out.mp4');
  assert.match(text, /Rendered video: https:\/\/s3\/out\.mp4/);
});

test('a render that fails in the browser is marked as the composition\'s; other failures are not', async () => {
  const failing = errors => ({lambda: {
    renderMediaOnLambda: async () => ({renderId: 'r', bucketName: 'b'}),
    getRenderProgress: async () => ({fatalErrorEncountered: true, errors}),
    getCompositionsOnLambda: async () => { throw new Error('calculateMetadata threw'); },
  }});
  const run = errors => benchmark({region: 'r', serveUrl: 'u', composition: 'Main', bfFunction: 'bf'}, {remotion: failing(errors)});
  await assert.rejects(run([{type: 'browser', isFatal: true, message: "Cannot read properties of undefined (reading 'title')", explanation: null}]),
    error => error.inComposition === true && /Render failed: Cannot read properties of undefined/.test(error.message));
  await assert.rejects(run([{type: 'renderer', isFatal: true, message: 'Timed out', explanation: 'The function timed out.'}]),
    error => error.inComposition === false && /Timed out\nThe function timed out\./.test(error.message));
  await assert.rejects(listCompositions({remotion: failing([]), region: 'r', functionName: 'f', serveUrl: 'u'}),
    error => error.inComposition === true && /calculateMetadata threw/.test(error.message));
});

test('the price guarantee caps the BlitzFrames cost at half of the Remotion Lambda cost', async () => {
  // A stock render estimated so cheap that the per-frame price would come out above it.
  const cheap = {lambda: {
    renderMediaOnLambda: async () => ({renderId: 'r', bucketName: 'b'}),
    getRenderProgress: async ({functionName}) => ({done: true, timeToFinish: 1, chunks: 1, framesRendered: 100, costs: {accruedSoFar: functionName === 'stock' ? 0.0005 : 0}}),
  }};
  const {summary} = await benchmark({region: 'r', serveUrl: 'u', composition: 'Main', stockFunction: 'stock', bfFunction: 'bf'}, {remotion: cheap});
  const stockCost = 0.0005 * STOCK_COST_FACTOR;
  assert.ok(100 * PRICE_PER_FRAME + BF_AWS_COST > stockCost, 'the per-frame price is above the stock cost in this case');
  assert.equal(summary.guaranteed, true);
  assert.equal(summary.bf.costUsd, stockCost * PRICE_GUARANTEE);
  assert.equal(summary.cheaperPct, 50);
  // A render that is cheaper, but by less than half, is capped as well.
  const cheaper = {lambda: {...cheap.lambda, getRenderProgress: async ({functionName}) => ({done: true, timeToFinish: 1, chunks: 1, framesRendered: 100, costs: {accruedSoFar: functionName === 'stock' ? 0.001 : 0}})}};
  const {summary: byLess} = await benchmark({region: 'r', serveUrl: 'u', composition: 'Main', stockFunction: 'stock', bfFunction: 'bf'}, {remotion: cheaper});
  assert.ok(100 * PRICE_PER_FRAME + BF_AWS_COST < 0.001 * STOCK_COST_FACTOR, 'the per-frame price is below the stock cost in this case');
  assert.equal(byLess.guaranteed, true);
  assert.equal(byLess.cheaperPct, 50);
  const text = formatSummary(summary);
  assert.match(text, /50% cheaper/);
  assert.match(text, /50% cheaper \(price guarantee\)\./);
  assert.doesNotMatch(text, /guarantee.*terms/);
});

test('input props are read as the Remotion CLI reads them: inline JSON or a JSON file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-props-'));
  writeFileSync(join(dir, 'props.json'), '{"title": "from file"}');
  assert.deepEqual(readProps('{"title": "inline"}', dir), {title: 'inline'});
  assert.deepEqual(readProps('props.json', dir), {title: 'from file'});
  assert.deepEqual(readProps(join(dir, 'props.json'), '/'), {title: 'from file'});
  assert.throws(() => readProps('missing.json', dir), /must be JSON or the path of a JSON file; got: missing.json/);
  assert.throws(() => readProps('{not json', dir), /must be JSON or the path of a JSON file/);
});

test('with a stock function the renders interleave and the summary compares', async () => {
  const {remotion, calls} = fakeRemotion({stock: 1, bf: 1});
  const {summary} = await benchmark({region: 'eu-central-1', serveUrl: 'u', composition: 'Main', stockFunction: 'stock', bfFunction: 'bf'}, {remotion});
  assert.deepEqual(calls, ['stock', 'bf', 'stock', 'bf', 'bf', 'stock', 'stock', 'bf']);
  assert.ok(summary.stock);
  assert.equal(typeof summary.fasterPct, 'number');
  assert.equal(typeof summary.cheaperPct, 'number');
  const text = formatSummary(summary);
  assert.match(text, /Remotion Lambda/);
  assert.match(text, /% (faster|slower)/);
});
