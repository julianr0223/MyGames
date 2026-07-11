// Logica pura del juego Stop (Basta / Tutti Frutti).
// Sin dependencias de red: recibe estado y devuelve estado. Facil de testear.

// Categorias clasicas en espanol (el anfitrion puede cambiarlas en la sala).
export const DEFAULT_CATEGORIES = [
  'Nombre',
  'Apellido',
  'Color',
  'Fruta o Comida',
  'Animal',
  'Pais o Ciudad',
  'Objeto o Cosa',
];

// Pool de letras: se excluyen las dificiles para jugar en espanol
// (K, N~, Q, W, X, Y, Z). El anfitrion puede ampliarlo si quiere.
export const DEFAULT_LETTERS = 'ABCDEFGHIJLMNOPRSTUV'.split('');

export const DEFAULT_SETTINGS = {
  rounds: 5,
  roundSeconds: 120, // tiempo maximo por ronda antes de STOP automatico
  graceSeconds: 3, // margen tras un STOP para que los demas envien
  letters: DEFAULT_LETTERS,
};

// Puntajes
const SCORE_UNIQUE = 100; // respuesta valida y unica
const SCORE_SHARED = 50; // respuesta valida pero repetida con otros
const SCORE_NONE = 0; // vacia o invalida

// Normaliza para comparar: minusculas, sin acentos, sin espacios extra.
export function normalize(text) {
  return (text || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes/diacriticos
    .replace(/\s+/g, ' ');
}

// Una respuesta es valida si no esta vacia y empieza con la letra de la ronda.
export function isValidAnswer(answer, letter) {
  const n = normalize(answer);
  if (!n) return false;
  const l = normalize(letter);
  return n.startsWith(l);
}

// Elige una letra al azar que no se haya usado todavia en la partida.
// Recibe una funcion rng (0..1) para poder testear de forma determinista.
export function pickLetter(pool, usedLetters, rng = Math.random) {
  const available = pool.filter((l) => !usedLetters.includes(l));
  const source = available.length > 0 ? available : pool;
  const idx = Math.floor(rng() * source.length);
  return source[idx];
}

// Calcula el puntaje de una ronda.
//   answersByPlayer: { playerId: { categoria: texto } }
//   categories: [categoria]
//   letter: letra de la ronda
// Devuelve:
//   { perPlayer: { playerId: { total, byCategory: { categoria: {value, score, valid, shared} } } } }
export function scoreRound(answersByPlayer, categories, letter) {
  const perPlayer = {};
  const playerIds = Object.keys(answersByPlayer);

  for (const pid of playerIds) {
    perPlayer[pid] = { total: 0, byCategory: {} };
  }

  for (const category of categories) {
    // Cuenta cuantos jugadores dieron cada respuesta valida (normalizada).
    const counts = new Map();
    for (const pid of playerIds) {
      const raw = answersByPlayer[pid]?.[category] ?? '';
      if (isValidAnswer(raw, letter)) {
        const key = normalize(raw);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    for (const pid of playerIds) {
      const raw = answersByPlayer[pid]?.[category] ?? '';
      const valid = isValidAnswer(raw, letter);
      let score = SCORE_NONE;
      let shared = false;
      if (valid) {
        const key = normalize(raw);
        if (counts.get(key) > 1) {
          score = SCORE_SHARED;
          shared = true;
        } else {
          score = SCORE_UNIQUE;
        }
      }
      perPlayer[pid].byCategory[category] = { value: raw, score, valid, shared };
      perPlayer[pid].total += score;
    }
  }

  return { perPlayer };
}
