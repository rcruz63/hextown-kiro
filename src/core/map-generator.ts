/**
 * Generador_De_Mapa: construye el mapa inicial de una partida a partir de un
 * escenario y una semilla (Requisito 1).
 *
 * Es una función pura: `generateMap(datos, escenario, semilla)` devuelve
 * siempre el mismo resultado para los mismos argumentos, porque todas las
 * decisiones aleatorias salen del RNG determinista de `rng.ts` y todos los
 * recorridos del mapa siguen el orden canónico en espiral de `hex-math.ts`
 * (Requisito 1.12).
 *
 * Algoritmo (design.md, «Generación del Mapa»):
 *
 * 1. Crear los hexágonos en espiral desde el centro con radio
 *    `scenario.map.radius` (Requisito 1.1).
 * 2. Asignar al hexágono central un terreno de los `allowed_terrains` de la
 *    Ciudad, situar allí la Ciudad de nivel 1 y dejarlo sin elemento
 *    (Requisito 1.2).
 * 3. Asignar el terreno del resto de hexágonos con probabilidad proporcional al
 *    peso declarado en `scenario.map.terrain_weights` (Requisito 1.3).
 * 4. Colocar los elementos en el orden en que los declaran los datos,
 *    respetando densidad y terrenos permitidos (Requisito 1.4), asignando a
 *    cada amenaza el nivel `1 + piso(D × nivel_amenaza_por_anillo)`
 *    (Requisito 1.10) con Dano_Acumulado 0 y día de aparición 1
 *    (Requisito 1.11).
 * 5. Evaluar las restricciones del escenario. Si el candidato incumple alguna,
 *    se descarta y se repite con la siguiente subsemilla derivada de la semilla
 *    de partida (Requisitos 1.5, 1.6); tras `constraints.intentos_maximos`
 *    candidatos se aborta devolviendo la semilla, el número de candidatos y las
 *    restricciones incumplidas por el último (Requisito 1.7).
 *
 * Una clave de `constraints` que este módulo no sepa evaluar aborta la
 * generación indicando la clave (Requisito 1.9).
 *
 * Reparto de responsabilidades: el mapa se entrega con todos los hexágonos en
 * estado `hidden`; los estados iniciales de visibilidad (Ciudad y anillo 1
 * explorados, anillo 2 atenuado) los aplica el Gestor_De_Visibilidad
 * (Requisito 2.2). Aquí tampoco se asignan puzzles a poblados ni misterios: eso
 * corresponde al Sistema_De_Puzzles (Requisito 16.1).
 */
import { hexDistance, hexKey, hexNeighbors, hexSpiral } from './hex-math.ts';
import type { AxialCoord } from './hex-math.ts';
import { createRng, forkRng } from './rng.ts';
import type { Rng } from './rng.ts';
import { err, ok } from './result.ts';
import type { GameError, Result } from './result.ts';
import type {
  Construction,
  ElementCategory,
  HexCell,
  HexMap,
  MapElement,
  TerrainType,
  ThreatElement,
} from './types.ts';
import type { ConstructionDef, ElementDef, GameData, ScenarioDef } from '../data/loader.ts';

// ---------------------------------------------------------------------------
// Constantes del mapa inicial
// ---------------------------------------------------------------------------

/** Hexágono central del mapa: sede de la Ciudad (Requisito 1.2). */
export const CITY_COORD: AxialCoord = { q: 0, r: 0 };

/** Primer día de la partida (Requisito 5.6). */
const FIRST_DAY = 1;

/** Primer fragmento del día: los fragmentos se numeran desde 0 (Requisito 5.6). */
const FIRST_FRAGMENT = 0;

/** Terreno cuyo mínimo vigilan las restricciones de prado del escenario. */
const MEADOW: TerrainType = 'prado';

/** Terrenos admitidos por el modelo de datos (`TerrainType`). */
const TERRAIN_TYPES: readonly TerrainType[] = [
  'prado',
  'tundra',
  'desierto',
  'no_fertil',
  'oceano',
];

/** Categorías de elemento admitidas por el modelo de datos (`ElementCategory`). */
const ELEMENT_CATEGORIES: readonly ElementCategory[] = [
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

/** Categorías de elemento que son amenazas (Requisitos 1.10, 1.11). */
const THREAT_CATEGORIES: readonly ElementCategory[] = ['animal_threat', 'human_threat'];

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

/** Restricción del escenario incumplida por un mapa candidato. */
export interface ConstraintViolation {
  /** Clave declarada en `scenario.map.constraints`, e.g. `montanas_minimas`. */
  key: string;
  /** Valor exigido por el escenario. */
  required: number;
  /** Valor medido en el mapa candidato. */
  actual: number;
}

/**
 * Resultado de la generación.
 *
 * En caso de fallo se devuelve la semilla junto al motivo, porque el
 * Sistema_De_Interfaz la muestra al volver al menú principal (Requisito 1.7).
 * `lastViolations` amplía el `string[]` del diseño con el valor exigido y el
 * medido, de modo que el mensaje de la interfaz no tenga que recalcularlos.
 */
export type GenerationResult =
  | { ok: true; map: HexMap; seed: number; attempts: number }
  | {
      ok: false;
      reason: 'max_attempts';
      seed: number;
      attempts: number;
      lastViolations: ConstraintViolation[];
    }
  | { ok: false; reason: 'unknown_constraint'; seed: number; key: string }
  | { ok: false; reason: 'invalid_scenario'; seed: number; errors: GameError[] };

/**
 * Datos que el generador necesita: los elementos en su orden de declaración
 * (Requisito 1.4) y las construcciones, de donde se toma la Ciudad
 * (Requisito 1.2). `GameData` los cumple, así que se puede pasar tal cual.
 */
export type MapGenerationData = Pick<GameData, 'elements' | 'constructions'>;

// ---------------------------------------------------------------------------
// Restricciones reconocidas
// ---------------------------------------------------------------------------

/** Medidas de un mapa candidato sobre las que se evalúan las restricciones. */
interface CandidateStats {
  /** Hexágonos del mapa. */
  cells: number;
  meadows: number;
  meadowsAdjacentToCity: number;
  mountains: number;
  forests: number;
  threats: number;
  /** `Infinity` cuando el candidato no coloca ninguna amenaza humana. */
  minHumanThreatDistance: number;
}

/**
 * Evaluador de una restricción: devuelve el valor medido cuando la restricción
 * se incumple y `undefined` cuando se cumple.
 */
type ConstraintEvaluator = (stats: CandidateStats, required: number) => number | undefined;

/**
 * Restricciones evaluables en la Fase 1 (Requisito 1.5). Cualquier otra clave
 * declarada en `constraints` aborta la generación (Requisito 1.9).
 */
const CONSTRAINT_EVALUATORS: Record<string, ConstraintEvaluator> = {
  prados_adyacentes_a_ciudad_minimo: (stats, required) =>
    stats.meadowsAdjacentToCity < required ? stats.meadowsAdjacentToCity : undefined,
  porcentaje_prado_minimo: (stats, required) => {
    const percentage = stats.cells === 0 ? 0 : (100 * stats.meadows) / stats.cells;
    return percentage < required ? percentage : undefined;
  },
  montanas_minimas: (stats, required) => (stats.mountains < required ? stats.mountains : undefined),
  bosques_minimos: (stats, required) => (stats.forests < required ? stats.forests : undefined),
  amenazas_maximas: (stats, required) => (stats.threats > required ? stats.threats : undefined),
  distancia_minima_amenaza_humana: (stats, required) =>
    stats.minHumanThreatDistance < required ? stats.minHumanThreatDistance : undefined,
};

/**
 * Claves de `constraints` que no son restricciones evaluables sino parámetros
 * del propio generador (Requisitos 1.7, 1.8, 1.10).
 */
const CONSTRAINT_PARAMETER_KEYS: ReadonlySet<string> = new Set([
  'intentos_maximos',
  'nivel_amenaza_por_anillo',
]);

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Genera el mapa inicial del escenario.
 *
 * @param data Elementos y construcciones cargados y ya validados.
 * @param scenario Escenario de la partida.
 * @param seed Semilla de la partida; debe ser un número finito.
 */
export function generateMap(
  data: MapGenerationData,
  scenario: ScenarioDef,
  seed: number,
): GenerationResult {
  const prepared = readSetup(data, scenario);
  if (!prepared.ok) {
    return prepared.error.reason === 'unknown_constraint'
      ? { ok: false, reason: 'unknown_constraint', seed, key: prepared.error.key }
      : { ok: false, reason: 'invalid_scenario', seed, errors: prepared.error.errors };
  }

  const setup = prepared.value;
  const rng = createRng(seed);
  let lastViolations: ConstraintViolation[] = [];

  for (let attempt = 1; attempt <= setup.maxAttempts; attempt += 1) {
    // Cada candidato consume una extracción del generador de la partida y
    // trabaja sobre la subsemilla derivada de ella (Requisito 1.6).
    const map = buildCandidate(setup, forkRng(rng));
    const violations = evaluateConstraints(setup, map);
    if (violations.length === 0) {
      return { ok: true, map, seed, attempts: attempt };
    }
    lastViolations = violations;
  }

  return {
    ok: false,
    reason: 'max_attempts',
    seed,
    attempts: setup.maxAttempts,
    lastViolations,
  };
}

// ---------------------------------------------------------------------------
// Preparación: lectura del escenario
// ---------------------------------------------------------------------------

/** Terreno con su peso dentro del reparto declarado por el escenario. */
interface WeightedTerrain {
  terrain: TerrainType;
  weight: number;
}

/** Reparto de terrenos por peso, con al menos una entrada de peso positivo. */
interface TerrainTable {
  entries: readonly WeightedTerrain[];
  total: number;
  /** Última entrada del reparto; solo se usa si el redondeo agota los tramos. */
  fallback: TerrainType;
}

/** Elemento a colocar, con su densidad y sus terrenos permitidos. */
interface ElementPlacement {
  id: string;
  category: ElementCategory;
  allowedTerrains: ReadonlySet<TerrainType>;
  density: number;
}

/** Restricción declarada por el escenario con su evaluador. */
interface ConstraintCheck {
  key: string;
  required: number;
  evaluate: ConstraintEvaluator;
}

/** Todo lo que el generador necesita del escenario, ya interpretado. */
interface Setup {
  radius: number;
  terrains: TerrainTable;
  /** Reparto restringido a los terrenos admitidos por la Ciudad. */
  cityTerrains: TerrainTable;
  cityConstructionId: string;
  /** Trabajadores del nivel 1 de la Ciudad. */
  cityWorkers: number;
  placements: readonly ElementPlacement[];
  constraints: readonly ConstraintCheck[];
  threatLevelPerRing: number;
  maxAttempts: number;
}

/** Motivo por el que el escenario no permite generar un mapa. */
type SetupFailure =
  | { reason: 'unknown_constraint'; key: string }
  | { reason: 'invalid_scenario'; errors: GameError[] };

/**
 * Interpreta el escenario. Las restricciones se leen primero porque una clave
 * no reconocida aborta la generación con su propio motivo (Requisito 1.9).
 */
function readSetup(
  data: MapGenerationData,
  scenario: ScenarioDef,
): Result<Setup, SetupFailure> {
  const errors: GameError[] = [];
  const map = scenario.map;
  if (map === undefined) {
    return err({
      reason: 'invalid_scenario',
      errors: [missingField(scenario, path(scenario, 'map'))],
    });
  }

  const declaredConstraints = map.constraints;
  if (declaredConstraints === undefined) {
    return err({
      reason: 'invalid_scenario',
      errors: [missingField(scenario, path(scenario, 'map', 'constraints'))],
    });
  }
  const unknownKey = findUnknownConstraint(declaredConstraints);
  if (unknownKey !== undefined) {
    return err({ reason: 'unknown_constraint', key: unknownKey });
  }

  const constraints = readConstraints(scenario, declaredConstraints, errors);
  const maxAttempts = readMaxAttempts(scenario, declaredConstraints, errors);
  const threatLevelPerRing = readThreatLevelPerRing(scenario, declaredConstraints, errors);
  const radius = readRadius(scenario, map.radius, errors);
  const terrains = readTerrainTable(scenario, map.terrainWeights, errors);
  const city = findCity(data, scenario, map.raw['city_construction_id'], errors);
  const cityTerrains =
    terrains === undefined || city === undefined
      ? undefined
      : restrictToCity(scenario, terrains, city, errors);
  const placements = readPlacements(data, scenario, map.elementDensity, errors);

  if (
    radius === undefined ||
    terrains === undefined ||
    city === undefined ||
    cityTerrains === undefined ||
    maxAttempts === undefined ||
    threatLevelPerRing === undefined ||
    errors.length > 0
  ) {
    return err({ reason: 'invalid_scenario', errors });
  }

  return ok({
    radius,
    terrains,
    cityTerrains,
    cityConstructionId: city.id,
    cityWorkers: cityLevelOneWorkers(city),
    placements,
    constraints,
    threatLevelPerRing,
    maxAttempts,
  });
}

/** Primera clave de `constraints` que el generador no sabe evaluar. */
function findUnknownConstraint(constraints: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(constraints)) {
    if (CONSTRAINT_PARAMETER_KEYS.has(key)) {
      continue;
    }
    if (CONSTRAINT_EVALUATORS[key] === undefined) {
      return key;
    }
  }
  return undefined;
}

/** Restricciones declaradas, en el orden en que las declara el escenario. */
function readConstraints(
  scenario: ScenarioDef,
  declared: Record<string, unknown>,
  errors: GameError[],
): ConstraintCheck[] {
  const checks: ConstraintCheck[] = [];
  for (const [key, value] of Object.entries(declared)) {
    const evaluate = CONSTRAINT_EVALUATORS[key];
    if (evaluate === undefined) {
      continue;
    }
    const required = asFiniteNumber(value);
    if (required === undefined) {
      errors.push(
        invalidValue(
          scenario,
          path(scenario, 'map', 'constraints', key),
          'debe ser un número finito',
          value,
        ),
      );
      continue;
    }
    checks.push({ key, required, evaluate });
  }
  return checks;
}

/** `intentos_maximos`: candidatos que se generan antes de abortar (Req. 1.7, 1.8). */
function readMaxAttempts(
  scenario: ScenarioDef,
  declared: Record<string, unknown>,
  errors: GameError[],
): number | undefined {
  const fieldPath = path(scenario, 'map', 'constraints', 'intentos_maximos');
  const value = declared['intentos_maximos'];
  if (value === undefined) {
    errors.push(missingField(scenario, fieldPath));
    return undefined;
  }
  const attempts = asFiniteNumber(value);
  if (attempts === undefined || !Number.isInteger(attempts) || attempts < 1) {
    errors.push(
      invalidValue(scenario, fieldPath, 'debe ser un entero mayor o igual que 1', value),
    );
    return undefined;
  }
  return attempts;
}

/**
 * `nivel_amenaza_por_anillo`: incremento de nivel por hexágono de distancia
 * (Requisito 1.10). Sin declarar equivale a 0, es decir, todas las amenazas de
 * nivel 1.
 */
function readThreatLevelPerRing(
  scenario: ScenarioDef,
  declared: Record<string, unknown>,
  errors: GameError[],
): number | undefined {
  const value = declared['nivel_amenaza_por_anillo'];
  if (value === undefined) {
    return 0;
  }
  const perRing = asFiniteNumber(value);
  if (perRing === undefined || perRing < 0) {
    errors.push(
      invalidValue(
        scenario,
        path(scenario, 'map', 'constraints', 'nivel_amenaza_por_anillo'),
        'debe ser un número mayor o igual que 0',
        value,
      ),
    );
    return undefined;
  }
  return perRing;
}

/** `radius`: radio del mapa en hexágonos (Requisito 1.1). */
function readRadius(
  scenario: ScenarioDef,
  declared: number | undefined,
  errors: GameError[],
): number | undefined {
  const fieldPath = path(scenario, 'map', 'radius');
  if (declared === undefined) {
    errors.push(missingField(scenario, fieldPath));
    return undefined;
  }
  if (!Number.isInteger(declared) || declared < 0) {
    errors.push(
      invalidValue(scenario, fieldPath, 'debe ser un entero mayor o igual que 0', declared),
    );
    return undefined;
  }
  return declared;
}

/** `terrain_weights`: reparto de terrenos por peso (Requisito 1.3). */
function readTerrainTable(
  scenario: ScenarioDef,
  declared: Record<string, number> | undefined,
  errors: GameError[],
): TerrainTable | undefined {
  const fieldPath = path(scenario, 'map', 'terrain_weights');
  if (declared === undefined) {
    errors.push(missingField(scenario, fieldPath));
    return undefined;
  }

  const entries: WeightedTerrain[] = [];
  for (const [id, weight] of Object.entries(declared)) {
    const terrain = asTerrainType(id);
    if (terrain === undefined) {
      errors.push(
        invalidValue(scenario, `${fieldPath}.${id}`, 'no es un terreno conocido', id),
      );
      continue;
    }
    if (!Number.isFinite(weight) || weight < 0) {
      errors.push(
        invalidValue(
          scenario,
          `${fieldPath}.${id}`,
          'debe ser un número mayor o igual que 0',
          weight,
        ),
      );
      continue;
    }
    // Un peso 0 no aporta tramo al reparto y se descarta.
    if (weight > 0) {
      entries.push({ terrain, weight });
    }
  }

  return buildTable(scenario, fieldPath, entries, errors);
}

/**
 * Reparto restringido a los `allowed_terrains` de la Ciudad, del que sale el
 * terreno del hexágono central (Requisito 1.2).
 */
function restrictToCity(
  scenario: ScenarioDef,
  terrains: TerrainTable,
  city: ConstructionDef,
  errors: GameError[],
): TerrainTable | undefined {
  const allowed = new Set(city.allowedTerrains ?? []);
  const entries = terrains.entries.filter((entry) => allowed.has(entry.terrain));
  return buildTable(
    scenario,
    path(scenario, 'map', 'terrain_weights'),
    entries,
    errors,
    `no declara ningún terreno de los admitidos por ${city.id} con peso mayor que 0`,
  );
}

/** Cierra un reparto comprobando que queda al menos una entrada con peso. */
function buildTable(
  scenario: ScenarioDef,
  fieldPath: string,
  entries: readonly WeightedTerrain[],
  errors: GameError[],
  reason = 'debe declarar al menos un terreno con peso mayor que 0',
): TerrainTable | undefined {
  const last = entries.at(-1);
  if (last === undefined) {
    errors.push(invalidValue(scenario, fieldPath, reason, entries.length));
    return undefined;
  }
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return { entries, total, fallback: last.terrain };
}

/** Construcción declarada como Ciudad en `map.city_construction_id`. */
function findCity(
  data: MapGenerationData,
  scenario: ScenarioDef,
  declared: unknown,
  errors: GameError[],
): ConstructionDef | undefined {
  const fieldPath = path(scenario, 'map', 'city_construction_id');
  if (declared === undefined || declared === null) {
    errors.push(missingField(scenario, fieldPath));
    return undefined;
  }
  if (typeof declared !== 'string') {
    errors.push(invalidValue(scenario, fieldPath, 'debe ser una cadena', declared));
    return undefined;
  }
  const city = data.constructions.find((construction) => construction.id === declared);
  if (city === undefined) {
    errors.push(
      invalidValue(scenario, fieldPath, 'no referencia ninguna construcción cargada', declared),
    );
    return undefined;
  }
  if (city.allowedTerrains === undefined || city.allowedTerrains.length === 0) {
    errors.push(
      invalidValue(
        scenario,
        fieldPath,
        `la construcción ${city.id} no declara allowed_terrains`,
        declared,
      ),
    );
    return undefined;
  }
  return city;
}

/** Trabajadores que emplea el nivel 1 de la Ciudad. */
function cityLevelOneWorkers(city: ConstructionDef): number {
  const levels = city.levels ?? [];
  const first = levels.find((level) => level.level === 1) ?? levels[0];
  return first?.employs ?? 0;
}

/**
 * Elementos a colocar, en el orden en que los declaran los datos
 * (Requisito 1.4). Un elemento sin densidad declarada, o con densidad 0, no se
 * coloca.
 */
function readPlacements(
  data: MapGenerationData,
  scenario: ScenarioDef,
  density: Record<string, number> | undefined,
  errors: GameError[],
): ElementPlacement[] {
  if (density === undefined) {
    return [];
  }
  const fieldPath = path(scenario, 'map', 'element_density');
  const placements: ElementPlacement[] = [];

  for (const element of data.elements) {
    const declared = density[element.id];
    if (declared === undefined) {
      continue;
    }
    if (!Number.isFinite(declared) || declared < 0) {
      errors.push(
        invalidValue(
          scenario,
          `${fieldPath}.${element.id}`,
          'debe ser un número mayor o igual que 0',
          declared,
        ),
      );
      continue;
    }
    if (declared === 0) {
      continue;
    }
    const placement = readPlacement(element, declared, errors);
    if (placement !== undefined) {
      placements.push(placement);
    }
  }

  // Una densidad declarada para un elemento que no existe es una referencia
  // rota: el Validador_De_Datos ya la rechaza, pero se informa igualmente.
  const known = new Set(data.elements.map((element) => element.id));
  for (const id of Object.keys(density)) {
    if (!known.has(id)) {
      errors.push(
        invalidValue(
          scenario,
          `${fieldPath}.${id}`,
          'no referencia ningún elemento cargado',
          id,
        ),
      );
    }
  }

  return placements;
}

/** Interpreta la categoría y los terrenos permitidos de un elemento. */
function readPlacement(
  element: ElementDef,
  density: number,
  errors: GameError[],
): ElementPlacement | undefined {
  const category = asElementCategory(element.category);
  if (category === undefined) {
    errors.push(
      invalidValue(
        element,
        `${element.fieldPath}.category`,
        'no es una categoría de elemento conocida',
        element.category,
      ),
    );
    return undefined;
  }

  const allowedTerrains = new Set<TerrainType>();
  for (const id of element.allowedTerrains ?? []) {
    const terrain = asTerrainType(id);
    if (terrain === undefined) {
      errors.push(
        invalidValue(
          element,
          `${element.fieldPath}.allowed_terrains`,
          'no es un terreno conocido',
          id,
        ),
      );
      continue;
    }
    allowedTerrains.add(terrain);
  }
  if (allowedTerrains.size === 0) {
    errors.push(
      invalidValue(
        element,
        `${element.fieldPath}.allowed_terrains`,
        'debe declarar al menos un terreno para poder colocar el elemento',
        element.allowedTerrains,
      ),
    );
    return undefined;
  }

  return { id: element.id, category, allowedTerrains, density };
}

// ---------------------------------------------------------------------------
// Construcción de un mapa candidato
// ---------------------------------------------------------------------------

/**
 * Construye un mapa candidato completo con el generador de la subsemilla del
 * intento. Consume el RNG en un orden fijo: primero el terreno de cada
 * hexágono en orden de espiral y después la colocación de cada elemento en el
 * orden declarado, de modo que la misma subsemilla produce el mismo candidato.
 */
function buildCandidate(setup: Setup, rng: Rng): HexMap {
  const coords = hexSpiral(CITY_COORD, setup.radius);
  const cells = new Map<string, HexCell>();

  for (const coord of coords) {
    const isCity = coord.q === CITY_COORD.q && coord.r === CITY_COORD.r;
    // El hexágono central toma su terreno del reparto restringido a los
    // terrenos de la Ciudad (Requisito 1.2); el resto, del reparto completo
    // (Requisito 1.3).
    const terrain = pickTerrain(rng, isCity ? setup.cityTerrains : setup.terrains);
    cells.set(hexKey(coord), {
      coord,
      terrain,
      element: null,
      construction: isCity ? createCity(setup) : null,
      // Los estados iniciales de visibilidad los aplica el
      // Gestor_De_Visibilidad (Requisito 2.2).
      visibility: 'hidden',
    });
  }

  const map: HexMap = { radius: setup.radius, cells };
  placeElements(map, setup, rng);
  return map;
}

/** Ciudad de nivel 1 del hexágono central (Requisito 1.2). */
function createCity(setup: Setup): Construction {
  return {
    id: setup.cityConstructionId,
    level: 1,
    workers: setup.cityWorkers,
    completedDay: FIRST_DAY,
    completedFragment: FIRST_FRAGMENT,
    mountedOnElement: null,
    upgradeInProgress: null,
  };
}

/** Elige un terreno con probabilidad proporcional a su peso (Requisito 1.3). */
function pickTerrain(rng: Rng, table: TerrainTable): TerrainType {
  const roll = rng.next() * table.total;
  let accumulated = 0;
  for (const entry of table.entries) {
    accumulated += entry.weight;
    if (roll < accumulated) {
      return entry.terrain;
    }
  }
  // Solo alcanzable si el redondeo de coma flotante deja el sorteo justo en el
  // extremo superior del último tramo.
  return table.fallback;
}

/**
 * Coloca los elementos recorriéndolos en el orden declarado (Requisito 1.4).
 *
 * De cada elemento se colocan
 * `min(redondeo(densidad × hexágonos con terreno permitido), hexágonos
 * elegibles sin elemento)` instancias. El hexágono de la Ciudad queda siempre
 * sin elemento (Requisito 1.2), pero sí cuenta como hexágono con terreno
 * permitido a efectos de la densidad.
 */
function placeElements(map: HexMap, setup: Setup, rng: Rng): void {
  for (const placement of setup.placements) {
    let eligible = 0;
    const available: HexCell[] = [];

    for (const cell of map.cells.values()) {
      if (!placement.allowedTerrains.has(cell.terrain)) {
        continue;
      }
      eligible += 1;
      if (cell.element === null && cell.construction === null) {
        available.push(cell);
      }
    }

    const count = Math.min(Math.round(placement.density * eligible), available.length);
    for (let placed = 0; placed < count; placed += 1) {
      const cell = takeRandom(available, rng);
      if (cell === undefined) {
        break;
      }
      cell.element = createElement(placement, cell.coord, setup);
    }
  }
}

/** Extrae un hexágono al azar del conjunto de candidatos, sin reposición. */
function takeRandom(pool: HexCell[], rng: Rng): HexCell | undefined {
  if (pool.length === 0) {
    return undefined;
  }
  const [chosen] = pool.splice(rng.nextInt(pool.length), 1);
  return chosen;
}

/**
 * Instancia un elemento. Las amenazas reciben su nivel según la distancia a la
 * Ciudad (Requisito 1.10), Dano_Acumulado 0 y día de aparición 1
 * (Requisito 1.11).
 */
function createElement(
  placement: ElementPlacement,
  coord: AxialCoord,
  setup: Setup,
): MapElement {
  if (placement.category === 'animal_threat' || placement.category === 'human_threat') {
    const distance = hexDistance(CITY_COORD, coord);
    const threat: ThreatElement = {
      id: placement.id,
      category: placement.category,
      level: 1 + Math.floor(distance * setup.threatLevelPerRing),
      accumulatedDamage: 0,
      appearedDay: FIRST_DAY,
      lastExpansionDay: FIRST_DAY,
      lastLevelUpDay: FIRST_DAY,
    };
    return threat;
  }
  return { id: placement.id, category: placement.category };
}

// ---------------------------------------------------------------------------
// Evaluación de restricciones
// ---------------------------------------------------------------------------

/**
 * Restricciones incumplidas por un candidato, en el orden en que las declara el
 * escenario (Requisito 1.5). Una lista vacía significa que el mapa se entrega.
 */
function evaluateConstraints(setup: Setup, map: HexMap): ConstraintViolation[] {
  const stats = measure(map);
  const violations: ConstraintViolation[] = [];
  for (const check of setup.constraints) {
    const actual = check.evaluate(stats, check.required);
    if (actual !== undefined) {
      violations.push({ key: check.key, required: check.required, actual });
    }
  }
  return violations;
}

/** Mide un candidato una sola vez para todas sus restricciones. */
function measure(map: HexMap): CandidateStats {
  const stats: CandidateStats = {
    cells: map.cells.size,
    meadows: 0,
    meadowsAdjacentToCity: 0,
    mountains: 0,
    forests: 0,
    threats: 0,
    minHumanThreatDistance: Number.POSITIVE_INFINITY,
  };

  for (const cell of map.cells.values()) {
    if (cell.terrain === MEADOW) {
      stats.meadows += 1;
    }
    const category = cell.element?.category;
    if (category === undefined) {
      continue;
    }
    if (category === 'mountain') {
      stats.mountains += 1;
    }
    if (category === 'forest') {
      stats.forests += 1;
    }
    if (THREAT_CATEGORIES.includes(category)) {
      stats.threats += 1;
    }
    if (category === 'human_threat') {
      stats.minHumanThreatDistance = Math.min(
        stats.minHumanThreatDistance,
        hexDistance(CITY_COORD, cell.coord),
      );
    }
  }

  for (const neighbor of hexNeighbors(CITY_COORD)) {
    if (map.cells.get(hexKey(neighbor))?.terrain === MEADOW) {
      stats.meadowsAdjacentToCity += 1;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Definición con origen conocido, para situar los errores en su fichero. */
interface DefinitionOrigin {
  sourceFile: string;
}

/** Compone la ruta de un campo del escenario dentro de su fichero. */
function path(scenario: ScenarioDef, ...fields: readonly string[]): string {
  return [scenario.fieldPath, ...fields].filter((part) => part.length > 0).join('.');
}

/** Error de campo obligatorio ausente. */
function missingField(origin: DefinitionOrigin, fieldPath: string): GameError {
  return {
    code: 'missing_field',
    message: `${origin.sourceFile}: ${fieldPath} no se declara`,
    context: { file: origin.sourceFile, path: fieldPath },
  };
}

/** Error de campo declarado con un valor que el generador no puede usar. */
function invalidValue(
  origin: DefinitionOrigin,
  fieldPath: string,
  reason: string,
  found: unknown,
): GameError {
  return {
    code: 'invalid_value',
    message: `${origin.sourceFile}: ${fieldPath} ${reason}`,
    context: { file: origin.sourceFile, path: fieldPath, reason, found },
  };
}

/** Número finito, o `undefined` si el valor no lo es. */
function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Identificador de terreno del modelo de datos, o `undefined`. */
function asTerrainType(id: string | undefined): TerrainType | undefined {
  return TERRAIN_TYPES.find((terrain) => terrain === id);
}

/** Categoría de elemento del modelo de datos, o `undefined`. */
function asElementCategory(id: string | undefined): ElementCategory | undefined {
  return ELEMENT_CATEGORIES.find((category) => category === id);
}
