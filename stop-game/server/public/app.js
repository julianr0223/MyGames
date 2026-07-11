/* Cliente del juego Stop. Vanilla JS + Socket.IO. */
const socket = io();

const state = {
  playerId: null,
  name: '',
  room: null,
  answers: {},
  timerInterval: null,
  deadline: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------------------------------------------------------------------------
// Navegacion entre pantallas
// ---------------------------------------------------------------------------
function show(screenId) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $(`#${screenId}`).classList.add('active');
}

function isHost() {
  return state.room && state.playerId === state.room.hostId;
}

function updateHostClass() {
  document.body.classList.toggle('is-host', isHost());
}

// Color de avatar a partir del nombre.
function colorFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360} 65% 55%)`;
}

// ---------------------------------------------------------------------------
// Pantalla inicio
// ---------------------------------------------------------------------------
$('#btn-create').onclick = () => {
  const name = $('#input-name').value.trim();
  if (!name) return homeError('Escribe tu nombre.');
  state.name = name;
  socket.emit('createRoom', { name }, (res) => {
    if (!res.ok) return homeError(res.error);
    persistSession(res.code, res.playerId);
  });
};

$('#btn-join').onclick = () => {
  const name = $('#input-name').value.trim();
  const code = $('#input-code').value.trim().toUpperCase();
  if (!name) return homeError('Escribe tu nombre.');
  if (code.length !== 4) return homeError('El código tiene 4 letras.');
  state.name = name;
  socket.emit('joinRoom', { code, name }, (res) => {
    if (!res.ok) return homeError(res.error);
    persistSession(res.code, res.playerId);
  });
};

function homeError(msg) { $('#home-error').textContent = msg || ''; }

function persistSession(code, playerId) {
  localStorage.setItem('stop_session', JSON.stringify({ code, playerId }));
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
$('#btn-copy').onclick = async () => {
  const code = state.room?.code || '';
  try {
    await navigator.clipboard.writeText(code);
    $('#btn-copy').textContent = '¡Copiado!';
    setTimeout(() => ($('#btn-copy').textContent = 'Copiar'), 1500);
  } catch { /* algunos navegadores móviles bloquean clipboard */ }
};

$('#btn-leave').onclick = () => {
  socket.emit('leaveRoom');
  localStorage.removeItem('stop_session');
  state.room = null;
  show('screen-home');
};

$('#input-rounds').oninput = (e) => ($('#rounds-val').textContent = e.target.value);
$('#input-secs').oninput = (e) => ($('#secs-val').textContent = e.target.value);

$('#btn-save-cfg').onclick = () => {
  const categories = $('#input-cats').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const settings = {
    rounds: parseInt($('#input-rounds').value, 10),
    roundSeconds: parseInt($('#input-secs').value, 10),
  };
  socket.emit('updateSettings', { categories, settings }, (res) => {
    $('#btn-save-cfg').textContent = res.ok ? '✓ Guardado' : (res.error || 'Error');
    setTimeout(() => ($('#btn-save-cfg').textContent = 'Guardar configuración'), 1500);
  });
};

$('#btn-start').onclick = () => {
  socket.emit('startGame', {}, (res) => { if (!res.ok) alert(res.error); });
};

function renderLobby() {
  const room = state.room;
  $('#lobby-code').textContent = room.code;
  $('#lobby-count').textContent = room.players.length;

  // Lista de jugadores
  const list = $('#player-list');
  list.innerHTML = '';
  room.players.forEach((p) => {
    const li = document.createElement('li');
    const initial = p.name[0]?.toUpperCase() || '?';
    li.innerHTML = `
      <span class="avatar" style="background:${colorFor(p.name)}">${initial}</span>
      <span class="pname">${escapeHtml(p.name)}</span>
      ${p.id === room.hostId ? '<span class="badge">Anfitrión</span>' : ''}
      ${!p.connected ? '<span class="badge off">Ausente</span>' : ''}
    `;
    list.appendChild(li);
  });

  // Config del anfitrión (solo llenamos una vez para no pisar lo que escribe)
  if (isHost() && !$('#input-cats').dataset.init) {
    $('#input-cats').value = room.categories.join('\n');
    $('#input-rounds').value = room.settings.rounds;
    $('#rounds-val').textContent = room.settings.rounds;
    $('#input-secs').value = room.settings.roundSeconds;
    $('#secs-val').textContent = room.settings.roundSeconds;
    $('#input-cats').dataset.init = '1';
  }

  // Vista de invitado
  const preview = $('#cat-preview');
  preview.innerHTML = '';
  room.categories.forEach((c) => {
    const li = document.createElement('li');
    li.textContent = c;
    preview.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Juego
// ---------------------------------------------------------------------------
function buildAnswerForm() {
  const form = $('#answers-form');
  form.innerHTML = '';
  state.answers = {};
  state.room.categories.forEach((cat, i) => {
    const row = document.createElement('div');
    row.className = 'answer-row';
    const id = `ans-${i}`;
    row.innerHTML = `
      <label for="${id}">${escapeHtml(cat)}</label>
      <input type="text" id="${id}" data-cat="${escapeHtml(cat)}" maxlength="40" autocomplete="off" />
    `;
    form.appendChild(row);
  });

  // Sincroniza mientras escribe (throttled).
  form.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      state.answers[input.dataset.cat] = input.value;
      queueSync();
    });
  });
}

let syncTimer = null;
function queueSync() {
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    socket.emit('updateAnswers', { answers: state.answers });
  }, 400);
}

$('#btn-stop').onclick = () => {
  collectAnswers();
  socket.emit('stop', { answers: state.answers });
  $('#btn-stop').disabled = true;
  $('#stop-note').textContent = '¡Dijiste STOP! Cerrando la ronda…';
};

function collectAnswers() {
  $('#answers-form').querySelectorAll('input').forEach((input) => {
    state.answers[input.dataset.cat] = input.value;
  });
}

function startTimer(seconds) {
  clearInterval(state.timerInterval);
  if (!seconds || seconds <= 0) { $('#play-timer').textContent = '∞'; return; }
  state.deadline = Date.now() + seconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
    const m = Math.floor(left / 60);
    const s = String(left % 60).padStart(2, '0');
    const el = $('#play-timer');
    el.textContent = `${m}:${s}`;
    el.classList.toggle('low', left <= 15);
    if (left <= 0) clearInterval(state.timerInterval);
  };
  tick();
  state.timerInterval = setInterval(tick, 1000);
}

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------
$('#btn-next').onclick = () => socket.emit('nextRound', {}, (r) => { if (!r.ok) alert(r.error); });
$('#btn-again').onclick = () => socket.emit('restartGame', {}, (r) => { if (!r.ok) alert(r.error); });
$('#btn-home').onclick = () => {
  socket.emit('leaveRoom');
  localStorage.removeItem('stop_session');
  show('screen-home');
};

function renderResults(data) {
  $('#results-title').textContent = `Ronda ${data.round} — Letra ${data.letter}`;
  const body = $('#results-body');
  body.innerHTML = '';
  data.results.forEach((r) => {
    const div = document.createElement('div');
    div.className = 'result-player';
    let cats = '';
    for (const cat of data.categories) {
      const c = r.byCategory[cat] || { value: '', score: 0 };
      const cls = c.score === 100 ? 'pts-100' : c.score === 50 ? 'pts-50' : 'pts-0';
      cats += `
        <div class="rp-cat">
          <span class="cat-name">${escapeHtml(cat)}</span>
          <span class="cat-val">${c.value ? escapeHtml(c.value) : '—'}</span>
          <span class="cat-pts ${cls}">${c.score}</span>
        </div>`;
    }
    div.innerHTML = `
      <div class="rp-head">
        <span class="rp-name">${escapeHtml(r.name)}</span>
        <span><span class="rp-total">+${r.roundTotal}</span> · ${r.total} pts</span>
      </div>
      <div class="rp-cats">${cats}</div>`;
    body.appendChild(div);
  });
  show('screen-results');
}

function renderGameOver(results) {
  const sorted = [...results].sort((a, b) => b.total - a.total);
  const podium = $('#podium');
  podium.innerHTML = '';
  const order = [1, 0, 2]; // 2do, 1ro, 3ro visualmente
  order.forEach((idx) => {
    const p = sorted[idx];
    if (!p) return;
    const place = idx + 1;
    const step = document.createElement('div');
    step.className = `step p${place}`;
    step.innerHTML = `
      <div class="bar">${place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'}</div>
      <div class="pname">${escapeHtml(p.name)}</div>
      <div class="pscore">${p.total} pts</div>`;
    podium.appendChild(step);
  });

  const scores = $('#final-scores');
  scores.innerHTML = '';
  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'rp-cat';
    row.innerHTML = `<span class="cat-name">${i + 1}. ${escapeHtml(p.name)}</span>
                     <span class="cat-pts">${p.total}</span>`;
    scores.appendChild(row);
  });
  show('screen-over');
}

// ---------------------------------------------------------------------------
// Eventos del servidor
// ---------------------------------------------------------------------------
socket.on('joined', ({ you, room }) => {
  state.playerId = you.id;
  state.name = you.name;
  state.room = room;
  updateHostClass();
  navigateToState(); // coloca la pantalla correcta (incluye reconexión a mitad de partida)
});

socket.on('roomUpdate', (room) => {
  const prevState = state.room?.state;
  state.room = room;
  updateHostClass();

  // Si estamos en lobby, mantenemos la lista y la config al día.
  if (room.state === 'lobby') {
    renderLobby();
    // Al reiniciar una partida volvemos todos al lobby.
    if (prevState && prevState !== 'lobby') show('screen-lobby');
    else if (['screen-home'].includes(activeScreenId())) show('screen-lobby');
  }
});

// Lleva al jugador a la pantalla que corresponde según el estado de la sala.
// Clave para reconexión: si recargas a mitad de juego, aterrizas donde toca.
function navigateToState() {
  const room = state.room;
  if (!room) return show('screen-home');
  switch (room.state) {
    case 'playing':
      $('#letter-badge').textContent = room.currentLetter || '?';
      $('#play-round').textContent = room.round;
      $('#play-total').textContent = room.totalRounds;
      buildAnswerForm();
      $('#btn-stop').disabled = !!room.stopBy;
      startTimer(room.settings.roundSeconds);
      show('screen-play');
      break;
    case 'reviewing':
      // Esperamos el evento roundResults; mientras, mostramos lobby con marcador.
      renderLobby();
      show('screen-lobby');
      break;
    case 'finished':
      renderLobby();
      show('screen-lobby');
      break;
    default:
      renderLobby();
      show('screen-lobby');
  }
}

socket.on('roundStarted', ({ round, letter }) => {
  $('#letter-badge').textContent = letter;
  $('#play-round').textContent = round;
  $('#play-total').textContent = state.room.totalRounds;
  $('#btn-stop').disabled = false;
  $('#stop-note').textContent = '';
  buildAnswerForm();
  startTimer(state.room.settings.roundSeconds);
  show('screen-play');
  // Enfoca el primer campo para escribir rápido.
  setTimeout(() => $('#answers-form input')?.focus(), 100);
});

socket.on('stopCalled', ({ by }) => {
  clearInterval(state.timerInterval);
  collectAnswers();
  socket.emit('submitAnswers', { answers: state.answers });
  $('#btn-stop').disabled = true;
  $('#answers-form').querySelectorAll('input').forEach((i) => (i.disabled = true));
  $('#stop-note').textContent = by
    ? `¡${by} dijo STOP! Cerrando ronda…`
    : '¡Se acabó el tiempo! Cerrando ronda…';
});

socket.on('roundResults', (data) => {
  clearInterval(state.timerInterval);
  renderResults(data);
});

socket.on('gameOver', ({ results }) => {
  setTimeout(() => renderGameOver(results), 400);
});

socket.on('connect', () => tryRejoin());

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function activeScreenId() {
  return document.querySelector('.screen.active')?.id || '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Reconexión automática al recargar o perder señal.
function tryRejoin() {
  if (state.room) return; // ya estamos dentro
  const saved = localStorage.getItem('stop_session');
  if (!saved) return;
  try {
    const { code, playerId } = JSON.parse(saved);
    socket.emit('rejoinRoom', { code, playerId }, (res) => {
      if (!res.ok) {
        localStorage.removeItem('stop_session');
        return;
      }
      state.playerId = res.playerId;
      // La sala llegará por 'joined' + navegación según estado.
    });
  } catch {
    localStorage.removeItem('stop_session');
  }
}

// Al cargar, intenta reconectar.
tryRejoin();
