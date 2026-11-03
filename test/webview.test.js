const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.scrollTop = this.scrollLeft = 0; this.className = ''; this.classList = { add() {}, remove() {} }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k, v) { this.attributes[k] = v; }
  get firstChild() { return this.children[0]; }
  querySelectorAll(selector) { return this.children.flatMap(n => [ ...(selector === 'button' && n.tagName === 'button' || selector.startsWith('.') && n.className.split(' ').includes(selector.slice(1)) ? [n] : []), ...n.querySelectorAll(selector)]); }
}
test('webview renders continuous hunks, applies glob patterns, preserves manual state, collapses after staging and routes line navigation', () => {
  const nodes = Object.fromEntries(['app', 'notice', 'repositories', 'settings', 'refresh'].map(id => [id, new Element('div')]));
  const handlers = {}, messages = [];
  const window = { scrollY: 0, scrollTo() {}, addEventListener: (event, fn) => { handlers[event] = fn; } };
  const context = vm.createContext({ document: { getElementById: id => nodes[id], createElement: tag => new Element(tag) }, window, acquireVsCodeApi: () => ({ getState: () => undefined, setState() {}, postMessage: m => messages.push(m) }) });
  vm.runInContext(fs.readFileSync(require.resolve('../media/main.js'), 'utf8'), context);
  const file = (name, staged = false) => ({ path: name, staged, status: 'M', hunks: [{ header: '@@ -5 +5 @@', newStart: 5, lines: ['-old', '+new'] }] });
  const update = entries => handlers.message({ data: { type: 'update', entries, revision: 1, root: '/repo', patterns: ['*.json', '*.dto.ts'] } });
  update([file('a.ts'), file('b.ts'), file('lock.json'), file('staged.ts', true)]);
  assert.equal(nodes.app.querySelectorAll('.hunk').length, 2);
  assert.equal(nodes.app.querySelectorAll('button').some(b => ['Collapse all', 'Expand all'].includes(b.textContent)), false);
  nodes.app.querySelectorAll('.section-bar')[1].onclick();
  assert.equal(nodes.app.querySelectorAll('.file').length, 4);
  assert.equal(nodes.app.querySelectorAll('.hunk').length, 0);
  nodes.app.querySelectorAll('.section-bar')[1].onclick();
  assert.equal(nodes.app.querySelectorAll('.hunk').length, 3);
  const buttons = () => nodes.app.querySelectorAll('button');
  buttons().find(b => b.className === 'hunk-location').onclick();
  assert.equal(messages.at(-1).type, 'open'); assert.equal(messages.at(-1).line, 5);
  nodes.app.querySelectorAll('.hunk-bar')[0].onclick();
  assert.equal(messages.at(-1).type, 'open'); assert.equal(messages.at(-1).line, 5);
  buttons().find(b => b.className === 'filename' && b.textContent === 'a.ts').onclick();
  assert.equal(messages.at(-1).type, 'open'); assert.equal(messages.at(-1).path, 'a.ts');
  nodes.app.querySelectorAll('.file-bar')[1].onclick();
  update([file('a.ts'), file('b.ts'), file('lock.json')]);
  assert.equal(nodes.app.querySelectorAll('.hunk').length, 2);
  update([file('b.ts', true)]);
  nodes.app.querySelectorAll('.file-bar')[0].onclick();
  assert.equal(nodes.app.querySelectorAll('.hunk').length, 1);
  handlers.message({ data: { type: 'completed', action: 'stage', paths: ['b.ts'] } });
  update([file('b.ts', true)]);
  assert.equal(nodes.app.querySelectorAll('.hunk').length, 0);
});
