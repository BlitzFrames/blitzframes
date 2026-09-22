/** The install value for a token, and the token check. */
export const ORIGIN = process.env.BLITZFRAMES_ORIGIN || 'https://blitzframes.com';

export function relayUrl(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('The BlitzFrames token is 64 hexadecimal characters; copy it from your account page.');
  return ORIGIN + '/api/relay.mjs/' + token;
}

/** The NODE_OPTIONS value: a data: module that downloads the relay for up to two seconds, writes it to the
 * Lambda's temp directory and imports that file, so error stacks name a path and not the module source with the
 * token in it; a failed write falls back to importing it as a data: URL, and a failed download leaves the stock behaviour. */
export function installValue(token) {
  const loader = `await fetch(${JSON.stringify(relayUrl(token))},{signal:AbortSignal.timeout(2000)})` +
    `.then(r=>{if(!r.ok)throw Error();return r.text()})` +
    `.then(async s=>{try{const [{writeFileSync},{tmpdir},{createHash}]=await Promise.all([import('node:fs'),import('node:os'),import('node:crypto')]);` +
    `const p=tmpdir()+'/blitzframes-relay-'+createHash('sha256').update(s).digest('hex').slice(0,16)+'.mjs';writeFileSync(p,s,{mode:0o600});return await import('file://'+p)}` +
    `catch{return import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'))}}).catch(()=>{})`;
  return '--import=data:text/javascript;base64,' + Buffer.from(loader).toString('base64');
}

export async function checkToken(token, fetchImpl = fetch) {
  const response = await fetchImpl(relayUrl(token), {signal: AbortSignal.timeout(10000)});
  await response.arrayBuffer();
  if (response.status === 403) throw new Error('This token has no active BlitzFrames subscription.');
  if (!response.ok) throw new Error(`blitzframes.com answered HTTP ${response.status}; try again in a minute.`);
}
