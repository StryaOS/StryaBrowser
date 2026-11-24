const { app, BrowserWindow, WebContentsView, ipcMain, session, safeStorage, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let win;
let tabs = [];
let activeTabId = null;
let nextId = 1;
const PARTITION = 'persist:strya';
let browserSession;
let vaultPath;
const toolWindows = new Map();

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function tabInfo(tab) {
  const wc = tab.view.webContents;
  return { id: tab.id, url: wc.getURL(), title: wc.getTitle() || 'New Tab', loading: wc.isLoading(), canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() };
}
function sendTabs() { send('tabs:updated', { tabs: tabs.map(tabInfo), activeTabId }); }
function setBounds() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const sidebarWidth = 190;
  const bounds = { x: sidebarWidth, y: 156, width: Math.max(0, width - sidebarWidth), height: Math.max(0, height - 156) };
  for (const tab of tabs) if (!tab.view.webContents.isDestroyed()) tab.view.setBounds(tab.id === activeTabId ? bounds : { x: 0, y: 156, width: 0, height: 0 });
}
function updateState(tab) { if (tab.id === activeTabId) send('page:updated', tabInfo(tab)); sendTabs(); }
function createTab(url = 'about:blank') {
  if (!win || !browserSession) return null;
  const view = new WebContentsView({ webPreferences: { session: browserSession, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const tab = { id: nextId++, view };
  tabs.push(tab); win.contentView.addChildView(view);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) createTab(url); return { action: 'deny' }; });
  wc.on('context-menu', (event, params) => {
    const current = wc.getURL();
    const menu = Menu.buildFromTemplate([
      { label: '進む', enabled: wc.canGoForward(), click: () => wc.goForward() },
      { label: '戻る', enabled: wc.canGoBack(), click: () => wc.goBack() },
      { label: 'ページをリロード', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'コピー', enabled: params.selectionText.length > 0, click: () => wc.copy() },
      { label: '貼り付け', click: () => wc.paste() },
      { label: 'カット', enabled: params.isEditable && params.selectionText.length > 0, click: () => wc.cut() },
      { type: 'separator' },
      { label: 'Webの保存', click: async () => { const result = await dialog.showSaveDialog(win, { defaultPath: 'webpage.mhtml', filters: [{ name: 'Webページ (MHTML)', extensions: ['mhtml'] }] }); if (!result.canceled && result.filePath) wc.savePage(result.filePath, 'MHTML').catch(err => console.error('Save page error:', err.message)); } },
      { label: 'Web改造', click: () => wc.openDevTools({ mode: 'detach' }) },
      { label: 'クッキーの内容を変更', click: () => openToolWindow('cookies') },
      { label: 'ページのソースを見る', click: () => { if (/^https?:\/\//i.test(current)) createTab('view-source:' + current); } }
    ]);
    menu.popup({ window: win });
  });
  ['page-title-updated','did-start-loading','did-stop-loading','did-navigate','did-navigate-in-page'].forEach(event => wc.on(event, () => updateState(tab)));
  wc.on('did-fail-load', (event, code, description, failedUrl, isMainFrame) => { if (isMainFrame && code !== -3) send('page:error', { code, description, url: failedUrl }); updateState(tab); });
  wc.on('render-process-gone', () => send('page:error', { code: -1, description: 'ページのレンダラープロセスが終了しました。' }));
  wc.on('will-navigate', (event, target) => { if (!/^https?:\/\//i.test(target) && !/^view-source:https?:\/\//i.test(target) && target !== 'about:blank') event.preventDefault(); });
  activeTabId = tab.id; setBounds(); sendTabs();
  if (url !== 'about:blank') wc.loadURL(url).catch(err => console.error('Tab load error:', err.message));
  return tab;
}
function getActiveTab() { return tabs.find(t => t.id === activeTabId); }
function openToolWindow(type) {
  if (toolWindows.has(type) && !toolWindows.get(type).isDestroyed()) { const existing = toolWindows.get(type); existing.focus(); return; }
  const titles = { settings: 'Strya Settings', cookies: 'Cookie Manager', passmenu: 'PassMenu', erase: 'Strya Data Eraser' };
  const child = new BrowserWindow({ width: type === 'erase' ? 560 : 900, height: type === 'erase' ? 650 : 720, minWidth: 480, minHeight: 420, parent: win || undefined, modal: false, frame: false, backgroundColor: '#f5f6fa', title: titles[type] || 'Strya Browser', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  toolWindows.set(type, child);
  child.loadFile(path.join(__dirname, 'src', 'index.html'), { query: { window: type } });
  child.on('closed', () => toolWindows.delete(type));
}
function createWindow() {
  if (win && !win.isDestroyed()) return;
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 850, minHeight: 600, backgroundColor: '#f5f6fa', title: 'Strya Browser', frame: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('resize', setBounds); win.on('maximize', setBounds); win.on('unmaximize', setBounds);
  win.webContents.on('did-finish-load', () => { if (!tabs.length) createTab(); setBounds(); sendTabs(); });
  win.on('closed', () => { win = null; tabs = []; activeTabId = null; });
}
function setupDownloads() {
  browserSession.on('will-download', (_, item) => {
    const name = item.getFilename();
    const result = dialog.showSaveDialogSync(win, { defaultPath: name });
    if (!result) { item.cancel(); return; }
    item.setSavePath(result); send('download:started', { name });
    item.on('updated', () => send('download:progress', { name, received: item.getReceivedBytes(), total: item.getTotalBytes(), state: item.getState() }));
    item.once('done', (_, state) => send('download:done', { name, state }));
  });
}

ipcMain.handle('tab:new', (_, url) => createTab(url || 'about:blank')?.id ?? null);
ipcMain.handle('tab:close', (_, id) => {
  const index = tabs.findIndex(t => t.id === id); if (index < 0) return;
  const tab = tabs[index]; tabs.splice(index, 1); if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (activeTabId === id) { activeTabId = tabs[Math.max(0, index - 1)]?.id || null; if (!activeTabId) createTab(); }
  setBounds(); sendTabs(); const active = getActiveTab(); if (active) send('page:updated', tabInfo(active));
});
ipcMain.handle('tab:activate', (_, id) => { if (!tabs.some(t => t.id === id)) return; activeTabId = id; setBounds(); sendTabs(); const active = getActiveTab(); if (active) send('page:updated', tabInfo(active)); });
ipcMain.handle('browser:navigate', (_, input) => {
  const value = String(input || '').trim(); if (!value) return;
  if (/^strya:\/\/erase\/?$/i.test(value)) { openToolWindow('erase'); return; }
  const tab = getActiveTab(); if (!tab) return;
  let target; try { const u = new URL(value); if (['http:','https:'].includes(u.protocol)) target = u.href; } catch {}
  if (!target) target = 'https://www.google.com/search?q=' + encodeURIComponent(value);
  tab.view.webContents.loadURL(target).catch(e => console.error('Navigation error:', e.message));
});
ipcMain.handle('browser:action', (_, action) => { const wc = getActiveTab()?.view.webContents; if (!wc) return; if (action === 'back' && wc.canGoBack()) wc.goBack(); if (action === 'forward' && wc.canGoForward()) wc.goForward(); if (action === 'reload') wc.reload(); if (action === 'stop') wc.stop(); if (action === 'home') wc.loadURL('about:blank'); if (action === 'devtools') wc.openDevTools({ mode: 'detach' }); });
ipcMain.handle('browser:zoom', (_, factor) => { const wc = getActiveTab()?.view.webContents; if (wc) wc.setZoomFactor(Math.min(3, Math.max(.5, Number(factor) || 1))); });
ipcMain.handle('browser:find', (_, text) => { const wc = getActiveTab()?.view.webContents; if (wc && text) wc.findInPage(String(text)); });
ipcMain.handle('browser:stop-find', () => getActiveTab()?.view.webContents.stopFindInPage('clearSelection'));
ipcMain.handle('browser:state', () => ({ tabs: tabs.map(tabInfo), activeTabId }));
ipcMain.handle('tool:open', (_, type) => { if (['settings','cookies','passmenu','erase'].includes(type)) openToolWindow(type); });
ipcMain.handle('window:control', (event, action) => { const w = BrowserWindow.fromWebContents(event.sender); if (!w) return; if (action === 'minimize') w.minimize(); if (action === 'toggle-maximize') w.isMaximized() ? w.unmaximize() : w.maximize(); if (action === 'close') w.close(); });
ipcMain.handle('window:is-maximized', event => BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false);
ipcMain.handle('cookies:list', async () => browserSession.cookies.get({}));
ipcMain.handle('cookies:remove', async (_, url, name) => { if (!/^https?:\/\//i.test(url)) return false; await browserSession.cookies.remove(url, name); return true; });
ipcMain.handle('cookies:update', async (_, cookie) => { if (!cookie || !cookie.url || !cookie.name || typeof cookie.value !== 'string') return false; if (!/^https?:\/\//i.test(cookie.url)) return false; await browserSession.cookies.set({ url: cookie.url, name: cookie.name, value: cookie.value, domain: cookie.domain || undefined, path: cookie.path || '/', secure: !!cookie.secure, httpOnly: !!cookie.httpOnly, expirationDate: cookie.expirationDate || undefined, sameSite: cookie.sameSite || 'unspecified' }); return true; });
async function readVault() {
  if (!fs.existsSync(vaultPath)) return [];
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('OSの暗号化ストレージが利用できません');
  if (safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('安全なキーリングがありません。PassMenuを無効にしました');
  return JSON.parse(await safeStorage.decryptStringAsync(fs.readFileSync(vaultPath)));
}
async function writeVault(entries) {
  if (!(await safeStorage.isAsyncEncryptionAvailable()) || safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('安全な暗号化ストレージを利用できません');
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(entries)); const temp = vaultPath + '.tmp';
  fs.writeFileSync(temp, encrypted, { mode: 0o600 }); fs.renameSync(temp, vaultPath);
}
ipcMain.handle('passmenu:list', async () => (await readVault()).map(({ password, ...entry }) => entry));
ipcMain.handle('passmenu:add', async (_, entry) => {
  const entries = await readVault(); if (!entry || !entry.site || !entry.username || !entry.password) throw new Error('入力内容が不足しています');
  let site; try { const parsed = new URL(entry.site); if (!['http:','https:'].includes(parsed.protocol)) throw Error(); site = parsed.origin; } catch { throw new Error('正しいWebサイトURLを入力してください'); }
  entries.push({ id: Date.now().toString(), site, username: String(entry.username), password: String(entry.password) }); await writeVault(entries); return true;
});
ipcMain.handle('passmenu:reveal', async (_, id) => { const item = (await readVault()).find(x => x.id === id); return item?.password ?? null; });
ipcMain.handle('passmenu:delete', async (_, id) => { const entries = await readVault(); await writeVault(entries.filter(x => x.id !== id)); return true; });
ipcMain.handle('erase:execute', async (_, selections) => {
  const allowed = new Set(['cookies','cache','history','bookmarks','passmenu','settings']);
  const selected = Array.isArray(selections) ? selections.filter(x => allowed.has(x)) : [];
  if (!selected.length) return { ok: false, message: '削除項目が選択されていません' };
  if (selected.includes('cookies')) await browserSession.clearStorageData({ storages: ['cookies'] });
  if (selected.includes('cache')) await browserSession.clearCache();
  if (selected.includes('passmenu') && fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath);
  if (selected.includes('settings')) { for (const w of toolWindows.values()) if (!w.isDestroyed()) w.webContents.send('erase:settings-cleared'); }
  return { ok: true, selected };
});
app.whenReady().then(() => { browserSession = session.fromPartition(PARTITION); vaultPath = path.join(app.getPath('userData'), 'passmenu.dat'); setupDownloads(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
