import './styles.css';

const $ = (selector) => document.querySelector(selector);
let notePathName = null;
let saveTimer;

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
  $('#breadcrumb-current').textContent = view === 'notes' ? 'BLOC DE NOTAS' : 'INICIO';
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
  wireEvents();
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
