import './styles.css';
import { Howl, Howler } from 'howler';

const $ = (selector) => document.querySelector(selector);
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
let tracks = [];
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
  const labels = { home: 'INICIO', notes: 'BLOC DE NOTAS', focus: 'POMODORO', player: 'REPRODUCTOR' };
  $('#breadcrumb-current').textContent = labels[view] ?? 'INICIO';
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
    URL.revokeObjectURL(track.url);
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
  $('#track-count').textContent = `${tracks.length} ${tracks.length === 1 ? 'pista' : 'pistas'}`;
  list.replaceChildren();
  if (tracks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-library';
    empty.innerHTML = '<div class="empty-icon">♫</div><strong>Tu música empieza acá</strong><span>Elegí una carpeta o varios archivos MP3, OGG y WAV.</span><div class="empty-library-actions"><label class="outline-button file-picker-label" for="folder-input">Elegir carpeta</label><label class="outline-button file-picker-label" for="track-input">Elegir archivos</label></div>';
    list.append(empty);
    return;
  }
  tracks.forEach((track, index) => {
    const row = document.createElement('button');
    row.className = `track-row${index === currentTrackIndex ? ' current-track' : ''}`;
    row.type = 'button';
    row.innerHTML = `<span class="track-number">${index === currentTrackIndex && track.howl?.playing() ? '♫' : String(index + 1).padStart(2, '0')}</span><span class="track-copy"><strong></strong><small></small></span><span class="track-duration">${track.duration ? formatTime(track.duration) : '—:—'}</span>`;
    row.querySelector('strong').textContent = track.name;
    row.querySelector('small').textContent = track.location || track.file.type || 'Archivo de audio';
    row.addEventListener('click', () => playTrack(index));
    list.append(row);
  });
}

function paintPlayerProgress() {
  const track = tracks[currentTrackIndex];
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
      if (tracks[currentTrackIndex] === track) paintPlayerProgress();
      paintTrackList();
    },
    onplay: () => {
      if (tracks[currentTrackIndex] === track) {
        $('#track-artist').textContent = `${track.location || track.file.type || 'Archivo local'} · Reproduciendo`;
        ensureAudioAnalyser();
        beginPlayerProgress();
        paintPlayerProgress();
        paintTrackList();
      }
    },
    onpause: () => {
      if (tracks[currentTrackIndex] === track) {
        stopPlayerProgress();
        paintPlayerProgress();
        paintTrackList();
      }
    },
    onend: () => {
      if (tracks[currentTrackIndex] !== track) return;
      if (repeatMode === 2) {
        howl.seek(0);
        howl.play();
      } else if (currentTrackIndex < tracks.length - 1 || repeatMode === 1 || shuffleEnabled) {
        playNextTrack(true);
      } else {
        stopPlayerProgress();
        paintPlayerProgress();
      }
    },
    onloaderror: () => showToast(`No se pudo cargar ${track.name}.`),
    onplayerror: () => showToast('No se pudo reproducir este archivo de audio.'),
  });
  track.howl = howl;
  return howl;
}

function playTrack(index) {
  const track = tracks[index];
  if (!track) return;
  if (currentTrackIndex !== index) {
    tracks[currentTrackIndex]?.howl?.stop();
    currentTrackIndex = index;
    $('#track-title').textContent = track.name;
    $('#track-artist').textContent = track.location || track.file.type || 'Archivo de audio local';
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
  if (tracks.length === 0) return;
  let nextIndex;
  if (shuffleEnabled && tracks.length > 1) {
    do { nextIndex = Math.floor(Math.random() * tracks.length); }
    while (nextIndex === currentTrackIndex);
  } else if (currentTrackIndex < tracks.length - 1) {
    nextIndex = currentTrackIndex + 1;
  } else if (!fromEnded || repeatMode === 1) {
    nextIndex = 0;
  } else {
    return;
  }
  playTrack(nextIndex);
}

function playPreviousTrack() {
  if (tracks.length === 0) return;
  const active = tracks[currentTrackIndex]?.howl;
  if (active && Number(active.seek()) > 3) {
    active.seek(0);
    return;
  }
  const previousIndex = currentTrackIndex <= 0 ? tracks.length - 1 : currentTrackIndex - 1;
  playTrack(previousIndex);
}

function loadAudioFiles(fileList, source = 'archivos locales') {
  const files = [...fileList]
    .filter((file) => /\.(mp3|ogg|wav)$/iu.test(file.name))
    .sort((left, right) => (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name, 'es', { sensitivity: 'base' }));
  if (files.length === 0) {
    showToast('No encontré archivos MP3, OGG o WAV en esa selección.');
    return;
  }
  releaseTracks();
  tracks = files.map((file) => {
    const relativePath = file.webkitRelativePath || '';
    const folder = relativePath.split('/').slice(0, -1).filter(Boolean).join(' / ');
    return {
      file,
      name: file.name,
      location: folder || (source === 'carpeta' ? 'Carpeta seleccionada' : file.type || 'Archivo local'),
      url: URL.createObjectURL(file),
      howl: null,
      duration: 0,
    };
  });
  $('#track-title').textContent = 'Elegí una pista';
  $('#track-artist').textContent = `${tracks.length} pistas cargadas desde ${source}.`;
  $('#play-toggle').textContent = '▶';
  paintTrackList();
  playTrack(0);
}

function togglePlayback() {
  const track = tracks[currentTrackIndex];
  if (!track) {
    if (tracks.length) playTrack(0);
    else showToast('Primero elegí archivos de audio.');
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
  $('#seek').addEventListener('input', (event) => {
    const track = tracks[currentTrackIndex];
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
}

async function initialize() {
  updateDate();
  paintTimer();
  paintTrackList();
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
