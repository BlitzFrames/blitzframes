/** Verifies that the advertised package version installs and exposes its CLI from a clean directory. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const spec = `${pkg.name}@${pkg.version}`;
const dir = mkdtempSync(join(tmpdir(), 'blitzframes-public-install-'));
try {
  const version = execFileSync('npm', ['view', spec, 'version', '--registry=https://registry.npmjs.org/'], {cwd: dir, encoding: 'utf8'}).trim();
  if (version !== pkg.version) throw new Error(`Expected ${pkg.version}, received ${version}`);
  const help = execFileSync('npm', ['exec', '--yes', '--registry=https://registry.npmjs.org/', '--cache', join(dir, 'cache'), `--package=${spec}`, '--', 'blitzframes', '--help'], {cwd: dir, encoding: 'utf8', timeout: 120000});
  for (const command of ['lambda functions deploy', 'lambda functions ls', 'benchmark']) {
    if (!help.includes(command)) throw new Error(`CLI help omits ${command}`);
  }
  console.log(`${spec}: public installation and CLI help passed.`);
} catch (error) {
  console.error(`${spec}: public installation failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, {recursive: true, force: true});
}
