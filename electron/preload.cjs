const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskforge', {
  openNote: () => ipcRenderer.invoke('notes:open'),
  saveNote: (content) => ipcRenderer.invoke('notes:save', content),
  newNote: () => ipcRenderer.send('notes:new'),
  readQuickNote: () => ipcRenderer.invoke('notes:read-quick'),
  writeQuickNote: (content) => ipcRenderer.invoke('notes:write-quick', content),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  hideWindow: () => ipcRenderer.send('window:hide'),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});
