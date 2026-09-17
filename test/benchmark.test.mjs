import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmark, formatSummary, PRICE_PER_FRAME, BF_AWS_COST} from '../src/benchmark.mjs';

// Each render finishes at once; the wall time is taken from the function name so the order shows in the results.
function fakeRemotion(ms) {
  const calls = [];
  const remotion = {lambda: {
    renderMediaOnLambda: async ({functionName}) => { calls.push(functionName); return {renderId: 'r' + calls.length, bucketName: 'b'}; },
    getRenderProgress: async ({functionName}) => ({done: true, timeToFinish: ms[functionName], chunks: 4, framesRendered: 100,
      costs: {accruedSoFar: 0.01}, renderMetadata: {dimensions: {width: 1920, height: 1080}}, outputSizeInBytes: 1}),
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
