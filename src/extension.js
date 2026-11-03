const vscode = require('vscode');
const path = require('node:path');
const crypto = require('node:crypto');
const { git, fileDiff, patch, mapLine } = require('./git');

function activate(context) {
  let panel, repo, api, repoListener, timer, loading = false, pending = false, busy = false, revision = 0;
  let entries = [];
  const status = { 0: 'M', 1: 'A', 2: 'D', 3: 'R', 4: 'C', 5: 'M', 6: 'D', 7: 'U', 9: 'A' };
  const config = () => vscode.workspace.getConfiguration('diffViewer', repo?.rootUri);
  const send = data => panel?.webview.postMessage(data);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => refresh(), 250); };
  async function refresh() {
    if (!panel || !repo) return;
    if (loading || busy) { pending = true; return; }
    loading = true;
    try {
      await repo.status();
      const root = repo.rootUri.fsPath;
      const next = [];
      for (const [staged, changes] of [[true, repo.state.indexChanges], [false, [...repo.state.workingTreeChanges, ...repo.state.mergeChanges]]]) {
        for (const c of changes) {
          const file = path.relative(root, c.uri.fsPath).split(path.sep).join('/');
          const e = { path: file, original: c.originalUri ? path.relative(root, c.originalUri.fsPath) : file, staged, status: status[c.status] || '!', conflict: c.status >= 10 };
          try { Object.assign(e, await fileDiff(root, file, staged, config().get('contextLines', 3))); } catch (err) { e.error = err.message; e.hunks = []; }
          next.push(e);
        }
      }
      entries = next; revision++;
      const patterns = config().get('initialCollapsePatterns', []);
      await send({ type: 'update', entries, revision, root, patterns });
    } catch (err) { await send({ type: 'error', message: err.message }); }
    finally { loading = false; if (pending) { pending = false; schedule(); } }
  }
  function setRepo(next) { repoListener?.dispose(); repo = next; entries = []; repoListener = repo.state.onDidChange(() => { if (!loading && !busy) schedule(); }); }
  async function handle(m) {
    let ownsBusy = false;
    try {
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'refresh') { schedule(); return; }
      if (m.type === 'settings') { await vscode.commands.executeCommand('workbench.action.openSettings', 'diffViewer.initialCollapsePatterns'); return; }
      if (!repo) return;
      const e = entries.find(e => e.path === m.path && e.staged === m.staged);
      if (m.type === 'open') {
        if (!e) return;
        let line = Number.isInteger(m.line) ? Math.max(1, m.line) : 1;
        if (e.staged) line = mapLine(line, (await fileDiff(repo.rootUri.fsPath, e.path, false)).hunks);
        const uri = vscode.Uri.joinPath(repo.rootUri, e.path);
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc, { viewColumn: panel?.viewColumn || vscode.ViewColumn.Active, preview: true });
          const p = new vscode.Position(Math.min(doc.lineCount - 1, line - 1), 0);
          editor.selection = new vscode.Selection(p, p); editor.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenter);
        } catch { await vscode.commands.executeCommand('git.openChange', uri); }
        return;
      }
      if (!['stage', 'unstage', 'discard', 'stageAll', 'unstageAll', 'discardAll'].includes(m.type) || busy || loading) return;
      if (m.revision !== revision) throw new Error('Changes have refreshed. Please try again.');
      if (!m.type.endsWith('All') && !e) throw new Error('File no longer exists in this view.');
      if (e?.conflict) throw new Error('Resolve conflicts in the editor before staging.');
      if (m.type === 'stageAll' && entries.some(e => e.conflict)) throw new Error('Resolve merge conflicts before staging all files.');
      busy = true; ownsBusy = true; await send({ type: 'busy', value: true });
      const root = repo.rootUri.fsPath;
      if (m.type.startsWith('discard')) {
        const answer = await vscode.window.showWarningMessage(`Discard ${m.type === 'discardAll' ? 'all unstaged changes (including untracked files)' : Number.isInteger(m.hunk) ? 'this hunk' : e.path}? This cannot be undone.`, { modal: true }, 'Discard');
        if (answer !== 'Discard') return;
      }
      if (Number.isInteger(m.hunk)) {
        if (!e || e.conflict || (m.type === 'stage' && e.staged) || (m.type === 'unstage' && !e.staged)) throw new Error('Invalid hunk action.');
        const fresh = await fileDiff(root, e.path, e.staged, config().get('contextLines', 3));
        if (fresh.diff !== e.diff) throw new Error('File changed since refresh. Refresh and try again.');
        if (e.status === 'R' || e.status === 'C') throw new Error('Use the file action for renames and copies.');
        const args = ['apply']; if (m.type !== 'discard') args.push('--cached'); if (m.type !== 'stage') args.push('--reverse');
        await git(root, args, patch(fresh, m.hunk));
      } else if (m.type === 'stage' || m.type === 'stageAll') {
        await git(root, m.type === 'stageAll' ? ['add', '-A'] : ['add', '-A', '--', ...new Set([e.path, e.original])]);
      } else if (m.type === 'unstage' || m.type === 'unstageAll') {
        const hasHead = (await git(root, ['rev-parse', '--verify', 'HEAD'], undefined, [0, 128])).trim();
        const paths = m.type === 'unstageAll' ? ['.'] : [...new Set([e.path, e.original])];
        await git(root, hasHead ? ['reset', '-q', 'HEAD', '--', ...paths] : ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...paths]);
      } else if (m.type === 'discard') {
        if (e.status === 'U') await vscode.workspace.fs.delete(vscode.Uri.joinPath(repo.rootUri, e.path), { useTrash: true });
        else await git(root, ['restore', '--worktree', '--', e.path]);
      } else {
        // Restore only tracked files; explicitly remove the untracked files shown in this snapshot.
        const tracked = entries.filter(f => !f.staged && f.status !== 'U');
        if (tracked.length) await git(root, ['restore', '--worktree', '--', ...tracked.map(f => f.path)]);
        for (const f of entries.filter(f => !f.staged && f.status === 'U')) await vscode.workspace.fs.delete(vscode.Uri.joinPath(repo.rootUri, f.path), { useTrash: true });
      }
      await send({ type: 'completed', action: m.type, paths: e ? [e.path] : entries.filter(e => !e.staged).map(e => e.path) });
    } catch (err) { await send({ type: 'error', message: err.message }); }
    finally { if (ownsBusy) { busy = false; await send({ type: 'busy', value: false }); schedule(); } }
  }
  context.subscriptions.push(vscode.commands.registerCommand('diffViewer.open', async () => {
    if (panel) { panel.reveal(); schedule(); return; }
    const ext = vscode.extensions.getExtension('vscode.git'); api = (await ext.activate()).getAPI(1);
    if (!api.repositories.length) { vscode.window.showInformationMessage('Open a Git repository first.'); return; }
    const active = vscode.window.activeTextEditor?.document.uri;
    setRepo((active && api.getRepository(active)) || api.repositories[0]);
    panel = vscode.window.createWebviewPanel('diffViewer', 'Diff Viewer', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
    const web = panel.webview, nonce = crypto.randomBytes(16).toString('hex');
    const resource = f => web.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', f));
    web.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${web.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${resource('main.css')}"><title>Diff Viewer</title></head><body><header class="toolbar"><strong>DIFF VIEWER</strong><button id="settings">Collapse patterns</button><button id="refresh">Refresh</button></header><div id="notice" role="status"></div><main id="app">Loading changes…</main><script nonce="${nonce}" src="${resource('main.js')}"></script></body></html>`;
    panel.webview.onDidReceiveMessage(handle);
    panel.onDidDispose(() => { panel = undefined; repoListener?.dispose(); clearTimeout(timer); });
    panel.onDidChangeViewState(() => { if (panel?.visible) schedule(); });
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('diffViewer')) schedule(); }), vscode.workspace.onDidSaveTextDocument(schedule), { dispose: () => { clearTimeout(timer); repoListener?.dispose(); panel?.dispose(); } });
}
module.exports = { activate };
