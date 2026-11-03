const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { git, fileDiff, patch, parseDiff, mapLine } = require('../src/git');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-viewer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  return root;
}
test('partial stage, unstage and discard preserve unrelated changes and staged content', async t => {
  const root = await fixture(t), name = '한글 spaced [file].txt';
  const initial = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  await fs.writeFile(path.join(root, name), initial); await git(root, ['add', '.']); await git(root, ['commit', '-qm', 'initial']);
  const changed = initial.replace('line 2\n', 'changed 2\n').replace('line 35\n', 'changed 35\n');
  await fs.writeFile(path.join(root, name), changed);
  let d = await fileDiff(root, name, false); assert.equal(d.hunks.length, 2);
  await git(root, ['apply', '--cached'], patch(d, 0));
  const staged = await fileDiff(root, name, true); assert.equal(staged.hunks.length, 1); assert.match(staged.diff, /changed 2/); assert.doesNotMatch(staged.diff, /changed 35/);
  d = await fileDiff(root, name, false); assert.equal(d.hunks.length, 1);
  await git(root, ['apply', '--reverse'], patch(d, 0));
  assert.equal((await fileDiff(root, name, false)).diff, '');
  assert.equal((await fileDiff(root, name, true)).diff, staged.diff);
  await git(root, ['apply', '--cached', '--reverse'], patch(staged, 0));
  assert.equal((await fileDiff(root, name, true)).diff, '');
  assert.match((await fileDiff(root, name, false)).diff, /changed 2/);
});
test('untracked no-newline file can be staged and unstaged before first commit', async t => {
  const root = await fixture(t); const name = 'new file.txt';
  await fs.writeFile(path.join(root, name), 'hello');
  const d = await fileDiff(root, name, false); assert.equal(d.hunks.length, 1);
  await git(root, ['apply', '--cached'], patch(d, 0));
  assert.match(await git(root, ['show', `:${name}`]), /hello/);
  await git(root, ['rm', '--cached', '-r', '--ignore-unmatch', '--', name]);
  assert.equal(await fs.readFile(path.join(root, name), 'utf8'), 'hello');
  assert.equal((await fileDiff(root, name, true)).diff, '');
});
test('binary and empty files have no text hunks', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2, 3]));
  await fs.writeFile(path.join(root, 'empty'), '');
  assert.equal((await fileDiff(root, 'binary', false)).hunks.length, 0);
  assert.equal((await fileDiff(root, 'empty', false)).hunks.length, 0);
});
test('deleted file patch and literal pathspec do not affect similarly named files', async t => {
  const root = await fixture(t);
  for (const name of ['[a].txt', 'a.txt']) await fs.writeFile(path.join(root, name), 'original\n');
  await git(root, ['add', '.']); await git(root, ['commit', '-qm', 'initial']);
  await fs.unlink(path.join(root, '[a].txt'));
  const d = await fileDiff(root, '[a].txt', false);
  await git(root, ['apply', '--cached'], patch(d, 0));
  assert.equal(await git(root, ['show', ':a.txt']), 'original\n');
  assert.match(await git(root, ['diff', '--cached', '--name-only']), /\[a\]/);
});
test('map staged lines through unstaged insertions and deletions', () => {
  const d = parseDiff('@@ -2,2 +2,3 @@\n line2\n+inserted\n line3\n');
  assert.equal(mapLine(1, d.hunks), 1); assert.equal(mapLine(3, d.hunks), 4); assert.equal(mapLine(8, d.hunks), 9);
  const insertion = parseDiff('@@ -0,0 +1,2 @@\n+one\n+two\n');
  assert.equal(mapLine(1, insertion.hunks), 3);
});
