#!/usr/bin/env node
/**
 * Diff-scoped lint gate.
 *
 * `pnpm lint` lints the whole tree and currently reports 532 pre-existing
 * errors (see docs/baseline-behavior-2026-10.md §7.2). Those files are being
 * replaced by the v2 rebuild, so paying that debt down now is wasted work.
 * What we do need is a guarantee that **new** code does not add new problems.
 *
 * This script lints only files touched by the change, and then reports only
 * the messages that land on **changed lines**. Whole-file filtering would not
 * be enough: `lib/study-model.ts` for example already carries 6 pre-existing
 * `no-explicit-any` errors, so the first person to legitimately edit it would
 * be blocked by debt they did not write. Changed-line filtering is what makes
 * the ratchet actually usable (the same idea as reviewdog / diff-cover).
 *
 * Environment:
 *   LINT_BASE  Base revision. Empty -> local mode (`origin/main`, else `HEAD`).
 *              All zeroes (push of a new branch) -> gate is skipped.
 *   LINT_HEAD  Head revision. Empty -> compare base against the working tree.
 *
 * Exit code 1 when at least one error sits on a changed line.
 */
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {ESLint} = require('eslint');

/** A revision that is entirely zeroes means "no previous commit" (new branch). */
const ALL_ZEROES = /^0+$/;

/** Only TypeScript sources are in scope for this gate. */
const TARGET_FILE = /\.(ts|tsx)$/;

/** Matches the `+++ b/<path>` line of a unified diff. */
const DIFF_HEADER = /^\+\+\+ b\/(.+)$/;

/** Matches a hunk header and captures the destination range. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Runs git and returns stdout, or null when the command fails.
 *
 * @param {string[]} args Git arguments.
 * @return {string|null} Trimmed stdout, or null on failure.
 */
function git(args) {
  try {
    return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null;
  }
}

/**
 * Decides which revisions to diff.
 *
 * @return {{base: string, head: string|null}|null} Range, or null to skip.
 */
function resolveRange() {
  const base = (process.env.LINT_BASE ?? '').trim();
  const head = (process.env.LINT_HEAD ?? '').trim();

  if (base) {
    if (ALL_ZEROES.test(base)) return null;
    // For pull requests the base is the target tip; diffing against the
    // merge-base avoids reporting changes that came from the base branch.
    const mergeBase = head ? git(['merge-base', base, head]) : git(['merge-base', base, 'HEAD']);
    return {base: mergeBase || base, head: head || null};
  }

  // Local mode: prefer the branch point, fall back to the last commit so that
  // uncommitted work is still checked.
  for (const candidate of ['origin/main', 'main']) {
    if (git(['rev-parse', '--verify', '--quiet', candidate])) {
      const mergeBase = git(['merge-base', candidate, 'HEAD']) || candidate;
      return {base: mergeBase, head: null};
    }
  }
  return {base: 'HEAD', head: null};
}

/**
 * Parses a unified diff into changed line ranges per file.
 *
 * @param {string} diff Unified diff text produced with `--unified=0`.
 * @return {Map<string, Array<[number, number]>>} Ranges keyed by repo path.
 */
function parseChangedLines(diff) {
  /** @type {Map<string, Array<[number, number]>>} */
  const ranges = new Map();
  let current = null;
  for (const line of diff.split(/\r?\n/)) {
    const header = DIFF_HEADER.exec(line);
    if (header) {
      current = header[1];
      if (!ranges.has(current)) ranges.set(current, []);
      continue;
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      // count === 0 is a pure deletion: no new lines to lint on this side.
      if (count > 0) ranges.get(current).push([start, start + count - 1]);
    }
  }
  return ranges;
}

/**
 * True when an eslint message overlaps a changed range.
 *
 * @param {{line?: number, endLine?: number}} message Eslint message.
 * @param {Array<[number, number]>} ranges Changed ranges for the file.
 * @return {boolean} Whether the message sits on changed code.
 */
function touchesChangedLine(message, ranges) {
  if (!message.line) return true; // file-level message: always in scope
  const from = message.line;
  const to = message.endLine ?? message.line;
  return ranges.some(([start, end]) => from <= end && to >= start);
}

/**
 * Normalises an absolute path to the repo-relative POSIX form used by git.
 *
 * @param {string} absolute Absolute file path reported by eslint.
 * @param {string} rootPosix Repo root as a POSIX-style absolute path.
 * @return {string} Repo-relative path with forward slashes.
 */
function normalizePath(absolute, rootPosix) {
  const normalized = absolute.replace(/\\/g, '/');
  return normalized.startsWith(`${rootPosix}/`) ? normalized.slice(rootPosix.length + 1) : normalized;
}

async function main() {
  const range = resolveRange();
  if (!range) {
    console.log('lint:diff — 跳过：本次推送没有可比对的基线提交（新分支）。');
    return 0;
  }

  const diff = git(['diff', '--unified=0', '--no-color', '--diff-filter=ACMR', range.base, ...(range.head ? [range.head] : [])]);
  if (diff === null) {
    console.log(`lint:diff — 跳过：无法比对 ${range.base}${range.head ? `..${range.head}` : ''}。`);
    return 0;
  }

  const changed = parseChangedLines(diff);
  // `git diff` never reports untracked files, so a brand-new file would slip
  // through the gate locally. Treat every untracked TS source as fully changed.
  for (const file of (git(['ls-files', '--others', '--exclude-standard']) ?? '').split(/\r?\n/)) {
    if (TARGET_FILE.test(file) && !changed.has(file)) {
      changed.set(file, [[1, Number.MAX_SAFE_INTEGER]]);
    }
  }
  const files = [...changed.keys()].filter((file) => TARGET_FILE.test(file) && existsSync(file));
  if (files.length === 0) {
    console.log('lint:diff — 无 TS/TSX 变更，跳过。');
    return 0;
  }

  const eslint = new ESLint();
  const results = await eslint.lintFiles(files);
  const rootPosix = (git(['rev-parse', '--show-toplevel']) ?? '').replace(/\\/g, '/');

  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    const relative = normalizePath(result.filePath, rootPosix);
    const ranges = changed.get(relative) ?? [];
    const blocking = result.messages.filter((m) => m.severity === 2 && touchesChangedLine(m, ranges));
    const advisory = result.messages.filter((m) => m.severity !== 2 && touchesChangedLine(m, ranges));
    if (blocking.length === 0 && advisory.length === 0) continue;

    console.log(`\n${relative}`);
    for (const message of [...blocking, ...advisory]) {
      const level = message.severity === 2 ? 'error' : 'warning';
      const rule = message.ruleId ?? '(no rule)';
      console.log(`  ${message.line}:${message.column}  ${level}  ${message.message}  ${rule}`);
    }
    errors += blocking.length;
    warnings += advisory.length;
  }

  const scope = `${files.length} file(s) changed, base ${range.base.slice(0, 7)}${range.head ? `..${range.head.slice(0, 7)}` : ' (working tree)'}`;
  if (errors === 0) {
    console.log(`\nlint:diff — 通过（${scope}；变更行上 0 error，${warnings} warning）。存量问题不计入本门禁。`);
    return 0;
  }
  console.log(`\nlint:diff — 失败（${scope}；变更行上 ${errors} error，${warnings} warning）。`);
  return 1;
}

process.exitCode = await main();
