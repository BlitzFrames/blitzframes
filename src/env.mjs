/** The project's .env: read the way Remotion reads it, and written for the one key that is ours.
 * Values are loaded into process.env without overriding what the shell already set. */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const TOKEN_KEY = 'BLITZFRAMES_TOKEN';

export function envPath(dir = process.cwd()) { return join(dir, '.env'); }

export function loadEnv(dir = process.cwd()) {
  const path = envPath(dir);
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    values[m[1]] = value;
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return values;
}

/** Sets one key in .env, replacing an existing line or appending, creating the file if needed. */
export function writeEnvKey(key, value, dir = process.cwd()) {
  const path = envPath(dir);
  const line = `${key}=${value}`;
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'm');
  const next = pattern.test(current) ? current.replace(pattern, line)
    : current + (current && !current.endsWith('\n') ? '\n' : '') + line + '\n';
  writeFileSync(path, next, {mode: 0o600});
  process.env[key] = value;
}

/** Remotion's REMOTION_AWS_* keys; undefined leaves the AWS default chain. */
export function awsCredentials() {
  const {REMOTION_AWS_ACCESS_KEY_ID: accessKeyId, REMOTION_AWS_SECRET_ACCESS_KEY: secretAccessKey} = process.env;
  return accessKeyId && secretAccessKey ? {accessKeyId, secretAccessKey} : undefined;
}

export const hasAwsCredentials = () => Boolean(process.env.REMOTION_AWS_ACCESS_KEY_ID && process.env.REMOTION_AWS_SECRET_ACCESS_KEY)
  || Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) || Boolean(process.env.AWS_PROFILE);
