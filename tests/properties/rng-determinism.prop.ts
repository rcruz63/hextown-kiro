/**
 * Tests de propiedades del generador de números aleatorios determinista
 * (tarea 1.5).
 *
 * El RNG es la base de todo el determinismo del juego: el Generador_De_Mapa y
 * el Nucleo_De_Simulacion solo son reproducibles si, para cualquier semilla, la
 * corriente de números y la restauración de estado se comportan de forma
 * exactamente repetible. Estos tests cubren esa base:
 *
 * - **Propiedad 1 (parcial): Determinismo del generador de mapa** — el mapa se
 *   deriva de la semilla a través del RNG, así que se comprueba aquí que la
 *   misma semilla produce siempre la misma secuencia.
 * - **Propiedad 10 (parcial): Determinismo de la simulación** — la simulación
 *   reanudada desde un `rngState` guardado continúa la misma corriente.
 *
 * **Validates: Requirements 1.12, 5.19**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  RNG_STATE_WORDS,
  createRng,
  createRngFromState,
  deriveSubSeed,
  forkRng,
  type Rng,
  type RngState,
} from '../../src/core/rng.ts';

/** Mínimo exigido por el diseño ("Configuración de tests de propiedades"). */
const RUNS = { numRuns: 100 } as const;

/** 2^32: cota superior exclusiva de la salida cruda del generador. */
const TWO_POW_32 = 2 ** 32;

/**
 * Semillas de partida: cualquier entero de 32 bits con signo. `createRng`
 * trunca a 32 bits, por lo que este es el espacio efectivo de semillas.
 */
const arbSeed = fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 });

/** Etiquetas de derivación de subsemillas: identificadores o números de intento. */
const arbLabel = fc.oneof(
  fc.string({ minLength: 0, maxLength: 24 }),
  fc.integer({ min: 0, max: 10_000 }),
);

/** Número de extracciones por comprobación: suficiente para detectar divergencias. */
const arbDrawCount = fc.integer({ min: 1, max: 40 });

/** Cotas admisibles de `nextInt`: enteros en [1, 2^32]. */
const arbMax = fc.integer({ min: 1, max: TWO_POW_32 });

/** Extrae `count` salidas crudas de 32 bits. */
function drawUint32(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.nextUint32());
}

/** Extrae `count` reales en [0, 1). */
function drawFloats(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.next());
}

// Feature: hextown-base-game, Property 1: Determinismo del generador de mapa
describe('Propiedad 1 (base): determinismo de la corriente del RNG', () => {
  it('dos generadores con la misma semilla producen la misma secuencia', () => {
    fc.assert(
      fc.property(arbSeed, arbDrawCount, (seed, count) => {
        expect(drawUint32(createRng(seed), count)).toEqual(
          drawUint32(createRng(seed), count),
        );
      }),
      RUNS,
    );
  });

  it('la misma semilla produce los mismos reales y los mismos enteros', () => {
    fc.assert(
      fc.property(
        arbSeed,
        fc.array(arbMax, { minLength: 1, maxLength: 20 }),
        (seed, maxes) => {
          expect(drawFloats(createRng(seed), maxes.length)).toEqual(
            drawFloats(createRng(seed), maxes.length),
          );

          const a = createRng(seed);
          const b = createRng(seed);
          expect(maxes.map((max) => a.nextInt(max))).toEqual(
            maxes.map((max) => b.nextInt(max)),
          );
        },
      ),
      RUNS,
    );
  });

  it('semillas distintas parten de estados iniciales distintos', () => {
    // La siembra (splitmix32) es biyectiva sobre 32 bits, así que dos semillas
    // que no coincidan al truncar nunca comparten estado inicial.
    fc.assert(
      fc.property(arbSeed, arbSeed, (seedA, seedB) => {
        fc.pre((Math.trunc(seedA) | 0) !== (Math.trunc(seedB) | 0));

        expect(createRng(seedA).getState().state).not.toEqual(
          createRng(seedB).getState().state,
        );
      }),
      RUNS,
    );
  });

  it('mantiene las salidas dentro de sus rangos declarados', () => {
    fc.assert(
      fc.property(arbSeed, arbDrawCount, arbMax, (seed, count, max) => {
        const rng = createRng(seed);

        for (let i = 0; i < count; i += 1) {
          const real = rng.next();
          expect(real).toBeGreaterThanOrEqual(0);
          expect(real).toBeLessThan(1);

          const word = rng.nextUint32();
          expect(Number.isInteger(word)).toBe(true);
          expect(word).toBeGreaterThanOrEqual(0);
          expect(word).toBeLessThan(TWO_POW_32);

          const value = rng.nextInt(max);
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(max);
        }
      }),
      RUNS,
    );
  });
});

// Feature: hextown-base-game, Property 10: Determinismo de la simulación
describe('Propiedad 10 (base): continuidad del estado persistido', () => {
  it('reanudar desde un estado guardado continúa la misma corriente', () => {
    fc.assert(
      fc.property(
        arbSeed,
        fc.integer({ min: 0, max: 50 }),
        arbDrawCount,
        (seed, warmUp, count) => {
          const rng = createRng(seed);
          drawUint32(rng, warmUp);

          const snapshot = rng.getState();
          const expected = drawUint32(rng, count);

          rng.setState(snapshot);
          expect(drawUint32(rng, count)).toEqual(expected);
          expect(drawUint32(createRngFromState(snapshot), count)).toEqual(expected);
        },
      ),
      RUNS,
    );
  });

  it('el estado sobrevive a una ida y vuelta por JSON', () => {
    // `rngState` viaja dentro de la partida guardada (design.md, "Formato de
    // Persistencia"), así que la corriente debe sobrevivir a serializarse.
    fc.assert(
      fc.property(
        arbSeed,
        fc.integer({ min: 0, max: 30 }),
        arbDrawCount,
        (seed, warmUp, count) => {
          const rng = createRng(seed);
          drawUint32(rng, warmUp);

          const snapshot = rng.getState();
          const revived = JSON.parse(JSON.stringify(snapshot)) as RngState;

          expect(revived.state).toHaveLength(RNG_STATE_WORDS);
          expect(drawUint32(createRngFromState(revived), count)).toEqual(
            drawUint32(rng, count),
          );
        },
      ),
      RUNS,
    );
  });

  it('expone un estado serializable y no aliasado', () => {
    fc.assert(
      fc.property(arbSeed, fc.integer({ min: 0, max: 30 }), (seed, warmUp) => {
        const rng = createRng(seed);
        drawUint32(rng, warmUp);

        const snapshot = rng.getState();
        expect(snapshot.state).toHaveLength(RNG_STATE_WORDS);
        for (const word of snapshot.state) {
          expect(Number.isInteger(word)).toBe(true);
          expect(word).toBeGreaterThanOrEqual(0);
          expect(word).toBeLessThan(TWO_POW_32);
        }

        // Mutar la copia devuelta no puede alterar el generador.
        const before = [...snapshot.state];
        snapshot.state[0] = 12345;
        expect(rng.getState().state).toEqual(before);
      }),
      RUNS,
    );
  });
});

describe('Propiedad 1 (base): determinismo de las subcorrientes', () => {
  it('deriveSubSeed es una función pura de (semilla, etiqueta)', () => {
    fc.assert(
      fc.property(arbSeed, arbLabel, (seed, label) => {
        const subSeed = deriveSubSeed(seed, label);

        expect(deriveSubSeed(seed, label)).toBe(subSeed);
        expect(Number.isInteger(subSeed)).toBe(true);
        expect(subSeed).toBeGreaterThanOrEqual(0);
        expect(subSeed).toBeLessThan(TWO_POW_32);
      }),
      RUNS,
    );
  });

  it('etiquetas distintas dan subsemillas distintas para la misma semilla', () => {
    fc.assert(
      fc.property(arbSeed, arbLabel, arbLabel, (seed, labelA, labelB) => {
        const textA = typeof labelA === 'number' ? `#${String(labelA)}` : labelA;
        const textB = typeof labelB === 'number' ? `#${String(labelB)}` : labelB;
        fc.pre(textA !== textB);

        // El mezclador es biyectivo sobre 32 bits, así que dos etiquetas solo
        // colisionan si colisiona su hash FNV-1a.
        fc.pre(deriveSubSeed(0, labelA) !== deriveSubSeed(0, labelB));

        expect(deriveSubSeed(seed, labelA)).not.toBe(deriveSubSeed(seed, labelB));
      }),
      RUNS,
    );
  });

  it('la corriente de una subsemilla es reproducible', () => {
    fc.assert(
      fc.property(arbSeed, arbLabel, arbDrawCount, (seed, label, count) => {
        const first = createRng(deriveSubSeed(seed, label));
        const second = createRng(deriveSubSeed(seed, label));

        expect(drawUint32(first, count)).toEqual(drawUint32(second, count));
      }),
      RUNS,
    );
  });

  it('forkRng deriva los mismos hijos y avanza el padre igual', () => {
    // Cada intento de generación de mapa consume un fork del generador de
    // partida (design.md, algoritmo del Generador_De_Mapa).
    fc.assert(
      fc.property(
        arbSeed,
        fc.integer({ min: 1, max: 5 }),
        arbDrawCount,
        (seed, forks, count) => {
          const parentA = createRng(seed);
          const parentB = createRng(seed);

          for (let i = 0; i < forks; i += 1) {
            expect(drawUint32(forkRng(parentA), count)).toEqual(
              drawUint32(forkRng(parentB), count),
            );
          }

          expect(parentA.getState().state).toEqual(parentB.getState().state);
        },
      ),
      RUNS,
    );
  });
});
