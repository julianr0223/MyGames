import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  pickLetter,
  scoreRound,
} from './game.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------
// rooms: code -> Room
const rooms = new Map();

// Genera un codigo de sala corto y facil de dictar (sin caracteres ambiguos).
function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId: null, // se asigna al crear el jugador anfitrion
    players: new Map(), // playerId -> player
    categories: [...DEFAULT_CATEGORIES],
    settings: { ...DEFAULT_SETTINGS },
    state: 'lobby', // lobby | playing | reviewing | finished
    round: 0,
    currentLetter: null,
    usedLetters: [],
    answers: new Map(), // playerId -> { categoria: texto }
    submitted: new Set(), // playerIds que ya enviaron esta ronda
    stopBy: null, // nombre de quien apreto STOP
    roundTimer: null,
    graceTimer: null,
  };
  rooms.set(code, room);
  return room;
}

function makePlayer(name, socketId) {
  return {
    id: randomUUID(),
    name: name.slice(0, 20).trim() || 'Jugador',
    socketId,
    connected: true,
    score: 0,
  };
}

// Vista publica de la sala que se envia a los clientes.
function roomView(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    round: room.round,
    totalRounds: room.settings.rounds,
    currentLetter: room.currentLetter,
    categories: room.categories,
    settings: room.settings,
    stopBy: room.stopBy,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      score: p.score,
      submitted: room.submitted.has(p.id),
    })),
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('roomUpdate', roomView(room));
}

function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

// ---------------------------------------------------------------------------
// Ciclo de una ronda
// ---------------------------------------------------------------------------
function startRound(room) {
  clearTimers(room);
  room.round += 1;
  room.state = 'playing';
  room.currentLetter = pickLetter(room.settings.letters, room.usedLetters);
  room.usedLetters.push(room.currentLetter);
  room.answers = new Map();
  room.submitted = new Set();
  room.stopBy = null;

  broadcastRoom(room);
  io.to(room.code).emit('roundStarted', {
    round: room.round,
    letter: room.currentLetter,
  });

  // STOP automatico si nadie lo aprieta antes.
  if (room.settings.roundSeconds > 0) {
    room.roundTimer = setTimeout(() => {
      triggerStop(room, null); // null = por tiempo
    }, room.settings.roundSeconds * 1000);
  }
}

// Alguien apreto STOP (o se acabo el tiempo). Damos un margen para que
// todos envien sus respuestas actuales y luego calculamos.
function triggerStop(room, byName) {
  if (room.state !== 'playing') return;
  clearTimeout(room.roundTimer);
  room.stopBy = byName;
  broadcastRoom(room);
  io.to(room.code).emit('stopCalled', { by: byName });

  const grace = room.settings.graceSeconds ?? 3;
  room.graceTimer = setTimeout(() => finishRound(room), grace * 1000);

  // Si todos ya enviaron durante el margen, cerramos antes.
  maybeFinishEarly(room);
}

function maybeFinishEarly(room) {
  // Solo aplica cuando ya se llamo STOP (hay margen de gracia activo).
  if (room.state !== 'playing' || !room.graceTimer) return;
  const connected = connectedPlayers(room);
  const allIn = connected.every((p) => room.submitted.has(p.id));
  if (allIn) finishRound(room);
}

function finishRound(room) {
  if (room.state !== 'playing') return;
  clearTimers(room);
  room.state = 'reviewing';

  const answersByPlayer = {};
  for (const p of room.players.values()) {
    answersByPlayer[p.id] = room.answers.get(p.id) || {};
  }

  const { perPlayer } = scoreRound(answersByPlayer, room.categories, room.currentLetter);

  // Acumula puntaje total.
  for (const [pid, res] of Object.entries(perPlayer)) {
    const player = room.players.get(pid);
    if (player) player.score += res.total;
  }

  const results = [...room.players.values()].map((p) => ({
    playerId: p.id,
    name: p.name,
    roundTotal: perPlayer[p.id]?.total || 0,
    total: p.score,
    byCategory: perPlayer[p.id]?.byCategory || {},
  }));
  results.sort((a, b) => b.total - a.total);

  const isLastRound = room.round >= room.settings.rounds;
  broadcastRoom(room);
  io.to(room.code).emit('roundResults', {
    round: room.round,
    letter: room.currentLetter,
    categories: room.categories,
    results,
    isLastRound,
  });

  if (isLastRound) {
    room.state = 'finished';
    broadcastRoom(room);
    io.to(room.code).emit('gameOver', { results });
  }
}

function clearTimers(room) {
  clearTimeout(room.roundTimer);
  clearTimeout(room.graceTimer);
  room.roundTimer = null;
  room.graceTimer = null;
}

function resetGame(room) {
  clearTimers(room);
  room.state = 'lobby';
  room.round = 0;
  room.currentLetter = null;
  room.usedLetters = [];
  room.answers = new Map();
  room.submitted = new Set();
  room.stopBy = null;
  for (const p of room.players.values()) p.score = 0;
}

// Limpia salas vacias tras un tiempo para no acumular memoria.
function scheduleRoomCleanup(room) {
  setTimeout(() => {
    if (connectedPlayers(room).length === 0) {
      clearTimers(room);
      rooms.delete(room.code);
    }
  }, 60 * 1000);
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  // Cada socket recuerda a que sala/jugador pertenece.
  let currentRoom = null;
  let currentPlayerId = null;

  function joinSocketToRoom(room, player) {
    currentRoom = room;
    currentPlayerId = player.id;
    socket.join(room.code);
    socket.emit('joined', {
      you: { id: player.id, name: player.name },
      room: roomView(room),
    });
    broadcastRoom(room);
  }

  socket.on('createRoom', ({ name }, cb) => {
    const room = createRoom(name);
    const player = makePlayer(name, socket.id);
    room.hostId = player.id;
    room.players.set(player.id, player);
    room.answers.set(player.id, {});
    joinSocketToRoom(room, player);
    cb?.({ ok: true, code: room.code, playerId: player.id });
  });

  socket.on('joinRoom', ({ code, name }, cb) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room) return cb?.({ ok: false, error: 'La sala no existe.' });
    if (room.state !== 'lobby') {
      return cb?.({ ok: false, error: 'La partida ya empezo.' });
    }
    const player = makePlayer(name, socket.id);
    room.players.set(player.id, player);
    room.answers.set(player.id, {});
    joinSocketToRoom(room, player);
    cb?.({ ok: true, code: room.code, playerId: player.id });
  });

  // Reconexion: el cliente guarda code+playerId en localStorage.
  socket.on('rejoinRoom', ({ code, playerId }, cb) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room) return cb?.({ ok: false, error: 'La sala ya no existe.' });
    const player = room.players.get(playerId);
    if (!player) return cb?.({ ok: false, error: 'Jugador no encontrado.' });
    player.socketId = socket.id;
    player.connected = true;
    joinSocketToRoom(room, player);
    cb?.({ ok: true, code: room.code, playerId: player.id });
  });

  socket.on('updateSettings', ({ categories, settings }, cb) => {
    const room = currentRoom;
    if (!room || currentPlayerId !== room.hostId) {
      return cb?.({ ok: false, error: 'Solo el anfitrion puede cambiar la config.' });
    }
    if (room.state !== 'lobby') {
      return cb?.({ ok: false, error: 'No se puede cambiar durante la partida.' });
    }
    if (Array.isArray(categories) && categories.length > 0) {
      room.categories = categories
        .map((c) => c.toString().slice(0, 30).trim())
        .filter(Boolean)
        .slice(0, 12);
    }
    if (settings) {
      const s = room.settings;
      if (Number.isFinite(settings.rounds)) s.rounds = Math.min(20, Math.max(1, settings.rounds));
      if (Number.isFinite(settings.roundSeconds)) s.roundSeconds = Math.min(600, Math.max(0, settings.roundSeconds));
    }
    broadcastRoom(room);
    cb?.({ ok: true });
  });

  socket.on('startGame', (_data, cb) => {
    const room = currentRoom;
    if (!room || currentPlayerId !== room.hostId) {
      return cb?.({ ok: false, error: 'Solo el anfitrion puede empezar.' });
    }
    if (room.state !== 'lobby' && room.state !== 'finished') {
      return cb?.({ ok: false, error: 'La partida ya esta en curso.' });
    }
    if (room.state === 'finished') resetGame(room);
    startRound(room);
    cb?.({ ok: true });
  });

  // El cliente sincroniza sus respuestas mientras escribe (throttled en el front).
  socket.on('updateAnswers', ({ answers }) => {
    const room = currentRoom;
    if (!room || room.state !== 'playing') return;
    if (answers && typeof answers === 'object') {
      room.answers.set(currentPlayerId, sanitizeAnswers(answers, room.categories));
    }
  });

  // El jugador apreta STOP.
  socket.on('stop', ({ answers }) => {
    const room = currentRoom;
    if (!room || room.state !== 'playing') return;
    if (answers) room.answers.set(currentPlayerId, sanitizeAnswers(answers, room.categories));
    room.submitted.add(currentPlayerId);
    const player = room.players.get(currentPlayerId);
    triggerStop(room, player?.name || 'Alguien');
  });

  // Envio de respuestas tras un STOP (durante el margen de gracia).
  socket.on('submitAnswers', ({ answers }) => {
    const room = currentRoom;
    if (!room || room.state !== 'playing') return;
    if (answers) room.answers.set(currentPlayerId, sanitizeAnswers(answers, room.categories));
    room.submitted.add(currentPlayerId);
    broadcastRoom(room);
    maybeFinishEarly(room);
  });

  socket.on('nextRound', (_data, cb) => {
    const room = currentRoom;
    if (!room || currentPlayerId !== room.hostId) {
      return cb?.({ ok: false, error: 'Solo el anfitrion continua.' });
    }
    if (room.state !== 'reviewing') return cb?.({ ok: false, error: 'No es momento.' });
    startRound(room);
    cb?.({ ok: true });
  });

  socket.on('restartGame', (_data, cb) => {
    const room = currentRoom;
    if (!room || currentPlayerId !== room.hostId) {
      return cb?.({ ok: false, error: 'Solo el anfitrion reinicia.' });
    }
    resetGame(room);
    broadcastRoom(room);
    cb?.({ ok: true });
  });

  socket.on('leaveRoom', () => handleLeave());

  socket.on('disconnect', () => handleLeave(true));

  function handleLeave(isDisconnect = false) {
    const room = currentRoom;
    if (!room) return;
    const player = room.players.get(currentPlayerId);
    if (player) {
      if (isDisconnect) {
        // Marcamos desconectado pero conservamos por si reconecta.
        player.connected = false;
      } else {
        room.players.delete(currentPlayerId);
        room.answers.delete(currentPlayerId);
      }
    }

    // Si el anfitrion se fue, pasamos el rol a otro conectado.
    if (room.hostId === currentPlayerId) {
      const next = connectedPlayers(room)[0];
      if (next) room.hostId = next.id;
    }

    if (connectedPlayers(room).length === 0) {
      scheduleRoomCleanup(room);
    } else {
      broadcastRoom(room);
      // Si estabamos jugando y ya todos los conectados enviaron, cerramos.
      if (room.state === 'playing') maybeFinishEarly(room);
    }

    if (!isDisconnect) {
      socket.leave(room.code);
      currentRoom = null;
      currentPlayerId = null;
    }
  }
});

function sanitizeAnswers(answers, categories) {
  const clean = {};
  for (const cat of categories) {
    if (typeof answers[cat] === 'string') {
      clean[cat] = answers[cat].slice(0, 40);
    }
  }
  return clean;
}

httpServer.listen(PORT, () => {
  console.log(`\n  🎮 Servidor Stop escuchando en http://0.0.0.0:${PORT}\n`);
});
