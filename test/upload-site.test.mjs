import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {uploadSite} from '../src/benchmark.mjs';

/** A project whose node_modules/.bin/remotion records its arguments and prints the given output. */
function projectWithCli(output, code) {
  const dir = mkdtempSync(join(tmpdir(), 'blitzframes-site-'));
  mkdirSync(join(dir, 'node_modules/.bin'), {recursive: true});
  const cli = join(dir, 'node_modules/.bin/remotion');
  writeFileSync(cli, `#!/bin/sh\necho "$@" > "${join(dir, 'args.txt')}"\ncat <<'EOF'\n${output}\nEOF\nexit ${code}\n`);
  chmodSync(cli, 0o755);
  return dir;
}

test('the site upload leaves the entry point to Remotion and returns its serve URL', async () => {
  const dir = projectWithCli('Serve URL  https://bucket.s3.us-east-1.amazonaws.com/sites/blitzframes-benchmark/index.html', 0);
  const {serveUrl} = await uploadSite({projectDir: dir, region: 'us-east-1'});
  assert.equal(serveUrl, 'https://bucket.s3.us-east-1.amazonaws.com/sites/blitzframes-benchmark/index.html');
  assert.equal(readFileSync(join(dir, 'args.txt'), 'utf8').trim(), 'lambda sites create --site-name=blitzframes-benchmark --region=us-east-1 --log=info');
});

test('a failed site upload reports Remotion\'s own output instead of guessing an entry point', async () => {
  const dir = projectWithCli('No entry file passed.\nPass an additional argument specifying the entry file of your Remotion project:', 1);
  await assert.rejects(uploadSite({projectDir: dir, region: 'us-east-1'}),
    error => /exit code 1/.test(error.message) && /No entry file passed\./.test(error.message));
});
