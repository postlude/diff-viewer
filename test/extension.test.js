const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const gitTools = require('../src/git');

test('extension selects an external worktree, opens its files and stages only its changes', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'diff-viewer-extension-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { git } = gitTools;
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.name', 'Test']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await fs.writeFile(path.join(root, 'file.txt'), 'initial\n');
  await git(root, ['add', '.']); await git(root, ['commit', '-qm', 'initial']);
  const linked = path.join(root, 'linked worktree');
  await git(root, ['worktree', 'add', '-qb', 'feature', linked]);
  await fs.writeFile(path.join(root, 'file.txt'), 'main change\n');
  await fs.writeFile(path.join(linked, 'file.txt'), 'linked change\n');
  let command, handle, scheduled, poll, opened, choices;
  const messages = [];
  const disposable = { dispose() {} };
  const uri = fsPath => ({ fsPath });
  const repository = { rootUri: uri(root), state: { onDidChange: () => disposable } };
  const api = { repositories: [repository] };
  const panel = {
    visible: true, viewColumn: 1,
    webview: { postMessage: message => messages.push(message), asWebviewUri: () => '', onDidReceiveMessage: callback => { handle = callback; } },
    onDidDispose() {}, onDidChangeViewState() {}, dispose() {}
  };
  const vscode = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    ViewColumn: { Active: 1 }, TextEditorRevealType: { InCenter: 0 },
    Position: class { constructor(line) { this.line = line; } }, Selection: class {}, Range: class {},
    extensions: { getExtension: () => ({ activate: async () => ({ getAPI: () => api }) }) },
    commands: { registerCommand: (name, callback) => { command = callback; return disposable; } },
    workspace: {
      getConfiguration: () => ({ get: (name, fallback) => fallback }),
      onDidChangeConfiguration: () => disposable, onDidSaveTextDocument: () => disposable,
      openTextDocument: async selected => { opened = selected.fsPath; return { lineCount: 2 }; }
    },
    window: {
      createWebviewPanel: () => panel,
      showQuickPick: async items => { choices = items; return items.find(item => item.worktree.path === linked); },
      showTextDocument: async () => ({ revealRange() {} })
    }
  };
  const context = vm.createContext({
    require: name => name === 'vscode' ? vscode : name === './git' ? gitTools : require(name),
    module: { exports: {} },
    setTimeout: callback => { scheduled = callback; }, clearTimeout() {},
    setInterval: callback => { poll = callback; }, clearInterval() {}
  });
  vm.runInContext(await fs.readFile(require.resolve('../src/extension.js'), 'utf8'), context);
  context.module.exports.activate({ subscriptions: [], extensionUri: uri(root) });
  await command(); await handle({ type: 'refresh' }); await scheduled();
  const initial = messages.findLast(message => message.type === 'update');
  assert.equal(initial.root, root);
  await handle({ type: 'selectWorktree' }); await scheduled();
  assert.ok(choices.some(item => item.worktree.path === root));
  let update = messages.findLast(message => message.type === 'update');
  assert.equal(update.root, linked);
  assert.match(update.entries[0].diff, /linked change/);
  await handle({ type: 'stageAll', revision: initial.revision });
  assert.equal(await git(linked, ['diff', '--cached']), '');
  await handle({ type: 'open', path: 'file.txt', staged: false, revision: update.revision, line: 2 });
  assert.equal(opened, path.join(linked, 'file.txt'));
  await handle({ type: 'stage', path: 'file.txt', staged: false, revision: update.revision });
  assert.match(await git(linked, ['diff', '--cached']), /linked change/);
  assert.equal(await git(root, ['diff', '--cached']), '');
  await scheduled();
  await fs.appendFile(path.join(linked, 'file.txt'), 'external edit\n');
  poll(); await scheduled();
  update = messages.findLast(message => message.type === 'update');
  assert.match(update.entries.find(entry => !entry.staged).diff, /external edit/);
});
