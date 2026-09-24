const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;
let tray;
let isQuitting = false;
let currentNotePath = null;

function createTray() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="17" fill="#cbff64"/><path d="M20 41V23h6l6 10 6-10h6v18h-6V32l-6 9-6-9v9z" fill="#151713"/></svg>';
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  tray = new Tray(icon);
  tray.setToolTip('DeskForge + BeatSync');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar DeskForge', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Salir', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: 'DeskForge + BeatSync',
    backgroundColor: '#101114',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (app.isPackaged) mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  else mainWindow.loadURL('http://127.0.0.1:5173');

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Archivo', submenu: [
      { label: 'Nueva nota', accelerator: 'CmdOrCtrl+N', click: () => { currentNotePath = null; mainWindow?.webContents.send('menu:action', 'new-note'); } },
      { label: 'Abrir nota…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:action', 'open-note') },
      { label: 'Guardar nota…', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:action', 'save-note') },
      { type: 'separator' },
      { label: 'Salir', role: 'quit' },
    ] },
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Ventana', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ]));
}

function registerIpc() {
  ipcMain.handle('notes:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Abrir una nota',
      properties: ['openFile'],
      filters: [{ name: 'Archivos de texto', extensions: ['txt', 'md'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    currentNotePath = result.filePaths[0];
    return { name: path.basename(currentNotePath), content: await fs.readFile(currentNotePath, 'utf8') };
  });

  ipcMain.handle('notes:save', async (_event, rawContent) => {
    if (!currentNotePath) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar nota',
        defaultPath: 'nota.txt',
        filters: [{ name: 'Archivos de texto', extensions: ['txt', 'md'] }],
      });
      if (result.canceled || !result.filePath) return null;
      currentNotePath = result.filePath;
    }
    await fs.writeFile(currentNotePath, String(rawContent ?? ''), 'utf8');
    return { name: path.basename(currentNotePath) };
  });

  ipcMain.handle('notes:read-quick', async () => {
    try { return await fs.readFile(path.join(app.getPath('userData'), 'quick-note.txt'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  });
  ipcMain.handle('notes:write-quick', async (_event, rawContent) => {
    await fs.writeFile(path.join(app.getPath('userData'), 'quick-note.txt'), String(rawContent ?? ''), 'utf8');
    return true;
  });
  ipcMain.on('notes:new', () => { currentNotePath = null; });
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:hide', () => mainWindow?.hide());
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.deskforge.beatsync');
  registerMenu();
  registerIpc();
  createWindow();
  createTray();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else { mainWindow?.show(); mainWindow?.focus(); }
});
app.on('before-quit', () => { isQuitting = true; });
