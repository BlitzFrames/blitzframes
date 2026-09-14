/** The oldest supported Remotion release. */

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
