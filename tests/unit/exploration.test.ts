/**
 * Tests unitarios del Sistema_De_Exploracion (tarea 5.2).
 *
 * Cubren la lectura de `rules.exploration`, el cálculo del tiempo y del coste en
 * población con y sin Efecto_Global, la coincidencia entre lo estimado y lo
 * cobrado, las cinco ramas de rechazo de una solicitud, el consumo de población
 * al confirmar, la resolución al vencer con su revelado, sus entradas del
 * Registro_De_Eventos y sus causas de pausa, y la integración con el
 * Reloj_De_Juego, incluidas dos exploraciones que concluyen en el mismo
 * instante.
 *
 * Los invariantes sobre cualquier distancia y cualquier estado son las
 * Propiedades 4 y 5 (tarea 5.3); aquí se comprueban sobre ejemplos concretos.
 *
 * Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
 */
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import { advanceFragment, scheduleAction } from '../../src/core/clock.ts';
import type { ClockHooks, ClockRules, GameInstant } from '../../src/core/clock.ts';
import {
  canExplore,
  createExplorationActions,
  estimateExploration,
  explorationDays,
  explorationPopulationCost,
  readExplorationRules,
  requestExploration,
  resolveExploration,
} from '../../src/core/exploration.ts';
import type { ExplorationRules } from '../../src/core/exploration.ts';
import { hexKey, hexSpiral } from '../../src/core/hex-math.ts';
import type { AxialCoord } from '../../src/core/hex-math.ts';
import { CITY_COORD } from '../../src/core/map-generator.ts';
import { totalPopulation } from '../../src/core/resources.ts';
import { createRng } from '../../src/core/rng.ts';
import type { GameError, Result } from '../../src/core/result.ts';
import type {
  ElementCategory,
  GameState,
  GlobalEffect,
  HexCell,
  HexMap,
  MapElement,
  Resources,
  ScheduledAction,
} from '../../src/core/types.ts';
import { getVisibility, initializeVisibility } from '../../src/core/visibility.ts';
import type { RulesData } from '../../src/data/loader.ts';

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

/**
 * Reglas de exploración de los tests: 1 día base más 1 día por cada 3 de
 * distancia y 1 de población por unidad de distancia, de modo que el coste de un
 * hexágono coincide con su distancia y los números se leen de un tirón.
 */
const RULES: ExplorationRules = {
  baseDays: 1,
  daysPerDistance: 3,
  populationPerDistance: 1,
};

/** Reglas del reloj de los tests: 4 fragmentos por día y mínimo de 1 día. */
const CLOCK_RULES: ClockRules = {
  fragments: 4,
  secondsPerDayNormal: 8,
  secondsPerDayFast: 4,
  minimumActionDays: 1,
};

/** Radio del mapa de pruebas: deja un anillo oculto más allá de los atenuados. */
const MAP_RADIUS = 3;

/** Hexágono atenuado a distancia 2 de la Ciudad, explorable en los tests. */
const DIMMED: AxialCoord = { q: 2, r: 0 };

/** Otro hexágono atenuado, anterior a `DIMMED` en orden lexicográfico de (q, r). */
const DIMMED_FIRST: AxialCoord = { q: 0, r: 2 };

/** Instante de vencimiento de las resoluciones que se prueban sin reloj. */
const INSTANT: GameInstant = { kind: 'fragment', day: 7, fragment: 2 };

/** Contenido en bruto del fichero de reglas real, para comprobar el contrato. */
const RAW_YAML: Record<string, string> = import.meta.glob('../../data/rules.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// ---------------------------------------------------------------------------
// Constructores de estado
// ---------------------------------------------------------------------------

function rulesOf(values: Record<string, unknown>): RulesData {
  return { values, defaults: {}, sourceFiles: ['data/rules.yaml'] };
}

function resourcesOf(partial: Partial<Resources>): Resources {
  return {
    freePopulation: 20,
    employedPopulation: 0,
    food: 0,
    materials: 0,
    science: 0,
    gold: 0,
    ...partial,
  };
}

/** Mapa de radio `MAP_RADIUS` con la visibilidad inicial ya aplicada (Req. 2.2). */
function mapOf(): HexMap {
  const cells = new Map<string, HexCell>();
  for (const coord of hexSpiral(CITY_COORD, MAP_RADIUS)) {
    cells.set(hexKey(coord), {
      coord,
      terrain: 'prado',
      element: null,
      construction: null,
      visibility: 'hidden',
    });
  }
  return initializeVisibility({ radius: MAP_RADIUS, cells }, CITY_COORD);
}

function stateOf(overrides: Partial<GameState> = {}): GameState {
  return {
    seed: 12345,
    scenarioId: 'valle_inicial',
    saveFormatVersion: 1,
    dataVersion: 'test',
    rngState: createRng(12345).getState(),
    currentDay: 4,
    currentFragment: 2,
    clockState: 'stopped',
    lastActiveClockState: 'play',
    map: mapOf(),
    resources: resourcesOf({}),
    scheduledActions: [],
    technologies: new Map(),
    researchInProgress: null,
    globalEffects: [],
    mainObjective: {
      description: 'scenario.test.objective.desc',
      condition: { kind: 'explored_hexes', threshold: 6 },
      sustainedDays: 1,
      consecutiveDaysCount: 0,
    },
    missions: [],
    gameEnd: 'playing',
    puzzles: [],
    respawnTrackers: [],
    eventLog: [],
    ...overrides,
  };
}

/** Estado con un elemento colocado en un hexágono. */
function withElement(state: GameState, hex: AxialCoord, element: MapElement): GameState {
  const cells = new Map(state.map.cells);
  const key = hexKey(hex);
  const cell = cells.get(key);
  if (cell === undefined) {
    throw new Error(`el hexágono ${key} no pertenece al mapa de pruebas`);
  }
  cells.set(key, { ...cell, element });
  return { ...state, map: { ...state.map, cells } };
}

/** Efecto_Global multiplicativo sobre el coste de explorar. */
function costEffect(multiplier: number, active = true): GlobalEffect {
  return {
    id: `efecto_${String(multiplier)}`,
    source: 'technology',
    sourceId: 'senderos',
    effectType: 'coste_poblacion_exploracion',
    multiplier,
    active,
  };
}

function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`se esperaba éxito: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function expectErr<T>(result: Result<T>): GameError {
  if (result.ok) {
    throw new Error('se esperaba un error y se obtuvo un valor');
  }
  return result.error;
}

function expectErrors<T>(result: Result<T, GameError[]>): GameError[] {
  if (result.ok) {
    throw new Error('se esperaban errores y se obtuvo un valor');
  }
  return result.error;
}

/** Claves de mensaje del Registro_De_Eventos, en orden. */
function messageKeys(state: GameState): string[] {
  return state.eventLog.map((event) => event.messageKey);
}

// ---------------------------------------------------------------------------
// Lectura de reglas (Requisitos 3.1, 3.2)
// ---------------------------------------------------------------------------

describe('readExplorationRules', () => {
  it('lee los tres parámetros de rules.exploration', () => {
    const rules = rulesOf({
      exploration: { tiempo_base: 2, dias_por_distancia: 4, poblacion_por_distancia: 0.5 },
    });

    expect(expectOk(readExplorationRules(rules))).toEqual({
      baseDays: 2,
      daysPerDistance: 4,
      populationPerDistance: 0.5,
    });
  });

  it('acumula un missing_field por cada parámetro sin declarar', () => {
    const errors = expectErrors(readExplorationRules(rulesOf({})));

    expect(errors.map((error) => error.code)).toEqual([
      'missing_field',
      'missing_field',
      'missing_field',
    ]);
    expect(errors.map((error) => error.context?.['path'])).toEqual([
      'rules.exploration.tiempo_base',
      'rules.exploration.dias_por_distancia',
      'rules.exploration.poblacion_por_distancia',
    ]);
  });

  it('rechaza dias_por_distancia igual a 0, que sería una división por cero', () => {
    const errors = expectErrors(
      readExplorationRules(
        rulesOf({
          exploration: { tiempo_base: 1, dias_por_distancia: 0, poblacion_por_distancia: 1 },
        }),
      ),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('invalid_value');
    expect(errors[0]?.context?.['path']).toBe('rules.exploration.dias_por_distancia');
  });

  it('rechaza tiempo_base no entero y poblacion_por_distancia negativa', () => {
    const errors = expectErrors(
      readExplorationRules(
        rulesOf({
          exploration: {
            tiempo_base: 1.5,
            dias_por_distancia: 3,
            poblacion_por_distancia: -1,
          },
        }),
      ),
    );

    expect(errors.map((error) => error.code)).toEqual(['invalid_value', 'invalid_value']);
    expect(errors.map((error) => error.context?.['path'])).toEqual([
      'rules.exploration.tiempo_base',
      'rules.exploration.poblacion_por_distancia',
    ]);
  });

  it('acepta el fichero de reglas real del juego', () => {
    const raw = RAW_YAML['../../data/rules.yaml'];
    if (typeof raw !== 'string') {
      throw new Error('no se ha podido leer data/rules.yaml');
    }
    const parsed = load(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('data/rules.yaml no parsea a un objeto YAML');
    }
    const declared = (parsed as Record<string, unknown>)['rules'];
    if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
      throw new Error('data/rules.yaml no declara el mapa rules');
    }

    const rules = expectOk(readExplorationRules(rulesOf(declared as Record<string, unknown>)));

    expect(rules.baseDays).toBeGreaterThanOrEqual(1);
    expect(rules.daysPerDistance).toBeGreaterThanOrEqual(1);
    expect(rules.populationPerDistance).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tiempo (Requisito 3.1)
// ---------------------------------------------------------------------------

describe('explorationDays', () => {
  it('suma un día cada dias_por_distancia unidades de distancia', () => {
    // Con tiempo_base 1 y dias_por_distancia 3, el escalón cambia en 3, 6 y 9.
    const expected = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4];

    expect([...expected.keys()].map((distance) => explorationDays(distance, RULES))).toEqual(
      expected,
    );
  });

  it('respeta el tiempo base declarado en los datos', () => {
    const slow: ExplorationRules = { ...RULES, baseDays: 3, daysPerDistance: 2 };

    expect(explorationDays(0, slow)).toBe(3);
    expect(explorationDays(2, slow)).toBe(4);
    expect(explorationDays(5, slow)).toBe(5);
  });

  it('lanza RangeError con una distancia que no es de hexágonos', () => {
    expect(() => explorationDays(-1, RULES)).toThrow(RangeError);
    expect(() => explorationDays(1.5, RULES)).toThrow(RangeError);
    expect(() => explorationDays(Number.NaN, RULES)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Coste en población (Requisito 3.2)
// ---------------------------------------------------------------------------

describe('explorationPopulationCost', () => {
  it('cuesta una unidad de población por unidad de distancia', () => {
    const state = stateOf();

    expect(explorationPopulationCost(state, 1, RULES)).toBe(1);
    expect(explorationPopulationCost(state, 4, RULES)).toBe(4);
    expect(explorationPopulationCost(state, 7, RULES)).toBe(7);
  });

  it('nunca baja de una unidad de población', () => {
    const cheap: ExplorationRules = { ...RULES, populationPerDistance: 0.2 };
    const state = stateOf();

    expect(explorationPopulationCost(state, 0, RULES)).toBe(1);
    expect(explorationPopulationCost(state, 1, cheap)).toBe(1);
    expect(explorationPopulationCost(state, 2, cheap)).toBe(1);
    expect(explorationPopulationCost(state, 6, cheap)).toBe(2);
  });

  it('multiplica por los factores de los Efecto_Global activos y redondea al alza', () => {
    const discounted = stateOf({ globalEffects: [costEffect(0.8)] });
    const twice = stateOf({ globalEffects: [costEffect(0.8), costEffect(0.5)] });

    // 10 × 0.8 = 8 exacto; 4 × 0.8 = 3.2 sube a 4; 10 × 0.8 × 0.5 = 4 exacto.
    expect(explorationPopulationCost(discounted, 10, RULES)).toBe(8);
    expect(explorationPopulationCost(discounted, 4, RULES)).toBe(4);
    expect(explorationPopulationCost(twice, 10, RULES)).toBe(4);
  });

  it('encarece la exploración si el factor es mayor que 1', () => {
    const penalised = stateOf({ globalEffects: [costEffect(1.25)] });

    expect(explorationPopulationCost(penalised, 4, RULES)).toBe(5);
  });

  it('ignora los efectos inactivos, los de otro tipo y los aditivos', () => {
    const noise: GlobalEffect[] = [
      costEffect(0.5, false),
      { ...costEffect(0.5), effectType: 'coste_poblacion_combate' },
      {
        id: 'aditivo',
        source: 'mystery',
        sourceId: 'misterio',
        effectType: 'coste_poblacion_exploracion',
        value: -3,
        active: true,
      },
    ];

    expect(explorationPopulationCost(stateOf({ globalEffects: noise }), 6, RULES)).toBe(6);
  });

  it('lanza RangeError con una distancia que no es de hexágonos', () => {
    expect(() => explorationPopulationCost(stateOf(), -2, RULES)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Estimación previa (Requisito 3.9)
// ---------------------------------------------------------------------------

describe('estimateExploration', () => {
  it('mide la distancia a la Ciudad y devuelve el tiempo y el coste', () => {
    const estimate = estimateExploration(stateOf(), DIMMED, RULES, CLOCK_RULES);

    expect(estimate).toEqual({ hex: { q: 2, r: 0 }, distance: 2, days: 1, populationCost: 2 });
  });

  it('mide desde el centro que se le indica', () => {
    const estimate = estimateExploration(stateOf(), DIMMED, RULES, CLOCK_RULES, { q: 1, r: 0 });

    expect(estimate.distance).toBe(1);
    expect(estimate.populationCost).toBe(1);
  });

  it('normaliza el tiempo al mínimo de días que exige el reloj', () => {
    const strict: ClockRules = { ...CLOCK_RULES, minimumActionDays: 3 };

    expect(estimateExploration(stateOf(), DIMMED, RULES, strict).days).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Validación de la solicitud (Requisitos 3.4, 3.5)
// ---------------------------------------------------------------------------

describe('canExplore', () => {
  it('admite un hexágono atenuado y devuelve su estimación', () => {
    const estimate = expectOk(canExplore(stateOf(), DIMMED, RULES, CLOCK_RULES));

    expect(estimate.distance).toBe(2);
    expect(estimate.days).toBe(1);
    expect(estimate.populationCost).toBe(2);
  });

  it('rechaza un hexágono oculto', () => {
    const hidden: AxialCoord = { q: 3, r: 0 };
    const error = expectErr(canExplore(stateOf(), hidden, RULES, CLOCK_RULES));

    expect(error.code).toBe('only_dimmed_can_be_explored');
    expect(error.context).toEqual({ hex: '3,0', visibility: 'hidden' });
  });

  it('rechaza un hexágono ya explorado', () => {
    const error = expectErr(canExplore(stateOf(), CITY_COORD, RULES, CLOCK_RULES));

    expect(error.code).toBe('only_dimmed_can_be_explored');
    expect(error.context?.['visibility']).toBe('explored');
  });

  it('rechaza una coordenada que no pertenece al mapa', () => {
    const error = expectErr(canExplore(stateOf(), { q: 9, r: 9 }, RULES, CLOCK_RULES));

    expect(error.code).toBe('hex_outside_map');
    expect(error.context).toEqual({ hex: '9,9' });
  });

  it('rechaza el hexágono con una exploración en curso indicando cuándo termina', () => {
    const busy = expectOk(requestExploration(stateOf(), DIMMED, RULES, CLOCK_RULES));
    const error = expectErr(canExplore(busy, DIMMED, RULES, CLOCK_RULES));

    expect(error.code).toBe('exploration_in_progress');
    expect(error.context).toEqual({
      hex: '2,0',
      type: 'exploration',
      endDay: 5,
      endFragment: 2,
    });
  });

  it('rechaza el hexágono con otra acción en curso', () => {
    const busy = expectOk(
      scheduleAction(stateOf(), { type: 'construction', hex: DIMMED, days: 2 }, CLOCK_RULES),
    );
    const error = expectErr(canExplore(busy, DIMMED, RULES, CLOCK_RULES));

    expect(error.code).toBe('action_in_progress');
    expect(error.context?.['type']).toBe('construction');
  });

  it('rechaza el coste que alcanza la Poblacion_Total', () => {
    // Coste 2 y Poblacion_Total 2: la exploración dejaría la partida sin nadie.
    const state = stateOf({ resources: resourcesOf({ freePopulation: 2 }) });
    const error = expectErr(canExplore(state, DIMMED, RULES, CLOCK_RULES));

    expect(error.code).toBe('population_would_end_game');
    expect(error.context).toEqual({
      hex: '2,0',
      resource: 'population',
      required: 2,
      available: 2,
      total: 2,
    });
  });

  it('rechaza la falta de Poblacion_Libre con el error del Gestor_De_Recursos', () => {
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 1, employedPopulation: 10 }),
    });
    const error = expectErr(canExplore(state, DIMMED, RULES, CLOCK_RULES));

    expect(error.code).toBe('insufficient_population');
    expect(error.context).toEqual({ resource: 'population', required: 2, available: 1 });
  });
});

// ---------------------------------------------------------------------------
// Confirmación de la solicitud (Requisitos 3.1, 3.2, 3.3, 3.5, 3.9)
// ---------------------------------------------------------------------------

describe('requestExploration', () => {
  it('resta el coste de la Poblacion_Libre en concepto de consumo', () => {
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 10, employedPopulation: 3 }),
    });

    const requested = expectOk(requestExploration(state, DIMMED, RULES, CLOCK_RULES));

    expect(requested.resources.freePopulation).toBe(8);
    expect(requested.resources.employedPopulation).toBe(3);
    expect(totalPopulation(requested.resources)).toBe(totalPopulation(state.resources) - 2);
  });

  it('programa la acción en el día d + tiempo y en el fragmento de la solicitud', () => {
    const state = stateOf({ currentDay: 4, currentFragment: 2 });

    const action = expectOk(requestExploration(state, DIMMED, RULES, CLOCK_RULES))
      .scheduledActions[0];

    expect(action?.type).toBe('exploration');
    expect(action?.hex).toEqual({ q: 2, r: 0 });
    expect(action?.startDay).toBe(4);
    expect(action?.endDay).toBe(5);
    expect(action?.endFragment).toBe(2);
    expect(action?.metadata).toEqual({ distance: 2, populationCost: 2 });
  });

  it('cobra y programa exactamente lo estimado antes de confirmar', () => {
    // Un descuento que cambia el coste y un mínimo de días que cambia el tiempo:
    // si la estimación y la confirmación no compartieran cálculo, no coincidirían.
    const state = stateOf({ globalEffects: [costEffect(0.5)] });
    const clock: ClockRules = { ...CLOCK_RULES, minimumActionDays: 2 };

    const estimate = expectOk(canExplore(state, DIMMED, RULES, clock));
    const requested = expectOk(requestExploration(state, DIMMED, RULES, clock));
    const action = requested.scheduledActions[0];

    expect(estimate.populationCost).toBe(1);
    expect(estimate.days).toBe(2);

    expect(state.resources.freePopulation - requested.resources.freePopulation).toBe(
      estimate.populationCost,
    );
    expect((action?.endDay ?? 0) - state.currentDay).toBe(estimate.days);
  });

  it('no toca el estado recibido', () => {
    const state = stateOf();

    expectOk(requestExploration(state, DIMMED, RULES, CLOCK_RULES));

    expect(state.resources.freePopulation).toBe(20);
    expect(state.scheduledActions).toHaveLength(0);
  });

  it('rechaza la segunda solicitud sobre el mismo hexágono sin comprometer población', () => {
    const first = expectOk(requestExploration(stateOf(), DIMMED, RULES, CLOCK_RULES));

    const error = expectErr(requestExploration(first, DIMMED, RULES, CLOCK_RULES));

    expect(error.code).toBe('exploration_in_progress');
    expect(first.resources.freePopulation).toBe(18);
    expect(first.scheduledActions).toHaveLength(1);
  });

  it('rechaza sin modificar ningún recurso cuando el hexágono no está atenuado', () => {
    const state = stateOf();

    const error = expectErr(requestExploration(state, CITY_COORD, RULES, CLOCK_RULES));

    expect(error.code).toBe('only_dimmed_can_be_explored');
    expect(state.resources.freePopulation).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Resolución al vencer (Requisitos 3.6, 3.7, 3.8, 3.13)
// ---------------------------------------------------------------------------

describe('resolveExploration', () => {
  /** Acción de exploración vencida sobre un hexágono. */
  function actionOn(hex: AxialCoord): ScheduledAction {
    return {
      type: 'exploration',
      hex,
      startDay: 6,
      startFragment: 2,
      endDay: 7,
      endFragment: 2,
      metadata: {},
    };
  }

  it('marca el hexágono como explorado y atenúa sus vecinos ocultos', () => {
    const resolution = resolveExploration(stateOf(), actionOn(DIMMED), INSTANT);
    const map = resolution.state.map;

    expect(getVisibility(map, DIMMED)).toBe('explored');
    // (3, 0) y (3, -1) estaban ocultos en el anillo 3 y ahora se atenúan.
    expect(getVisibility(map, { q: 3, r: 0 })).toBe('dimmed');
    expect(getVisibility(map, { q: 3, r: -1 })).toBe('dimmed');
    expect(getVisibility(map, { q: 0, r: 3 })).toBe('hidden');
  });

  it('anota la exploración completada con el día y el fragmento del instante', () => {
    const resolution = resolveExploration(stateOf(), actionOn(DIMMED), INSTANT);
    const event = resolution.state.eventLog[0];

    expect(resolution.state.eventLog).toHaveLength(1);
    expect(event?.type).toBe('exploration');
    expect(event?.day).toBe(7);
    expect(event?.fragment).toBe(2);
    expect(event?.hex).toEqual({ q: 2, r: 0 });
    expect(event?.messageKey).toBe('event.exploration_completed');
    expect(event?.params).toEqual({ hex: '2,0' });
  });

  it('anota el elemento descubierto cuando el hexágono lo tiene', () => {
    const state = withElement(stateOf(), DIMMED, { id: 'bosque', category: 'forest' });

    const resolution = resolveExploration(state, actionOn(DIMMED), INSTANT);

    expect(messageKeys(resolution.state)).toEqual([
      'event.exploration_completed',
      'event.element_discovered',
    ]);
    expect(resolution.state.eventLog[1]?.params).toEqual({ hex: '2,0', element: 'bosque' });
    expect(resolution.pause).toEqual([]);
  });

  it('pide la pausa al revelar un poblado, un misterio o una amenaza', () => {
    const cases: { element: MapElement; cause: string }[] = [
      { element: { id: 'poblado', category: 'settlement' }, cause: 'settlement_discovered' },
      { element: { id: 'misterio', category: 'mystery' }, cause: 'mystery_discovered' },
      { element: { id: 'lobos', category: 'animal_threat' }, cause: 'threat_discovered' },
      { element: { id: 'barbaros', category: 'human_threat' }, cause: 'threat_discovered' },
    ];

    for (const { element, cause } of cases) {
      const state = withElement(stateOf(), DIMMED, element);

      const resolution = resolveExploration(state, actionOn(DIMMED), INSTANT);

      expect(resolution.pause).toEqual([cause]);
    }
  });

  it('no pide la pausa por un elemento que no exige atención', () => {
    const categories: ElementCategory[] = ['mountain', 'forest', 'domestic_animal', 'fish'];

    for (const category of categories) {
      const state = withElement(stateOf(), DIMMED, { id: 'elemento', category });

      expect(resolveExploration(state, actionOn(DIMMED), INSTANT).pause).toEqual([]);
    }
  });

  it('deja la población sin variación: el coste se pagó al solicitarla', () => {
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 8, employedPopulation: 3 }),
    });

    const resolution = resolveExploration(state, actionOn(DIMMED), INSTANT);

    expect(resolution.state.resources).toEqual(state.resources);
  });

  it('no hace nada si el hexágono ya no está atenuado o no pertenece al mapa', () => {
    const state = stateOf();

    expect(resolveExploration(state, actionOn(CITY_COORD), INSTANT).state).toBe(state);
    expect(resolveExploration(state, actionOn({ q: 9, r: 9 }), INSTANT).state).toBe(state);
    expect(resolveExploration(state, { ...actionOn(DIMMED), hex: null }, INSTANT).state).toBe(
      state,
    );
  });
});

// ---------------------------------------------------------------------------
// Integración con el Reloj_De_Juego (Requisitos 3.6, 3.8, 3.10)
// ---------------------------------------------------------------------------

describe('integración con el Reloj_De_Juego', () => {
  const HOOKS: ClockHooks = { actions: createExplorationActions() };

  /** Avanza el reloj hasta que el día cambia, resolviendo lo que encuentre. */
  function advanceOneDay(state: GameState): GameState {
    let current = state;
    for (let step = 0; step < CLOCK_RULES.fragments; step += 1) {
      current = advanceFragment(current, CLOCK_RULES, HOOKS);
    }
    return current;
  }

  it('resuelve la exploración al vencer y para el reloj al descubrir un misterio', () => {
    const state = withElement(stateOf({ clockState: 'play' }), DIMMED, {
      id: 'misterio',
      category: 'mystery',
    });

    const requested = expectOk(requestExploration(state, DIMMED, RULES, CLOCK_RULES));
    const resolved = advanceOneDay(requested);

    expect(resolved.currentDay).toBe(5);
    expect(resolved.currentFragment).toBe(2);
    expect(resolved.scheduledActions).toHaveLength(0);
    expect(getVisibility(resolved.map, DIMMED)).toBe('explored');
    expect(messageKeys(resolved)).toEqual([
      'event.exploration_completed',
      'event.element_discovered',
    ]);
    expect(resolved.clockState).toBe('stopped');
  });

  it('no para el reloj si la exploración no revela nada que exija atención', () => {
    const state = stateOf({ clockState: 'play' });

    const requested = expectOk(requestExploration(state, DIMMED, RULES, CLOCK_RULES));
    const resolved = advanceOneDay(requested);

    expect(getVisibility(resolved.map, DIMMED)).toBe('explored');
    expect(resolved.clockState).toBe('play');
  });

  it('resuelve dos exploraciones del mismo instante en orden lexicográfico de (q, r)', () => {
    let state = withElement(stateOf({ clockState: 'play' }), DIMMED, {
      id: 'misterio',
      category: 'mystery',
    });
    state = withElement(state, DIMMED_FIRST, { id: 'poblado', category: 'settlement' });

    state = expectOk(requestExploration(state, DIMMED, RULES, CLOCK_RULES));
    state = expectOk(requestExploration(state, DIMMED_FIRST, RULES, CLOCK_RULES));
    const resolved = advanceOneDay(state);

    // (0, 2) va antes que (2, 0), aunque se solicitase después.
    expect(resolved.eventLog.map((event) => event.params['hex'])).toEqual([
      '0,2',
      '0,2',
      '2,0',
      '2,0',
    ]);
    expect(resolved.clockState).toBe('stopped');
    expect(resolved.scheduledActions).toHaveLength(0);
  });
});
