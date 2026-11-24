'use strict';

const api = window.strya;
const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);
const isSettings = params.get('window') === 'settings';
const isMenuWindow = params.get('window') === 'menu';

let tabs = [];
let activeId = null;
let currentPanel = null;
let sidebarVisible = true;
let downloads = [];

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function searchURL(value) {
  const v = String(value || '').trim();
  if (!v) return 'about:blank';
  if (/^(https?:\/\/|about:|file:\/\/)/i.test(v)) return v;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(v)) return 'http://' + v;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(v)) return 'https://' + v;
  const engine = localStorage.getItem('strya-search') || 'google';
  const engines = {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q='
  };
  return (engines[engine] || engines.google) + encodeURIComponent(v);
}

function activeTab() {
  return tabs.find(t => t.id === activeId);
}

function renderTabs() {
  const root = $('tabs');
  if (!root) return;
  root.innerHTML = '';

  tabs.forEach(t => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (t.id === activeId ? ' active' : '') + (t.pinned ? ' pinned' : '');
    tab.dataset.id = t.id;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = (t.private ? '◉ ' : '') + (t.title || '新しいタブ');

    const pin = document.createElement('button');
    pin.className = 'tab-pin';
    pin.title = t.pinned ? '固定解除' : 'タブを固定';
    pin.textContent = t.pinned ? '◆' : '◇';
    pin.onclick = async e => {
      e.stopPropagation();
      await api.pinTab(t.id);
    };

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'タブを閉じる';
    close.onclick = e => {
      e.stopPropagation();
      api.closeTab(t.id);
    };

    tab.onclick = () => api.activateTab(t.id);
    tab.oncontextmenu = e => {
      e.preventDefault();
      api.duplicateTab(t.id);
    };

    tab.append(title, pin, close);
    root.append(tab);
  });
}

function renderPage(info = {}) {
  if (isSettings || isMenuWindow) return;

  const address = $('address');
  if (address && document.activeElement !== address) {
    address.value = (info.url && info.url !== 'about:blank') ? info.url : '';
  }

  if ($('back')) $('back').disabled = !info.back;
  if ($('forward')) $('forward').disabled = !info.forward;
  if ($('reload')) $('reload').textContent = info.loading ? '×' : '↻';
}

function setPanel(name) {
  currentPanel = name || null;
  api.panel(currentPanel);
  renderPanel();
}

function renderPanel() {
  const content = $('panelContent');
  const panel = $('panel');
  if (!content || !panel) return;

  if (!currentPanel) {
    panel.classList.remove('open');
    content.innerHTML = '';
    return;
  }

  panel.classList.add('open');
  content.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'panel-header';

  const title = document.createElement('h2');
  title.textContent = ({
    home: 'ホーム',
    bookmarks: 'ブックマーク',
    history: '履歴',
    downloads: 'ダウンロード',
    cookies: 'Cookie',
    passmenu: 'PassMenu',
    permissions: '権限'
  })[currentPanel] || currentPanel;

  const close = document.createElement('button');
  close.className = 'icon-button';
  close.textContent = '×';
  close.onclick = () => setPanel(null);

  header.append(title, close);
  content.append(header);

  switch (currentPanel) {
    case 'home': renderHomePanel(content); break;
    case 'bookmarks': renderBookmarks(content); break;
    case 'history': renderHistory(content); break;
    case 'downloads': renderDownloads(content); break;
    case 'cookies': renderCookies(content); break;
    case 'passmenu': renderPassMenu(content); break;
    case 'permissions': renderPermissions(content); break;
    default: renderHomePanel(content);
  }
}

function renderHomePanel(content) {
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = 'よく使うページをすばやく開けます。';
  content.append(note);

  const actions = [
    ['新しいタブ', () => api.newTab()],
    ['設定', () => api.openTool('settings')],
    ['ダウンロード', () => setPanel('downloads')],
    ['履歴', () => setPanel('history')]
  ];

  actions.forEach(([label, fn]) => {
    const button = document.createElement('button');
    button.className = 'panel-action';
    button.textContent = label;
    button.onclick = fn;
    content.append(button);
  });
}

function renderBookmarks(content) {
  const bookmarks = JSON.parse(localStorage.getItem('strya-bookmarks') || '[]');
  if (!bookmarks.length) {
    content.append(emptyText('ブックマークはまだありません。'));
    return;
  }

  bookmarks.forEach(b => {
    const row = makeRow(b.title || b.url, b.url);
    row.onclick = () => {
      api.navigate(b.url);
      setPanel(null);
    };
    content.append(row);
  });
}

function renderHistory(content) {
  const list = document.createElement('div');
  list.className = 'list';

  api.history().then(items => {
    list.innerHTML = '';
    if (!items || !items.length) {
      list.append(emptyText('履歴はありません。'));
    } else {
      items.forEach(item => {
        const row = makeRow(item.title || item.url, item.url);
        row.onclick = () => {
          api.navigate(item.url);
          setPanel(null);
        };
        list.append(row);
      });
    }
  });

  const clear = document.createElement('button');
  clear.className = 'panel-action danger';
  clear.textContent = '履歴を削除';
  clear.onclick = async () => {
    await api.historyClear();
    renderPanel();
  };

  content.append(list, clear);
}

function renderDownloads(content) {
  const list = document.createElement('div');
  list.className = 'list';

  downloads.forEach(d => {
    const row = document.createElement('div');
    row.className = 'list-row';

    const info = document.createElement('div');
    info.className = 'row-info';

    const name = document.createElement('strong');
    name.textContent = d.filename;

    const detail = document.createElement('small');
    detail.textContent = d.state === 'completed' ? '完了' :
      d.state === 'progressing' ? 'ダウンロード中' : d.state;

    info.append(name, detail);
    row.append(info);
    list.append(row);
  });

  if (!downloads.length) list.append(emptyText('ダウンロードはありません。'));
  content.append(list);
}

async function renderCookies(content) {
  const list = document.createElement('div');
  list.className = 'list';
  content.append(list);

  const clear = document.createElement('button');
  clear.className = 'panel-action danger';
  clear.textContent = 'すべてのCookieを削除';
  clear.onclick = async () => {
    await api.cookieClear();
    toast('Cookieを削除しました');
    renderPanel();
  };
  content.append(clear);

  try {
    const cookies = await api.cookieList();

    if (!cookies.length) {
      list.append(emptyText('Cookieはありません。'));
      return;
    }

    cookies.forEach(c => {
      const row = document.createElement('div');
      row.className = 'list-row';

      const info = document.createElement('div');
      info.className = 'row-info';

      const name = document.createElement('strong');
      name.textContent = c.name;

      const detail = document.createElement('small');
      detail.textContent = c.domain + ' · ' + c.path;

      const remove = document.createElement('button');
      remove.className = 'icon-button';
      remove.textContent = '×';
      remove.onclick = async () => {
        const url = (c.secure ? 'https://' : 'http://') +
          c.domain.replace(/^\./, '') + c.path;
        await api.cookieRemove(url, c.name);
        renderPanel();
      };

      info.append(name, detail);
      row.append(info, remove);
      list.append(row);
    });
  } catch {
    list.append(emptyText('Cookieを取得できませんでした。'));
  }
}

async function renderPassMenu(content) {
  const form = document.createElement('div');
  form.className = 'pass-form';

  const site = makeInput('サイト', 'https://example.com');
  const username = makeInput('ユーザー名', 'ユーザー名');
  const password = makeInput('パスワード', 'パスワード', 'password');

  const add = document.createElement('button');
  add.className = 'panel-action';
  add.textContent = '保存';
  add.onclick = async () => {
    if (!site.input.value.trim() || !password.input.value) {
      toast('サイトとパスワードを入力してください');
      return;
    }

    const result = await api.passAdd({
      site: site.input.value,
      username: username.input.value,
      password: password.input.value
    });

    if (result?.ok) {
      toast('保存しました');
      renderPanel();
    } else {
      toast('保存できませんでした');
    }
  };

  form.append(site.wrap, username.wrap, password.wrap, add);
  content.append(form);

  const list = document.createElement('div');
  list.className = 'list';
  content.append(list);

  const result = await api.passList();

  if (!result?.ok) {
    list.append(emptyText(result?.error || '保存データを読み込めません。'));
    return;
  }

  if (!result.entries.length) {
    list.append(emptyText('保存したログイン情報はありません。'));
    return;
  }

  result.entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'list-row';

    const info = document.createElement('div');
    info.className = 'row-info';

    const title = document.createElement('strong');
    title.textContent = entry.site;

    const user = document.createElement('small');
    user.textContent = entry.username;

    info.append(title, user);

    const reveal = document.createElement('button');
    reveal.className = 'icon-button';
    reveal.textContent = '表示';
    reveal.onclick = async () => {
      const value = await api.passReveal(entry.id);
      toast(value ? `パスワード: ${value}` : '取得できませんでした');
    };

    const del = document.createElement('button');
    del.className = 'icon-button';
    del.textContent = '×';
    del.onclick = async () => {
      await api.passDelete(entry.id);
      renderPanel();
    };

    row.append(info, reveal, del);
    list.append(row);
  });
}

function renderPermissions(content) {
  content.append(emptyText('この機能は現在準備中です。'));
}

function makeRow(title, detail) {
  const row = document.createElement('div');
  row.className = 'list-row';

  const info = document.createElement('div');
  info.className = 'row-info';

  const name = document.createElement('strong');
  name.textContent = title;

  const small = document.createElement('small');
  small.textContent = detail;

  info.append(name, small);
  row.append(info);
  return row;
}

function emptyText(text) {
  const el = document.createElement('p');
  el.className = 'empty';
  el.textContent = text;
  return el;
}

function makeInput(label, placeholder, type = 'text') {
  const wrap = document.createElement('label');
  wrap.className = 'field';

  const text = document.createElement('span');
  text.textContent = label;

  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;

  wrap.append(text, input);
  return { wrap, input };
}

function addBookmark() {
  const t = activeTab();
  if (!t || !t.url || t.url.startsWith('about:')) {
    toast('ブックマークできるページがありません');
    return;
  }

  const bookmarks = JSON.parse(localStorage.getItem('strya-bookmarks') || '[]');
  if (bookmarks.some(b => b.url === t.url)) {
    toast('すでに登録されています');
    return;
  }

  bookmarks.unshift({ title: t.title, url: t.url });
  localStorage.setItem('strya-bookmarks', JSON.stringify(bookmarks));
  toast('ブックマークに追加しました');
}

function renderStartPage() {
  const root = $('startpage');
  if (!root) return;

  const t = activeTab();
  const isWebTab = t && (t.mode === 'web' || (t.url && t.url.startsWith('http')));
  const showStart = !isSettings && !isMenuWindow && !isWebTab;

  root.innerHTML = '';
  root.classList.toggle('visible', !!showStart);
  if (!showStart) return;

  const box = document.createElement('div');
  box.className = 'start-content';

  const logo = document.createElement('div');
  logo.className = 'start-logo';
  logo.textContent = 'Strya';

  const search = document.createElement('input');
  search.className = 'start-search';
  search.placeholder = '検索またはURLを入力';
  search.onkeydown = e => {
    if (e.key === 'Enter') {
      api.navigate(searchURL(search.value));
      setPanel(null);
    }
  };

  const go = document.createElement('button');
  go.className = 'primary';
  go.textContent = '検索';
  go.onclick = () => {
    api.navigate(searchURL(search.value));
    setPanel(null);
  };

  box.append(logo, search, go);
  root.append(box);
}

function setupBrowser() {
  $('go').onclick = () => api.navigate(searchURL($('address').value));
  $('address').onkeydown = e => {
    if (e.key === 'Enter') api.navigate(searchURL($('address').value));
  };

  $('back').onclick = () => api.action('back');
  $('forward').onclick = () => api.action('forward');
  $('reload').onclick = () => {
    const t = activeTab();
    if (t?.loading) api.action('stop');
    else api.action('reload');
  };

  $('home').onclick = () => {
    api.action('home');
    setPanel('home');
  };

  $('newTab').onclick = () => api.newTab();
  $('bookmark').onclick = addBookmark;

  // Menu opens as an independent BrowserWindow without hiding WebContentsView.
  $('menu').onclick = () => api.openMenu();

  $('findToggle').onclick = () => $('findbar').classList.toggle('open');
  $('findInput').oninput = () => api.find($('findInput').value);
  $('findInput').onkeydown = e => {
    if (e.key === 'Escape') {
      $('findbar').classList.remove('open');
      api.stopFind();
    }
  };
  $('findClose').onclick = () => {
    $('findbar').classList.remove('open');
    api.stopFind();
  };

  $('sidebarToggle').onclick = async () => {
    sidebarVisible = !sidebarVisible;
    await api.sidebar(sidebarVisible);
  };

  document.querySelectorAll('[data-panel]').forEach(btn => {
    btn.onclick = () => setPanel(btn.dataset.panel);
  });

  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.onclick = () => api.openTool(btn.dataset.tool);
  });

  $('winMin').onclick = () => api.windowControl('minimize');
  $('winMax').onclick = () => api.windowControl('maximize');
  $('winClose').onclick = () => api.windowControl('close');
}

function setupMenuWindow() {
  document.querySelectorAll('[data-menu-action]').forEach(button => {
    button.onclick = () => api.menuAction(button.dataset.menuAction);
  });

  $('menuWindowClose').onclick = () => api.windowControl('close');
}

function setupSettings() {
  document.querySelectorAll('[data-settings]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-settings]').forEach(b => b.classList.remove('selected'));
      document.querySelectorAll('.settings-page').forEach(p => p.classList.remove('active'));
      btn.classList.add('selected');
      $(`settings-${btn.dataset.settings}`)?.classList.add('active');
    };
  });

  $('settingsMin').onclick = () => api.windowControl('minimize');
  $('settingsMax').onclick = () => api.windowControl('maximize');
  $('settingsClose').onclick = () => api.windowControl('close');

  $('settingHome').onchange = () => localStorage.setItem('strya-home', $('settingHome').value);
  $('settingSearch').onchange = () => localStorage.setItem('strya-search', $('settingSearch').value);

  $('themeSelect').onchange = () => {
    document.documentElement.dataset.theme = $('themeSelect').value;
    localStorage.setItem('strya-theme', $('themeSelect').value);
  };

  $('accentSelect').oninput = () => {
    document.documentElement.style.setProperty('--accent', $('accentSelect').value);
    localStorage.setItem('strya-accent', $('accentSelect').value);
  };

  $('cornerSelect').oninput = () => {
    document.documentElement.style.setProperty('--corner', $('cornerSelect').value + 'px');
    localStorage.setItem('strya-corner', $('cornerSelect').value);
  };

  $('sidebarWidth').oninput = () => {
    document.documentElement.style.setProperty('--sidebar-width', $('sidebarWidth').value + 'px');
    localStorage.setItem('strya-sidebar-width', $('sidebarWidth').value);
  };

  $('clearCookies').onclick = async () => {
    await api.cookieClear();
    toast('Cookieを削除しました');
  };
  $('clearCache').onclick = async () => {
    await api.eraseData({ cache: true });
    toast('キャッシュを削除しました');
  };
  $('clearHistory').onclick = async () => {
    await api.historyClear();
    toast('履歴を削除しました');
  };
  $('clearPass').onclick = async () => {
    await api.eraseData({ pass: true });
    toast('PassMenuを削除しました');
  };

  $('eraseAll').onclick = async () => {
    await api.eraseData({
      cookies: $('eraseCookies').checked,
      cache: $('eraseCache').checked,
      storage: $('eraseStorage').checked,
      history: $('eraseHistory').checked,
      pass: $('erasePass').checked
    });
    toast('選択したデータを削除しました');
  };

  $('openCookies').onclick = () => api.openTool('cookies');
  $('openPass').onclick = () => api.openTool('passmenu');
  $('openDownloads').onclick = () => api.openTool('downloads');
  $('openDevtools').onclick = () => api.action('devtools');
  $('settingNewTab').onclick = () => api.newTab('about:blank', false);
}

function applySavedSettings() {
  const theme = localStorage.getItem('strya-theme') || 'light';
  const accent = localStorage.getItem('strya-accent') || '#6750A4';
  const corner = localStorage.getItem('strya-corner') || '20';
  const width = localStorage.getItem('strya-sidebar-width') || '210';

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--corner', corner + 'px');
  document.documentElement.style.setProperty('--sidebar-width', width + 'px');

  if ($('themeSelect')) $('themeSelect').value = theme;
  if ($('accentSelect')) $('accentSelect').value = accent;
  if ($('cornerSelect')) $('cornerSelect').value = corner;
  if ($('sidebarWidth')) $('sidebarWidth').value = width;

  if ($('settingHome')) $('settingHome').value = localStorage.getItem('strya-home') || 'about:blank';
  if ($('settingSearch')) $('settingSearch').value = localStorage.getItem('strya-search') || 'google';
}

function init() {
  applySavedSettings();

  if (isMenuWindow) {
    $('browserUI')?.classList.add('hidden');
    $('settingsUI')?.classList.add('hidden');
    $('menuWindowUI')?.classList.remove('hidden');
    setupMenuWindow();
    return;
  }

  if (isSettings) {
    $('browserUI')?.classList.add('hidden');
    $('menuWindowUI')?.classList.add('hidden');
    $('settingsUI')?.classList.remove('hidden');
    setupSettings();
    return;
  }

  $('menuWindowUI')?.classList.add('hidden');
  $('settingsUI')?.classList.add('hidden');
  $('browserUI')?.classList.remove('hidden');
  setupBrowser();

  api.on('tabs:update', data => {
    tabs = data.tabs || [];
    activeId = data.activeId;
    renderTabs();
    renderStartPage();
  });

  api.on('page:update', renderPage);
  api.on('panel:update', name => {
    currentPanel = name;
    renderPanel();
  });

  api.on('sidebar:update', value => {
    sidebarVisible = !!value;
    $('sidebar').classList.toggle('hidden', !sidebarVisible);
  });

  api.on('window:max', value => {
    $('winMax').textContent = value ? '❐' : '□';
  });

  api.on('toast', toast);

  api.on('download:add', d => {
    downloads.unshift(d);
    renderPanel();
  });

  api.on('download:progress', d => {
    const item = downloads.find(x => x.id === d.id);
    if (item) Object.assign(item, d);
    renderPanel();
  });

  api.on('download:finish', d => {
    const item = downloads.find(x => x.id === d.id);
    if (item) Object.assign(item, d);
    renderPanel();
  });

  api.on('history:clear', () => renderPanel());

  api.on('focus-address', () => {
    $('address').focus();
    $('address').select();
  });

  api.on('focus-find', () => {
    $('findbar').classList.add('open');
    $('findInput').focus();
  });

  api.state().then(state => {
    if (!state) return;
    tabs = state.tabs || [];
    activeId = state.activeId;
    currentPanel = state.panel || null;
    sidebarVisible = !!state.sidebarVisible;
    $('sidebar').classList.toggle('hidden', !sidebarVisible);
    renderTabs();
    renderStartPage();
    renderPanel();
  });

  api.downloads().then(data => {
    downloads = data || [];
    renderPanel();
  });
}

init();