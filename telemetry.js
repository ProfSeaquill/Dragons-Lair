// telemetry.js — dev-only telemetry (safe no-op if never referenced)
const Telemetry = (() => {
  let buffer = [];
  let enabledFn = () => false;

  function isEnabled() {
    try { return !!enabledFn(); } catch { return false; }
  }

  function log(name, payload = {}) {
    const evt = { t: Date.now(), name, ...payload };
    if (isEnabled()) {
      // dev-friendly structured log
      // eslint-disable-next-line no-console
      console.log('[telemetry]', evt);
    } else {
      buffer.push(evt);
    }
  }

  function flush() {
    const out = buffer; buffer = []; return out;
  }

  function setup(fn) { if (typeof fn === 'function') enabledFn = fn; }

  return { setup, log, flush, get buffer() { return buffer.slice(); } };
})();

// Global for optional use without imports; also ESM named/default exports
try { (globalThis || window).Telemetry = Telemetry; } catch {}
export default Telemetry;
export const setup = Telemetry.setup;
export const log   = Telemetry.log;
export const flush = Telemetry.flush;

