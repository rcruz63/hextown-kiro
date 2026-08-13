/**
 * Tests unitarios del Generador_De_Mapa (tarea 4.1).
 *
 * Cubren el mapa del escenario real `valle_inicial` y escenarios sintéticos que
 * fuerzan cada rama del algoritmo: colocación por densidad, nivel de las
 * amenazas por distancia, agotamiento de intentos y restricciones no
 * reconocidas.
 *
 * Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 1.10, 1.11, 1.12, 1.13,
 * 1.14, 1.15
 */
import { describe, expect, it } from 'vitest';
import { hexDistance, hexKey, hexNeighbors } from '../../src/core/hex-math.ts';
import { CITY_COORD, generateMap } from '../../src/core/map-generator.ts';
import type { GenerationResult, MapGenerationData } from '../../src/core/map-generator.ts';
import type { HexCell, HexMap, ThreatElement } from '../../src/core/types.ts';
import { loadAll } from '../../src/data/loader.ts';
import type { DataSource, GameData, ScenarioDef } from '../../src/data/loader.ts';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function source(path: string, content: string): DataSource {
  return { path, content };
}

/** Carga las fuentes y falla el test si el cargador devolvió errores. */
function loadData(sources: DataSource[]): GameData {
  const result = loadAll(sources);
  if (!result.ok) {
    throw new Error(`carga fallida: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

function scenarioOf(data: GameData, id: string): ScenarioDef {
  const scenario = data.scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) {
    throw new Error(`el escenario ${id} no se ha cargado`);
  }
  return scenario;
}

/** Devuelve el mapa generado y falla el test si la generación no tuvo éxito. */
function expectMap(result: GenerationResult): HexMap {
  if (!result.ok) {
    throw new Error(`generación fallida: ${JSON.stringify(result, null, 2)}`);
  }
  return result.map;
}

function cellAt(map: HexMap, q: number, r: number): HexCell {
  const cell = map.cells.get(hexKey({ q, r }));
  if (cell === undefined) {
    throw new Error(`el mapa no tiene el hexágono (${String(q)}, ${String(r)})`);
  }
  return cell;
}

/** Amenaza del hexágono, o `undefined` si su elemento no es una amenaza. */
function threatOf(cell: HexCell): ThreatElement | undefined {
  const element = cell.element;
  if (element === null) {
    return undefined;
  }
  return element.category === 'animal_threat' || element.category === 'human_threat'
    ? (element as ThreatElement)
    : undefined;
}

/** Huella comparable de un mapa: terreno, elemento y nivel de amenaza por hex. */
function fingerprint(map: HexMap): string {
  return [...map.cells.entries()]
    .map(([key, cell]) => {
      const threat = threatOf(cell);
      const level = threat === undefined ? '' : `:${String(threat.level)}`;
      return `${key}|${cell.terrain}|${cell.element?.id ?? '-'}${level}`;
    })
    .join(';');
}

function cells(map: HexMap): HexCell[] {
  return [...map.cells.values()];
}

function countElements(map: HexMap, predicate: (cell: HexCell) => boolean): number {
  return cells(map).filter(predicate).length;
}

// ---------------------------------------------------------------------------
// Escenarios sintéticos
// ---------------------------------------------------------------------------

const RULES_YAML = `
day:
  fragments: 5
`;

const CONSTRUCTIONS_YAML = `
constructions:
  - id: ciudad
    allowed_terrains: [prado, tundra]
    levels:
      - level: 1
        build_time: 1
        employs: 2
`;

const ELEMENTS_YAML = `
elements:
  - id: bosque
    category: forest
    allowed_terrains: [prado, tundra]
  - id: lobos
    category: animal_threat
    allowed_terrains: [prado]
`;

/** Escenario mínimo con el bloque `map` que se le indique. */
function syntheticData(mapYaml: string): { data: GameData; scenario: ScenarioDef } {
  const data = loadData([
    source('data/rules.yaml', RULES_YAML),
    source('data/constructions.yaml', CONSTRUCTIONS_YAML),
    source('data/elements.yaml', ELEMENTS_YAML),
    source(
      'data/scenarios/prueba.yaml',
      `
scenario:
  id: prueba
  map:
${mapYaml}
`,
    ),
  ]);
  return { data, scenario: scenarioOf(data, 'prueba') };
}

// ---------------------------------------------------------------------------
// Ficheros reales de `data/`
// ---------------------------------------------------------------------------

/** Contenido en bruto de todos los ficheros de datos del juego. */
const REAL_YAML: Record<string, string> = import.meta.glob('../../data/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const REAL_DATA = loadData(
  Object.entries(REAL_YAML).map(([path, content]) => ({
    path: path.replace('../../', ''),
    content,
  })),
);
const VALLE_INICIAL = scenarioOf(REAL_DATA, 'valle_inicial');

/** Semillas con las que se comprueba el escenario publicado. */
const SEEDS = [1, 42, 12345, 987654321, -7];

describe('generateMap: escenario valle_inicial', () => {
  it('construye un mapa del radio declarado con todas sus celdas (Requisito 1.1)', () => {
    const map = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, 12345));
    const radius = 8;

    expect(map.radius).toBe(radius);
    expect(map.cells.size).toBe(1 + 3 * radius * (radius + 1));
    for (const cell of cells(map)) {
      expect(hexDistance(CITY_COORD, cell.coord)).toBeLessThanOrEqual(radius);
    }
  });

  it('sitúa la Ciudad de nivel 1 en el centro, sin elemento y en terreno permitido (Requisito 1.2)', () => {
    const city = REAL_DATA.constructions.find((construction) => construction.id === 'ciudad');
    const allowed = city?.allowedTerrains ?? [];

    expect(allowed.length).toBeGreaterThan(0);

    for (const seed of SEEDS) {
      const map = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, seed));
      const center = cellAt(map, 0, 0);

      expect(allowed, `semilla ${String(seed)}`).toContain(center.terrain);
      expect(center.element).toBeNull();
      expect(center.construction).toEqual({
        id: 'ciudad',
        level: 1,
        workers: 0,
        completedDay: 1,
        completedFragment: 0,
        mountedOnElement: null,
        upgradeInProgress: null,
      });
      expect(
        countElements(map, (cell) => cell.construction !== null),
        'solo la Ciudad está construida al empezar',
      ).toBe(1);
    }
  });

  it('usa solo los terrenos del reparto declarado (Requisito 1.3)', () => {
    const declared = new Set(Object.keys(VALLE_INICIAL.map?.terrainWeights ?? {}));
    const map = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, 42));
    const used = new Set(cells(map).map((cell) => cell.terrain));

    expect(declared.size).toBeGreaterThan(0);
    for (const terrain of used) {
      expect(declared).toContain(terrain);
    }
  });

  it('coloca cada elemento en un terreno de sus allowed_terrains (Requisito 1.4)', () => {
    const allowedById = new Map(
      REAL_DATA.elements.map((element) => [element.id, new Set(element.allowedTerrains ?? [])]),
    );

    for (const seed of SEEDS) {
      const map = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, seed));

      for (const cell of cells(map)) {
        if (cell.element === null) continue;

        expect(
          allowedById.get(cell.element.id),
          `${cell.element.id} en ${cell.terrain} (semilla ${String(seed)})`,
        ).toContain(cell.terrain);
      }
    }
  });

  it('entrega un mapa que cumple todas las restricciones del escenario (Requisitos 1.5, 1.15)', () => {
    const constraints = VALLE_INICIAL.map?.constraints ?? {};

    for (const seed of SEEDS) {
      const map = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, seed));
      const label = `semilla ${String(seed)}`;
      const meadows = countElements(map, (cell) => cell.terrain === 'prado');
      const adjacentMeadows = hexNeighbors(CITY_COORD).filter(
        (neighbor) => map.cells.get(hexKey(neighbor))?.terrain === 'prado',
      ).length;
      const humanThreatDistances = cells(map)
        .filter((cell) => cell.element?.category === 'human_threat')
        .map((cell) => hexDistance(CITY_COORD, cell.coord));

      expect(adjacentMeadows, label).toBeGreaterThanOrEqual(
        constraints['prados_adyacentes_a_ciudad_minimo'] as number,
      );
      expect((100 * meadows) / map.cells.size, label).toBeGreaterThanOrEqual(
        constraints['porcentaje_prado_minimo'] as number,
      );
      expect(
        countElements(map, (cell) => cell.element?.category === 'mountain'),
        label,
      ).toBeGreaterThanOrEqual(constraints['montanas_minimas'] as number);
      expect(
        countElements(map, (cell) => cell.element?.category === 'forest'),
        label,
      ).toBeGreaterThanOrEqual(constraints['bosques_minimos'] as number);
      expect(
        countElements(map, (cell) => threatOf(cell) !== undefined),
        label,
      ).toBeLessThanOrEqual(constraints['amenazas_maximas'] as number);
      for (const distance of humanThreatDistances) {
        expect(distance, label).toBeGreaterThanOrEqual(
          constraints['distancia_minima_amenaza_humana'] as number,
        );
      }
    }
  });

  it('asigna a cada amenaza el nivel de su anillo, sin daño y aparecida el día 1 (Requisitos 1.10, 1.11, 1.14)', () => {
    const perRing = (VALLE_INICIAL.map?.constraints?.['nivel_amenaza_por_anillo'] ??
      0) as number;

    for (const seed of SEEDS) {
      const map = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, seed));
      const threats = cells(map).flatMap((cell) => {
        const threat = threatOf(cell);
        return threat === undefined ? [] : [{ threat, distance: hexDistance(CITY_COORD, cell.coord) }];
      });

      expect(threats.length).toBeGreaterThan(0);

      for (const { threat, distance } of threats) {
        expect(threat.level, `${threat.id} a distancia ${String(distance)}`).toBe(
          1 + Math.floor(distance * perRing),
        );
        expect(threat.accumulatedDamage).toBe(0);
        expect(threat.appearedDay).toBe(1);
      }
    }
  });

  it('produce el mismo mapa para la misma semilla y distintos para semillas distintas (Requisito 1.12)', () => {
    const first = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, 12345));
    const second = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, 12345));
    const other = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, 12346));

    expect(fingerprint(first)).toBe(fingerprint(second));
    expect(fingerprint(first)).not.toBe(fingerprint(other));
  });

  it('deja todos los hexágonos ocultos: la visibilidad inicial es del Gestor_De_Visibilidad', () => {
    const map = expectMap(generateMap(REAL_DATA, VALLE_INICIAL, 1));

    for (const cell of cells(map)) {
      expect(cell.visibility).toBe('hidden');
    }
  });

  it('informa del número de candidatos generados', () => {
    const result = generateMap(REAL_DATA, VALLE_INICIAL, 12345);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBeGreaterThanOrEqual(1);
      expect(result.seed).toBe(12345);
    }
  });
});

describe('generateMap: colocación de elementos', () => {
  it('coloca min(redondeo(densidad × elegibles), disponibles) instancias (Requisito 1.4)', () => {
    // Radio 2 (19 hexágonos) todos de prado: los 19 son elegibles para el
    // bosque, pero el de la Ciudad no admite elemento.
    const { data, scenario } = syntheticData(`    radius: 2
    city_construction_id: ciudad
    terrain_weights:
      prado: 1
    element_density:
      bosque: 1.0
    constraints:
      intentos_maximos: 1
`);
    const map = expectMap(generateMap(data, scenario, 7));

    expect(map.cells.size).toBe(19);
    expect(countElements(map, (cell) => cell.element?.id === 'bosque')).toBe(18);
    expect(cellAt(map, 0, 0).element).toBeNull();
  });

  it('respeta la densidad parcial y el orden declarado de los elementos (Requisito 1.4)', () => {
    // 19 hexágonos: bosque redondea 19 × 0.5 = 10 (se coloca primero) y lobos
    // redondea 19 × 0.3 = 6 sobre los 8 que quedan libres.
    const { data, scenario } = syntheticData(`    radius: 2
    city_construction_id: ciudad
    terrain_weights:
      prado: 1
    element_density:
      bosque: 0.5
      lobos: 0.3
    constraints:
      intentos_maximos: 1
`);
    const map = expectMap(generateMap(data, scenario, 3));

    expect(countElements(map, (cell) => cell.element?.id === 'bosque')).toBe(10);
    expect(countElements(map, (cell) => cell.element?.id === 'lobos')).toBe(6);
  });

  it('asigna el nivel de la amenaza por anillo (Requisitos 1.10, 1.14)', () => {
    const { data, scenario } = syntheticData(`    radius: 2
    city_construction_id: ciudad
    terrain_weights:
      prado: 1
    element_density:
      lobos: 1.0
    constraints:
      nivel_amenaza_por_anillo: 0.5
      intentos_maximos: 1
`);
    const map = expectMap(generateMap(data, scenario, 11));

    for (const cell of cells(map)) {
      const threat = threatOf(cell);
      const distance = hexDistance(CITY_COORD, cell.coord);

      if (distance === 0) {
        expect(threat).toBeUndefined();
        continue;
      }

      expect(threat?.level, `distancia ${String(distance)}`).toBe(distance === 1 ? 1 : 2);
      expect(threat?.lastExpansionDay).toBe(1);
    }
  });
});

describe('generateMap: fallos de generación', () => {
  it('agota los intentos y devuelve semilla, candidatos y violaciones (Requisitos 1.6, 1.7)', () => {
    // Sin elementos de categoría `mountain` la restricción nunca se cumple.
    const { data, scenario } = syntheticData(`    radius: 2
    city_construction_id: ciudad
    terrain_weights:
      prado: 1
    element_density:
      bosque: 0.5
    constraints:
      montanas_minimas: 5
      intentos_maximos: 4
`);
    const result = generateMap(data, scenario, 99);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'max_attempts') {
      throw new Error(`se esperaba max_attempts: ${JSON.stringify(result)}`);
    }
    expect(result.seed).toBe(99);
    expect(result.attempts).toBe(4);
    expect(result.lastViolations).toEqual([
      { key: 'montanas_minimas', required: 5, actual: 0 },
    ]);
  });

  it('acepta el mapa en cuanto un candidato cumple las restricciones (Requisito 1.6)', () => {
    // Prado y tundra pesan igual, así que exigir un 60 % de prado descarta la
    // mayoría de los candidatos: el mapa entregado cumple la restricción y hace
    // falta más de un intento para encontrarlo.
    const { data, scenario } = syntheticData(`    radius: 3
    city_construction_id: ciudad
    terrain_weights:
      prado: 1
      tundra: 1
    element_density: {}
    constraints:
      porcentaje_prado_minimo: 60
      intentos_maximos: 200
`);
    const result = generateMap(data, scenario, 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const meadows = countElements(result.map, (cell) => cell.terrain === 'prado');

    expect(result.attempts).toBeGreaterThan(1);
    expect((100 * meadows) / result.map.cells.size).toBeGreaterThanOrEqual(60);
  });

  it('aborta indicando la clave de restricción que no sabe evaluar (Requisito 1.9)', () => {
    const { data, scenario } = syntheticData(`    radius: 2
    city_construction_id: ciudad
    terrain_weights:
      prado: 1
    element_density: {}
    constraints:
      lagos_minimos: 3
      intentos_maximos: 1
`);
    const result = generateMap(data, scenario, 1);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'unknown_constraint') {
      throw new Error(`se esperaba unknown_constraint: ${JSON.stringify(result)}`);
    }
    expect(result.key).toBe('lagos_minimos');
  });

  it('rechaza un escenario sin radio declarado', () => {
    const { data, scenario } = syntheticData(`    city_construction_id: ciudad
    terrain_weights:
      prado: 1
    element_density: {}
    constraints:
      intentos_maximos: 1
`);
    const result = generateMap(data, scenario, 1);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'invalid_scenario') {
      throw new Error(`se esperaba invalid_scenario: ${JSON.stringify(result)}`);
    }
    expect(result.errors.map((error) => error.context?.['path'])).toContain('scenario.map.radius');
  });

  it('rechaza un escenario cuyo reparto no admite ningún terreno de la Ciudad (Requisito 1.2)', () => {
    const { data, scenario } = syntheticData(`    radius: 1
    city_construction_id: ciudad
    terrain_weights:
      oceano: 1
    element_density: {}
    constraints:
      intentos_maximos: 1
`);
    const result = generateMap(data, scenario, 1);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'invalid_scenario') {
      throw new Error(`se esperaba invalid_scenario: ${JSON.stringify(result)}`);
    }
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('acepta cualquier `GameData` como fuente de elementos y construcciones', () => {
    const data: MapGenerationData = REAL_DATA;

    expect(data.elements.length).toBeGreaterThan(0);
    expect(generateMap(data, VALLE_INICIAL, 2024).ok).toBe(true);
  });
});
