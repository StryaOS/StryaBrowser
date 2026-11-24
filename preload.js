'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

const allowedEvents = [
  'tabs:update', 'page:update', 'panel:update', 'sidebar:update',
  'window:max', 'toast', 'download:add', 'download:progress',
  'download:finish', 'history:clear', 'focus-address', 'focus-find'
];

contextBridge.exposeInMainWorld('strya', {
  newTab: (url, priv = false) => ipcRenderer.invoke('tabs:new', url, priv),
  activateTab: id => ipcRenderer.invoke('tabs:activate', id),
  closeTab: id => ipcRenderer.invoke('tabs:close', id),
  pinTab: id => ipcRenderer.invoke('tabs:pin', id),
  duplicateTab: id => ipcRenderer.invoke('tabs:duplicate', id),
  state: () => ipcRenderer.invoke('tabs:state'),

  navigate: url => ipcRenderer.invoke('browser:navigate', url),
  action: name => ipcRenderer.invoke('browser:action', name),
  zoom: value => ipcRenderer.invoke('browser:zoom', value),
  find: text => ipcRenderer.invoke('browser:find', text),
  stopFind: () => ipcRenderer.invoke('browser:find-stop'),

  panel: name => ipcRenderer.invoke('browser:panel', name),
  panelClose: () => ipcRenderer.invoke('browser:panel-close'),

  sidebar: value => ipcRenderer.invoke('sidebar:set', value),
  openTool: name => ipcRenderer.invoke('tool:open', name),

  // Separate menu window
  openMenu: () => ipcRenderer.invoke('menu:open'),
  menuAction: action => ipcRenderer.invoke('menu:action', action),

  cookieList: () => ipcRenderer.invoke('cookies:list'),
  cookieRemove: (url, name) => ipcRenderer.invoke('cookies:remove', url, name),
  cookieClear: () => ipcRenderer.invoke('cookies:clear'),

  passList: () => ipcRenderer.invoke('pass:list'),
  passAdd: data => ipcRenderer.invoke('pass:add', data),
  passReveal: id => ipcRenderer.invoke('pass:reveal', id),
  passDelete: id => ipcRenderer.invoke('pass:delete', id),

  downloads: () => ipcRenderer.invoke('downloads:list'),
  permissions: () => ipcRenderer.invoke('browser:permissions'),
  history: () => ipcRenderer.invoke('history:list'),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  eraseData: options => ipcRenderer.invoke('data:erase', options),

  windowControl: action => ipcRenderer.invoke('window:control', action),
  isMaximized: () => ipcRenderer.invoke('window:is-max'),

  on(channel, callback) {
    if (!allowedEvents.includes(channel) || typeof callback !== 'function') return;

    const handler = (_, data) => callback(data);
    ipcRenderer.on(channel, handler);
    listeners.set(callback, { channel, handler });
  },

  off(callback) {
    const item = listeners.get(callback);
    if (!item) return;

    ipcRenderer.removeListener(item.channel, item.handler);
    listeners.delete(callback);
  }
});