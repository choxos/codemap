// Checks loader.js: input parsing and file rules offline, then real loads from
// GitHub (seven API requests; set GITHUB_TOKEN if the rate limit runs out).
// Run: node check.mjs
import assert from 'node:assert/strict';

await import('./loader.js');
const { parseRepo, loadRepo, classify, normalize } = globalThis.codemap;
const parse = (query) => parseRepo(new URLSearchParams(query));
const repo = (owner, name, ref = '', path = '') => ({ owner, repo: name, ref, path });

assert.deepEqual(parse('repo=choxos/mlumr'), repo('choxos', 'mlumr'));
assert.deepEqual(parse('repo=https://github.com/choxos/mlumr.git'), repo('choxos', 'mlumr'));
assert.deepEqual(parse('repo=git@github.com:choxos/mlumr.git'), repo('choxos', 'mlumr'));
assert.deepEqual(parse('repo=github.com/o/r/tree/dev/src/lib?tab=x'), repo('o', 'r', 'dev', 'src/lib'));
assert.deepEqual(parse('repo=https://github.com/o/r/blob/main/src/a.js'), repo('o', 'r', 'main', 'src'));
assert.deepEqual(parse('repo=https://github.com/o/r/commit/abc123'), repo('o', 'r', 'abc123'));
assert.deepEqual(parse('repo=o/r&ref=feature/x&path=/a/b/'), repo('o', 'r', 'feature/x', 'a/b'));
for (const bad of ['repo=', 'repo=single', 'repo=o/..', 'repo=-o/r', 'repo=<b>/r', 'repo=o/r&path=a/../b', 'repo=o/r&ref=a..b', 'repo=o/r&ref=a b']) {
  assert.throws(() => parse(bad), Error, bad);
}

assert.equal(normalize('﻿a\tb\r\n\tc\rd\n'), 'a   b\n    c\nd');
assert.equal(classify('src/app.tsx', 10).lang, 'typescript');
assert.equal(classify('R/fit.R', 10).lang, 'r');
assert.equal(classify('Makefile', 10).lang, 'make');
assert.equal(classify('.github/workflows/ci.yml', 10).lang, 'yaml');
assert.equal(classify('node_modules/x/index.js', 10).skip, 'vendored');
assert.equal(classify('package-lock.json', 10).skip, 'vendored');
assert.equal(classify('web/jquery.min.js', 10).skip, 'vendored');
assert.equal(classify('src/clock.js', 10).lang, 'javascript');
assert.equal(classify('logo.png', 10).skip, 'other');
assert.equal(classify('constructor', 10).skip, 'other');
assert.equal(classify('big.c', 1e6).skip, 'large');

const opt = { token: process.env.GITHUB_TOKEN };
const filesOf = (tree) => { const out = []; (function walk(n) { if (n.c) n.c.forEach(walk); else out.push(n); })(tree); return out; };

const full = await loadRepo(parse('repo=choxos/mlumr'), opt);
const files = filesOf(full.tree);
assert.equal(files.length, full.files);
assert.ok(full.files > 50, 'mlumr has more than 50 source files');
assert.match(full.sha, /^[0-9a-f]{40}$/);
assert.match(full.date, /^\d{4}-\d\d-\d\d$/);
assert.ok(files.every((f) => f.p && f.l && typeof f.s === 'string' && !/[\t\r]/.test(f.s) && f.b > 0), 'clean file records');
assert.ok(full.tree.c.some((n) => n.n === 'DESCRIPTION' && n.l === 'dcf'), 'DESCRIPTION at the root');
assert.ok(full.tree.c.some((n) => n.n === 'R' && n.c.length > 5), 'R folder');
assert.ok(!files.some((f) => f.p === 'NAMESPACE'), 'roxygen NAMESPACE is generated and left out');

const sub = await loadRepo(parse('repo=https://github.com/choxos/mlumr/tree/main/R'), opt);
assert.equal(sub.tree.n, 'R');
assert.ok(filesOf(sub.tree).every((f) => f.p.startsWith('R/')), 'folder paths keep their prefix');

await assert.rejects(loadRepo(parse('repo=microsoft/vscode'), opt), (e) => e.folders.length > 0 && /too big/.test(e.message));
await assert.rejects(loadRepo(parse('repo=choxos/no-such-repo-here'), opt), /was not found/);
await assert.rejects(loadRepo(parse('repo=choxos/mlumr&path=DESCRIPTION'), opt), /is a file/);

console.log('ok:', full.files, 'files in choxos/mlumr at', full.sha.slice(0, 7), '·', sub.files, 'in R/');
