/**
 * Shared resolve logic for the assertion-script suite.
 *
 * The `tests/**` scripts are plain modules executed top-to-bottom. They import
 * with explicit `.ts` specifiers (`../lib/domain.ts`), while the `lib/**`
 * modules they pull in use bundler-style extensionless specifiers
 * (`./domain`). Node's native ESM resolver requires a full file extension,
 * which is why a bare `node --experimental-strip-types tests/domain.test.ts`
 * fails with ERR_MODULE_NOT_FOUND on `lib/domain`.
 *
 * This module only rewrites *relative, extensionless* specifiers to their
 * TypeScript counterpart. Nothing else is touched: bare specifiers
 * (`fflate`, `@noble/hashes/sha2.js`) and explicit specifiers keep Node's
 * default resolution.
 */
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** Candidate extensions tried in order when a relative specifier has none. */
export const CANDIDATE_EXTENSIONS = ['.ts', '.mts', '/index.ts'];

/** Matches a specifier that already carries a JS/TS file extension. */
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

/**
 * Maps an extensionless relative specifier to the `.ts`/`.mts` file on disk.
 *
 * @param {string} specifier The raw import specifier.
 * @param {{parentURL?: string}} context Node's resolution context.
 * @return {{url: string, shortCircuit: true} | null} Resolution result, or
 *     `null` when the default resolver should handle the specifier.
 */
export function resolveTypeScriptRelative(specifier, context) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isRelative || HAS_EXTENSION.test(specifier) || !context.parentURL) {
    return null;
  }
  const base = new URL(specifier, context.parentURL);
  for (const extension of CANDIDATE_EXTENSIONS) {
    const candidate = new URL(base.href + extension);
    if (existsSync(fileURLToPath(candidate))) {
      return {url: candidate.href, shortCircuit: true};
    }
  }
  return null;
}

/**
 * Asynchronous hook entry point, used by `module.register()` on Node versions
 * that predate the synchronous `module.registerHooks()` API.
 *
 * @param {string} specifier The raw import specifier.
 * @param {{parentURL?: string}} context Node's resolution context.
 * @param {Function} nextResolve Node's default resolver.
 * @return {Promise<object>} The resolution result.
 */
export async function resolve(specifier, context, nextResolve) {
  return resolveTypeScriptRelative(specifier, context) ?? nextResolve(specifier, context);
}
