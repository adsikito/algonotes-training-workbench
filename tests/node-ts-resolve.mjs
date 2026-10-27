/**
 * Resolution preload for the assertion-script suite.
 *
 * `pnpm test` runs every `tests/**\/*.test.ts` script through this preload so
 * that the extensionless `lib/**` imports resolve without touching any
 * source file. See `tests/ts-resolve-hooks.mjs` for the actual mapping rule.
 *
 * Two registration APIs are supported so the suite runs across the whole
 * `engines.node` range declared in package.json (>=22.13.0):
 *
 * - `module.registerHooks()` (synchronous, Node >=22.15.0) — preferred, no
 *   extra thread, hooks apply to this realm directly.
 * - `module.register()` (asynchronous, Node >=20.6.0) — fallback for
 *   Node 22.13–22.14, where `registerHooks` does not exist yet.
 *
 * Set `ALGONOTES_ASYNC_HOOKS=1` to force the fallback; that is how both code
 * paths are covered on a single local Node version.
 *
 * TypeScript stripping itself is enabled by `--experimental-strip-types` in
 * the `test` script. The flag is required on Node <22.18 and is accepted
 * (without effect) on newer releases.
 */
import {register, registerHooks} from 'node:module';

import {resolveTypeScriptRelative} from './ts-resolve-hooks.mjs';

const useAsyncHooks = process.env.ALGONOTES_ASYNC_HOOKS === '1';

if (typeof registerHooks === 'function' && !useAsyncHooks) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      return resolveTypeScriptRelative(specifier, context) ?? nextResolve(specifier, context);
    },
  });
} else {
  // `register()` runs the hook in a dedicated thread, so the rule has to live
  // in a real module file rather than a closure.
  register('./ts-resolve-hooks.mjs', import.meta.url);
}
