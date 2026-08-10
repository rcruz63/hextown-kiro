import { describe, expect, it } from 'vitest';
import {
  RNG_STATE_WORDS,
  createRng,
  createRngFromState,
  deriveSubSeed,
  forkRng,
} from '../../src/core/rng.ts';

/** Extrae `count` valores en [0, 1) de un generador recién creado. */
function sequence(seed: number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe('createRng', () => {
  it('produce la misma secuencia para la misma semilla', () => {
    expect(sequence(12345, 20)).toEqual(sequence(12345, 20));
  });

  it('produce secuencias distintas para semillas contiguas', () => {
    // splitmix32 al sembrar evita que semillas vecinas queden correlacionadas.
    expect(sequence(1, 10)).not.toEqual(sequence(2, 10));
  });

  it('devuelve valores en [0, 1)', () => {
    const rng = createRng(-7);
    for (let i = 0; i < 500; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('devuelve enteros de 32 bits sin signo en nextUint32', () => {
    const rng = createRng(2 ** 31 + 5);
    for (let i = 0; i < 200; i += 1) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });

  it('acepta semillas no enteras truncándolas', () => {
    expect(sequence(42.9, 5)).toEqual(sequence(42, 5));
  });

  it('rechaza semillas no finitas', () => {
    expect(() => createRng(Number.NaN)).toThrow(RangeError);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('Rng.nextInt', () => {
  it('devuelve enteros en [0, max)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 500; i += 1) {
      const value = rng.nextInt(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it('devuelve siempre 0 cuando max es 1', () => {
    const rng = createRng(4);
    expect([rng.nextInt(1), rng.nextInt(1), rng.nextInt(1)]).toEqual([0, 0, 0]);
  });

  it('cubre todo el rango de un dado de 6 caras', () => {
    const rng = createRng(2024);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(rng.nextInt(6));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('con max = 2^32 reproduce la salida cruda del generador', () => {
    const a = createRng(555);
    const b = createRng(555);
    expect(a.nextInt(2 ** 32)).toBe(b.nextUint32());
  });

  it('rechaza valores de max inválidos', () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-3)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
    expect(() => rng.nextInt(2 ** 32 + 1)).toThrow(RangeError);
  });
});

describe('getState / setState', () => {
  it('permite reanudar exactamente la misma secuencia', () => {
    const rng = createRng(777);
    for (let i = 0; i < 13; i += 1) {
      rng.next();
    }
    const snapshot = rng.getState();
    const expected = Array.from({ length: 10 }, () => rng.next());

    rng.setState(snapshot);
    expect(Array.from({ length: 10 }, () => rng.next())).toEqual(expected);
  });

  it('sobrevive a una ida y vuelta por JSON', () => {
    const rng = createRng(31337);
    rng.next();
    rng.next();
    const restored = createRngFromState(
      JSON.parse(JSON.stringify(rng.getState())) as ReturnType<typeof rng.getState>,
    );
    expect(restored.next()).toBe(rng.next());
  });

  it('expone un estado serializable de enteros sin signo', () => {
    const rng = createRng(-1);
    rng.next();
    const { state } = rng.getState();
    expect(state).toHaveLength(RNG_STATE_WORDS);
    for (const word of state) {
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThan(2 ** 32);
    }
  });

  it('devuelve una copia del estado, no una vista mutable', () => {
    const rng = createRng(8);
    const snapshot = rng.getState();
    snapshot.state[0] = 0;
    expect(rng.getState().state[0]).not.toBe(0);
  });

  it('rechaza estados con forma incorrecta', () => {
    const rng = createRng(8);
    expect(() => rng.setState({ state: [1, 2, 3] })).toThrow(RangeError);
    expect(() => rng.setState({ state: [0, 0, 0, 0] })).toThrow(RangeError);
    expect(() => rng.setState({ state: [1, 2, 3, 4.5] })).toThrow(RangeError);
  });
});

describe('deriveSubSeed', () => {
  it('es determinista para la misma semilla y etiqueta', () => {
    expect(deriveSubSeed(100, 'puzzle:pozo')).toBe(deriveSubSeed(100, 'puzzle:pozo'));
    expect(deriveSubSeed(100, 3)).toBe(deriveSubSeed(100, 3));
  });

  it('cambia con la etiqueta y con la semilla', () => {
    expect(deriveSubSeed(100, 'a')).not.toBe(deriveSubSeed(100, 'b'));
    expect(deriveSubSeed(100, 'a')).not.toBe(deriveSubSeed(101, 'a'));
  });

  it('devuelve un entero de 32 bits sin signo', () => {
    for (let i = 0; i < 100; i += 1) {
      const subSeed = deriveSubSeed(2 ** 30, i);
      expect(Number.isInteger(subSeed)).toBe(true);
      expect(subSeed).toBeGreaterThanOrEqual(0);
      expect(subSeed).toBeLessThan(2 ** 32);
    }
  });

  it('genera corrientes distintas por etiqueta', () => {
    const first = createRng(deriveSubSeed(50, 'intento:1')).next();
    const second = createRng(deriveSubSeed(50, 'intento:2')).next();
    expect(first).not.toBe(second);
  });
});

describe('forkRng', () => {
  it('deriva hijos deterministas y avanza el padre', () => {
    const parentA = createRng(2468);
    const parentB = createRng(2468);

    const childA1 = forkRng(parentA);
    const childA2 = forkRng(parentA);
    const childB1 = forkRng(parentB);
    const childB2 = forkRng(parentB);

    expect(childA1.next()).toBe(childB1.next());
    expect(childA2.next()).toBe(childB2.next());
    // Cada fork consume una extracción del padre, así que los hijos
    // consecutivos son corrientes diferentes.
    expect(parentA.next()).toBe(parentB.next());
  });

  it('produce hijos independientes entre sí', () => {
    const parent = createRng(13);
    const first = forkRng(parent);
    const second = forkRng(parent);
    expect(
      Array.from({ length: 5 }, () => first.next()),
    ).not.toEqual(Array.from({ length: 5 }, () => second.next()));
  });
});
