/**
 * Tests de propiedades del Generador_De_Mapa (tarea 4.2).
 *
 * Los tests unitarios de la tarea 4.1 comprueban el escenario publicado
 * `valle_inicial` con un puñado de semillas fijas. Aquí se cubre el espacio de
 * escenarios: radio, reparto de terrenos, terrenos de la Ciudad, catálogo de
 * elementos con sus densidades y terrenos permitidos, nivel de amenaza por
 * anillo, restricciones e intentos máximos se sortean, y de cada escenario
 * sintético se emiten los ficheros YAML que carga el Cargador_De_Datos, de modo
 * que el generador recibe exactamente el mismo tipo de datos que en partida.
 *
 * - **Propiedad 1: Determinismo del generador de mapa** — para cualquier
 *   escenario y semilla, dos ejecuciones producen mapas iguales en terreno,
 *   elemento, amenaza y nivel de amenaza; el resultado no depende de la
 *   identidad de los objetos de datos ni de generaciones anteriores, y los
 *   fallos también son reproducibles.
 * - **Propiedad 2: Invariantes estructurales del mapa generado** — cada
 *   hexágono contiene 0 o 1 elementos, los niveles de amenaza no decrecen con
 *   la distancia y todo mapa entregado cumple las restricciones declaradas.
 *
 * Las restricciones se evalúan aquí con una implementación independiente
 * (filtros sobre la lista de celdas) en vez de reutilizar la pasada única del
 * generador, para que sirva de oráculo y no de espejo.
 *
 * **Validates: Requirements 1.12, 1.13, 1.14, 1.15**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { hexDistance, hexKey, hexNeighbors, hexSpiral } from '../../src/core/hex-math.ts';
import { CITY_COORD, generateMap } from '../../src/core/map-generator.ts';
import type { GenerationResult } from '../../src/core/map-generator.ts';
import type {
  ElementCategory,
  HexCell,
  HexMap,
  TerrainType,
  ThreatElement,
} from '../../src/core/types.ts';
import { loadAll } from '../../src/data/loader.ts';
import type { DataSource, GameData, ScenarioDef } from '../../src/data/loader.ts';

/** Mínimo exigido por el diseño ("Configuración de tests de propiedades"). */
const RUNS = { numRuns: 100 } as const;

/**
 * Iteraciones de las propiedades que solo hablan de mapas *entregados*.
 *
 * Un escenario sorteado puede declarar restricciones que ningún candidato
 * cumpla, y ese caso no dice nada de las invariantes del mapa entregado. Se
 * sortean más escenarios de los 100 del diseño para que el mínimo de 100
 * iteraciones se cumpla sobre los mapas realmente entregados
 * ({@link MIN_DELIVERED}), no sobre los escenarios descartados.
 */
const DELIVERY_RUNS = { numRuns: 250 } as const;

/** Mapas entregados que cada propiedad de la Propiedad 2 debe alcanzar. */
const MIN_DELIVERED = 100;

const TERRAINS: readonly TerrainType[] = [
  'prado',
  'tundra',
  'desierto',
  'no_fertil',
  'oceano',
];

const CATEGORIES: readonly ElementCategory[] = [
  'mountain',
  'forest',
  'domestic_animal',
  'fish',
  'whale',
  'settlement',
  'mystery',
  'animal_threat',
  'human_threat',
];

const THREAT_CATEGORIES: readonly ElementCategory[] = ['animal_threat', 'human_threat'];

/** Identificador de la construcción que hace de Ciudad en los escenarios sintéticos. */
const CITY_ID = 'ciudad';

// ---------------------------------------------------------------------------
// Escenario sintético
// ---------------------------------------------------------------------------

/** Elemento declarado en `elements.yaml` con su densidad en el escenario. */
interface ElementSpec {
  id: string;
  category: ElementCategory;
  allowedTerrains: TerrainType[];
  density: number;
}

/** Escenario sintético del que se derivan los ficheros YAML de una ejecución. */
interface ScenarioSpec {
  radius: number;
  /** Terrenos con peso mayor que 0: los únicos que pueden aparecer en el mapa. */
  weights: [TerrainType, number][];
  /** Terrenos declarados con peso 0: el generador los descarta del reparto. */
  zeroed: TerrainType[];
  /** `allowed_terrains` de la Ciudad, siempre dentro de los terrenos con peso. */
  cityTerrains: TerrainType[];
  cityWorkers: number;
  elements: ElementSpec[];
  constraints: Record<string, number>;
  maxAttempts: number;
  /** `nivel_amenaza_por_anillo`; `undefined` deja la clave sin declarar. */
  threatLevelPerRing: number | undefined;
}

/** Emite los ficheros de datos del escenario sintético. */
function buildSources(spec: ScenarioSpec): DataSource[] {
  const elements = spec.elements.flatMap((element) => [
    `  - id: ${element.id}`,
    `    category: ${element.category}`,
    `    allowed_terrains: [${element.allowedTerrains.join(', ')}]`,
  ]);

  const constructions = [
    'constructions:',
    `  - id: ${CITY_ID}`,
    `    allowed_terrains: [${spec.cityTerrains.join(', ')}]`,
    '    levels:',
    '      - level: 1',
    '        build_time: 1',
    `        employs: ${String(spec.cityWorkers)}`,
  ];

  const constraints = [
    ...Object.entries(spec.constraints).map(
      ([key, value]) => `      ${key}: ${String(value)}`,
    ),
    `      intentos_maximos: ${String(spec.maxAttempts)}`,
    ...(spec.threatLevelPerRing === undefined
      ? []
      : [`      nivel_amenaza_por_anillo: ${spec.threatLevelPerRing.toFixed(2)}`]),
  ];

  const scenario = [
    'scenario:',
    '  id: prueba',
    '  map:',
    `    radius: ${String(spec.radius)}`,
    `    city_construction_id: ${CITY_ID}`,
    '    terrain_weights:',
    ...spec.weights.map(([terrain, weight]) => `      ${terrain}: ${String(weight)}`),
    ...spec.zeroed.map((terrain) => `      ${terrain}: 0`),
    '    element_density:',
    ...spec.elements.map(
      (element) => `      ${element.id}: ${element.density.toFixed(2)}`,
    ),
    '    constraints:',
    ...constraints,
  ];

  return [
    { path: 'data/rules.yaml', content: 'day:\n  fragments: 5\n' },
    { path: 'data/constructions.yaml', content: `${constructions.join('\n')}\n` },
    { path: 'data/elements.yaml', content: `elements:\n${elements.join('\n')}\n` },
    { path: 'data/scenarios/prueba.yaml', content: `${scenario.join('\n')}\n` },
  ];
}

/** Carga el escenario sintético; un fallo de carga es un error del propio test. */
function loadSpec(spec: ScenarioSpec): { data: GameData; scenario: ScenarioDef } {
  const loaded = loadAll(buildSources(spec));
  if (!loaded.ok) {
    throw new Error(
      `el escenario sintético no carga: ${JSON.stringify(loaded.error, null, 2)}`,
    );
  }
  const scenario = loaded.value.scenarios.find((candidate) => candidate.id === 'prueba');
  if (scenario === undefined) {
    throw new Error('el escenario sintético no aparece entre los cargados');
  }
  return { data: loaded.value, scenario };
}

// ---------------------------------------------------------------------------
// Arbitrarios
// ---------------------------------------------------------------------------

/** Semillas de partida: cualquier entero de 32 bits con signo. */
const arbSeed = fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 });

const arbTerrainSubset = fc.uniqueArray(fc.constantFrom(...TERRAINS), {
  minLength: 1,
  maxLength: TERRAINS.length,
});

/** Densidades en centésimas, para que el YAML emitido no arrastre decimales largos. */
const arbDensity = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min, max }).map((percent) => percent / 100);

/**
 * `allowed_terrains` de un elemento: al menos un terreno del reparto, para que
 * el elemento tenga hexágonos donde caer, más cualquier terreno fuera del
 * reparto, que es la situación de un elemento declarado para terrenos que este
 * escenario no genera.
 */
const arbAllowedTerrains = (
  weighted: readonly TerrainType[],
): fc.Arbitrary<TerrainType[]> => {
  const rest = TERRAINS.filter((terrain) => !weighted.includes(terrain));

  return fc
    .tuple(
      fc.shuffledSubarray([...weighted], { minLength: 1, maxLength: weighted.length }),
      rest.length === 0
        ? fc.constant<TerrainType[]>([])
        : fc.uniqueArray(fc.constantFrom(...rest), { maxLength: rest.length }),
    )
    .map(([used, unused]) => [...used, ...unused]);
};

/**
 * Catálogo de elementos. Empieza siempre por montaña, bosque y las dos familias
 * de amenaza para que las restricciones de `montanas_minimas`, `bosques_minimos`,
 * `amenazas_maximas` y `distancia_minima_amenaza_humana` tengan algo que medir,
 * y añade hasta tres elementos de categoría y densidad libres, que compiten por
 * los mismos hexágonos al colocarse después.
 *
 * Montaña y bosque llevan densidad positiva porque un escenario que exige un
 * mínimo de ellos declara su densidad; las amenazas la llevan baja, como el
 * escenario publicado, para que la distancia mínima a la Ciudad sea alcanzable.
 */
const arbElements = (weighted: readonly TerrainType[]): fc.Arbitrary<ElementSpec[]> => {
  const body = (
    category: fc.Arbitrary<ElementCategory>,
    density: fc.Arbitrary<number>,
  ): fc.Arbitrary<Omit<ElementSpec, 'id'>> =>
    fc.record({ category, allowedTerrains: arbAllowedTerrains(weighted), density });

  return fc
    .tuple(
      body(fc.constant<ElementCategory>('mountain'), arbDensity(20, 60)),
      body(fc.constant<ElementCategory>('forest'), arbDensity(20, 60)),
      body(fc.constant<ElementCategory>('animal_threat'), arbDensity(1, 15)),
      body(fc.constant<ElementCategory>('human_threat'), arbDensity(1, 10)),
      fc.array(body(fc.constantFrom(...CATEGORIES), arbDensity(0, 40)), {
        maxLength: 3,
      }),
    )
    .map(([mountain, forest, animalThreat, humanThreat, extra]) =>
      [mountain, forest, animalThreat, humanThreat, ...extra].map((element, index) => ({
        id: `e${String(index)}`,
        ...element,
      })),
    );
};

/** Reparto de terrenos, terrenos de peso 0 y terrenos admitidos por la Ciudad. */
const arbTerrainTable = arbTerrainSubset.chain((positive) => {
  const rest = TERRAINS.filter((terrain) => !positive.includes(terrain));

  return fc.record({
    weights: fc
      .array(fc.integer({ min: 1, max: 5 }), {
        minLength: positive.length,
        maxLength: positive.length,
      })
      .map((values) =>
        positive.map(
          (terrain, index): [TerrainType, number] => [terrain, values[index] ?? 1],
        ),
      ),
    zeroed:
      rest.length === 0
        ? fc.constant<TerrainType[]>([])
        : fc.uniqueArray(fc.constantFrom(...rest), { maxLength: rest.length }),
    cityTerrains: fc.shuffledSubarray(positive, {
      minLength: 1,
      maxLength: positive.length,
    }),
  });
});

/** Claves de restricción que el generador sabe evaluar (Requisito 1.5). */
const CONSTRAINT_KEYS = [
  'prados_adyacentes_a_ciudad_minimo',
  'porcentaje_prado_minimo',
  'montanas_minimas',
  'bosques_minimos',
  'amenazas_maximas',
  'distancia_minima_amenaza_humana',
] as const;

/**
 * Restricciones del escenario: cada clave puede declararse o no.
 *
 * Se sortean en función del reparto y del radio ya elegidos, porque un escenario
 * publicado tampoco exige lo que su propio mapa no puede dar: pedir prado donde
 * el reparto no lo declara, o montañas en un mapa de un solo hexágono, produce
 * escenarios que ningún candidato cumple y que por tanto no dicen nada de las
 * invariantes de los mapas *entregados*. Cuando la restricción no es alcanzable
 * se declara con valor 0, que sigue pasando por el evaluador.
 *
 * El agotamiento de intentos se cubre aparte, forzándolo con una restricción
 * imposible.
 */
const arbConstraints = (
  weighted: readonly TerrainType[],
  radius: number,
): fc.Arbitrary<Record<string, number>> => {
  const meadow = weighted.includes('prado') && radius >= 1;
  const roomForElements = radius >= 2;

  return fc.record(
    {
      prados_adyacentes_a_ciudad_minimo: meadow
        ? fc.integer({ min: 0, max: 1 })
        : fc.constant(0),
      porcentaje_prado_minimo: meadow ? fc.integer({ min: 0, max: 10 }) : fc.constant(0),
      montanas_minimas: roomForElements ? fc.integer({ min: 0, max: 2 }) : fc.constant(0),
      bosques_minimos: roomForElements ? fc.integer({ min: 0, max: 2 }) : fc.constant(0),
      amenazas_maximas: fc.integer({ min: 3, max: 60 }),
      distancia_minima_amenaza_humana: roomForElements
        ? fc.integer({ min: 0, max: 2 })
        : fc.constant(0),
    },
    { requiredKeys: [] },
  );
};

const arbSpec: fc.Arbitrary<ScenarioSpec> = fc
  .tuple(arbTerrainTable, fc.integer({ min: 0, max: 5 }))
  .chain(([table, radius]) => {
    const weighted = table.weights.map(([terrain]) => terrain);

    return fc
      .record({
        cityWorkers: fc.integer({ min: 0, max: 5 }),
        elements: arbElements(weighted),
        constraints: arbConstraints(weighted, radius),
        maxAttempts: fc.integer({ min: 1, max: 30 }),
        threatLevelPerRing: fc.option(
          fc.integer({ min: 0, max: 8 }).map((quarters) => quarters / 4),
          { nil: undefined },
        ),
      })
      .map((rest) => ({ ...table, radius, ...rest }));
  });

// ---------------------------------------------------------------------------
// Utilidades de inspección
// ---------------------------------------------------------------------------

function cellsOf(map: HexMap): HexCell[] {
  return [...map.cells.values()];
}

/** Amenaza del hexágono, o `undefined` si su elemento no es una amenaza. */
function threatOf(cell: HexCell): ThreatElement | undefined {
  const element = cell.element;
  if (element === null || !THREAT_CATEGORIES.includes(element.category)) {
    return undefined;
  }
  return element as ThreatElement;
}

/**
 * Huella del mapa: recoge exactamente lo que el Requisito 1.12 exige que sea
 * igual entre dos ejecuciones (terreno, elemento, amenaza y nivel de amenaza) y
 * añade la construcción y la visibilidad, que también deben coincidir.
 */
function fingerprint(map: HexMap): string {
  return [...map.cells.entries()]
    .map(([key, cell]) => {
      const threat = threatOf(cell);
      const construction = cell.construction;
      return [
        key,
        cell.terrain,
        cell.element?.id ?? '-',
        threat === undefined ? '-' : String(threat.level),
        construction === null
          ? '-'
          : `${construction.id}@${String(construction.level)}`,
        cell.visibility,
      ].join('|');
    })
    .join(';');
}

/** Huella de cualquier resultado, con éxito o sin él, para comparar ejecuciones. */
function describeResult(result: GenerationResult): string {
  if (result.ok) {
    return `ok|${String(result.seed)}|${String(result.attempts)}|${fingerprint(result.map)}`;
  }
  switch (result.reason) {
    case 'max_attempts':
      return `max_attempts|${String(result.seed)}|${String(result.attempts)}|${JSON.stringify(result.lastViolations)}`;
    case 'unknown_constraint':
      return `unknown_constraint|${String(result.seed)}|${result.key}`;
    case 'invalid_scenario':
      return `invalid_scenario|${String(result.seed)}|${JSON.stringify(result.errors)}`;
  }
}

/**
 * Restricciones que el mapa incumple, evaluadas de forma independiente del
 * generador: oráculo del Requisito 1.15.
 */
function unmetConstraints(map: HexMap, constraints: Record<string, number>): string[] {
  const cells = cellsOf(map);
  const countCategory = (category: ElementCategory): number =>
    cells.filter((cell) => cell.element?.category === category).length;

  const meets: Record<(typeof CONSTRAINT_KEYS)[number], (required: number) => boolean> = {
    prados_adyacentes_a_ciudad_minimo: (required) =>
      hexNeighbors(CITY_COORD).filter(
        (neighbor) => map.cells.get(hexKey(neighbor))?.terrain === 'prado',
      ).length >= required,
    porcentaje_prado_minimo: (required) =>
      (100 * cells.filter((cell) => cell.terrain === 'prado').length) / cells.length >=
      required,
    montanas_minimas: (required) => countCategory('mountain') >= required,
    bosques_minimos: (required) => countCategory('forest') >= required,
    amenazas_maximas: (required) =>
      cells.filter((cell) => threatOf(cell) !== undefined).length <= required,
    distancia_minima_amenaza_humana: (required) =>
      cells
        .filter((cell) => cell.element?.category === 'human_threat')
        .every((cell) => hexDistance(CITY_COORD, cell.coord) >= required),
  };

  return Object.entries(constraints)
    .filter(([key, required]) => {
      const check = meets[key as (typeof CONSTRAINT_KEYS)[number]];
      if (check === undefined) {
        throw new Error(`el test no sabe evaluar la restricción ${key}`);
      }
      return !check(required);
    })
    .map(([key]) => key);
}

/**
 * Instancias que debería colocar cada elemento según el Requisito 1.4:
 * `min(redondeo(densidad × hexágonos con terreno permitido), hexágonos
 * elegibles sin elemento en el momento de colocarlo)`.
 *
 * El segundo término se reconstruye desde el mapa final: un hexágono estaba
 * libre al colocar el elemento de índice `i` si su elemento final lo colocó un
 * elemento de índice mayor o igual que `i`, o si sigue vacío. La Ciudad nunca
 * cuenta como libre, pero sí como elegible.
 *
 * Comparar estas cuentas con las del mapa detecta cualquier sobrescritura: si
 * un elemento hubiera aterrizado sobre un hexágono ya ocupado, el elemento
 * pisado aparecería menos veces de las debidas (Requisito 1.13).
 */
function expectedCounts(map: HexMap, placements: ElementSpec[]): Map<string, number> {
  const order = new Map(placements.map((placement, index) => [placement.id, index]));
  const cells = cellsOf(map);
  const counts = new Map<string, number>();

  placements.forEach((placement, index) => {
    const allowed = new Set(placement.allowedTerrains);
    const eligible = cells.filter((cell) => allowed.has(cell.terrain));
    const free = eligible.filter((cell) => {
      if (cell.construction !== null) {
        return false;
      }
      return cell.element === null || (order.get(cell.element.id) ?? -1) >= index;
    });

    counts.set(
      placement.id,
      Math.min(Math.round(placement.density * eligible.length), free.length),
    );
  });

  return counts;
}

/** Instancias de cada elemento presentes en el mapa. */
function actualCounts(map: HexMap): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cell of cellsOf(map)) {
    const element = cell.element;
    if (element !== null) {
      counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Comprueba `check` sobre cada mapa entregado por un escenario y semilla
 * sorteados, descartando los escenarios cuyas restricciones agotan los
 * intentos, y exige que la comprobación haya alcanzado {@link MIN_DELIVERED}
 * mapas para que la propiedad no pase por vacía.
 */
function forEachDeliveredMap(
  check: (map: HexMap, spec: ScenarioSpec) => void,
): void {
  let delivered = 0;

  fc.assert(
    fc.property(arbSpec, arbSeed, (spec, seed) => {
      const { data, scenario } = loadSpec(spec);
      const result = generateMap(data, scenario, seed);
      if (!result.ok) {
        return;
      }
      delivered += 1;
      check(result.map, spec);
    }),
    DELIVERY_RUNS,
  );

  expect(
    delivered,
    'demasiados escenarios sorteados sin mapa entregado: la propiedad quedaría por debajo de las 100 iteraciones del diseño',
  ).toBeGreaterThanOrEqual(MIN_DELIVERED);
}

// ---------------------------------------------------------------------------
// Propiedad 1: determinismo
// ---------------------------------------------------------------------------

// Feature: hextown-base-game, Property 1: Determinismo del generador de mapa
describe('Propiedad 1: determinismo del Generador_De_Mapa', () => {
  it('dos ejecuciones con el mismo escenario y semilla producen el mismo mapa', () => {
    fc.assert(
      fc.property(arbSpec, arbSeed, (spec, seed) => {
        const { data, scenario } = loadSpec(spec);
        const first = generateMap(data, scenario, seed);
        const second = generateMap(data, scenario, seed);

        // La huella primero: si divergen, señala el hexágono concreto.
        expect(describeResult(second)).toBe(describeResult(first));
        expect(second).toEqual(first);
      }),
      RUNS,
    );
  });

  it('no depende de la identidad de los datos ni de generaciones anteriores', () => {
    fc.assert(
      fc.property(arbSpec, arbSeed, arbSeed, (spec, seed, otherSeed) => {
        const first = loadSpec(spec);
        const second = loadSpec(spec);

        const reference = generateMap(first.data, first.scenario, seed);
        // Una generación intermedia con otra semilla no puede contaminar la
        // siguiente: `generateMap` no conserva estado entre llamadas.
        generateMap(first.data, first.scenario, otherSeed);

        expect(describeResult(generateMap(first.data, first.scenario, seed))).toBe(
          describeResult(reference),
        );
        expect(describeResult(generateMap(second.data, second.scenario, seed))).toBe(
          describeResult(reference),
        );
      }),
      RUNS,
    );
  });

  it('devuelve la semilla recibida en cualquier resultado (Requisito 1.7)', () => {
    fc.assert(
      fc.property(arbSpec, arbSeed, (spec, seed) => {
        const { data, scenario } = loadSpec(spec);

        expect(generateMap(data, scenario, seed).seed).toBe(seed);
      }),
      RUNS,
    );
  });

  it('reproduce el fallo por agotamiento de intentos (Requisitos 1.6, 1.7)', () => {
    fc.assert(
      fc.property(arbSpec, arbSeed, (spec, seed) => {
        // Ningún candidato puede reunir 10 000 montañas, así que el generador
        // recorre los `intentos_maximos` candidatos y aborta.
        const impossible: ScenarioSpec = {
          ...spec,
          constraints: { ...spec.constraints, montanas_minimas: 10_000 },
        };
        const { data, scenario } = loadSpec(impossible);
        const first = generateMap(data, scenario, seed);
        const second = generateMap(data, scenario, seed);

        expect(describeResult(second)).toBe(describeResult(first));
        expect(first.ok).toBe(false);
        if (first.ok || first.reason !== 'max_attempts') {
          throw new Error(`se esperaba max_attempts: ${JSON.stringify(first)}`);
        }
        expect(first.attempts).toBe(impossible.maxAttempts);
        expect(first.lastViolations.map((violation) => violation.key)).toContain(
          'montanas_minimas',
        );
      }),
      RUNS,
    );
  });

  it('semillas distintas no producen todas el mismo mapa', () => {
    // Con al menos dos terrenos en el reparto y 19 hexágonos o más, el terreno
    // de cada hexágono es una tirada independiente: que cuatro mapas resultaran
    // idénticos tiene probabilidad despreciable (por debajo de 1e-8 incluso con
    // el reparto más sesgado que genera el arbitrario). Si ocurre, el generador
    // está ignorando la semilla.
    fc.assert(
      fc.property(arbSpec, (spec) => {
        fc.pre(spec.weights.length >= 2 && spec.radius >= 2);
        const { data, scenario } = loadSpec(spec);
        const maps = [1, 2, 3, 5, 8, 13, 21, 34]
          .map((seed) => generateMap(data, scenario, seed))
          .flatMap((result) => (result.ok ? [fingerprint(result.map)] : []));

        fc.pre(maps.length >= 4);
        expect(new Set(maps).size).toBeGreaterThan(1);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Propiedad 2: invariantes estructurales
// ---------------------------------------------------------------------------

// Feature: hextown-base-game, Property 2: Invariantes estructurales del mapa generado
describe('Propiedad 2: invariantes estructurales del mapa entregado', () => {
  it('coloca cada elemento sin pisar ninguno ya colocado (Requisitos 1.4, 1.13)', () => {
    forEachDeliveredMap((map, spec) => {
      // Una densidad de 0 no coloca instancias, así que no entra en el recorrido.
      const placements = spec.elements.filter((element) => element.density > 0);
      const expected = expectedCounts(map, placements);
      const actual = actualCounts(map);

      for (const placement of placements) {
        expect(actual.get(placement.id) ?? 0, `elemento ${placement.id}`).toBe(
          expected.get(placement.id) ?? 0,
        );
      }
      // Y ningún elemento ajeno a los declarados con densidad positiva.
      expect([...actual.keys()].sort()).toEqual(
        placements
          .filter((placement) => (expected.get(placement.id) ?? 0) > 0)
          .map((placement) => placement.id)
          .sort(),
      );
    });
  });

  it('asigna a cada amenaza el nivel de su anillo, no decreciente con la distancia (Requisitos 1.10, 1.11, 1.14)', () => {
    forEachDeliveredMap((map, spec) => {
      const perRing = spec.threatLevelPerRing ?? 0;
      const threats = cellsOf(map).flatMap((cell) => {
        const threat = threatOf(cell);
        return threat === undefined
          ? []
          : [{ threat, distance: hexDistance(CITY_COORD, cell.coord) }];
      });

      for (const { threat, distance } of threats) {
        expect(threat.level, `${threat.id} a distancia ${String(distance)}`).toBe(
          1 + Math.floor(distance * perRing),
        );
        expect(threat.level).toBeGreaterThanOrEqual(1);
        expect(threat.accumulatedDamage).toBe(0);
        expect(threat.appearedDay).toBe(1);
      }

      // El Requisito 1.14 exige la monotonía entre amenazas del mismo tipo.
      for (const near of threats) {
        for (const far of threats) {
          if (near.threat.id !== far.threat.id || near.distance > far.distance) {
            continue;
          }
          expect(
            far.threat.level,
            `${near.threat.id}: D=${String(near.distance)} frente a D=${String(far.distance)}`,
          ).toBeGreaterThanOrEqual(near.threat.level);
        }
      }
    });
  });

  it('cumple todas las restricciones declaradas por el escenario (Requisitos 1.5, 1.15)', () => {
    forEachDeliveredMap((map, spec) => {
      expect(unmetConstraints(map, spec.constraints)).toEqual([]);
    });
  });

  it('entrega el disco completo con la Ciudad en el centro (Requisitos 1.1, 1.2, 1.3)', () => {
    forEachDeliveredMap((map, spec) => {
      const weighted = new Set(spec.weights.map(([terrain]) => terrain));
      const allowedByElement = new Map(
        spec.elements.map((element) => [element.id, new Set(element.allowedTerrains)]),
      );
      const city = map.cells.get(hexKey(CITY_COORD));

      expect(map.radius).toBe(spec.radius);
      // El recorrido en espiral fija además el orden de inserción, del que
      // depende el orden en que el generador consume las tiradas.
      expect([...map.cells.keys()]).toEqual(
        hexSpiral(CITY_COORD, spec.radius).map(hexKey),
      );

      expect(city?.element).toBeNull();
      expect(city?.construction?.id).toBe(CITY_ID);
      expect(city?.construction?.level).toBe(1);
      expect(city?.construction?.workers).toBe(spec.cityWorkers);
      expect(spec.cityTerrains).toContain(city?.terrain);
      expect(cellsOf(map).filter((cell) => cell.construction !== null)).toHaveLength(1);

      for (const cell of cellsOf(map)) {
        // Los terrenos de peso 0 quedan fuera del reparto.
        expect(weighted, `terreno de ${hexKey(cell.coord)}`).toContain(cell.terrain);
        // La visibilidad inicial la aplica el Gestor_De_Visibilidad.
        expect(cell.visibility).toBe('hidden');
        if (cell.element !== null) {
          expect(
            allowedByElement.get(cell.element.id),
            `${cell.element.id} en ${cell.terrain}`,
          ).toContain(cell.terrain);
        }
      }
    });
  });
});
