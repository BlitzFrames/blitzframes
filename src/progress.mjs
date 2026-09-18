/** A spinner with elapsed seconds for a long step; a plain line when the output is not a terminal. */
const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

export async function spin(text, work) {
  if (!process.stdout.isTTY) { console.log(text + '…'); return work(); }
  const started = Date.now(), seconds = () => Math.floor((Date.now() - started) / 1000);
  let frame = 0;
  const clear = () => process.stdout.write('\r\x1b[K');
  const draw = () => process.stdout.write(`\r\x1b[K${FRAMES[frame++ % FRAMES.length]} ${text} ${seconds()} s`);
  // Lines logged during the step print above the spinner.
  const original = {log: console.log, warn: console.warn, error: console.error};
  for (const key of Object.keys(original)) console[key] = (...args) => { clear(); original[key](...args); draw(); };
  draw();
  const timer = setInterval(draw, 100);
  try {
    const result = await work();
    clear(); original.log(`\x1b[32m✔\x1b[39m ${text} (${seconds()} s)`);
    return result;
  } catch (error) {
    clear(); throw error;
  } finally {
    clearInterval(timer); Object.assign(console, original);
  }
}
