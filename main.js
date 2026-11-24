'use strict';

const {
  app, BrowserWindow, WebContentsView, ipcMain,
  session, safeStorage, Menu, clipboard
} = require('electron');

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let win = null;
let settingsWin = null;
let menuWin = null;
let tabs = [];
let activeId = null;
let nextId = 1;
let sidebarVisible = true;
let panel = null;
let browserSession = null;
let downloadItems = [];
let historyItems = [];

const PARTITION = 'persist:strya';
const htmlPath = path.join(__dirname, 'src', 'index.html');
const htmlURL = pathToFileURL(htmlPath).href;
const vaultFile = () => path.join(app.getPath('userData'), 'passmenu.enc');

const getTab = id => tabs.find(t => t.id === (id ?? activeId));

function send(channel, data) {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

function normalizeURL(input) {
  const value = String(input || '').trim();

  if (!value) return 'about:blank';
  if (/^(https?:\/\/|about:|file:\/\/)/i.test(value)) return value;

  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)) {
    return `http://${value}`;
  }

  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(value)) {
    return `https://${value}`;
  }

  return 'https://www.google.com/search?q=' + encodeURIComponent(value);
}

function tabInfo(t) {
  const wc = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
  const currentURL = wc ? (wc.getURL() || t.url || 'about:blank') : (t.url || 'about:blank');
  const currentTitle = wc ? (wc.getTitle() || t.title || '新しいタブ') : (t.title || '新しいタブ');

  return {
    id: t.id,
    title: currentTitle,
    url: currentURL,
    loading: !!t.loading,
    pinned: !!t.pinned,
    private: !!t.private,
    mode: t.mode || 'start'
  };
}

function syncTabs() {
  send('tabs:update', { tabs: tabs.map(tabInfo), activeId });
}

function syncPage() {
  const t = getTab();
  if (!t || !t.view || t.view.webContents.isDestroyed()) return;

  const wc = t.view.webContents;
  send('page:update', {
    url: wc.getURL() || t.url || '',
    title: wc.getTitle() || t.title || '',
    loading: !!t.loading,
    back: wc.canGoBack(),
    forward: wc.canGoForward(),
    zoom: wc.getZoomFactor()
  });
}

function ensureAttached(t) {
  if (!win || win.isDestroyed() || !t || !t.view) return false;
  if (t.view.webContents.isDestroyed()) return false;

  const children = win.contentView.children || [];
  if (!children.includes(t.view)) {
    win.contentView.addChildView(t.view);
  }
  return true;
}

function layout() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;

  const { width, height } = win.getContentBounds();
  if (width <= 0 || height <= 0) return;

  const left = sidebarVisible ? 210 : 0;
  const top = 116;
  const viewWidth = Math.max(1, width - left);
  const viewHeight = Math.max(1, height - top);

  for (const t of tabs) {
    if (!ensureAttached(t)) continue;

    const isActive = t.id === activeId;
    const actualURL = t.view.webContents.getURL() || t.url || 'about:blank';
    if (actualURL && actualURL !== 'about:blank') {
      t.mode = 'web';
    } else if (t.url === 'about:blank' && (!actualURL || actualURL === 'about:blank')) {
      t.mode = 'start';
    }

    // Menu is a separate BrowserWindow and never controls WebContentsView visibility.
    const visible = isActive && !panel && t.mode === 'web';

    if (isActive) {
      t.view.setBounds({
        x: left,
        y: top,
        width: viewWidth,
        height: viewHeight
      });
      t.view.setBackgroundColor('#ffffff');
    }

    t.view.setVisible(visible);
  }

  syncPage();
}

function setPanel(name) {
  panel = name || null;
  send('panel:update', panel);
  layout();
}

function navigate(t, input) {
  if (!t || !ensureAttached(t)) return;

  const url = normalizeURL(input);
  t.url = url;
  t.mode = url === 'about:blank' ? 'start' : 'web';

  if (t.id === activeId) {
    panel = null;
    send('panel:update', null);
  }

  t.loading = url !== 'about:blank';
  syncTabs();
  layout();

  t.view.webContents.loadURL(url).catch(() => {
    t.loading = false;
    syncTabs();
    syncPage();
    layout();
  });
}

function addHistory(t, url) {
  if (!url || url.startsWith('about:') || t.private) return;

  const title = (!t.view.webContents.isDestroyed() ? t.view.webContents.getTitle() : '') || url;
  historyItems.unshift({
    url,
    title,
    time: Date.now()
  });

  if (historyItems.length > 2000) historyItems.length = 2000;
}

function createTab(url = 'about:blank', isPrivate = false) {
  if (!win || win.isDestroyed()) return null;

  const normalized = normalizeURL(url);
  const id = nextId++;
  const ses = isPrivate
    ? session.fromPartition(`strya-private-${id}`)
    : browserSession;

  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const t = {
    id,
    view,
    url: normalized,
    title: '新しいタブ',
    loading: false,
    mode: normalized === 'about:blank' ? 'start' : 'web',
    pinned: false,
    private: isPrivate
  };

  tabs.push(t);
  win.contentView.addChildView(view);
  activeId = id;
  panel = null;
  send('panel:update', null);

  const wc = view.webContents;

  wc.on('page-title-updated', (_, title) => {
    if (title) t.title = title;
    syncTabs();
    syncPage();
  });

  wc.on('did-start-loading', () => {
    t.loading = true;
    syncTabs();
    syncPage();
  });

  wc.on('did-stop-loading', () => {
    t.loading = false;
    const currentU = wc.getURL();
    if (currentU) {
      t.url = currentU;
      t.mode = currentU === 'about:blank' ? 'start' : 'web';
    }
    const currentT = wc.getTitle();
    if (currentT) t.title = currentT;
    syncTabs();
    syncPage();
    layout();
  });

  wc.on('did-navigate', (_, u) => {
    t.url = u;
    t.mode = (!u || u === 'about:blank') ? 'start' : 'web';
    addHistory(t, u);
    syncTabs();
    syncPage();
    layout();
  });

  wc.on('did-navigate-in-page', (_, u) => {
    t.url = u;
    if (u && u !== 'about:blank') t.mode = 'web';
    syncTabs();
    syncPage();
    layout();
  });

  wc.on('render-process-gone', () => {
    t.loading = false;
    send('toast', 'ページの処理が終了しました。再読み込みしてください。');
    syncTabs();
  });

  wc.on('did-fail-load', (_, code, desc, u, mainFrame) => {
    if (mainFrame) {
      t.loading = false;
      if (code !== -3) {
        send('toast', `ページを開けませんでした: ${desc} (${u})`);
      }
      syncTabs();
      syncPage();
    }
  });

  wc.setWindowOpenHandler(({ url: target }) => {
    createTab(target, t.private);
    return { action: 'deny' };
  });

  wc.on('context-menu', (_, params) => {
    const menu = Menu.buildFromTemplate([
      { label: '戻る', enabled: wc.canGoBack(), click: () => wc.goBack() },
      { label: '進む', enabled: wc.canGoForward(), click: () => wc.goForward() },
      { label: '再読み込み', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'コピー', click: () => wc.copy() },
      { label: '貼り付け', click: () => wc.paste() },
      {
        label: 'リンクを新しいタブで開く',
        visible: !!params.linkURL,
        click: () => createTab(params.linkURL, t.private)
      },
      {
        label: 'リンクをコピー',
        visible: !!params.linkURL,
        click: () => clipboard.writeText(params.linkURL)
      },
      { type: 'separator' },
      { label: '開発者ツール', click: () => wc.openDevTools({ mode: 'detach' }) }
    ]);
    menu.popup({ window: win });
  });

  wc.on('before-input-event', (_, input) => {
    if (input.control || input.meta) {
      const key = input.key.toLowerCase();
      if (key === 'l') send('focus-address');
      if (key === 't') createTab();
      if (key === 'w') closeTab(id);
      if (key === 'r') wc.reload();
      if (key === 'f') send('focus-find');
    }

    if (input.alt && input.key === 'ArrowLeft' && wc.canGoBack()) wc.goBack();
    if (input.alt && input.key === 'ArrowRight' && wc.canGoForward()) wc.goForward();
  });

  layout();
  syncTabs();

  if (normalized && normalized !== 'about:blank') {
    navigate(t, normalized);
  }
  return id;
}

function activateTab(id) {
  const t = getTab(Number(id));
  if (!t) return false;

  activeId = t.id;
  panel = null;
  send('panel:update', null);
  layout();
  syncTabs();
  syncPage();
  return true;
}

function closeTab(id) {
  const index = tabs.findIndex(t => t.id === Number(id));
  if (index < 0) return false;

  const t = tabs[index];
  if (t.pinned) {
    send('toast', '固定されたタブは閉じられません。');
    return false;
  }

  try {
    if (win && !win.isDestroyed() && t.view) {
      win.contentView.removeChildView(t.view);
    }
    if (t.view && !t.view.webContents.isDestroyed()) {
      t.view.webContents.close();
    }
  } catch {}

  tabs.splice(index, 1);

  if (activeId === Number(id)) {
    if (tabs.length) {
      activeId = tabs[Math.min(index, tabs.length - 1)].id;
    } else {
      activeId = null;
      createTab();
      return true;
    }
  }

  layout();
  syncTabs();
  return true;
}

/* Settings subwindow */
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }

  const parentWin = win && !win.isDestroyed() ? win : undefined;
  const parentBounds = parentWin ? parentWin.getBounds() : null;

  const x = parentBounds
    ? Math.max(0, Math.round(parentBounds.x + (parentBounds.width - 900) / 2))
    : undefined;
  const y = parentBounds
    ? Math.max(0, Math.round(parentBounds.y + (parentBounds.height - 760) / 2))
    : undefined;

  settingsWin = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 600,
    minHeight: 560,
    x,
    y,
    frame: false,
    show: false,
    parent: parentWin,
    backgroundColor: '#f3f3f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const current = settingsWin;
  let shown = false;

  const reveal = () => {
    if (shown || current.isDestroyed()) return;
    shown = true;
    if (current.isMinimized()) current.restore();
    current.show();
    current.focus();
  };

  const fallbackTimer = setTimeout(reveal, 1200);

  current.once('ready-to-show', () => {
    clearTimeout(fallbackTimer);
    reveal();
  });

  current.on('closed', () => {
    clearTimeout(fallbackTimer);
    if (settingsWin === current) settingsWin = null;
  });

  current.webContents.on('did-fail-load', (_, code, desc, url) => {
    console.error('[Settings] Load failed:', code, desc, url);
    clearTimeout(fallbackTimer);
    if (!shown && !current.isDestroyed()) {
      current.close();
      send('toast', `設定ウィンドウの読み込みに失敗しました (${code})`);
    }
  });

  current.webContents.on('console-message', (_, level, message) => {
    if (level >= 2) console.error('[Settings renderer]', message);
  });

  current.loadURL(`${htmlURL}?window=settings`)
    .then(() => {
      clearTimeout(fallbackTimer);
      reveal();
    })
    .catch(err => {
      clearTimeout(fallbackTimer);
      console.error('[Settings] Failed to load:', err);
      if (!current.isDestroyed()) current.close();
      send('toast', '設定ウィンドウの読み込みに失敗しました。');
    });
}

/* Separate Menu subwindow */
function openMenu() {
  if (menuWin && !menuWin.isDestroyed()) {
    if (menuWin.isMinimized()) menuWin.restore();
    menuWin.show();
    menuWin.focus();
    return;
  }

  const parentWin = win && !win.isDestroyed() ? win : undefined;
  const parentBounds = parentWin ? parentWin.getBounds() : null;

  const menuWidth = 280;
  const menuHeight = 470;
  const x = parentBounds
    ? Math.max(0, Math.round(parentBounds.x + parentBounds.width - menuWidth - 16))
    : undefined;
  const y = parentBounds
    ? Math.max(0, Math.round(parentBounds.y + 102))
    : undefined;

  menuWin = new BrowserWindow({
    width: menuWidth,
    height: menuHeight,
    minWidth: menuWidth,
    maxWidth: menuWidth,
    minHeight: 400,
    maxHeight: 600,
    x,
    y,
    frame: false,
    resizable: false,
    show: false,
    parent: parentWin,
    backgroundColor: '#f3f3f9',
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const current = menuWin;
  let shown = false;

  const reveal = () => {
    if (shown || current.isDestroyed()) return;
    shown = true;
    if (current.isMinimized()) current.restore();
    current.show();
    current.focus();
  };

  const fallbackTimer = setTimeout(reveal, 1000);

  current.once('ready-to-show', () => {
    clearTimeout(fallbackTimer);
    reveal();
  });

  current.on('closed', () => {
    clearTimeout(fallbackTimer);
    if (menuWin === current) menuWin = null;
  });

  current.webContents.on('did-fail-load', (_, code, desc, url) => {
    console.error('[Menu] Load failed:', code, desc, url);
    clearTimeout(fallbackTimer);
    if (!shown && !current.isDestroyed()) {
      current.close();
      send('toast', `メニューを開けませんでした (${code})`);
    }
  });

  current.loadURL(`${htmlURL}?window=menu`)
    .then(() => {
      clearTimeout(fallbackTimer);
      reveal();
    })
    .catch(err => {
      clearTimeout(fallbackTimer);
      console.error('[Menu] Failed to load:', err);
      if (!current.isDestroyed()) current.close();
      send('toast', 'メニューを開けませんでした。');
    });
}

function closeMenuWindow() {
  if (menuWin && !menuWin.isDestroyed()) {
    menuWin.close();
  }
  menuWin = null;
}

function handleMenuAction(action) {
  closeMenuWindow();

  switch (action) {
    case 'bookmarks': setPanel('bookmarks'); break;
    case 'history': setPanel('history'); break;
    case 'downloads': setPanel('downloads'); break;
    case 'cookies': setPanel('cookies'); break;
    case 'passmenu': setPanel('passmenu'); break;
    case 'private': createTab('about:blank', true); break;
    case 'settings': openSettings(); break;
  }

  if (action !== 'settings' && win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function openTool(name) {
  if (name === 'settings') {
    openSettings();
    return;
  }

  if (['cookies', 'passmenu', 'downloads', 'permissions', 'bookmarks', 'history', 'home'].includes(name)) {
    setPanel(name);
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#f3f3f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once('ready-to-show', () => {
    if (win && !win.isDestroyed()) {
      win.show();
      layout();
    }
  });

  win.on('resize', layout);
  win.on('restore', layout);
  win.on('maximize', () => {
    send('window:max', true);
    layout();
  });
  win.on('unmaximize', () => {
    send('window:max', false);
    layout();
  });

  win.webContents.on('did-finish-load', () => {
    if (!tabs.length) createTab();
    send('sidebar:update', sidebarVisible);
    send('panel:update', panel);
    syncTabs();
    layout();
  });

  win.on('closed', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    if (menuWin && !menuWin.isDestroyed()) menuWin.close();
    settingsWin = null;
    menuWin = null;
    win = null;
    tabs = [];
    activeId = null;
  });

  win.loadURL(htmlURL).catch(err => {
    console.error('[Main] Failed to load index.html:', err);
  });
}

/* Password vault */
function readVault() {
  if (!safeStorage.isEncryptionAvailable()) return [];

  try {
    if (!fs.existsSync(vaultFile())) return [];
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(vaultFile())));
  } catch {
    return [];
  }
}

function writeVault(data) {
  if (!safeStorage.isEncryptionAvailable()) return false;

  try {
    fs.writeFileSync(vaultFile(), safeStorage.encryptString(JSON.stringify(data)));
    return true;
  } catch {
    return false;
  }
}

/* IPC */
ipcMain.handle('tabs:new', (_, url, priv) => createTab(url || 'about:blank', !!priv));
ipcMain.handle('tabs:activate', (_, id) => activateTab(id));
ipcMain.handle('tabs:close', (_, id) => closeTab(id));

ipcMain.handle('tabs:pin', (_, id) => {
  const t = getTab(id);
  if (!t) return false;
  t.pinned = !t.pinned;
  syncTabs();
  return t.pinned;
});

ipcMain.handle('tabs:duplicate', (_, id) => {
  const t = getTab(id);
  if (!t) return null;
  return createTab(t.url, t.private);
});

ipcMain.handle('tabs:state', () => ({
  tabs: tabs.map(tabInfo),
  activeId,
  sidebarVisible,
  panel
}));

ipcMain.handle('browser:navigate', (_, url) => {
  navigate(getTab(), url);
  return true;
});

ipcMain.handle('browser:action', (_, action) => {
  const t = getTab();
  if (!t || !t.view || t.view.webContents.isDestroyed()) return;

  const wc = t.view.webContents;
  switch (action) {
    case 'back': if (wc.canGoBack()) wc.goBack(); break;
    case 'forward': if (wc.canGoForward()) wc.goForward(); break;
    case 'reload': wc.reload(); break;
    case 'stop': wc.stop(); break;
    case 'home': navigate(t, 'about:blank'); break;
    case 'devtools': wc.openDevTools({ mode: 'detach' }); break;
  }
});

ipcMain.handle('browser:zoom', (_, value) => {
  const t = getTab();
  if (!t || !t.view || t.view.webContents.isDestroyed()) return;
  const zoom = Math.max(0.5, Math.min(2.5, Number(value) || 1));
  t.view.webContents.setZoomFactor(zoom);
});

ipcMain.handle('browser:find', (_, text) => {
  const t = getTab();
  if (!t || !t.view || t.view.webContents.isDestroyed()) return;
  return t.view.webContents.findInPage(String(text || ''));
});

ipcMain.handle('browser:find-stop', () => {
  const t = getTab();
  if (!t || !t.view || t.view.webContents.isDestroyed()) return;
  return t.view.webContents.stopFindInPage('clearSelection');
});

ipcMain.handle('browser:panel', (_, name) => setPanel(name));
ipcMain.handle('browser:panel-close', () => setPanel(null));

ipcMain.handle('sidebar:set', (_, value) => {
  sidebarVisible = !!value;
  layout();
  send('sidebar:update', sidebarVisible);
  return sidebarVisible;
});

ipcMain.handle('tool:open', (_, name) => openTool(name));
ipcMain.handle('menu:open', () => openMenu());
ipcMain.handle('menu:action', (_, action) => handleMenuAction(action));

ipcMain.handle('window:control', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w.isDestroyed()) return false;
  if (action === 'minimize') w.minimize();
  if (action === 'maximize') w.isMaximized() ? w.unmaximize() : w.maximize();
  if (action === 'close') w.close();
  return true;
});

ipcMain.handle('window:is-max', e => BrowserWindow.fromWebContents(e.sender)?.isMaximized() || false);

ipcMain.handle('cookies:list', () => browserSession.cookies.get({}));
ipcMain.handle('cookies:remove', async (_, url, name) => {
  try {
    await browserSession.cookies.remove(url, name);
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('cookies:clear', async () => {
  await browserSession.clearStorageData({ storages: ['cookies'] });
  return true;
});

ipcMain.handle('pass:list', () => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: '暗号化機能を利用できません。' };
  return { ok: true, entries: readVault().map(({ id, site, username }) => ({ id, site, username })) };
});

ipcMain.handle('pass:add', (_, data) => {
  const list = readVault();
  list.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    site: String(data.site || ''),
    username: String(data.username || ''),
    password: String(data.password || '')
  });
  return { ok: writeVault(list) };
});

ipcMain.handle('pass:reveal', (_, id) => readVault().find(x => x.id === id)?.password ?? null);
ipcMain.handle('pass:delete', (_, id) => writeVault(readVault().filter(x => x.id !== id)));

ipcMain.handle('downloads:list', () => downloadItems);
ipcMain.handle('browser:permissions', () => []);
ipcMain.handle('history:list', () => historyItems);
ipcMain.handle('history:clear', () => {
  historyItems = [];
  send('history:clear');
  return true;
});

ipcMain.handle('data:erase', async (_, o = {}) => {
  const r = {};
  if (o.cookies) {
    await browserSession.clearStorageData({ storages: ['cookies'] });
    r.cookies = true;
  }
  if (o.cache) {
    await browserSession.clearCache();
    r.cache = true;
  }
  if (o.storage) {
    await browserSession.clearStorageData({
      storages: ['localstorage', 'indexdb', 'serviceworkers', 'websql', 'cachestorage']
    });
    r.storage = true;
  }
  if (o.history) {
    historyItems = [];
    send('history:clear');
    r.history = true;
  }
  if (o.pass) r.pass = writeVault([]);
  return r;
});

app.whenReady().then(() => {
  browserSession = session.fromPartition(PARTITION);

  browserSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(['media', 'geolocation', 'notifications'].includes(permission));
  });

  browserSession.on('will-download', (_, item) => {
    const filename = item.getFilename();
    const id = Date.now().toString(36);
    const download = {
      id, filename, total: item.getTotalBytes(),
      received: 0, state: 'progressing', path: '', url: item.getURL()
    };

    downloadItems.unshift(download);
    send('download:add', download);

    item.on('updated', () => {
      download.received = item.getReceivedBytes();
      download.total = item.getTotalBytes();
      send('download:progress', download);
    });

    item.once('done', (_, state) => {
      download.state = state;
      download.path = item.getSavePath();
      send('download:finish', download);
    });
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!win) createWindow();
});