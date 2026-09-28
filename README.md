# DeskForge + BeatSync

Proyecto de escritorio construido con Electron, Vite y JavaScript. Se desarrolla en pares de requisitos para mantener el historial de commits alineado con la consigna.

## Requisitos

- Windows 10/11 de 64 bits.
- Node.js 20.19+ o 22.12+ y npm.

## Ejecutar en desarrollo

```powershell
npm install
npm run dev
```

## Progreso por requisitos

- E1: ventana Electron redimensionable, menú nativo y bandeja del sistema.
- E2: bloc de notas con apertura/guardado por diálogos y autoguardado local.
- E3: temporizador Pomodoro con sesiones de enfoque, descansos cortos/largos y notificaciones de escritorio.
- E4: reproductor de archivos MP3, OGG y WAV con cola, reproducción/pausa, anterior/siguiente, progreso, volumen, aleatorio y repetición.
- E5: selección de una carpeta local o varios archivos; la cola ordena y lista las pistas MP3, OGG y WAV para reproducirlas con Howler.js.
- E6: visualizador en Canvas conectado al audio mediante Web Audio API, con modos de barras de frecuencia y forma de onda.
- E7: playlists locales que se pueden crear, renombrar, eliminar y reordenar arrastrando pistas entre playlists o dentro de una cola.
- E8: búsqueda de canciones en Spotify Web API con OAuth Authorization Code + PKCE y acceso a cada resultado en Spotify.

El reproductor usa archivos locales seleccionados por el usuario. Las playlists y su orden se guardan localmente; al abrir la app de nuevo hay que volver a elegir la carpeta de música para recuperar acceso a esos archivos. Spotify permite buscar y mostrar canciones, pero no reproduce su audio dentro de la aplicación.

Para Spotify, configurá como Redirect URI exacto `http://127.0.0.1:43821/callback` y pegá el Client ID en la vista de búsqueda. No se solicita ni se almacena el Client Secret.

## Seguridad

La ventana usa `contextIsolation: true`, `nodeIntegration: false` y un preload con operaciones IPC explícitas.
