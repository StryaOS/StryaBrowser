const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('strya', {
  newTab: url => ipcRenderer.invoke('tab:new', url), closeTab: id => ipcRenderer.invoke('tab:close', id), activateTab: id => ipcRenderer.invoke('tab:activate', id),
  navigate: url => ipcRenderer.invoke('browser:navigate', url), action: name => ipcRenderer.invoke('browser:action', name), zoom: value => ipcRenderer.invoke('browser:zoom', value), find: text => ipcRenderer.invoke('browser:find', text), stopFind: () => ipcRenderer.invoke('browser:stop-find'), getState: () => ipcRenderer.invoke('browser:state'),
  getCookies: () => ipcRenderer.invoke('cookies:list'), removeCookie: (url, name) => ipcRenderer.invoke('cookies:remove', url, name), updateCookie: cookie => ipcRenderer.invoke('cookies:update', cookie),
  passmenu: { list: () => ipcRenderer.invoke('passmenu:list'), add: entry => ipcRenderer.invoke('passmenu:add', entry), reveal: id => ipcRenderer.invoke('passmenu:reveal', id), delete: id => ipcRenderer.invoke('passmenu:delete', id) },
  openTool: type => ipcRenderer.invoke('tool:open', type), controlWindow: action => ipcRenderer.invoke('window:control', action), isMaximized: () => ipcRenderer.invoke('window:is-maximized'), erase: selections => ipcRenderer.invoke('erase:execute', selections),
  on(channel, callback) { const allowed = ['tabs:updated','page:updated','page:error','download:started','download:progress','download:done','erase:settings-cleared']; if (!allowed.includes(channel)) return () => {}; const listener = (_, data) => callback(data); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); }
});
