/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();
const app = document.getElementById('app'), notice = document.getElementById('notice');
let data = { entries: [], patterns: [], revision: 0 }, busy = false, root = '';
let collapsed = {}, collapsedHunks = {}, heights = {}, previous = new Set();
const saved = vscode.getState() || {};
function persist() { vscode.setState({ root, collapsed, collapsedHunks, heights, scroll: window.scrollY }); }
function key(e) { return JSON.stringify([e.staged, e.path]); }
function globRegex(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { source += '(?:.*/)?'; i++; } else source += '.*'; }
      else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += /[\\^$+?.()|{}\[\]]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`);
}
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function button(text, action, cls = '') { const b = el('button', cls, text); b.type = 'button'; b.onclick = action; return b; }
function iconButton(label, symbol, action, cls) { const b = button(symbol, action, `${cls} icon-action`); b.title = label; b.setAttribute('aria-label', label); return b; }
function post(type, extra = {}) { vscode.postMessage({ type, revision: data.revision, ...extra }); }
function action(type, e, hunk) { post(type, { path: e.path, staged: e.staged, hunk }); }
function render() {
  const scroll = window.scrollY;
  const innerScroll = new Map([...app.querySelectorAll('.hunk-content')].map(n => [n.dataset.key, [n.scrollTop, n.scrollLeft]]));
  app.replaceChildren();
  for (const staged of [true, false]) {
    const files = data.entries.filter(e => e.staged === staged);
    const section = el('section', 'section'), bar = el('div', 'section-bar');
    const allClosed = files.every(e => collapsed[key(e)]);
    bar.onclick = () => { for (const e of files) collapsed[key(e)] = !allClosed; persist(); render(); };
    bar.append(el('span', 'file-chevron', allClosed ? '▸' : '▾'), el('strong', '', `${staged ? 'STAGED' : 'UNSTAGED'} FILES`), el('span', 'count', String(files.length)));
    const controls = el('div', 'actions');
    controls.onclick = ev => ev.stopPropagation();
    controls.append(button(staged ? 'Unstage all' : 'Stage all', () => post(staged ? 'unstageAll' : 'stageAll'), `${staged ? 'unstage' : 'primary'} mutation`));
    if (!staged) controls.append(button('Discard all', () => post('discardAll'), 'danger mutation'));
    for (const b of controls.querySelectorAll('.mutation')) b.disabled = !files.length || busy;
    bar.append(controls); section.append(bar);
    if (!files.length) section.append(el('p', 'empty', staged ? 'No staged changes' : 'No unstaged changes'));
    for (const e of files) {
      const id = key(e), closed = collapsed[id];
      const card = el('article', 'file'), head = el('div', 'file-bar');
      const toggleFile = () => { collapsed[id] = !collapsed[id]; persist(); render(); };
      head.onclick = toggleFile;
      const name = button(e.path, ev => { ev?.stopPropagation?.(); action('open', e); }, 'filename');
      name.title = `Open ${e.path}`;
      head.append(el('span', 'file-chevron', closed ? '▸' : '▾'), name, el('span', `status status-${e.status}`, e.status));
      const stats = e.hunks.reduce((s, h) => { for (const l of h.lines) { if (l[0] === '+') s[0]++; if (l[0] === '-') s[1]++; } return s; }, [0, 0]);
      head.append(el('span', 'added', `+${stats[0]}`), el('span', 'removed', `−${stats[1]}`));
      const controls = el('div', 'actions');
      controls.onclick = ev => ev.stopPropagation();
      controls.append(iconButton(staged ? 'Unstage' : 'Stage', staged ? '−' : '+', () => action(staged ? 'unstage' : 'stage', e), `${staged ? 'unstage' : 'primary'} mutation`));
      if (!staged) controls.append(iconButton('Discard', '⟲', () => action('discard', e), 'danger mutation'));
      for (const b of controls.querySelectorAll('button')) b.disabled = busy || e.conflict;
      head.append(controls); card.append(head);
      if (!closed) {
        if (e.error) card.append(el('p', 'empty error', e.error));
        else if (e.conflict) card.append(el('p', 'empty', 'Merge conflict — resolve in the editor.'));
        else if (!e.hunks.length) card.append(el('pre', 'metadata', e.diff || 'Empty file or metadata-only change. Use the file action.'));
        for (const [index, h] of e.hunks.entries()) {
          const hkey = JSON.stringify([id, index, h.header]), hunk = el('div', 'hunk'), hhead = el('div', 'hunk-bar');
          const hunkClosed = collapsedHunks[hkey] === true;
          const toggleHunk = () => { collapsedHunks[hkey] = !collapsedHunks[hkey]; persist(); render(); };
          const openHunk = () => post('open', { path: e.path, staged: e.staged, line: Math.max(1, h.newStart) });
          hhead.onclick = toggleHunk;
          hhead.append(el('span', 'hunk-chevron', hunkClosed ? '▸' : '▾'), button(h.header, ev => { ev?.stopPropagation?.(); openHunk(); }, 'hunk-location'));
          const controls = el('div', 'actions');
          controls.onclick = ev => ev.stopPropagation();
          controls.append(iconButton(staged ? 'Unstage hunk' : 'Stage hunk', staged ? '−' : '+', () => action(staged ? 'unstage' : 'stage', e, index), `${staged ? 'unstage' : 'primary'} mutation`));
          if (!staged) controls.append(iconButton('Discard hunk', '⟲', () => action('discard', e, index), 'danger mutation'));
          for (const b of controls.querySelectorAll('button')) { b.disabled = busy || e.conflict || ['R', 'C'].includes(e.status); if (['R', 'C'].includes(e.status)) b.title = 'Use the file action for renames and copies'; }
          hhead.append(controls); hunk.append(hhead);
          if (hunkClosed) { card.append(hunk); continue; }
          const content = el('div', 'hunk-content'); content.dataset.key = hkey;
          content.style.height = `${heights[hkey] || Math.min(360, Math.max(64, h.lines.length * 20 + 10))}px`;
          let old = h.oldStart, next = h.newStart;
          for (const line of h.lines) {
            const kind = line[0], row = el('div', `line ${kind === '+' ? 'addition' : kind === '-' ? 'deletion' : ''}`);
            const oldNumber = kind === '+' || kind === '\\' ? '' : old++, newNumber = kind === '-' || kind === '\\' ? '' : next++;
            const num = el('button', 'line-number', String(newNumber || oldNumber));
            num.title = 'Open at this line'; num.onclick = () => post('open', { path: e.path, staged: e.staged, line: Math.max(1, newNumber || next) });
            row.append(el('span', 'old-number', String(oldNumber)), num, el('code', '', line)); content.append(row);
          }
          hunk.append(content);
          const grip = el('div', 'resize-handle'); grip.tabIndex = 0; grip.setAttribute('role', 'separator'); grip.setAttribute('aria-label', 'Resize hunk height'); grip.setAttribute('aria-orientation', 'horizontal');
          const resize = height => { const value = Math.max(48, Math.min(2400, height)); content.style.height = `${value}px`; heights[hkey] = value; grip.setAttribute('aria-valuenow', String(value)); };
          grip.onpointerdown = ev => { ev.preventDefault(); const y = ev.clientY, height = content.offsetHeight; grip.setPointerCapture(ev.pointerId); grip.classList.add('dragging'); grip.onpointermove = move => resize(height + move.clientY - y); };
          grip.onpointerup = grip.onpointercancel = () => { grip.onpointermove = null; grip.classList.remove('dragging'); persist(); };
          grip.onkeydown = ev => { if (['ArrowUp', 'ArrowDown'].includes(ev.key)) { ev.preventDefault(); resize(content.offsetHeight + (ev.key === 'ArrowDown' ? 20 : -20)); persist(); } };
          grip.ondblclick = () => { delete heights[hkey]; persist(); render(); }; grip.title = 'Drag to resize · Double-click to reset';
          hunk.append(grip); card.append(hunk);
        }
      }
      section.append(card);
    }
    app.append(section);
  }
  for (const n of app.querySelectorAll('.hunk-content')) { const s = innerScroll.get(n.dataset.key); if (s) [n.scrollTop, n.scrollLeft] = s; }
  window.scrollTo(0, scroll);
}
window.addEventListener('message', ({ data: m }) => {
  if (m.type === 'update') {
    const changedRoot = root !== m.root;
    if (changedRoot) { root = m.root; collapsed = saved.root === root ? saved.collapsed || {} : {}; collapsedHunks = saved.root === root ? saved.collapsedHunks || {} : {}; heights = saved.root === root ? saved.heights || {} : {}; previous = new Set(); }
    const patterns = m.patterns.map(p => [globRegex(p), p.includes('/')]);
    for (const e of m.entries) { const k = key(e); if (!previous.has(k) || collapsed[k] === undefined) collapsed[k] = e.staged || patterns.some(([pattern, pathPattern]) => pattern.test(pathPattern ? e.path : e.path.split('/').at(-1))); }
    previous = new Set(m.entries.map(key)); data = m;
    notice.textContent = '';
    render(); if (changedRoot) window.scrollTo(0, saved.root === root ? saved.scroll || 0 : 0); persist();
  } else if (m.type === 'busy') { busy = m.value; render(); }
  else if (m.type === 'error') { notice.textContent = m.message; notice.classList.add('error'); }
  else if (m.type === 'completed') {
    if (m.action === 'stage' || m.action === 'stageAll') for (const path of m.paths) collapsed[key({ path, staged: true })] = true;
    persist();
  }
});
document.getElementById('settings').onclick = () => post('settings');
document.getElementById('refresh').onclick = () => post('refresh');
window.addEventListener('scroll', persist, { passive: true });
post('refresh');
