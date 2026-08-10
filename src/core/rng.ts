/**
 * Generador de números aleatorios determinista de Hextown.
 *
 * Algoritmo: **xoshiro128\*\*** con siembra mediante **splitmix32**
 * (ver design.md, "Generador de Números Aleatorios").
 *
 * Todas las operaciones se realizan con aritmética de 32 bits (`|0`, `>>>`,
 * `Math.imul`), de modo que la secuencia es idéntica en cualquier motor de
 * JavaScript: no intervienen dobles ni orden de coma flotante. Esto es lo que
 * garantiza el determinismo exigido por los Requisitos 1.12 y 5.19.
 *
 * El estado interno son 4 palabras de 32 bits sin signo, así que `RngState` es
 * directamente serializable a JSON/YAML y puede guardarse en la partida
 * (ver design.md, "Formato de Persistencia": `rngState`).
 */

/** Número de palabras de 32 bits del estado interno de xoshiro128**. */
export const RNG_STATE_WORDS = 4;

/**
 * Estado interno serializable del generador.
 *
 * `state` contiene {@link RNG_STATE_WORDS} enteros en el rango [0, 2^32).
 */
export interface RngState {
  state: number[];
}

/** Generador de números aleatorios determinista. */
export interface Rng {
  /** Devuelve un número real en [0, 1). */
  next(): number;
  /**
   * Devuelve un entero en [0, `max`).
   *
   * @throws RangeError si `max` no es un entero en [1, 2^32].
   */
  nextInt(max: number): number;
  /** Devuelve un entero en [0, 2^32): la salida cruda del generador. */
  nextUint32(): number;
  /** Copia del estado interno, apta para persistir. */
  getState(): RngState;
  /**
   * Restaura el estado interno.
   *
   * @throws RangeError si el estado no tiene la forma esperada.
   */
  setState(s: RngState): void;
}

/** 2^32, usado para normalizar la salida de 32 bits a [0, 1). */
const TWO_POW_32 = 4294967296;

/** Rotación circular a la izquierda sobre 32 bits. */
function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * Mezclador splitmix32: expande una semilla de 32 bits en una secuencia de
 * palabras bien dispersas. Se usa para sembrar xoshiro128**, de forma que
 * semillas contiguas (1, 2, 3…) produzcan estados iniciales sin correlación.
 */
function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return (): number => {
    a = (a + 0x9e3779b9) | 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** Hash FNV-1a de 32 bits sobre una etiqueta de derivación. */
function hashLabel(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** Finalizador de splitmix32 aplicado a una única palabra. */
function mix32(value: number): number {
  let t = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

/**
 * Crea el generador a partir de las 4 palabras de estado ya validadas.
 * El estado vive en variables locales de 32 bits capturadas por el cierre.
 */
function makeRng(w0: number, w1: number, w2: number, w3: number): Rng {
  let a = w0 | 0;
  let b = w1 | 0;
  let c = w2 | 0;
  let d = w3 | 0;

  const nextUint32 = (): number => {
    // xoshiro128**: scrambler `rotl(s1 * 5, 7) * 9`.
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9);
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return result >>> 0;
  };

  const next = (): number => nextUint32() / TWO_POW_32;

  const nextInt = (max: number): number => {
    if (!Number.isInteger(max) || max < 1 || max > TWO_POW_32) {
      throw new RangeError(
        `Rng.nextInt: max debe ser un entero en [1, 2^32], recibido ${String(max)}`,
      );
    }
    // `next()` es un múltiplo exacto de 2^-32, por lo que el producto no
    // introduce error de redondeo para cualquier max <= 2^32.
    return Math.floor(next() * max);
  };

  const getState = (): RngState => ({
    state: [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
  });

  const setState = (s: RngState): void => {
    const words = validateStateWords(s);
    a = words[0];
    b = words[1];
    c = words[2];
    d = words[3];
  };

  return { next, nextInt, nextUint32, getState, setState };
}

/** Comprueba la forma de un `RngState` y devuelve sus 4 palabras como int32. */
function validateStateWords(s: RngState): [number, number, number, number] {
  if (s === null || typeof s !== 'object' || !Array.isArray(s.state)) {
    throw new RangeError('RngState inválido: se esperaba { state: number[] }');
  }
  if (s.state.length !== RNG_STATE_WORDS) {
    throw new RangeError(
      `RngState inválido: se esperaban ${RNG_STATE_WORDS} palabras, recibidas ${s.state.length}`,
    );
  }
  const words: number[] = [];
  for (let i = 0; i < RNG_STATE_WORDS; i += 1) {
    const word = s.state[i];
    if (typeof word !== 'number' || !Number.isInteger(word)) {
      throw new RangeError(
        `RngState inválido: la palabra ${i} no es un entero (${String(word)})`,
      );
    }
    words.push(word | 0);
  }
  const [w0, w1, w2, w3] = words;
  if (w0 === undefined || w1 === undefined || w2 === undefined || w3 === undefined) {
    throw new RangeError('RngState inválido: faltan palabras de estado');
  }
  if ((w0 | w1 | w2 | w3) === 0) {
    throw new RangeError('RngState inválido: el estado no puede ser todo ceros');
  }
  return [w0, w1, w2, w3];
}

/**
 * Crea un generador determinista a partir de una semilla entera.
 *
 * La semilla se trunca a 32 bits, de modo que cualquier entero es válido.
 * Dos llamadas con la misma semilla producen exactamente la misma secuencia
 * (Requisito 1.12).
 */
export function createRng(seed: number): Rng {
  if (!Number.isFinite(seed)) {
    throw new RangeError(`createRng: semilla no finita (${String(seed)})`);
  }
  const nextWord = splitmix32(Math.trunc(seed) | 0);
  let w0 = nextWord();
  const w1 = nextWord();
  const w2 = nextWord();
  const w3 = nextWord();
  // xoshiro128** exige un estado no nulo; splitmix32 no lo produce nunca en
  // la práctica, pero la garantía se hace explícita.
  if ((w0 | w1 | w2 | w3) === 0) {
    w0 = 1;
  }
  return makeRng(w0, w1, w2, w3);
}

/**
 * Restaura un generador desde un estado previamente obtenido con
 * {@link Rng.getState} (usado al cargar una partida, Requisito 5.19).
 *
 * @throws RangeError si el estado no tiene la forma esperada.
 */
export function createRngFromState(state: RngState): Rng {
  const [w0, w1, w2, w3] = validateStateWords(state);
  return makeRng(w0, w1, w2, w3);
}

/**
 * Deriva de forma determinista una subsemilla a partir de la semilla de la
 * partida y de una etiqueta (identificador de puzzle, número de intento de
 * generación de mapa, etc.).
 *
 * Es una función pura: la misma pareja (semilla, etiqueta) devuelve siempre la
 * misma subsemilla, y etiquetas distintas devuelven subsemillas sin
 * correlación aparente (Requisitos 1.6, 15.4, 15.6).
 */
export function deriveSubSeed(seed: number, label: string | number): number {
  if (!Number.isFinite(seed)) {
    throw new RangeError(`deriveSubSeed: semilla no finita (${String(seed)})`);
  }
  const labelText = typeof label === 'number' ? `#${String(label)}` : label;
  return mix32((Math.trunc(seed) | 0) ^ hashLabel(labelText));
}

/**
 * Crea un generador hijo consumiendo una extracción del generador padre.
 *
 * Corresponde a `subSemilla ← rng.nextInt(); subRng ← crearRng(subSemilla)`
 * del algoritmo de generación de mapa (design.md): cada intento avanza el
 * generador padre y trabaja sobre una corriente independiente.
 */
export function forkRng(parent: Rng): Rng {
  return createRng(parent.nextUint32());
}
