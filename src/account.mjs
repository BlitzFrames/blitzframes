/** Account calls to blitzframes.com. */
import {ORIGIN} from './install.mjs';

async function call(path, {method = 'GET', body, token, fetchImpl = fetch} = {}) {
  const response = await fetchImpl(ORIGIN + path, {
    method, signal: AbortSignal.timeout(15000),
    headers: {...(body ? {'content-type': 'application/json'} : {}), ...(token ? {authorization: 'Bearer ' + token} : {})},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = {error: text.slice(0, 200)}; }
  if (!response.ok) throw Object.assign(new Error(data.error || `blitzframes.com answered HTTP ${response.status}`), {status: response.status});
  return data;
}

export const requestCode = (email, deps) => call('/api/cli/login', {method: 'POST', body: {email}, ...deps});
export const verifyCode = (email, code, deps) => call('/api/cli/verify', {method: 'POST', body: {email, code}, ...deps});
export const startTrial = (proof, deps) => call('/api/cli/trial', {method: 'POST', body: {proof}, ...deps});
/** trial, subscribed or inactive; unknown for a token the service has no record of, which it refuses as such. */
export const tokenStatus = (token, deps) => call('/api/token', {token, ...deps}).catch(error => {
  if (error.status === 404 || (error.status === 403 && /unknown token/i.test(error.message))) return {status: 'unknown'};
  throw error;
});
export const liveUsage = (token, renderId, deps) => call('/api/usage/live?renderId=' + encodeURIComponent(renderId), {token, ...deps});
