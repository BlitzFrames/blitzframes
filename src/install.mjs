/** The install value for a token, and the token check. */
export const ORIGIN = process.env.BLITZFRAMES_ORIGIN || 'https://blitzframes.com';

export function relayUrl(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('The BlitzFrames token is 64 hexadecimal characters; copy it from your account page.');
  return ORIGIN + '/api/relay.mjs/' + token;
}

export function installValue(token) {
  const loader = `await fetch(${JSON.stringify(relayUrl(token))},{signal:AbortSignal.timeout(2000)})` +
    `.then(r=>{if(!r.ok)throw Error();return r.text()})` +
    `.then(s=>import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'))).catch(()=>{})`;
  return '--import=data:text/javascript;base64,' + Buffer.from(loader).toString('base64');
}

export async function checkToken(token, fetchImpl = fetch) {
  const response = await fetchImpl(relayUrl(token), {signal: AbortSignal.timeout(10000)});
  await response.arrayBuffer();
  if (response.status === 403) throw new Error('This token has no active BlitzFrames subscription.');
  if (!response.ok) throw new Error(`blitzframes.com answered HTTP ${response.status}; try again in a minute.`);
}
