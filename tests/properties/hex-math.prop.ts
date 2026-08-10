/**
 * Tests de propiedades de las matemáticas hexagonales (tarea 1.5).
 *
 * El Generador_De_Mapa recorre el mapa en el orden canónico que devuelve
 * `hexSpiral` y decide adyacencias con `hexNeighbors`. Que ese recorrido sea
 * puro, completo y estable es la otra mitad del determinismo del mapa: la
 * semilla fija las tiradas y estas funciones fijan el orden en que se consumen.
 *
 * - **Propiedad 1 (parcial): Determinismo del generador de mapa** — el orden de
 *   recorrido depende solo de (centro, radio), nunca del estado de la partida.
 * - **Propiedad 10 (parcial): Determinismo de la simulación** — las consultas
 *   de vecindad y distancia son funciones puras de sus argumentos.
 *
 * **Validates: Requirements 1.12, 5.19**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DIRECTIONS,
  hexDistance,
  hexNeighbors,
  hexRing,
  hexSpiral,
  hexToPixel,
  type AxialCoord,
} from '../../src/core/hex-math.ts';

/** Mínimo exigido por el diseño ("Configuración de tests de propiedades"). */
const RUNS = { numRuns: 100 } as const;

const ORIGIN: AxialCoord = { q: 0, r: 0 };

/** Coordenada axial arbitraria, sin restricción de radio de mapa. */
const arbHex = fc.record({
  q: fc.integer({ min: -60, max: 60 }),
  r: fc.integer({ min: -60, max: 60 }),
});

/**
 * Coordenada dentro del disco de radio `radius` alrededor del origen.
 *
 * Se construye por rangos en vez de por filtrado: para una `q` dada, las `r`
 * admisibles son exactamente `[max(-radius, -q - radius), min(radius, radius - q)]`.
 */
const arbHexInRadius = (radius: number): fc.Arbitrary<AxialCoord> =>
  fc.integer({ min: -radius, max: radius }).chain((q) =>
    fc
      .integer({
        min: Math.max(-radius, -q - radius),
        max: Math.min(radius, radius - q),
      })
      .map((r) => ({ q, r })),
  );

/** Radios de mapa realistas (el escenario inicial usa radio 8). */
const arbRadius = fc.integer({ min: 0, max: 10 });

/** Radios inválidos: enteros negativos o valores fraccionarios. */
const arbInvalidRadius = fc.oneof(
  fc.integer({ min: -50, max: -1 }),
  fc.double({ min: 0.1, max: 50, noInteger: true }),
);

/** Clave canónica de una coordenada, para comparar conjuntos. */
const key = ({ q, r }: AxialCoord): string => `${q},${r}`;

describe('hexDistance es una métrica sobre el mapa', () => {
  it('es simétrica, entera, no negativa y nula solo en el mismo hexágono', () => {
    fc.assert(
      fc.property(arbHex, arbHex, (a, b) => {
        const distance = hexDistance(a, b);

        expect(Number.isInteger(distance)).toBe(true);
        expect(distance).toBeGreaterThanOrEqual(0);
        expect(hexDistance(b, a)).toBe(distance);
        expect(distance === 0).toBe(key(a) === key(b));
      }),
      RUNS,
    );
  });

  it('cumple la desigualdad triangular', () => {
    fc.assert(
      fc.property(arbHex, arbHex, arbHex, (a, b, c) => {
        expect(hexDistance(a, c)).toBeLessThanOrEqual(
          hexDistance(a, b) + hexDistance(b, c),
        );
      }),
      RUNS,
    );
  });

  it('es invariante frente a traslaciones', () => {
    fc.assert(
      fc.property(arbHex, arbHex, arbHex, (a, b, shift) => {
        const shifted = (hex: AxialCoord): AxialCoord => ({
          q: hex.q + shift.q,
          r: hex.r + shift.r,
        });

        expect(hexDistance(shifted(a), shifted(b))).toBe(hexDistance(a, b));
      }),
      RUNS,
    );
  });
});

describe('hexNeighbors', () => {
  it('devuelve seis hexágonos distintos a distancia 1, en el orden de DIRECTIONS', () => {
    fc.assert(
      fc.property(arbHex, (hex) => {
        const neighbors = hexNeighbors(hex);

        expect(neighbors).toHaveLength(DIRECTIONS.length);
        expect(new Set(neighbors.map(key)).size).toBe(DIRECTIONS.length);
        neighbors.forEach((neighbor, index) => {
          expect(hexDistance(hex, neighbor)).toBe(1);
          expect(neighbor).toEqual({
            q: hex.q + DIRECTIONS[index]!.q,
            r: hex.r + DIRECTIONS[index]!.r,
          });
        });
      }),
      RUNS,
    );
  });

  it('es simétrica: si b es vecino de a, a es vecino de b', () => {
    fc.assert(
      fc.property(arbHex, fc.integer({ min: 0, max: 5 }), (hex, index) => {
        const neighbor = hexNeighbors(hex)[index]!;

        expect(hexNeighbors(neighbor).map(key)).toContain(key(hex));
      }),
      RUNS,
    );
  });
});

describe('hexRing', () => {
  it('devuelve exactamente los hexágonos a la distancia pedida', () => {
    fc.assert(
      fc.property(arbHex, arbRadius, (center, radius) => {
        const ring = hexRing(center, radius);
        const expectedSize = radius === 0 ? 1 : 6 * radius;

        expect(ring).toHaveLength(expectedSize);
        expect(new Set(ring.map(key)).size).toBe(expectedSize);
        for (const hex of ring) {
          expect(hexDistance(center, hex)).toBe(radius);
        }
      }),
      RUNS,
    );
  });

  it('se recorre de forma contigua y cerrada', () => {
    fc.assert(
      fc.property(arbHex, fc.integer({ min: 1, max: 10 }), (center, radius) => {
        const ring = hexRing(center, radius);

        for (let i = 0; i < ring.length; i += 1) {
          expect(hexDistance(ring[i]!, ring[(i + 1) % ring.length]!)).toBe(1);
        }
      }),
      RUNS,
    );
  });

  it('empieza en la esquina Este y es equivariante por traslación', () => {
    fc.assert(
      fc.property(arbHex, arbRadius, (center, radius) => {
        const ring = hexRing(center, radius);

        expect(ring[0]).toEqual({
          q: center.q + DIRECTIONS[0].q * radius,
          r: center.r + DIRECTIONS[0].r * radius,
        });
        expect(ring).toEqual(
          hexRing(ORIGIN, radius).map(({ q, r }) => ({
            q: q + center.q,
            r: r + center.r,
          })),
        );
      }),
      RUNS,
    );
  });

  it('rechaza radios que no sean enteros no negativos', () => {
    fc.assert(
      fc.property(arbHex, arbInvalidRadius, (center, radius) => {
        expect(() => hexRing(center, radius)).toThrow(RangeError);
      }),
      RUNS,
    );
  });
});

// Feature: hextown-base-game, Property 1: Determinismo del generador de mapa
describe('Propiedad 1 (base): hexSpiral es el recorrido canónico del mapa', () => {
  it('devuelve el disco completo sin repeticiones y en orden de anillos', () => {
    fc.assert(
      fc.property(arbHex, arbRadius, (center, radius) => {
        const spiral = hexSpiral(center, radius);
        const distances = spiral.map((hex) => hexDistance(center, hex));

        expect(spiral).toHaveLength(1 + 3 * radius * (radius + 1));
        expect(new Set(spiral.map(key)).size).toBe(spiral.length);
        expect(spiral[0]).toEqual({ q: center.q, r: center.r });
        expect(distances).toEqual([...distances].sort((a, b) => a - b));
        expect(Math.max(...distances)).toBe(radius);
      }),
      RUNS,
    );
  });

  it('contiene todo hexágono a distancia menor o igual que el radio', () => {
    fc.assert(
      fc.property(
        arbRadius.chain((radius) =>
          fc.tuple(fc.constant(radius), arbHexInRadius(radius)),
        ),
        ([radius, hex]) => {
          expect(hexDistance(ORIGIN, hex)).toBeLessThanOrEqual(radius);
          expect(hexSpiral(ORIGIN, radius).map(key)).toContain(key(hex));
        },
      ),
      RUNS,
    );
  });

  it('el recorrido de radio n es prefijo del de radio n + 1', () => {
    // El Generador_De_Mapa consume tiradas en este orden, así que ampliar el
    // radio no puede reordenar los hexágonos ya recorridos.
    fc.assert(
      fc.property(arbHex, fc.integer({ min: 0, max: 9 }), (center, radius) => {
        expect(hexSpiral(center, radius + 1)).toEqual([
          ...hexSpiral(center, radius),
          ...hexRing(center, radius + 1),
        ]);
      }),
      RUNS,
    );
  });

  it('es una función pura: dos llamadas devuelven el mismo recorrido', () => {
    fc.assert(
      fc.property(arbHex, arbRadius, (center, radius) => {
        expect(hexSpiral(center, radius)).toEqual(hexSpiral(center, radius));
      }),
      RUNS,
    );
  });

  it('rechaza radios que no sean enteros no negativos', () => {
    fc.assert(
      fc.property(arbHex, arbInvalidRadius, (center, radius) => {
        expect(() => hexSpiral(center, radius)).toThrow(RangeError);
      }),
      RUNS,
    );
  });
});

describe('hexToPixel', () => {
  const arbSize = fc.double({ min: 1, max: 64, noNaN: true });

  it('es inyectiva: hexágonos distintos ocupan centros distintos', () => {
    fc.assert(
      fc.property(arbHex, arbHex, arbSize, (a, b, size) => {
        fc.pre(key(a) !== key(b));

        expect(hexToPixel(a, size)).not.toEqual(hexToPixel(b, size));
      }),
      RUNS,
    );
  });

  it('separa los centros adyacentes por la anchura del hexágono', () => {
    fc.assert(
      fc.property(arbHex, arbSize, (hex, size) => {
        const center = hexToPixel(hex, size);

        for (const neighbor of hexNeighbors(hex)) {
          const pixel = hexToPixel(neighbor, size);

          expect(Math.hypot(pixel.x - center.x, pixel.y - center.y)).toBeCloseTo(
            Math.sqrt(3) * size,
            6,
          );
        }
      }),
      RUNS,
    );
  });

  it('escala linealmente con el tamaño del hexágono', () => {
    fc.assert(
      fc.property(
        arbHex,
        arbSize,
        fc.integer({ min: 2, max: 8 }),
        (hex, size, factor) => {
          const single = hexToPixel(hex, size);
          const scaled = hexToPixel(hex, size * factor);

          expect(scaled.x).toBeCloseTo(single.x * factor, 6);
          expect(scaled.y).toBeCloseTo(single.y * factor, 6);
        },
      ),
      RUNS,
    );
  });

  it('sitúa el hexágono central en el origen', () => {
    fc.assert(
      fc.property(arbSize, (size) => {
        expect(hexToPixel(ORIGIN, size)).toEqual({ x: 0, y: 0 });
      }),
      RUNS,
    );
  });
});
