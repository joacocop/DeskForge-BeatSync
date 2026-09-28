import './styles.css';
import { Howl, Howler } from 'howler';

const $ = (selector) => document.querySelector(selector);
const defaultPlaylist = () => ({ id: 'playlist-main', name: 'Mi música', trackIds: [] });

function readLocalValue(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readPlaylists() {
  const saved = readLocalValue('deskforge-playlists', [defaultPlaylist()]);
  const valid = Array.isArray(saved)
    ? saved.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.trackIds))
      .map((item) => ({ id: item.id, name: item.name.slice(0, 40), trackIds: [...new Set(item.trackIds.filter((id) => typeof id === 'string'))] }))
    : [];
  return valid.length ? valid : [defaultPlaylist()];
}

function readLibrary() {
  const saved = readLocalValue('deskforge-library', []);
  return Array.isArray(saved)
    ? saved.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
      .map((item) => ({ ...item, file: null, url: null, howl: null, unavailable: true }))
    : [];
}

let notePathName = null;
let saveTimer;
const timerModes = {
  focus: { label: 'ENFOQUE', seconds: 25 * 60 },
  shortBreak: { label: 'DESCANSO', seconds: 5 * 60 },
  longBreak: { label: 'DESCANSO LARGO', seconds: 15 * 60 },
};
let timerMode = 'focus';
let timerRemaining = timerModes.focus.seconds;
let completedFocusSessions = 0;
let timerInterval = null;
let tracks = readLibrary();
let playlists = readPlaylists();
let activePlaylistId = readLocalValue('deskforge-active-playlist', playlists[0].id);
if (!playlists.some((playlist) => playlist.id === activePlaylistId)) activePlaylistId = playlists[0].id;
let currentTrackIndex = -1;
let shuffleEnabled = false;
let repeatMode = 0;
let playerInterval = null;
let volumeLevel = 0.75;
let audioAnalyser = null;
let frequencySamples = null;
let waveformSamples = null;
let visualizerMode = 'bars';
let visualizerFrame = null;
let spotifyConnected = false;

function getActivePlaylist() {
  return playlists.find((playlist) => playlist.id === activePlaylistId) ?? playlists[0];
}

function getQueueTracks() {
  const playlist = getActivePlaylist();
  return playlist.trackIds.map((id) => tracks.find((track) => track.id === id)).filter(Boolean);
}

function persistMusic() {
  try {
    localStorage.setItem('deskforge-playlists', JSON.stringify(playlists));
    localStorage.setItem('deskforge-active-playlist', JSON.stringify(activePlaylistId));
    localStorage.setItem('deskforge-library', JSON.stringify(tracks.map(({ id, name, location, format, duration, size, lastModified }) => ({ id, name, location, format, duration, size, lastModified }))));
  } catch {
    showToast('No se pudieron guardar las playlists en este dispositivo.');
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2400);
}

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function updateCount(text) {
  const count = wordCount(text);
  const label = `${count} ${count === 1 ? 'palabra' : 'palabras'}`;
  $('#quick-word-count').textContent = label;
  $('#editor-word-count').textContent = label;
}

function selectView(view) {
  document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active-view', element.id === `view-${view}`));
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const labels = { home: 'INICIO', notes: 'BLOC DE NOTAS', focus: 'POMODORO', player: 'REPRODUCTOR', spotify: 'SPOTIFY' };
  $('#breadcrumb-current').textContent = labels[view] ?? 'INICIO';
}

function switchPlaylist(playlistId) {
  if (playlistId === activePlaylistId) return;
  getQueueTracks()[currentTrackIndex]?.howl?.stop();
  stopPlayerProgress();
  activePlaylistId = playlistId;
  currentTrackIndex = -1;
  persistMusic();
  renderMusic();
}

function createPlaylist() {
  const name = window.prompt('¿Cómo querés llamar a la playlist?');
  if (!name?.trim()) return;
  getQueueTracks()[currentTrackIndex]?.howl?.stop();
  stopPlayerProgress();
  const playlist = {
    id: `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim().slice(0, 40),
    trackIds: [],
  };
  playlists.push(playlist);
  activePlaylistId = playlist.id;
  currentTrackIndex = -1;
  persistMusic();
  renderMusic();
  showToast(`Playlist “${playlist.name}” creada.`);
}

function renamePlaylist(playlistId) {
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  const name = window.prompt('Nuevo nombre para la playlist:', playlist.name);
  if (!name?.trim()) return;
  playlist.name = name.trim().slice(0, 40);
  persistMusic();
  renderMusic();
}

function deletePlaylist(playlistId) {
  if (playlists.length === 1) {
    showToast('Dejá al menos una playlist en tu biblioteca.');
    return;
  }
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist || !window.confirm(`¿Eliminar la playlist “${playlist.name}”?`)) return;
  if (playlistId === activePlaylistId) {
    getQueueTracks()[currentTrackIndex]?.howl?.stop();
    stopPlayerProgress();
    currentTrackIndex = -1;
  }
  playlists = playlists.filter((item) => item.id !== playlistId);
  if (activePlaylistId === playlistId) activePlaylistId = playlists[0].id;
  persistMusic();
  renderMusic();
}

function addTrackToPlaylist(playlistId, trackId) {
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist || !tracks.some((track) => track.id === trackId)) return;
  if (playlist.trackIds.includes(trackId)) {
    showToast(`Esa pista ya está en “${playlist.name}”.`);
    return;
  }
  playlist.trackIds.push(trackId);
  persistMusic();
  renderMusic();
  showToast(`Pista añadida a “${playlist.name}”.`);
}

function removeTrackFromPlaylist(playlistId, trackId) {
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  const currentId = getQueueTracks()[currentTrackIndex]?.id;
  if (playlistId === activePlaylistId && currentId === trackId) {
    getQueueTracks()[currentTrackIndex]?.howl?.stop();
    stopPlayerProgress();
    currentTrackIndex = -1;
  }
  playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
  if (currentId && playlistId === activePlaylistId && currentId !== trackId) {
    currentTrackIndex = getQueueTracks().findIndex((track) => track.id === currentId);
  }
  persistMusic();
  renderMusic();
}

function renderPlaylistNav() {
  const container = $('#playlist-nav');
  container.replaceChildren();
  playlists.forEach((playlist) => {
    const entry = document.createElement('div');
    entry.className = `playlist-entry${playlist.id === activePlaylistId ? ' active' : ''}`;
    entry.addEventListener('dragover', (event) => {
      event.preventDefault();
      entry.classList.add('drag-target');
      event.dataTransfer.dropEffect = 'copy';
    });
    entry.addEventListener('dragleave', (event) => {
      if (!entry.contains(event.relatedTarget)) entry.classList.remove('drag-target');
    });
    entry.addEventListener('drop', (event) => {
      event.preventDefault();
      entry.classList.remove('drag-target');
      const trackId = event.dataTransfer.getData('text/plain');
      if (trackId) addTrackToPlaylist(playlist.id, trackId);
    });

    const select = document.createElement('button');
    select.className = 'nav-item playlist-nav-item';
    select.type = 'button';
    select.classList.toggle('active', playlist.id === activePlaylistId);
    select.innerHTML = '<span class="nav-icon">♫</span><span class="playlist-label"></span><span class="playlist-count"></span>';
    select.querySelector('.playlist-label').textContent = playlist.name;
    select.querySelector('.playlist-count').textContent = String(playlist.trackIds.length);
    select.title = 'Abrir playlist';
    select.addEventListener('click', () => switchPlaylist(playlist.id));

    const rename = document.createElement('button');
    rename.className = 'playlist-action';
    rename.type = 'button';
    rename.textContent = '✎';
    rename.title = `Renombrar ${playlist.name}`;
    rename.setAttribute('aria-label', `Renombrar ${playlist.name}`);
    rename.addEventListener('click', () => renamePlaylist(playlist.id));

    const remove = document.createElement('button');
    remove.className = 'playlist-action delete';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Eliminar ${playlist.name}`;
    remove.setAttribute('aria-label', `Eliminar ${playlist.name}`);
    remove.addEventListener('click', () => deletePlaylist(playlist.id));
    entry.append(select, rename, remove);
    container.append(entry);
  });
}

function renderMusic() {
  renderPlaylistNav();
  paintTrackList();
  const queue = getQueueTracks();
  const current = queue[currentTrackIndex];
  if (!current) {
    $('#track-title').textContent = 'Elegí una pista';
    $('#track-artist').textContent = 'Cargá una carpeta o elegí archivos de audio.';
    $('#current-time').textContent = '0:00';
    $('#duration').textContent = '0:00';
    $('#seek').value = '0';
    $('#play-toggle').textContent = '▶';
    $('#play-toggle').setAttribute('aria-label', 'Reproducir');
  } else {
    $('#track-title').textContent = current.name;
    $('#track-artist').textContent = current.unavailable
      ? `${current.location || 'Archivo local'} · Volvé a importar la carpeta`
      : current.location || current.file?.type || 'Archivo local';
  }
  $('#shuffle-toggle').classList.toggle('control-active', shuffleEnabled);
  $('#repeat-toggle').classList.toggle('control-active', repeatMode !== 0);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

function paintTimer() {
  const total = timerModes[timerMode].seconds;
  const progress = ((total - timerRemaining) / total) * 100;
  $('#timer-mode').textContent = timerModes[timerMode].label;
  $('#timer-readout').textContent = formatTime(timerRemaining);
  $('#timer-session').textContent = `SESIÓN ${String(Math.min(completedFocusSessions + 1, 99)).padStart(2, '0')}`;
  $('#cycle-caption').textContent = `${completedFocusSessions % 4} de 4 sesiones de hoy`;
  $('#timer-ring').style.setProperty('--timer-progress', `${progress}%`);
  $('#timer-start').innerHTML = timerInterval
    ? 'Pausar <span>Ⅱ</span>'
    : `${timerRemaining === total ? 'Empezar' : 'Continuar'} ${timerMode === 'focus' ? 'enfoque' : 'descanso'} <span>→</span>`;
  $('#timer-status').textContent = timerInterval
    ? 'Sesión en curso'
    : timerRemaining === total ? 'Listo cuando vos estés' : 'Sesión pausada';
  $('#timer-ring').classList.toggle('timer-running', Boolean(timerInterval));
}

function switchTimerMode(mode) {
  timerMode = mode;
  timerRemaining = timerModes[mode].seconds;
  paintTimer();
}

function finishTimer() {
  window.clearInterval(timerInterval);
  timerInterval = null;
  const finishedMode = timerMode;
  if (finishedMode === 'focus') {
    completedFocusSessions += 1;
    const longBreak = completedFocusSessions % 4 === 0;
    switchTimerMode(longBreak ? 'longBreak' : 'shortBreak');
    window.deskforge.notify('Pomodoro terminado', longBreak
      ? 'Completaste cuatro sesiones. Es momento de un descanso largo.'
      : 'Completaste tu sesión de enfoque. Tomate un descanso.');
  } else {
    switchTimerMode('focus');
    window.deskforge.notify('Descanso terminado', 'Tu próxima sesión de enfoque está lista.');
  }
}

function toggleTimer() {
  if (timerInterval) {
    window.clearInterval(timerInterval);
    timerInterval = null;
    paintTimer();
    return;
  }
  timerInterval = window.setInterval(() => {
    timerRemaining = Math.max(0, timerRemaining - 1);
    if (timerRemaining === 0) finishTimer();
    else paintTimer();
  }, 1000);
  paintTimer();
}

function resetTimer() {
  window.clearInterval(timerInterval);
  timerInterval = null;
  timerMode = 'focus';
  timerRemaining = timerModes.focus.seconds;
  completedFocusSessions = 0;
  paintTimer();
}

function releaseTracks() {
  tracks.forEach((track) => {
    track.howl?.unload();
    if (track.url) URL.revokeObjectURL(track.url);
  });
  tracks = [];
  currentTrackIndex = -1;
  stopPlayerProgress();
}

function stopPlayerProgress() {
  window.clearInterval(playerInterval);
  playerInterval = null;
}

function paintTrackList() {
  const list = $('#track-list');
  const playlist = getActivePlaylist();
  const queue = getQueueTracks();
  $('#active-playlist-name').textContent = playlist.name;
  $('#track-count').textContent = `${queue.length} ${queue.length === 1 ? 'pista' : 'pistas'}`;
  list.replaceChildren();
  if (queue.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-library';
    empty.innerHTML = '<div class="empty-icon">♫</div><strong>Esta playlist está vacía</strong><span>Importá música o arrastrá pistas acá.</span><div class="empty-library-actions"><label class="outline-button file-picker-label" for="folder-input">Elegir carpeta</label><label class="outline-button file-picker-label" for="track-input">Elegir archivos</label></div>';
    list.append(empty);
    return;
  }
  queue.forEach((track, index) => {
    const row = document.createElement('div');
    row.className = `track-row${index === currentTrackIndex ? ' current-track' : ''}${track.unavailable ? ' track-unavailable' : ''}`;
    row.draggable = true;
    row.dataset.trackId = track.id;
    row.innerHTML = `<span class="track-number">${index === currentTrackIndex && track.howl?.playing() ? '♫' : String(index + 1).padStart(2, '0')}</span><button class="track-select" type="button"><span class="track-copy"><strong></strong><small></small></span><span class="track-duration">${track.duration ? formatTime(track.duration) : '—:—'}</span></button><button class="track-remove" type="button" title="Quitar de esta playlist">×</button>`;
    row.querySelector('.track-copy strong').textContent = track.name;
    row.querySelector('.track-copy small').textContent = track.unavailable
      ? `${track.location || 'Pista local'} · Volvé a importar la carpeta`
      : track.location || track.file?.type || 'Archivo de audio';
    row.querySelector('.track-remove').setAttribute('aria-label', `Quitar ${track.name} de esta playlist`);
    row.querySelector('.track-select').addEventListener('click', () => {
      if (track.unavailable) showToast('Volvé a elegir la carpeta de música para cargar este archivo.');
      else playTrack(index);
    });
    row.querySelector('.track-remove').addEventListener('click', () => removeTrackFromPlaylist(playlist.id, track.id));
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', track.id);
      event.dataTransfer.effectAllowed = 'copyMove';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const draggedId = event.dataTransfer.getData('text/plain');
      const from = playlist.trackIds.indexOf(draggedId);
      const to = playlist.trackIds.indexOf(track.id);
      if (from < 0 || to < 0 || from === to) return;
      const currentId = queue[currentTrackIndex]?.id;
      const [movedId] = playlist.trackIds.splice(from, 1);
      playlist.trackIds.splice(to, 0, movedId);
      currentTrackIndex = currentId ? getQueueTracks().findIndex((item) => item.id === currentId) : -1;
      persistMusic();
      renderMusic();
    });
    list.append(row);
  });
}

function paintPlayerProgress() {
  const track = getQueueTracks()[currentTrackIndex];
  if (!track?.howl) return;
  const duration = track.howl.duration() || track.duration || 0;
  const position = Number(track.howl.seek()) || 0;
  $('#seek').value = duration ? String(Math.round((position / duration) * 1000)) : '0';
  $('#current-time').textContent = formatTime(position);
  $('#duration').textContent = formatTime(duration);
  $('#play-toggle').textContent = track.howl.playing() ? 'Ⅱ' : '▶';
  $('#play-toggle').setAttribute('aria-label', track.howl.playing() ? 'Pausar' : 'Reproducir');
}

function beginPlayerProgress() {
  stopPlayerProgress();
  playerInterval = window.setInterval(paintPlayerProgress, 350);
}

function ensureAudioAnalyser() {
  if (audioAnalyser) return true;
  if (!Howler.usingWebAudio || !Howler.ctx || !Howler.masterGain) {
    $('#visualizer-status').textContent = 'Web Audio no está disponible en este dispositivo.';
    return false;
  }
  try {
    audioAnalyser = Howler.ctx.createAnalyser();
    audioAnalyser.fftSize = 2048;
    audioAnalyser.smoothingTimeConstant = 0.82;
    frequencySamples = new Uint8Array(audioAnalyser.frequencyBinCount);
    waveformSamples = new Uint8Array(audioAnalyser.fftSize);
    Howler.masterGain.disconnect();
    Howler.masterGain.connect(audioAnalyser);
    audioAnalyser.connect(Howler.ctx.destination);
    $('#visualizer-status').textContent = 'Analizando el sonido en tiempo real.';
    return true;
  } catch {
    audioAnalyser = null;
    $('#visualizer-status').textContent = 'No se pudo iniciar el visualizador de audio.';
    return false;
  }
}

function drawAudioVisualizer() {
  visualizerFrame = window.requestAnimationFrame(drawAudioVisualizer);
  const canvas = $('#audio-visualizer');
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(bounds.width * pixelRatio);
  const pixelHeight = Math.round(bounds.height * pixelRatio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const width = bounds.width;
  const height = bounds.height;
  context.clearRect(0, 0, width, height);
  if (!audioAnalyser || !frequencySamples || !waveformSamples) {
    context.strokeStyle = '#34372f';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    return;
  }

  if (visualizerMode === 'bars') {
    audioAnalyser.getByteFrequencyData(frequencySamples);
    const count = 56;
    const gap = 4;
    const barWidth = (width - gap * (count - 1)) / count;
    const gradient = context.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#8ed5ba');
    gradient.addColorStop(1, '#d1fb73');
    context.fillStyle = gradient;
    for (let index = 0; index < count; index += 1) {
      const first = Math.floor((index / count) ** 2 * frequencySamples.length);
      const last = Math.max(first + 1, Math.floor(((index + 1) / count) ** 2 * frequencySamples.length));
      let sum = 0;
      for (let sample = first; sample < last; sample += 1) sum += frequencySamples[sample];
      const average = sum / (last - first);
      const barHeight = Math.max(2, (average / 255) * (height - 12));
      const x = index * (barWidth + gap);
      context.beginPath();
      context.roundRect(x, height - barHeight, barWidth, barHeight, 3);
      context.fill();
    }
    return;
  }

  audioAnalyser.getByteTimeDomainData(waveformSamples);
  const waveGradient = context.createLinearGradient(0, 0, width, 0);
  waveGradient.addColorStop(0, '#8ed5ba');
  waveGradient.addColorStop(0.5, '#d1fb73');
  waveGradient.addColorStop(1, '#8ed5ba');
  context.beginPath();
  context.lineWidth = 2;
  context.strokeStyle = waveGradient;
  context.shadowColor = '#d1fb7355';
  context.shadowBlur = 10;
  for (let index = 0; index < waveformSamples.length; index += 1) {
    const x = (index / (waveformSamples.length - 1)) * width;
    const y = (waveformSamples[index] / 128) * (height / 2);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.shadowBlur = 0;
}

function setVisualizerMode(mode) {
  visualizerMode = mode;
  $('#visualizer-bars').classList.toggle('active', mode === 'bars');
  $('#visualizer-wave').classList.toggle('active', mode === 'wave');
  $('#visualizer-bars').setAttribute('aria-pressed', String(mode === 'bars'));
  $('#visualizer-wave').setAttribute('aria-pressed', String(mode === 'wave'));
}

function createHowl(track) {
  if (track.howl) return track.howl;
  const extension = track.name.split('.').pop().toLowerCase();
  const howl = new Howl({
    src: [track.url],
    format: [extension],
    html5: false,
    volume: volumeLevel,
    onload: () => {
      track.duration = howl.duration();
      if (getQueueTracks()[currentTrackIndex] === track) paintPlayerProgress();
      paintTrackList();
    },
    onplay: () => {
      if (getQueueTracks()[currentTrackIndex] === track) {
        $('#track-artist').textContent = `${track.location || track.file.type || 'Archivo local'} · Reproduciendo`;
        ensureAudioAnalyser();
        beginPlayerProgress();
        paintPlayerProgress();
        paintTrackList();
      }
    },
    onpause: () => {
      if (getQueueTracks()[currentTrackIndex] === track) {
        stopPlayerProgress();
        paintPlayerProgress();
        paintTrackList();
      }
    },
    onend: () => {
      if (getQueueTracks()[currentTrackIndex] !== track) return;
      if (repeatMode === 2) {
        howl.seek(0);
        howl.play();
      } else if (currentTrackIndex < getQueueTracks().length - 1 || repeatMode === 1 || shuffleEnabled) {
        playNextTrack(true);
      } else {
        stopPlayerProgress();
        paintPlayerProgress();
        paintTrackList();
      }
    },
    onloaderror: () => showToast(`No se pudo cargar ${track.name}.`),
    onplayerror: () => showToast('No se pudo reproducir este archivo de audio.'),
  });
  track.howl = howl;
  return howl;
}

function playTrack(index) {
  const queue = getQueueTracks();
  const track = queue[index];
  if (!track) return;
  if (track.unavailable || !track.url) {
    showToast('Volvé a elegir la carpeta de música para cargar este archivo.');
    return;
  }
  if (currentTrackIndex !== index) {
    queue[currentTrackIndex]?.howl?.stop();
    currentTrackIndex = index;
    $('#track-title').textContent = track.name;
    $('#track-artist').textContent = track.location || track.file?.type || 'Archivo de audio local';
    $('#seek').value = '0';
    $('#current-time').textContent = '0:00';
    $('#duration').textContent = formatTime(track.duration);
    paintTrackList();
  }
  const howl = createHowl(track);
  howl.volume(volumeLevel);
  if (!howl.playing()) howl.play();
}

function playNextTrack(fromEnded = false) {
  const queue = getQueueTracks();
  if (queue.length === 0) return;
  let nextIndex;
  if (shuffleEnabled && queue.length > 1) {
    do { nextIndex = Math.floor(Math.random() * queue.length); }
    while (nextIndex === currentTrackIndex);
  } else if (currentTrackIndex < queue.length - 1) {
    nextIndex = currentTrackIndex + 1;
  } else if (!fromEnded || repeatMode === 1) {
    nextIndex = 0;
  } else {
    return;
  }
  playTrack(nextIndex);
}

function playPreviousTrack() {
  const queue = getQueueTracks();
  if (queue.length === 0) return;
  const active = queue[currentTrackIndex]?.howl;
  if (active && Number(active.seek()) > 3) {
    active.seek(0);
    return;
  }
  const previousIndex = currentTrackIndex <= 0 ? queue.length - 1 : currentTrackIndex - 1;
  playTrack(previousIndex);
}

function stableTrackId(file) {
  const source = `${file.webkitRelativePath || file.path || file.name}|${file.size}|${file.lastModified}`
    .normalize('NFKC')
    .toLocaleLowerCase('en-US');
  let firstHash = 2166136261;
  let secondHash = 0x9e3779b9;
  for (const character of source) {
    const codePoint = character.codePointAt(0);
    firstHash = Math.imul(firstHash ^ codePoint, 16777619);
    secondHash = Math.imul(secondHash ^ codePoint, 0x85ebca6b);
  }
  return `local-${(firstHash >>> 0).toString(16)}-${(secondHash >>> 0).toString(16)}`;
}

function loadAudioFiles(fileList, source = 'archivos locales') {
  const files = [...fileList]
    .filter((file) => /\.(mp3|ogg|wav)$/iu.test(file.name))
    .sort((left, right) => (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name, 'es', { sensitivity: 'base' }));
  if (files.length === 0) {
    showToast('No encontré archivos MP3, OGG o WAV en esa selección.');
    return;
  }
  const playlist = getActivePlaylist();
  const loadedIds = [];
  const activeTrack = getQueueTracks()[currentTrackIndex];
  activeTrack?.howl?.stop();
  stopPlayerProgress();
  currentTrackIndex = -1;
  files.forEach((file) => {
    const relativePath = file.webkitRelativePath || '';
    const folder = relativePath.split('/').slice(0, -1).filter(Boolean).join(' / ');
    const id = stableTrackId(file);
    const storedTrack = tracks.find((track) => track.id === id);
    const trackData = {
      id,
      file,
      name: file.name,
      location: folder || (source === 'carpeta' ? 'Carpeta seleccionada' : file.type || 'Archivo local'),
      format: file.name.split('.').pop().toUpperCase(),
      size: file.size,
      lastModified: file.lastModified,
      url: URL.createObjectURL(file),
      howl: null,
      duration: 0,
      unavailable: false,
    };
    if (storedTrack) {
      storedTrack.howl?.unload();
      if (storedTrack.url) URL.revokeObjectURL(storedTrack.url);
      Object.assign(storedTrack, trackData);
    } else {
      tracks.push(trackData);
    }
    if (!playlist.trackIds.includes(id)) playlist.trackIds.push(id);
    loadedIds.push(id);
  });
  persistMusic();
  renderMusic();
  const queue = getQueueTracks();
  const firstLoadedIndex = queue.findIndex((track) => loadedIds.includes(track.id));
  if (firstLoadedIndex >= 0) playTrack(firstLoadedIndex);
  showToast(`${loadedIds.length} pistas cargadas desde ${source}.`);
}

function togglePlayback() {
  const queue = getQueueTracks();
  const track = queue[currentTrackIndex];
  if (!track) {
    if (queue.length) playTrack(0);
    else showToast('Primero elegí archivos de audio.');
    return;
  }
  if (track.unavailable || !track.url) {
    showToast('Volvé a elegir la carpeta de música para cargar este archivo.');
    return;
  }
  const howl = createHowl(track);
  if (howl.playing()) howl.pause();
  else howl.play();
}

function toggleShuffle() {
  shuffleEnabled = !shuffleEnabled;
  $('#shuffle-toggle').classList.toggle('control-active', shuffleEnabled);
  $('#shuffle-toggle').setAttribute('aria-pressed', String(shuffleEnabled));
}

function cycleRepeatMode() {
  repeatMode = (repeatMode + 1) % 3;
  const labels = ['Desactivar repetición', 'Repetir cola', 'Repetir pista'];
  $('#repeat-toggle').classList.toggle('control-active', repeatMode !== 0);
  $('#repeat-toggle').setAttribute('aria-label', labels[repeatMode]);
  $('#repeat-toggle').title = labels[repeatMode];
  $('#repeat-toggle').dataset.mode = String(repeatMode);
}

function renderSpotifyResults(results) {
  const container = $('#spotify-results');
  container.replaceChildren();
  $('#spotify-result-count').textContent = `${results.length} ${results.length === 1 ? 'canción' : 'canciones'}`;
  if (results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'spotify-empty';
    empty.innerHTML = '<span>⌕</span><strong>No encontramos resultados</strong><small>Probá con otro título, artista o álbum.</small>';
    container.append(empty);
    return;
  }
  results.forEach((track) => {
    const row = document.createElement('article');
    row.className = 'spotify-result';
    const image = document.createElement('img');
    image.className = 'spotify-cover';
    image.alt = track.album ? `Portada de ${track.album}` : 'Portada de álbum';
    image.loading = 'lazy';
    if (track.artwork) image.src = track.artwork;

    const copy = document.createElement('div');
    copy.className = 'spotify-track-copy';
    const title = document.createElement('strong');
    title.textContent = track.title;
    const artist = document.createElement('span');
    artist.textContent = track.artist;
    const album = document.createElement('small');
    album.textContent = track.album;
    copy.append(title, artist, album);

    const duration = document.createElement('span');
    duration.className = 'spotify-duration';
    duration.textContent = formatTime(track.duration / 1000);
    const open = document.createElement('button');
    open.className = 'outline-button spotify-open';
    open.type = 'button';
    open.textContent = 'Abrir en Spotify ↗';
    open.addEventListener('click', () => window.deskforge.openSpotifyTrack(track.url));
    row.append(image, copy, duration, open);
    container.append(row);
  });
}

async function connectSpotify() {
  const clientId = $('#spotify-client-id').value.trim() || readLocalValue('deskforge-spotify-client-id', '');
  if (!clientId) {
    $('details.spotify-setup').open = true;
    $('#spotify-client-id').focus();
    showToast('Ingresá primero el Client ID de tu app de Spotify.');
    return;
  }
  $('#spotify-client-id').value = clientId;
  $('#spotify-connect').disabled = true;
  $('#spotify-connect').textContent = 'Esperando autorización…';
  $('#spotify-connection-status').textContent = 'Completá el inicio de sesión en el navegador.';
  try {
    localStorage.setItem('deskforge-spotify-client-id', JSON.stringify(clientId));
    await window.deskforge.spotifyAuthorize(clientId);
    spotifyConnected = true;
    $('#spotify-connection-status').textContent = 'Cuenta conectada. Ya podés buscar canciones.';
    $('#spotify-connect').textContent = 'Conectado ✓';
    showToast('Spotify quedó conectado.');
  } catch (error) {
    spotifyConnected = false;
    $('#spotify-connection-status').textContent = error.message || 'No se pudo completar la conexión.';
    $('#spotify-connect').textContent = 'Intentar de nuevo →';
    showToast(error.message || 'No se pudo conectar con Spotify.');
  } finally {
    $('#spotify-connect').disabled = false;
  }
}

async function searchSpotify(event) {
  event.preventDefault();
  const query = $('#spotify-query').value.trim();
  if (!query) return;
  if (!spotifyConnected) {
    showToast('Conectá tu cuenta de Spotify para buscar.');
    return;
  }
  $('#spotify-results').innerHTML = '<div class="spotify-empty"><span class="search-spinner"></span><strong>Buscando en Spotify…</strong></div>';
  $('#spotify-result-count').textContent = '';
  try {
    const results = await window.deskforge.spotifySearch(query);
    renderSpotifyResults(results);
  } catch (error) {
    if (/conectá|venció|conectar tu cuenta/iu.test(error.message || '')) {
      spotifyConnected = false;
      $('#spotify-connection-status').textContent = error.message;
      $('#spotify-connect').textContent = 'Conectar cuenta →';
    }
    $('#spotify-results').replaceChildren();
    showToast(error.message || 'Spotify no pudo completar la búsqueda.');
  }
}

function syncEditors(source) {
  const text = source === 'quick' ? $('#quick-note').value : $('#note-editor').value;
  if (source === 'quick') $('#note-editor').value = text;
  else $('#quick-note').value = text;
  updateCount(text);
  $('#quick-save-status').textContent = 'Guardando…';
  $('#editor-saved').textContent = 'Guardando…';
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      await window.deskforge.writeQuickNote(text);
      $('#quick-save-status').textContent = 'Guardado automáticamente';
      $('#editor-saved').textContent = 'Guardado';
    } catch {
      $('#quick-save-status').textContent = 'No se pudo guardar';
      $('#editor-saved').textContent = 'Sin guardar';
    }
  }, 350);
}

async function openNote() {
  try {
    const note = await window.deskforge.openNote();
    if (!note) return;
    notePathName = note.name;
    $('#note-document-name').textContent = note.name;
    $('#note-editor').value = note.content;
    $('#quick-note').value = note.content;
    updateCount(note.content);
    selectView('notes');
    showToast(`Abierto: ${note.name}`);
  } catch {
    showToast('No se pudo abrir el archivo.');
  }
}

async function saveNote() {
  try {
    const result = await window.deskforge.saveNote($('#note-editor').value);
    if (!result) return;
    notePathName = result.name;
    $('#note-document-name').textContent = result.name;
    showToast('Nota guardada.');
  } catch {
    showToast('No se pudo guardar la nota.');
  }
}

function newNote() {
  if ($('#note-editor').value.trim() && !window.confirm('¿Crear una nota nueva? La nota rápida seguirá guardada.')) return;
  window.deskforge.newNote();
  notePathName = null;
  $('#note-document-name').textContent = 'Nota sin título';
  $('#note-editor').value = '';
  $('#quick-note').value = '';
  updateCount('');
  syncEditors('editor');
}

function updateDate() {
  $('#session-date').textContent = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

function wireEvents() {
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));
  $('#open-notes').addEventListener('click', () => selectView('notes'));
  $('#notes-link').addEventListener('click', () => selectView('notes'));
  $('#home-player').addEventListener('click', () => selectView('player'));
  $('#home-focus').addEventListener('click', () => selectView('focus'));
  $('#add-playlist').addEventListener('click', createPlaylist);
  $('#sidebar-import').addEventListener('click', () => {
    selectView('player');
    $('#folder-input').click();
  });
  $('#timer-start').addEventListener('click', toggleTimer);
  $('#timer-reset').addEventListener('click', resetTimer);
  const handleTrackSelection = (event, source) => {
    const files = [...event.currentTarget.files];
    event.currentTarget.value = '';
    loadAudioFiles(files, source);
  };
  $('#track-input').addEventListener('change', (event) => handleTrackSelection(event, 'archivos'));
  $('#folder-input').addEventListener('change', (event) => handleTrackSelection(event, 'carpeta'));
  $('#play-toggle').addEventListener('click', togglePlayback);
  $('#next-track').addEventListener('click', () => playNextTrack());
  $('#previous-track').addEventListener('click', playPreviousTrack);
  $('#shuffle-toggle').addEventListener('click', toggleShuffle);
  $('#repeat-toggle').addEventListener('click', cycleRepeatMode);
  $('#visualizer-bars').addEventListener('click', () => setVisualizerMode('bars'));
  $('#visualizer-wave').addEventListener('click', () => setVisualizerMode('wave'));
  $('#spotify-connect').addEventListener('click', connectSpotify);
  $('#spotify-save-client').addEventListener('click', () => {
    const clientId = $('#spotify-client-id').value.trim();
    localStorage.setItem('deskforge-spotify-client-id', JSON.stringify(clientId));
    showToast(clientId ? 'Client ID guardado en este dispositivo.' : 'Client ID eliminado.');
  });
  $('#spotify-search-form').addEventListener('submit', searchSpotify);
  $('#seek').addEventListener('input', (event) => {
    const track = getQueueTracks()[currentTrackIndex];
    if (!track?.howl) return;
    const duration = track.howl.duration() || track.duration;
    const position = (Number(event.currentTarget.value) / 1000) * duration;
    track.howl.seek(position);
    $('#current-time').textContent = formatTime(position);
  });
  $('#volume').addEventListener('input', (event) => {
    volumeLevel = Number(event.currentTarget.value) / 100;
    tracks.forEach((track) => track.howl?.volume(volumeLevel));
  });
  $('#quick-note').addEventListener('input', () => syncEditors('quick'));
  $('#note-editor').addEventListener('input', () => syncEditors('editor'));
  $('#open-note').addEventListener('click', openNote);
  $('#save-note').addEventListener('click', saveNote);
  $('#new-note').addEventListener('click', newNote);
  $('#minimize-window').addEventListener('click', () => window.deskforge.minimizeWindow());
  $('#hide-window').addEventListener('click', () => window.deskforge.hideWindow());
  window.deskforge.onMenuAction((action) => {
    if (action === 'new-note') newNote();
    if (action === 'open-note') openNote();
    if (action === 'save-note') saveNote();
  });
  window.deskforge.onGlobalShortcutAction((action) => {
    if (action === 'toggle-playback') togglePlayback();
    if (action === 'toggle-pomodoro') {
      const wasRunning = Boolean(timerInterval);
      selectView('focus');
      toggleTimer();
      showToast(wasRunning ? 'Pomodoro pausado con Ctrl+Shift+P.' : 'Pomodoro iniciado con Ctrl+Shift+P.');
    }
  });
}

async function initialize() {
  updateDate();
  paintTimer();
  renderMusic();
  $('#spotify-client-id').value = readLocalValue('deskforge-spotify-client-id', '');
  wireEvents();
  drawAudioVisualizer();
  try {
    const quickNote = await window.deskforge.readQuickNote();
    $('#quick-note').value = quickNote;
    $('#note-editor').value = quickNote;
    updateCount(quickNote);
  } catch {
    showToast('No se pudo recuperar la nota guardada.');
  }
}

initialize();
