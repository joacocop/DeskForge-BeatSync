const { app, BrowserWindow, Menu, Tray, Notification, dialog, ipcMain, nativeImage, globalShortcut } = require('electron');
const { shell } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;
let tray;
let isQuitting = false;
let currentNotePath = null;
let spotifyAccessToken = null;
let spotifyRefreshToken = null;
let spotifyTokenExpiresAt = 0;
let spotifyClientId = null;
let spotifyAuthServer = null;

function saveSpotifyTokens(data) {
  spotifyAccessToken = data.access_token;
  spotifyRefreshToken = data.refresh_token || spotifyRefreshToken;
  spotifyTokenExpiresAt = Date.now() + Math.max(0, Number(data.expires_in || 3600) - 30) * 1000;
}

async function refreshSpotifyAccessToken() {
  if (!spotifyRefreshToken || !spotifyClientId) throw new Error('Volvé a conectar tu cuenta de Spotify.');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: spotifyRefreshToken,
      client_id: spotifyClientId,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    spotifyAccessToken = null;
    spotifyRefreshToken = null;
    spotifyTokenExpiresAt = 0;
    throw new Error(data.error_description || 'La sesión de Spotify venció. Volvé a conectar tu cuenta.');
  }
  saveSpotifyTokens(data);
  return spotifyAccessToken;
}

async function getSpotifyAccessToken() {
  if (!spotifyAccessToken) throw new Error('Conectá tu cuenta de Spotify para buscar canciones.');
  if (Date.now() >= spotifyTokenExpiresAt) return refreshSpotifyAccessToken();
  return spotifyAccessToken;
}

function mapSpotifyTracks(data) {
  return (data.tracks?.items ?? []).map((track) => ({
    id: track.id,
    title: track.name,
    artist: (track.artists ?? []).map((artist) => artist.name).join(', '),
    album: track.album?.name ?? 'Álbum desconocido',
    artwork: track.album?.images?.at(-1)?.url ?? '',
    duration: track.duration_ms,
    url: track.external_urls?.spotify ?? '',
  }));
}

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

function registerGlobalShortcuts() {
  const shortcuts = [
    { accelerator: 'CommandOrControl+Shift+Space', action: 'toggle-playback' },
    { accelerator: 'CommandOrControl+Shift+P', action: 'toggle-pomodoro' },
  ];

  shortcuts.forEach(({ accelerator, action }) => {
    const registered = globalShortcut.register(accelerator, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (action === 'toggle-pomodoro') {
        mainWindow.show();
        mainWindow.focus();
      }
      mainWindow.webContents.send('shortcut:action', action);
    });
    if (!registered) console.warn(`No se pudo registrar el atajo global ${accelerator}.`);
  });
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

  ipcMain.handle('spotify:authorize', async (_event, rawClientId) => {
    const clientId = String(rawClientId ?? '').trim();
    if (!/^[a-zA-Z0-9]{20,40}$/.test(clientId)) throw new Error('Ingresá un Client ID válido de Spotify.');
    if (spotifyAuthServer?.listening) {
      await new Promise((resolve) => spotifyAuthServer.close(resolve));
      spotifyAuthServer = null;
    }

    spotifyClientId = clientId;
    spotifyAccessToken = null;
    spotifyRefreshToken = null;
    spotifyTokenExpiresAt = 0;
    const redirectUri = 'http://127.0.0.1:43821/callback';
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const expectedState = crypto.randomBytes(18).toString('hex');
    const authorizeUrl = new URL('https://accounts.spotify.com/authorize');
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: expectedState,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    }).toString();

    return new Promise((resolve, reject) => {
      let settled = false;
      const server = http.createServer(async (request, response) => {
        let callbackUrl;
        try { callbackUrl = new URL(request.url, redirectUri); }
        catch { response.writeHead(400).end('Invalid callback'); return; }
        if (callbackUrl.pathname !== '/callback') {
          response.writeHead(404).end('Not found');
          return;
        }
        if (callbackUrl.searchParams.get('state') !== expectedState) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No se pudo validar el inicio de sesión.');
          finish(new Error('La respuesta de Spotify no coincidió con la solicitud.'));
          return;
        }
        const authorizationError = callbackUrl.searchParams.get('error');
        const code = callbackUrl.searchParams.get('code');
        if (authorizationError || !code) {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<meta charset="utf-8"><title>Spotify</title><h2>Inicio de sesión cancelado</h2><p>Podés cerrar esta pestaña y volver a DeskForge.</p>');
          finish(new Error(authorizationError === 'access_denied' ? 'Cancelaste la conexión con Spotify.' : 'Spotify no pudo autorizar la conexión.'));
          return;
        }
        try {
          const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
              client_id: clientId,
              code_verifier: verifier,
            }),
          });
          const tokenData = await tokenResponse.json().catch(() => ({}));
          if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || 'Spotify no pudo completar la autorización.');
          saveSpotifyTokens(tokenData);
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<meta charset="utf-8"><title>Spotify conectado</title><h2>Spotify conectado</h2><p>Ya podés cerrar esta pestaña y volver a DeskForge.</p>');
          finish(null, { connected: true });
        } catch (error) {
          response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end('<meta charset="utf-8"><title>Spotify</title><h2>No se pudo conectar</h2><p>Volvé a DeskForge e intentá de nuevo.</p>');
          finish(error);
        }
      });

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (server.listening) server.close();
        if (spotifyAuthServer === server) spotifyAuthServer = null;
        if (error) reject(error);
        else resolve(value);
      };
      const timeout = setTimeout(() => finish(new Error('Se agotó el tiempo para iniciar sesión en Spotify.')), 120000);
      spotifyAuthServer = server;
      server.once('error', (error) => finish(error.code === 'EADDRINUSE'
        ? new Error('El puerto 43821 está ocupado. Cerrá otra instancia de DeskForge e intentá de nuevo.')
        : error));
      server.listen(43821, '127.0.0.1', () => {
        shell.openExternal(authorizeUrl.toString()).catch((error) => finish(error));
      });
    });
  });

  ipcMain.handle('spotify:search', async (_event, rawQuery) => {
    const query = String(rawQuery ?? '').trim().slice(0, 100);
    if (!query) return [];
    const accessToken = await getSpotifyAccessToken();
    const url = new URL('https://api.spotify.com/v1/search');
    url.search = new URLSearchParams({ q: query, type: 'track', limit: '10' }).toString();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && spotifyRefreshToken) {
      const renewedToken = await refreshSpotifyAccessToken();
      const retry = await fetch(url, { headers: { Authorization: `Bearer ${renewedToken}` } });
      const retryData = await retry.json().catch(() => ({}));
      if (!retry.ok) throw new Error(retryData.error?.message || 'Spotify no pudo completar la búsqueda.');
      return mapSpotifyTracks(retryData);
    }
    if (response.status === 429) throw new Error('Spotify limitó temporalmente las búsquedas. Esperá un momento e intentá de nuevo.');
    if (!response.ok) throw new Error(data.error?.message || 'Spotify no pudo completar la búsqueda.');
    return mapSpotifyTracks(data);
  });

  ipcMain.handle('spotify:open-track', async (_event, rawUrl) => {
    let url;
    try { url = new URL(String(rawUrl)); } catch { return false; }
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || !/^\/track\/[A-Za-z0-9]+\/?$/u.test(url.pathname)) return false;
    await shell.openExternal(url.toString());
    return true;
  });

  ipcMain.on('notes:new', () => { currentNotePath = null; });
  ipcMain.on('notifications:show', (_event, payload) => {
    if (Notification.isSupported()) {
      new Notification({
        title: String(payload?.title ?? 'DeskForge'),
        body: String(payload?.body ?? ''),
      }).show();
    }
  });
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:hide', () => mainWindow?.hide());
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.deskforge.beatsync');
  registerMenu();
  registerIpc();
  createWindow();
  createTray();
  registerGlobalShortcuts();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else { mainWindow?.show(); mainWindow?.focus(); }
});
app.on('before-quit', () => { isQuitting = true; globalShortcut.unregisterAll(); });
