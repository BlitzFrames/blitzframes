/** The deploy warns about a Remotion release the render hosts do not have, from GET /api/versions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {supportNote} from '../src/version.mjs';

const fleet = (body, status = 200) => async url => {
  assert.equal(url, 'https://blitzframes.com/api/versions');
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {status});
};
const hosts = {versions: ['4.0.293', '4.0.538', '4.0.539'], newest: '4.0.539', hosts: 11, reporting: 11};

test('a release every host has needs no note', async () => {
  assert.equal(await supportNote('4.0.539', fleet(hosts)), null);
  assert.equal(await supportNote('4.0.293', fleet(hosts)), null);
});

test('a release newer than the hosts\' newest is not supported yet; the note names the release to stay on', async () => {
  const note = await supportNote('4.0.540', fleet(hosts));
  assert.match(note, /^Warning: BlitzFrames does not support Remotion 4\.0\.540 yet, so every render on this function fails until it does\./);
  assert.match(note, /The newest supported release is 4\.0\.539; stay on it \(npx remotion upgrade --version 4\.0\.539\) until 4\.0\.540 is supported\.$/);
});

test('an older release the hosts lack is not supported', async () => {
  assert.equal(await supportNote('4.0.300', fleet(hosts)),
    'Warning: BlitzFrames does not support Remotion 4.0.300, so every render on this function fails. The newest supported release is 4.0.539.');
});

test('an unanswered or empty check says it could not check, and does not stop the deploy', async () => {
  const unknown = 'Could not check whether BlitzFrames supports Remotion 4.0.539; deploying anyway.';
  assert.equal(await supportNote('4.0.539', fleet('', 503)), unknown);
  assert.equal(await supportNote('4.0.539', fleet('not json')), unknown);
  assert.equal(await supportNote('4.0.539', async () => { throw new Error('offline'); }), unknown);
  assert.equal(await supportNote('4.0.539', fleet({versions: [], newest: null, hosts: 11, reporting: 0})), unknown, 'no host has reported');
  assert.equal(await supportNote(undefined, fleet(hosts)), null, 'an unknown project version is noted by checkVersion');
});
