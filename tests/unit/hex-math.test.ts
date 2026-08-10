/**
 * Tests unitarios de las matemáticas hexagonales (tarea 1.2).
 *
 * Cubren el orden fijo de `DIRECTIONS`, la distancia axial, la estructura de
 * anillos y espirales y la conversión a píxeles pointy-top.
 *
 * Requisitos: 1.1, 2.9
 */
import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  hexDistance,
  hexNeighbors,
  hexRing,
  hexSpiral,
  hexToPixel,
} from '../../src/core/hex-math.ts';

const CENTER = { q: 0, r: 0 };

describe('DIRECTIONS', () => {
  it('declara las seis direcciones en orden E, NE, NW, W, SW, SE', () => {
    expect(DIRECTIONS).toEqual([
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ]);
  });

  it('sitúa las seis direcciones a distancia 1 del origen', () => {
    for (const direction of DIRECTIONS) {
      expect(hexDistance(CENTER, direction)).toBe(1);
    }
  });
});

describe('hexDistance', () => {
  it('devuelve 0 para el mismo hexágono', () => {
    expect(hexDistance({ q: 3, r: -2 }, { q: 3, r: -2 })).toBe(0);
  });

  it('devuelve 1 entre hexágonos adyacentes', () => {
    expect(hexDistance({ q: 2, r: -1 }, { q: 2, r: 0 })).toBe(1);
  });

  it('mide el camino más corto atravesando el mapa', () => {
    // (0,0) → (3,-1): tres pasos E y uno NE compartiendo tramo.
    expect(hexDistance(CENTER, { q: 3, r: -1 })).toBe(3);
    expect(hexDistance(CENTER, { q: -2, r: 3 })).toBe(3);
    expect(hexDistance({ q: -1, r: 2 }, { q: 2, r: -3 })).toBe(5);
  });

  it('es simétrica', () => {
    const a = { q: -4, r: 1 };
    const b = { q: 2, r: 2 };

    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
  });
});

describe('hexNeighbors', () => {
  it('devuelve los seis vecinos en el orden de DIRECTIONS', () => {
    expect(hexNeighbors({ q: 2, r: -3 })).toEqual([
      { q: 3, r: -3 },
      { q: 3, r: -4 },
      { q: 2, r: -4 },
      { q: 1, r: -3 },
      { q: 1, r: -2 },
      { q: 2, r: -2 },
    ]);
  });

  it('devuelve vecinos distintos y todos a distancia 1', () => {
    const coord = { q: -1, r: 4 };
    const neighbors = hexNeighbors(coord);
    const keys = new Set(neighbors.map(({ q, r }) => `${q},${r}`));

    expect(keys.size).toBe(6);
    for (const neighbor of neighbors) {
      expect(hexDistance(coord, neighbor)).toBe(1);
    }
  });
});

describe('hexRing', () => {
  it('devuelve solo el centro con radio 0', () => {
    expect(hexRing({ q: 1, r: 1 }, 0)).toEqual([{ q: 1, r: 1 }]);
  });

  it('empieza en la esquina Este y recorre el anillo de radio 1', () => {
    expect(hexRing(CENTER, 1)).toEqual([
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ]);
  });

  it('devuelve 6 × radio hexágonos, todos a la distancia pedida', () => {
    const center = { q: -2, r: 5 };

    for (const radius of [1, 2, 3, 8]) {
      const ring = hexRing(center, radius);

      expect(ring).toHaveLength(6 * radius);
      for (const hex of ring) {
        expect(hexDistance(center, hex)).toBe(radius);
      }
    }
  });

  it('recorre el anillo de forma contigua y cerrada', () => {
    const ring = hexRing(CENTER, 3);

    for (let i = 0; i < ring.length; i += 1) {
      const current = ring[i]!;
      const next = ring[(i + 1) % ring.length]!;

      expect(hexDistance(current, next)).toBe(1);
    }
  });

  it('no repite hexágonos', () => {
    const ring = hexRing(CENTER, 4);
    const keys = new Set(ring.map(({ q, r }) => `${q},${r}`));

    expect(keys.size).toBe(ring.length);
  });

  it('rechaza radios negativos o fraccionarios', () => {
    expect(() => hexRing(CENTER, -1)).toThrow(RangeError);
    expect(() => hexRing(CENTER, 1.5)).toThrow(RangeError);
  });
});

describe('hexSpiral', () => {
  it('devuelve solo el centro con radio 0', () => {
    expect(hexSpiral({ q: 4, r: -4 }, 0)).toEqual([{ q: 4, r: -4 }]);
  });

  it('devuelve 1 + 3 × radio × (radio + 1) hexágonos sin repeticiones', () => {
    const center = { q: 1, r: -1 };

    for (const radius of [0, 1, 2, 3, 8]) {
      const spiral = hexSpiral(center, radius);
      const keys = new Set(spiral.map(({ q, r }) => `${q},${r}`));

      expect(spiral).toHaveLength(1 + 3 * radius * (radius + 1));
      expect(keys.size).toBe(spiral.length);
    }
  });

  it('empieza en el centro y ordena por anillos de radio creciente', () => {
    const spiral = hexSpiral(CENTER, 3);

    expect(spiral[0]).toEqual(CENTER);

    const distances = spiral.map((hex) => hexDistance(CENTER, hex));
    const sorted = [...distances].sort((a, b) => a - b);

    expect(distances).toEqual(sorted);
    expect(distances.at(-1)).toBe(3);
  });

  it('concatena el centro con cada anillo en el orden de hexRing', () => {
    const center = { q: -3, r: 2 };

    expect(hexSpiral(center, 2)).toEqual([
      center,
      ...hexRing(center, 1),
      ...hexRing(center, 2),
    ]);
  });

  it('rechaza radios negativos o fraccionarios', () => {
    expect(() => hexSpiral(CENTER, -2)).toThrow(RangeError);
    expect(() => hexSpiral(CENTER, 2.25)).toThrow(RangeError);
  });
});

describe('hexToPixel', () => {
  const SIZE = 32;

  it('sitúa el hexágono central en el origen', () => {
    expect(hexToPixel(CENTER, SIZE)).toEqual({ x: 0, y: 0 });
  });

  it('separa los hexágonos de la misma fila por la anchura completa', () => {
    const origin = hexToPixel(CENTER, SIZE);
    const east = hexToPixel({ q: 1, r: 0 }, SIZE);

    expect(east.x - origin.x).toBeCloseTo(Math.sqrt(3) * SIZE, 10);
    expect(east.y).toBe(origin.y);
  });

  it('desplaza las filas media anchura y tres cuartos de alto', () => {
    const below = hexToPixel({ q: 0, r: 1 }, SIZE);

    expect(below.x).toBeCloseTo((Math.sqrt(3) / 2) * SIZE, 10);
    expect(below.y).toBeCloseTo(1.5 * SIZE, 10);
  });

  it('mantiene los vecinos a una distancia en píxeles igual a la anchura', () => {
    const origin = hexToPixel(CENTER, SIZE);

    for (const neighbor of hexNeighbors(CENTER)) {
      const pixel = hexToPixel(neighbor, SIZE);
      const distance = Math.hypot(pixel.x - origin.x, pixel.y - origin.y);

      expect(distance).toBeCloseTo(Math.sqrt(3) * SIZE, 10);
    }
  });

  it('escala linealmente con el tamaño', () => {
    const coord = { q: 2, r: -3 };
    const single = hexToPixel(coord, 1);
    const scaled = hexToPixel(coord, 10);

    expect(scaled.x).toBeCloseTo(single.x * 10, 10);
    expect(scaled.y).toBeCloseTo(single.y * 10, 10);
  });
});
