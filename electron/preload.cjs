const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskforge', {
  openNote: () => ipcRenderer.invoke('notes:open'),
  saveNote: (content) => ipcRenderer.invoke('notes:save', content),
  newNote: () => ipcRenderer.send('notes:new'),
  readQuickNote: () => ipcRenderer.invoke('notes:read-quick'),
  writeQuickNote: (content) => ipcRenderer.invoke('notes:write-quick', content),
  spotifyAuthorize: (clientId) => ipcRenderer.invoke('spotify:authorize', clientId),
  spotifySearch: (query) => ipcRenderer.invoke('spotify:search', query),
  openSpotifyTrack: (url) => ipcRenderer.invoke('spotify:open-track', url),
  notify: (title, body) => ipcRenderer.send('notifications:show', { title, body }),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  hideWindow: () => ipcRenderer.send('window:hide'),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});
