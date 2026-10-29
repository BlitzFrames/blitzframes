/** The oldest supported Remotion release, and whether the render hosts have the project's. */
import {ORIGIN} from './install.mjs';

export const FLOOR = '4.0.293';
const parts = v => String(v).replace(/^[^\d]*/, '').split('.').map(Number);
export const compareVersions = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

export function checkVersion(version) {
  if (!version) return {ok: true, note: 'Remotion version unknown.'};
  if (compareVersions(version, FLOOR) < 0) {
    throw new Error(`Remotion ${version} is below ${FLOOR}, the oldest release BlitzFrames supports. Upgrade Remotion first (npx remotion upgrade).`);
  }
  return {ok: true};
}

/** A note for a release the render hosts do not have (GET /api/versions lists those every host
 * has): the relay spreads every render over all hosts, so every render on a function of such a
 * release fails. Also a note when that cannot be checked; none when the hosts have it. */
export async function supportNote(version, fetchImpl = fetch) {
  if (!version) return null;
  let fleet;
  try {
    const response = await fetchImpl(ORIGIN + '/api/versions', {signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    fleet = await response.json();
  } catch {}
  if (!Array.isArray(fleet?.versions) || !fleet.reporting) return `Could not check whether BlitzFrames supports Remotion ${version}; deploying anyway.`;
  if (fleet.versions.includes(version)) return null;
  const newest = fleet.newest;
  if (newest && compareVersions(version, newest) > 0)
    return `Warning: BlitzFrames does not support Remotion ${version} yet, so every render on this function fails until it does. `
      + `The newest supported release is ${newest}; stay on it (npx remotion upgrade --version ${newest}) until ${version} is supported.`;
  return `Warning: BlitzFrames does not support Remotion ${version}, so every render on this function fails.`
    + (newest ? ` The newest supported release is ${newest}.` : '');
}
