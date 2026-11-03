const { spawn } = require('node:child_process');

function git(root, args, input, allowed = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--literal-pathspecs', ...args], { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    const out = [], err = []; let size = 0, tooLarge = false;
    child.stdout.on('data', b => { size += b.length; if (size > 32 * 1024 * 1024) { tooLarge = true; child.kill(); } else out.push(b); });
    child.stderr.on('data', b => err.push(b));
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.on('close', code => tooLarge ? reject(new Error('Diff exceeds 32 MB. Open this file in the editor.')) : allowed.includes(code) ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(Buffer.concat(err).toString('utf8') || `Git exited with ${code}`)));
    child.stdin.end(input);
  });
}
function parseDiff(diff) {
  const lines = diff.split('\n'); if (lines.at(-1) === '') lines.pop();
  const header = []; const hunks = []; let hunk;
  for (const line of lines) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) { hunk = { header: line, oldStart: +m[1], oldCount: +(m[2] ?? 1), newStart: +m[3], newCount: +(m[4] ?? 1), lines: [] }; hunks.push(hunk); }
    else if (hunk) hunk.lines.push(line); else header.push(line);
  }
  return { header: header.join('\n'), hunks };
}
function patch(parsed, index) {
  const h = parsed.hunks[index]; if (!h) throw new Error('Hunk no longer exists. Refresh and try again.');
  return `${parsed.header}\n${h.header}\n${h.lines.join('\n')}\n`;
}
async function fileDiff(root, file, staged, context = 3) {
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', `--unified=${context}`];
  if (staged) args.push('--cached');
  let diff = await git(root, [...args, '--', file]);
  if (!staged && !diff) {
    const tracked = await git(root, ['ls-files', '-z', '--', file]);
    if (!tracked) diff = await git(root, [...args, '--no-index', '--', '/dev/null', file], undefined, [0, 1]);
  }
  return { diff, ...parseDiff(diff) };
}
function mapLine(line, hunks) {
  let offset = 0;
  for (const h of hunks) {
    if (line < h.oldStart || (h.oldCount === 0 && line <= h.oldStart)) break;
    if (line >= h.oldStart + h.oldCount) { offset = h.newStart + h.newCount - h.oldStart - h.oldCount - (h.oldCount === 0 ? 1 : 0); continue; }
    let old = h.oldStart, next = h.newStart;
    for (const s of h.lines) {
      if (s[0] === ' ') { if (old === line) return Math.max(1, next); old++; next++; }
      else if (s[0] === '-') { if (old === line) return Math.max(1, next); old++; }
      else if (s[0] === '+') next++;
    }
    return Math.max(1, next);
  }
  return Math.max(1, line + offset);
}
module.exports = { git, parseDiff, patch, fileDiff, mapLine };
