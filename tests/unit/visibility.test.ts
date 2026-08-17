/**
 * Tests unitarios del Gestor_De_Visibilidad (tarea 5.1).
 *
 * Cubren la visibilidad inicial por anillos, la transición atenuado → explorado
 * con atenuación de los vecinos ocultos, la ausencia de retrocesos y las dos
 * ramas de error de `revealHex`. Los invariantes generales sobre cualquier
 * secuencia de acciones son la Propiedad 3 (tarea 5.3); aquí se comprueban
 * sobre secuencias concretas.
 *
 * Requisitos: 2.1, 2.2, 2.7, 2.8, 2.9, 2.10, 2.11
 */
import { describe, expect, it } from 'vitest';
import { hexKey, hexNeighbors, hexRing, hexSpiral } from '../../src/core/hex-math.ts';
import type { AxialCoord } from '../../src/core/hex-math.ts';
import type { GameError, Result } from '../../src/core/result.ts';
import type { HexCell, HexMap, VisibilityState } from '../../src/core/types.ts';
import {
  getVisibility,
  initializeVisibility,
  revealHex,
} from '../../src/core/visibility.ts';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const CITY: AxialCoord = { q: 0, r: 0 };

/** Mapa con todos los hexágonos ocultos, como lo entrega el Generador_De_Mapa. */
function hiddenMap(center: AxialCoord, radius: number): HexMap {
  const cells = new Map<string, HexCell>();
  for (const coord of hexSpiral(center, radius)) {
    cells.set(hexKey(coord), {
      coord,
      terrain: 'prado',
      element: null,
      construction: null,
      visibility: 'hidden',
    });
  }
  return { radius, cells };
}

/** Estado de un hexágono del mapa; falla el test si el hexágono no existe. */
function stateAt(map: HexMap, coord: AxialCoord): VisibilityState {
  const state = getVisibility(map, coord);
  if (state === undefined) {
    throw new Error(`el mapa no tiene el hexágono ${hexKey(coord)}`);
  }
  return state;
}

/** Estados del anillo `radius`, sin repeticiones. */
function statesOfRing(map: HexMap, radius: number): Set<VisibilityState> {
  return new Set(hexRing(CITY, radius).map((coord) => stateAt(map, coord)));
}

/** Recuento de hexágonos por estado. */
function countByState(map: HexMap): Record<VisibilityState, number> {
  const counts: Record<VisibilityState, number> = { hidden: 0, dimmed: 0, explored: 0 };
  for (const cell of map.cells.values()) {
    counts[cell.visibility] += 1;
  }
  return counts;
}

/** Mapa devuelto por `revealHex`; falla el test si devolvió error. */
function expectOk(result: Result<HexMap>): HexMap {
  if (!result.ok) {
    throw new Error(`revelado fallido: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Error devuelto por `revealHex`; falla el test si devolvió un mapa. */
function expectErr(result: Result<HexMap>): GameError {
  if (result.ok) {
    throw new Error('se esperaba un error y se obtuvo un mapa');
  }
  return result.error;
}

// ---------------------------------------------------------------------------
// initializeVisibility (Requisitos 2.1, 2.2)
// ---------------------------------------------------------------------------

describe('initializeVisibility', () => {
  it('explora la Ciudad y el anillo 1, atenúa el anillo 2 y oculta el resto', () => {
    const map = initializeVisibility(hiddenMap(CITY, 4), CITY);

    expect(stateAt(map, CITY)).toBe('explored');
    expect(statesOfRing(map, 1)).toEqual(new Set(['explored']));
    expect(statesOfRing(map, 2)).toEqual(new Set(['dimmed']));
    expect(statesOfRing(map, 3)).toEqual(new Set(['hidden']));
    expect(statesOfRing(map, 4)).toEqual(new Set(['hidden']));
  });

  it('da a cada hexágono del mapa exactamente un estado', () => {
    const map = initializeVisibility(hiddenMap(CITY, 4), CITY);

    // Mapa de radio 4: 61 hexágonos, 7 explorados (centro y anillo 1),
    // 12 atenuados (anillo 2) y 42 ocultos (anillos 3 y 4).
    expect(map.cells.size).toBe(61);
    expect(countByState(map)).toEqual({ explored: 7, dimmed: 12, hidden: 42 });
  });

  it('no crea hexágonos que el mapa no contiene', () => {
    // Radio 1: no hay anillo 2 que atenuar y el mapa no crece.
    const map = initializeVisibility(hiddenMap(CITY, 1), CITY);

    expect(map.cells.size).toBe(7);
    expect(countByState(map)).toEqual({ explored: 7, dimmed: 0, hidden: 0 });
  });

  it('mide las distancias desde la Ciudad recibida, no desde el origen', () => {
    const city: AxialCoord = { q: 2, r: -1 };
    const map = initializeVisibility(hiddenMap(city, 3), city);

    expect(stateAt(map, city)).toBe('explored');
    expect(stateAt(map, { q: 3, r: -1 })).toBe('explored');
    expect(stateAt(map, { q: 4, r: -1 })).toBe('dimmed');
    expect(stateAt(map, { q: 5, r: -1 })).toBe('hidden');
  });

  it('devuelve un mapa nuevo sin tocar el recibido', () => {
    const original = hiddenMap(CITY, 3);

    const map = initializeVisibility(original, CITY);

    expect(map).not.toBe(original);
    expect(map.cells).not.toBe(original.cells);
    expect(map.radius).toBe(original.radius);
    expect(countByState(original)).toEqual({ explored: 0, dimmed: 0, hidden: 37 });
  });

  it('conserva el terreno y el elemento de cada celda', () => {
    const original = hiddenMap(CITY, 2);
    const cell = original.cells.get(hexKey({ q: 1, r: 0 }));
    if (cell === undefined) {
      throw new Error('falta el hexágono (1, 0)');
    }
    original.cells.set(hexKey({ q: 1, r: 0 }), {
      ...cell,
      terrain: 'tundra',
      element: { id: 'vaca', category: 'domestic_animal' },
    });

    const map = initializeVisibility(original, CITY);
    const initialized = map.cells.get(hexKey({ q: 1, r: 0 }));

    expect(initialized?.terrain).toBe('tundra');
    expect(initialized?.element).toEqual({ id: 'vaca', category: 'domestic_animal' });
    expect(initialized?.visibility).toBe('explored');
  });

  it('no retrocede el estado de un mapa ya avanzado (Requisitos 2.8, 2.10)', () => {
    const inicial = initializeVisibility(hiddenMap(CITY, 4), CITY);
    // (2, 0) está en el anillo 2, atenuado; al revelarlo atenúa a (3, 0).
    const avanzado = expectOk(revealHex(inicial, { q: 2, r: 0 }));

    const reinicializado = initializeVisibility(avanzado, CITY);

    expect(stateAt(reinicializado, { q: 2, r: 0 })).toBe('explored');
    expect(stateAt(reinicializado, { q: 3, r: 0 })).toBe('dimmed');
  });

  it('lanza RangeError si la Ciudad no pertenece al mapa', () => {
    expect(() => initializeVisibility(hiddenMap(CITY, 2), { q: 9, r: -9 })).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// revealHex (Requisitos 2.7, 2.8, 2.9, 2.10, 2.11)
// ---------------------------------------------------------------------------

describe('revealHex', () => {
  it('marca el hexágono atenuado como explorado y atenúa sus vecinos ocultos', () => {
    const inicial = initializeVisibility(hiddenMap(CITY, 4), CITY);

    const map = expectOk(revealHex(inicial, { q: 2, r: 0 }));

    expect(stateAt(map, { q: 2, r: 0 })).toBe('explored');
    // De los seis vecinos, los tres del anillo 3 pasan de oculto a atenuado,
    // el del anillo 1 sigue explorado y los dos del anillo 2 siguen atenuados.
    expect(stateAt(map, { q: 3, r: 0 })).toBe('dimmed');
    expect(stateAt(map, { q: 3, r: -1 })).toBe('dimmed');
    expect(stateAt(map, { q: 2, r: 1 })).toBe('dimmed');
    expect(stateAt(map, { q: 1, r: 0 })).toBe('explored');
    expect(stateAt(map, { q: 2, r: -1 })).toBe('dimmed');
    expect(stateAt(map, { q: 1, r: 1 })).toBe('dimmed');
  });

  it('solo cambia el hexágono revelado y sus vecinos ocultos', () => {
    const inicial = initializeVisibility(hiddenMap(CITY, 4), CITY);

    const map = expectOk(revealHex(inicial, { q: 2, r: 0 }));

    // Un explorado más, tres ocultos que pasan a atenuados y un atenuado que
    // pasa a explorado: 12 - 1 + 3 = 14 atenuados y 42 - 3 = 39 ocultos.
    expect(countByState(map)).toEqual({ explored: 8, dimmed: 14, hidden: 39 });
    expect(map.cells.size).toBe(inicial.cells.size);
  });

  it('devuelve un mapa nuevo sin tocar el recibido', () => {
    const inicial = initializeVisibility(hiddenMap(CITY, 3), CITY);

    const map = expectOk(revealHex(inicial, { q: 2, r: 0 }));

    expect(map).not.toBe(inicial);
    expect(map.cells).not.toBe(inicial.cells);
    expect(stateAt(inicial, { q: 2, r: 0 })).toBe('dimmed');
    expect(stateAt(inicial, { q: 3, r: 0 })).toBe('hidden');
  });

  it('conserva el resto de la celda revelada', () => {
    const base = hiddenMap(CITY, 3);
    const cell = base.cells.get(hexKey({ q: 2, r: 0 }));
    if (cell === undefined) {
      throw new Error('falta el hexágono (2, 0)');
    }
    base.cells.set(hexKey({ q: 2, r: 0 }), {
      ...cell,
      terrain: 'desierto',
      element: { id: 'lobos', category: 'animal_threat' },
    });

    const map = expectOk(revealHex(initializeVisibility(base, CITY), { q: 2, r: 0 }));
    const revelada = map.cells.get(hexKey({ q: 2, r: 0 }));

    expect(revelada?.terrain).toBe('desierto');
    expect(revelada?.element).toEqual({ id: 'lobos', category: 'animal_threat' });
  });

  it('no crea hexágonos fuera del mapa al atenuar el borde', () => {
    // Radio 2: al revelar un hexágono del anillo 2 sus vecinos del anillo 3 no
    // existen y no deben aparecer.
    const inicial = initializeVisibility(hiddenMap(CITY, 2), CITY);

    const map = expectOk(revealHex(inicial, { q: 2, r: 0 }));

    expect(map.cells.size).toBe(19);
    expect(getVisibility(map, { q: 3, r: 0 })).toBeUndefined();
    expect(countByState(map)).toEqual({ explored: 8, dimmed: 11, hidden: 0 });
  });

  it('mantiene los invariantes de visibilidad al revelar el anillo 2 completo', () => {
    let map = initializeVisibility(hiddenMap(CITY, 4), CITY);

    for (const coord of hexRing(CITY, 2)) {
      map = expectOk(revealHex(map, coord));
    }

    expect(countByState(map)).toEqual({ explored: 19, dimmed: 18, hidden: 24 });
    for (const cell of map.cells.values()) {
      const vecinos = hexNeighbors(cell.coord)
        .map((neighbor) => getVisibility(map, neighbor))
        .filter((state) => state !== undefined);

      if (cell.visibility === 'dimmed') {
        // Requisito 2.9
        expect(vecinos).toContain('explored');
      }
      if (cell.visibility === 'hidden') {
        // Requisito 2.11
        expect(vecinos).not.toContain('explored');
      }
    }
  });

  it('rechaza un hexágono oculto con only_dimmed_can_be_explored', () => {
    const inicial = initializeVisibility(hiddenMap(CITY, 4), CITY);

    const error = expectErr(revealHex(inicial, { q: 3, r: 0 }));

    expect(error.code).toBe('only_dimmed_can_be_explored');
    expect(error.context).toEqual({ hex: '3,0', visibility: 'hidden' });
    expect(error.message).toContain('atenuados');
  });

  it('rechaza un hexágono ya explorado y conserva su estado (Requisito 2.8)', () => {
    const inicial = initializeVisibility(hiddenMap(CITY, 4), CITY);

    const error = expectErr(revealHex(inicial, CITY));

    expect(error.code).toBe('only_dimmed_can_be_explored');
    expect(error.context).toEqual({ hex: '0,0', visibility: 'explored' });
    expect(stateAt(inicial, CITY)).toBe('explored');
  });

  it('rechaza una coordenada ajena al mapa con hex_outside_map', () => {
    const inicial = initializeVisibility(hiddenMap(CITY, 2), CITY);

    const error = expectErr(revealHex(inicial, { q: 9, r: -9 }));

    expect(error.code).toBe('hex_outside_map');
    expect(error.context).toEqual({ hex: '9,-9' });
  });
});

// ---------------------------------------------------------------------------
// getVisibility
// ---------------------------------------------------------------------------

describe('getVisibility', () => {
  it('devuelve el estado del hexágono del mapa', () => {
    const map = initializeVisibility(hiddenMap(CITY, 3), CITY);

    expect(getVisibility(map, CITY)).toBe('explored');
    expect(getVisibility(map, { q: 2, r: 0 })).toBe('dimmed');
    expect(getVisibility(map, { q: 3, r: 0 })).toBe('hidden');
  });

  it('devuelve undefined si el hexágono no pertenece al mapa', () => {
    const map = initializeVisibility(hiddenMap(CITY, 1), CITY);

    expect(getVisibility(map, { q: 4, r: 0 })).toBeUndefined();
  });
});
