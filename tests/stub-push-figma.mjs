import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const scenario = JSON.parse(fs.readFileSync(process.env.PUSH_STUB_SCENARIO, 'utf8'));
const requestFile = process.env.PUSH_STUB_REQUESTS;
let posts = 0;
let renames = 0;

if (process.env.PUSH_STUB_FAIL_RENAME) {
  const rename = fs.renameSync;
  fs.renameSync = (...args) => {
    renames++;
    if (renames === Number(process.env.PUSH_STUB_FAIL_RENAME)) throw new Error('simulated checkpoint failure');
    return rename(...args);
  };
  syncBuiltinESMExports();
}

globalThis.fetch = async (input, options = {}) => {
  const method = options.method ?? 'GET';
  fs.appendFileSync(
    requestFile,
    `${JSON.stringify({
      method,
      url: String(input),
      body: options.body ? JSON.parse(options.body) : null,
      redirect: options.redirect,
    })}\n`,
  );
  if (method === 'GET') {
    const status = scenario.getStatus ?? 200;
    return new Response(JSON.stringify({ comments: scenario.comments ?? [] }), { status });
  }
  const result = scenario.posts?.[posts++] ?? { status: 500 };
  if (result.hang) {
    return new Promise((_, reject) => {
      options.signal.addEventListener(
        'abort',
        () => {
          setTimeout(() => reject(new Error('simulated interruption')), result.abortDelayMs ?? 0);
        },
        { once: true },
      );
    });
  }
  if (result.throw) throw new Error('simulated response loss');
  const status = result.status ?? 200;
  return new Response(status === 204 ? null : JSON.stringify(result.body ?? {}), { status });
};
