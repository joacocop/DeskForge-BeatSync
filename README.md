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
- E9: atajos globales `Ctrl+Shift+Space` para reproducir/pausar y `Ctrl+Shift+P` para iniciar/pausar Pomodoro.
- E10: instalador de Windows x64 generado con electron-builder y NSIS.
- E11: ecualizador de bajos, medios y agudos aplicado al reproductor local mediante nodos BiquadFilter de Web Audio API.
- E12: temas claro y oscuro, con detección del tema del sistema y persistencia de la preferencia elegida.

## Atajos globales

- `Ctrl+Shift+Space`: alternar reproducción/pausa de la pista local.
- `Ctrl+Shift+P`: mostrar la app, abrir Pomodoro e iniciar/pausar el temporizador.

## Instalador de Windows

En Windows, ejecutá `npm run package:win`. El instalador `.exe` se genera en `dist-installer/e9-e10/`; la carpeta está excluida de Git para no subir binarios grandes.

El ecualizador ofrece controles de -12 a +12 dB para bajos, medios y agudos; sus valores se guardan localmente. La preferencia de apariencia se cambia desde el selector de tema de la barra superior y puede configurarse como sistema, claro u oscuro.

El reproductor usa archivos locales seleccionados por el usuario. Las playlists y su orden se guardan localmente; al abrir la app de nuevo hay que volver a elegir la carpeta de música para recuperar acceso a esos archivos. Spotify permite buscar y mostrar canciones, pero no reproduce su audio dentro de la aplicación.

Para Spotify, configurá como Redirect URI exacto `http://127.0.0.1:43821/callback` y pegá el Client ID en la vista de búsqueda. No se solicita ni se almacena el Client Secret.

## Seguridad

La ventana usa `contextIsolation: true`, `nodeIntegration: false` y un preload con operaciones IPC explícitas.
