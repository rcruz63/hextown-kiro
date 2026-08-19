/**
 * Tests unitarios del Gestor_De_Recursos (tarea 6.1).
 *
 * Cubren los recursos iniciales del escenario, la lectura de los parámetros de
 * balance, la suficiencia y la aplicación de costes en sus dos conceptos
 * (consumo y empleo), el consumo diario de comida con su hambruna, la tirada de
 * enfermedad con Efecto_Global, el crecimiento de población y el algoritmo de
 * sacrificio de construcciones ante una pérdida de población, con sus ramas de
 * error.
 *
 * Los invariantes sobre cualquier estado alcanzable son las Propiedades 6, 7 y 8
 * (tarea 6.2); aquí se comprueban sobre ejemplos concretos.
 *
 * Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12,
 * 4.15, 4.16, 4.17, 7.13
 */
import { describe, expect, it } from 'vitest';
import { hexKey } from '../../src/core/hex-math.ts';
import type { AxialCoord } from '../../src/core/hex-math.ts';
import {
  addResources,
  applyCost,
  applyPopulationGrowth,
  applyPopulationLoss,
  canAfford,
  combatPopulation,
  createInitialResources,
  diseaseProbability,
  foodConsumption,
  isPopulationDepleted,
  readResourceRules,
  resolveDiseaseRoll,
  resolveFoodConsumption,
  resourceShortage,
  totalPopulation,
} from '../../src/core/resources.ts';
import type { ResourceData, ResourceRules } from '../../src/core/resources.ts';
import { createRng } from '../../src/core/rng.ts';
import type { GameError, Result } from '../../src/core/result.ts';
import type {
  Construction,
  GameState,
  GlobalEffect,
  HexCell,
  HexMap,
  MapElement,
  Resources,
  ScheduledAction,
} from '../../src/core/types.ts';
import { loadAll } from '../../src/data/loader.ts';
import type { DataSource, GameData, RulesData, ScenarioDef } from '../../src/data/loader.ts';

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

const RULES_YAML = `
rules:
  data_version: "test"
  defaults:
    constructions:
      sacrificable: true
  food:
    consumo_por_poblacion: 0.5
    poblacion_perdida_por_hambre: 1
  disease:
    probabilidad_base_diaria: 0.02
    incremento_por_poblacion: 0.001
    poblacion_perdida: 1
`;

/**
 * Catálogo mínimo: la Ciudad no sacrificable (4.8), una casa, una granja que se
 * monta sobre una vaca y una torre de defensa, reconocible por declarar
 * `blocks_expansion_radius` (4.7).
 */
const CONTENT_YAML = `
constructions:
  - id: "ciudad"
    name_key: "construction.ciudad.name"
    sacrificable: false
    levels:
      - level: 1
        employs: 0
  - id: "casa"
    name_key: "construction.casa.name"
    levels:
      - level: 1
        employs: 1
  - id: "granja"
    name_key: "construction.granja.name"
    mounts_on_elements: ["vaca"]
    levels:
      - level: 1
        employs: 2
  - id: "torre"
    name_key: "construction.torre.name"
    levels:
      - level: 1
        employs: 2
        blocks_expansion_radius: 1

elements:
  - id: "vaca"
    name_key: "element.vaca.name"
    category: "domestic_animal"
`;

function loadContent(): GameData {
  const sources: DataSource[] = [
    { path: 'data/rules.yaml', content: RULES_YAML },
    { path: 'data/content.yaml', content: CONTENT_YAML },
  ];
  const result = loadAll(sources);
  if (!result.ok) {
    throw new Error(`carga fallida: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

const DATA: ResourceData = loadContent();

/** Parámetros de balance del fichero de reglas de prueba. */
const RULES: ResourceRules = expectRules(readResourceRules(loadContent().rules));

function expectRules(result: Result<ResourceRules, GameError[]>): ResourceRules {
  if (!result.ok) {
    throw new Error(`reglas ilegibles: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Constructores de estado
// ---------------------------------------------------------------------------

function resourcesOf(partial: Partial<Resources>): Resources {
  return {
    freePopulation: 0,
    employedPopulation: 0,
    food: 0,
    materials: 0,
    science: 0,
    gold: 0,
    ...partial,
  };
}

function constructionOf(id: string, partial: Partial<Construction> = {}): Construction {
  return {
    id,
    level: 1,
    workers: 0,
    completedDay: 1,
    completedFragment: 0,
    mountedOnElement: null,
    upgradeInProgress: null,
    ...partial,
  };
}

function cellOf(
  coord: AxialCoord,
  construction: Construction | null = null,
  element: MapElement | null = null,
): HexCell {
  return { coord, terrain: 'prado', element, construction, visibility: 'explored' };
}

function mapOf(cells: HexCell[]): HexMap {
  const indexed = new Map<string, HexCell>();
  for (const cell of cells) {
    indexed.set(hexKey(cell.coord), cell);
  }
  return { radius: 3, cells: indexed };
}

function actionOf(
  type: ScheduledAction['type'],
  hex: AxialCoord,
  startDay: number,
  startFragment = 0,
): ScheduledAction {
  return {
    type,
    hex,
    startDay,
    startFragment,
    endDay: startDay + 2,
    endFragment: startFragment,
    metadata: {},
  };
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
    map: mapOf([cellOf({ q: 0, r: 0 })]),
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

/** Escenario sintético con los recursos iniciales indicados. */
function scenarioOf(startingResources: Record<string, number> | undefined): ScenarioDef {
  return {
    id: 'valle_test',
    sourceFile: 'data/scenarios/valle_test.yaml',
    fieldPath: 'scenario',
    raw: {},
    startingResources,
  };
}

function rulesOf(values: Record<string, unknown>): RulesData {
  return { values, defaults: {}, sourceFiles: ['data/rules.yaml'] };
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

/** Construcción de un hexágono del estado, o `null` si no tiene ninguna. */
function constructionAt(state: GameState, coord: AxialCoord): Construction | null {
  const cell = state.map.cells.get(hexKey(coord));
  if (cell === undefined) {
    throw new Error(`el mapa no tiene el hexágono ${hexKey(coord)}`);
  }
  return cell.construction;
}

// ---------------------------------------------------------------------------
// Consultas (Requisitos 4.4, 4.17, 4.18)
// ---------------------------------------------------------------------------

describe('consultas de población', () => {
  it('calcula la Poblacion_Total como Poblacion_Libre más Poblacion_Empleada', () => {
    const resources = resourcesOf({ freePopulation: 7, employedPopulation: 5 });

    expect(totalPopulation(resources)).toBe(12);
  });

  it('excluye la Poblacion_Empleada de la fuerza de combate (Requisito 4.4)', () => {
    const resources = resourcesOf({ freePopulation: 7, employedPopulation: 5 });

    expect(combatPopulation(resources)).toBe(7);
  });

  it('detecta la Poblacion_Total a 0 aunque haya otros recursos (Requisito 4.17)', () => {
    expect(isPopulationDepleted(resourcesOf({ food: 40, gold: 10 }))).toBe(true);
    expect(isPopulationDepleted(resourcesOf({ employedPopulation: 1 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Recursos iniciales (Requisito 4.1)
// ---------------------------------------------------------------------------

describe('createInitialResources', () => {
  it('toma los seis recursos de scenario.starting_resources', () => {
    const scenario = scenarioOf({
      poblacion_libre: 5,
      poblacion_empleada: 0,
      comida: 30,
      materiales: 10,
      ciencia: 0,
      oro: 0,
    });

    expect(expectOk(createInitialResources(scenario))).toEqual({
      freePopulation: 5,
      employedPopulation: 0,
      food: 30,
      materials: 10,
      science: 0,
      gold: 0,
    });
  });

  it('acumula un missing_field por cada recurso sin declarar', () => {
    const scenario = scenarioOf({ poblacion_libre: 5, comida: 30 });

    const errors = expectErrors(createInitialResources(scenario));

    expect(errors.map((error) => error.code)).toEqual([
      'missing_field',
      'missing_field',
      'missing_field',
      'missing_field',
    ]);
    expect(errors[0]?.context).toEqual({
      file: 'data/scenarios/valle_test.yaml',
      path: 'scenario.starting_resources.poblacion_empleada',
    });
  });

  it('rechaza una cantidad negativa o no entera con invalid_value', () => {
    const scenario = scenarioOf({
      poblacion_libre: -1,
      poblacion_empleada: 0,
      comida: 2.5,
      materiales: 10,
      ciencia: 0,
      oro: 0,
    });

    const errors = expectErrors(createInitialResources(scenario));

    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.code)).toEqual(['invalid_value', 'invalid_value']);
    expect(errors[1]?.context?.['path']).toBe('scenario.starting_resources.comida');
  });

  it('informa del bloque completo cuando el escenario no lo declara', () => {
    const errors = expectErrors(createInitialResources(scenarioOf(undefined)));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('missing_field');
    expect(errors[0]?.context?.['path']).toBe('scenario.starting_resources');
  });
});

// ---------------------------------------------------------------------------
// Parámetros de balance (Requisitos 4.5, 4.6, 4.10, 4.11)
// ---------------------------------------------------------------------------

describe('readResourceRules', () => {
  it('lee los parámetros de comida y de enfermedad', () => {
    expect(RULES).toEqual({
      foodPerPopulation: 0.5,
      populationLostPerMissingFood: 1,
      diseaseBaseProbability: 0.02,
      diseaseIncrementPerPopulation: 0.001,
      diseasePopulationLoss: 1,
    });
  });

  it('acumula un diagnóstico por parámetro ausente', () => {
    const errors = expectErrors(readResourceRules(rulesOf({})));

    expect(errors).toHaveLength(5);
    expect(new Set(errors.map((error) => error.code))).toEqual(new Set(['missing_field']));
    expect(errors[0]?.context).toEqual({
      file: 'data/rules.yaml',
      path: 'rules.food.consumo_por_poblacion',
    });
  });

  it('rechaza un parámetro negativo y una pérdida de población no entera', () => {
    const errors = expectErrors(
      readResourceRules(
        rulesOf({
          food: { consumo_por_poblacion: -0.5, poblacion_perdida_por_hambre: 1 },
          disease: {
            probabilidad_base_diaria: 0.02,
            incremento_por_poblacion: 0.001,
            poblacion_perdida: 1.5,
          },
        }),
      ),
    );

    expect(errors.map((error) => error.context?.['path'])).toEqual([
      'rules.food.consumo_por_poblacion',
      'rules.disease.poblacion_perdida',
    ]);
    expect(errors.map((error) => error.code)).toEqual(['invalid_value', 'invalid_value']);
  });
});

// ---------------------------------------------------------------------------
// Suficiencia y costes (Requisitos 4.2, 4.3, 4.16)
// ---------------------------------------------------------------------------

describe('resourceShortage y canAfford', () => {
  const state = stateOf({
    resources: resourcesOf({
      freePopulation: 3,
      employedPopulation: 10,
      food: 20,
      materials: 5,
    }),
  });

  it('acepta un coste que cabe en los recursos disponibles', () => {
    expect(resourceShortage(state, { population: 3, food: 20, materials: 5 })).toBeUndefined();
    expect(canAfford(state, { population: 3, food: 20, materials: 5 })).toBe(true);
  });

  it('acepta el coste vacío', () => {
    expect(canAfford(state, {})).toBe(true);
  });

  it('no cuenta la Poblacion_Empleada como disponible', () => {
    expect(resourceShortage(state, { population: 4 })).toEqual({
      resource: 'population',
      required: 4,
      available: 3,
    });
  });

  it('informa del primer recurso deficitario en el orden declarado', () => {
    // Faltan población y materiales: se informa de la población (Requisito 4.16).
    expect(resourceShortage(state, { population: 9, materials: 40 })?.resource).toBe(
      'population',
    );
    expect(resourceShortage(state, { population: 1, materials: 40 })).toEqual({
      resource: 'materials',
      required: 40,
      available: 5,
    });
  });

  it('lanza RangeError con un coste negativo o una población no entera', () => {
    expect(() => canAfford(state, { food: -1 })).toThrow(RangeError);
    expect(() => canAfford(state, { population: 1.5 })).toThrow(RangeError);
  });
});

describe('applyCost', () => {
  const state = stateOf({
    resources: resourcesOf({
      freePopulation: 6,
      employedPopulation: 4,
      food: 30,
      materials: 12,
      science: 5,
      gold: 2,
    }),
  });

  it('con consume resta de la Poblacion_Libre y reduce la Poblacion_Total', () => {
    const next = expectOk(applyCost(state, { population: 2 }, 'consume'));

    expect(next.resources.freePopulation).toBe(4);
    expect(next.resources.employedPopulation).toBe(4);
    expect(totalPopulation(next.resources)).toBe(totalPopulation(state.resources) - 2);
  });

  it('con employ traslada población y deja la Poblacion_Total invariante', () => {
    const next = expectOk(applyCost(state, { population: 2 }, 'employ'));

    expect(next.resources.freePopulation).toBe(4);
    expect(next.resources.employedPopulation).toBe(6);
    expect(totalPopulation(next.resources)).toBe(totalPopulation(state.resources));
  });

  it('resta los demás recursos igual en los dos conceptos', () => {
    const cost = { food: 10, materials: 12, science: 5, gold: 2 };

    const consumed = expectOk(applyCost(state, cost, 'consume')).resources;
    const employed = expectOk(applyCost(state, cost, 'employ')).resources;

    expect(consumed).toEqual({ ...employed, food: 20, materials: 0, science: 0, gold: 0 });
  });

  it('devuelve un estado nuevo sin tocar el recibido', () => {
    const next = expectOk(applyCost(state, { population: 1, food: 1 }, 'employ'));

    expect(next).not.toBe(state);
    expect(next.resources).not.toBe(state.resources);
    expect(state.resources.freePopulation).toBe(6);
    expect(state.resources.food).toBe(30);
  });

  it('rechaza el coste completo sin comprometer nada cuando falta un recurso', () => {
    const result = applyCost(state, { population: 1, food: 10, materials: 99 }, 'employ');

    const error = expectErr(result);
    expect(error.code).toBe('insufficient_resources');
    expect(error.context).toEqual({ resource: 'materials', required: 99, available: 12 });
    expect(state.resources.food).toBe(30);
  });

  it('distingue la falta de población con su propio código', () => {
    const error = expectErr(applyCost(state, { population: 7 }, 'consume'));

    expect(error.code).toBe('insufficient_population');
    expect(error.context).toEqual({ resource: 'population', required: 7, available: 6 });
    expect(error.message).toContain('Poblacion_Libre');
  });
});

// ---------------------------------------------------------------------------
// Ingresos (Requisitos 4.12, 4.15)
// ---------------------------------------------------------------------------

describe('addResources y applyPopulationGrowth', () => {
  const state = stateOf({
    resources: resourcesOf({ freePopulation: 2, employedPopulation: 3, food: 1 }),
  });

  it('acumula los recursos sin límite superior', () => {
    const next = addResources(state, { food: 1_000_000, science: 5, gold: 7 });

    expect(next.resources.food).toBe(1_000_001);
    expect(next.resources.science).toBe(5);
    expect(next.resources.gold).toBe(7);
  });

  it('suma la producción de población a la Poblacion_Libre (Requisito 4.12)', () => {
    const next = applyPopulationGrowth(state, 4);

    expect(next.resources.freePopulation).toBe(6);
    expect(next.resources.employedPopulation).toBe(3);
    expect(totalPopulation(next.resources)).toBe(totalPopulation(state.resources) + 4);
  });

  it('devuelve el mismo estado si no hay producción de población', () => {
    expect(applyPopulationGrowth(state, 0)).toBe(state);
  });

  it('lanza RangeError con una producción negativa o no entera', () => {
    expect(() => applyPopulationGrowth(state, -1)).toThrow(RangeError);
    expect(() => applyPopulationGrowth(state, 1.5)).toThrow(RangeError);
    expect(() => addResources(state, { gold: -5 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Consumo de comida y hambruna (Requisitos 4.5, 4.6)
// ---------------------------------------------------------------------------

describe('resolveFoodConsumption', () => {
  it('redondea el consumo hacia arriba (Requisito 4.5)', () => {
    // 5 de Poblacion_Total × 0,5 = 2,5 ⇒ 3 de comida.
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 3, employedPopulation: 2, food: 10 }),
    });

    expect(foodConsumption(state, RULES)).toBe(3);
    expect(resolveFoodConsumption(state, DATA, RULES).resources.food).toBe(7);
  });

  it('no consume nada sin población', () => {
    const state = stateOf({ resources: resourcesOf({ food: 4 }) });

    const next = resolveFoodConsumption(state, DATA, RULES);

    expect(foodConsumption(state, RULES)).toBe(0);
    expect(next.resources.food).toBe(4);
    expect(next.eventLog).toHaveLength(0);
  });

  it('gasta la comida hasta el último punto sin provocar hambruna', () => {
    const state = stateOf({ resources: resourcesOf({ freePopulation: 6, food: 3 }) });

    const next = resolveFoodConsumption(state, DATA, RULES);

    expect(next.resources.food).toBe(0);
    expect(next.resources.freePopulation).toBe(6);
    expect(next.eventLog).toHaveLength(0);
  });

  it('fija la comida en 0 y pierde población cuando no alcanza (Requisito 4.6)', () => {
    // 8 de población ⇒ consumo 4, hay 1: faltan 3 y se pierden 3 habitantes.
    const state = stateOf({ resources: resourcesOf({ freePopulation: 8, food: 1 }) });

    const next = resolveFoodConsumption(state, DATA, RULES);

    expect(next.resources.food).toBe(0);
    expect(next.resources.freePopulation).toBe(5);
    expect(next.eventLog).toEqual([
      {
        type: 'famine',
        day: 4,
        fragment: 2,
        hex: null,
        messageKey: 'event.famine',
        params: { missing: 3, lost: 3 },
      },
    ]);
  });

  it('acota la pérdida por hambre a la Poblacion_Total', () => {
    // Con 5 de población perdida por unidad de comida faltante la fórmula daría
    // 5 y solo hay 2 habitantes (Requisito 4.6).
    const cruel: ResourceRules = { ...RULES, populationLostPerMissingFood: 5 };
    const state = stateOf({ resources: resourcesOf({ freePopulation: 2, food: 0 }) });

    const next = resolveFoodConsumption(state, DATA, cruel);

    expect(totalPopulation(next.resources)).toBe(0);
    expect(next.eventLog[0]?.params).toEqual({ missing: 1, lost: 2 });
  });
});

// ---------------------------------------------------------------------------
// Enfermedad (Requisitos 4.10, 4.11)
// ---------------------------------------------------------------------------

describe('diseaseProbability', () => {
  function effect(multiplier: number, active = true): GlobalEffect {
    return {
      id: 'pozos_saneamiento',
      source: 'technology',
      sourceId: 'pozos_saneamiento',
      effectType: 'probabilidad_enfermedad',
      multiplier,
      active,
    };
  }

  it('crece con la Poblacion_Total', () => {
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 20, employedPopulation: 10 }),
    });

    // 0,02 + 0,001 × 30 = 0,05
    expect(diseaseProbability(state, RULES)).toBeCloseTo(0.05, 10);
  });

  it('aplica los Efecto_Global activos como factores multiplicativos', () => {
    const resources = resourcesOf({ freePopulation: 30 });
    const state = stateOf({ resources, globalEffects: [effect(0.5), effect(1.5)] });

    expect(diseaseProbability(state, RULES)).toBeCloseTo(0.05 * 0.75, 10);
  });

  it('ignora los efectos inactivos y los de otro tipo', () => {
    const resources = resourcesOf({ freePopulation: 30 });
    const otherType: GlobalEffect = { ...effect(0.5), effectType: 'consumo_comida' };
    const state = stateOf({
      resources,
      globalEffects: [effect(0.5, false), otherType],
    });

    expect(diseaseProbability(state, RULES)).toBeCloseTo(0.05, 10);
  });

  it('acota la probabilidad al intervalo [0, 1]', () => {
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 30 }),
      globalEffects: [effect(1000)],
    });
    const cancelled = stateOf({
      resources: resourcesOf({ freePopulation: 30 }),
      globalEffects: [effect(0)],
    });

    expect(diseaseProbability(state, RULES)).toBe(1);
    expect(diseaseProbability(cancelled, RULES)).toBe(0);
  });
});

describe('resolveDiseaseRoll', () => {
  /** Reglas que fuerzan el resultado de la tirada sin depender del RNG. */
  const certain: ResourceRules = { ...RULES, diseaseBaseProbability: 1 };
  const impossible: ResourceRules = {
    ...RULES,
    diseaseBaseProbability: 0,
    diseaseIncrementPerPopulation: 0,
  };

  it('consume una extracción del RNG aunque la probabilidad sea 0', () => {
    const state = stateOf({ resources: resourcesOf({ freePopulation: 5 }) });

    const next = resolveDiseaseRoll(state, DATA, impossible);

    expect(next.rngState).not.toEqual(state.rngState);
    expect(next.resources).toEqual(state.resources);
    expect(next.eventLog).toHaveLength(0);
  });

  it('pierde población y anota el evento con una tirada positiva', () => {
    const state = stateOf({ resources: resourcesOf({ freePopulation: 5 }) });

    const next = resolveDiseaseRoll(state, DATA, certain);

    expect(next.resources.freePopulation).toBe(4);
    expect(next.eventLog).toEqual([
      {
        type: 'disease',
        day: 4,
        fragment: 2,
        hex: null,
        messageKey: 'event.disease',
        params: { lost: 1 },
      },
    ]);
  });

  it('no anota nada si no queda población que perder', () => {
    const state = stateOf({ resources: resourcesOf({ food: 10 }) });

    const next = resolveDiseaseRoll(state, DATA, certain);

    expect(next.eventLog).toHaveLength(0);
    expect(next.resources).toEqual(state.resources);
  });

  it('avanza el RNG de forma reproducible desde el mismo estado', () => {
    const state = stateOf({ resources: resourcesOf({ freePopulation: 5 }) });

    const first = resolveDiseaseRoll(state, DATA, RULES);
    const second = resolveDiseaseRoll(state, DATA, RULES);

    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// Pérdida de población y sacrificio (Requisitos 4.7, 4.8, 4.9, 7.13)
// ---------------------------------------------------------------------------

describe('applyPopulationLoss', () => {
  const CITY: AxialCoord = { q: 0, r: 0 };

  it('devuelve el mismo estado con una pérdida de 0', () => {
    const state = stateOf({ resources: resourcesOf({ freePopulation: 3 }) });

    expect(applyPopulationLoss(state, 0, DATA)).toBe(state);
  });

  it('lanza RangeError con una pérdida negativa o no entera', () => {
    const state = stateOf({ resources: resourcesOf({ freePopulation: 3 }) });

    expect(() => applyPopulationLoss(state, -1, DATA)).toThrow(RangeError);
    expect(() => applyPopulationLoss(state, 0.5, DATA)).toThrow(RangeError);
  });

  it('cubre la pérdida con la Poblacion_Libre sin tocar las construcciones', () => {
    const casa = constructionOf('casa', { workers: 1 });
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 4, employedPopulation: 1 }),
      map: mapOf([cellOf(CITY, constructionOf('ciudad')), cellOf({ q: 1, r: 0 }, casa)]),
    });

    const next = applyPopulationLoss(state, 3, DATA);

    expect(next.resources.freePopulation).toBe(1);
    expect(next.resources.employedPopulation).toBe(1);
    expect(constructionAt(next, { q: 1, r: 0 })).toEqual(casa);
    expect(next.map).toBe(state.map);
    expect(next.eventLog).toHaveLength(0);
  });

  it('sacrifica la construcción completada más reciente y devuelve el excedente', () => {
    const vieja = constructionOf('granja', { workers: 2, completedDay: 3 });
    const reciente = constructionOf('granja', { workers: 2, completedDay: 6 });
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 1, employedPopulation: 4 }),
      map: mapOf([
        cellOf(CITY, constructionOf('ciudad')),
        cellOf({ q: 1, r: 0 }, vieja),
        cellOf({ q: 2, r: 0 }, reciente),
      ]),
    });

    // Pérdida de 2: 1 sale de la Poblacion_Libre y la otra del sacrificio de la
    // granja más reciente, cuyo trabajador restante vuelve a la Poblacion_Libre.
    const next = applyPopulationLoss(state, 2, DATA);

    expect(constructionAt(next, { q: 2, r: 0 })).toBeNull();
    expect(constructionAt(next, { q: 1, r: 0 })).toEqual(vieja);
    expect(next.resources).toEqual(
      resourcesOf({ freePopulation: 1, employedPopulation: 2 }),
    );
    expect(totalPopulation(next.resources)).toBe(totalPopulation(state.resources) - 2);
    expect(next.eventLog).toEqual([
      {
        type: 'sacrifice',
        day: 4,
        fragment: 2,
        hex: { q: 2, r: 0 },
        messageKey: 'event.construction_sacrificed',
        params: { construction: 'granja', hex: '2,0' },
      },
    ]);
  });

  it('nunca sacrifica la Ciudad y fija la Poblacion_Total en 0 (Requisito 4.8)', () => {
    const ciudad = constructionOf('ciudad', { workers: 0 });
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 2, employedPopulation: 0 }),
      map: mapOf([cellOf(CITY, ciudad)]),
    });

    const next = applyPopulationLoss(state, 5, DATA);

    expect(constructionAt(next, CITY)).toEqual(ciudad);
    expect(totalPopulation(next.resources)).toBe(0);
  });

  it('deja las torres de defensa para el final (Requisito 4.7)', () => {
    const torre = constructionOf('torre', { workers: 2, completedDay: 9 });
    const casa = constructionOf('casa', { workers: 1, completedDay: 2 });
    const state = stateOf({
      resources: resourcesOf({ employedPopulation: 3 }),
      map: mapOf([
        cellOf(CITY, constructionOf('ciudad')),
        cellOf({ q: 1, r: 0 }, torre),
        cellOf({ q: 2, r: 0 }, casa),
      ]),
    });

    // La casa es mucho más antigua que la torre y aun así cae primero.
    const next = applyPopulationLoss(state, 1, DATA);

    expect(constructionAt(next, { q: 2, r: 0 })).toBeNull();
    expect(constructionAt(next, { q: 1, r: 0 })).toEqual(torre);

    // Con una pérdida mayor la torre también cae.
    const arrasado = applyPopulationLoss(state, 3, DATA);

    expect(constructionAt(arrasado, { q: 1, r: 0 })).toBeNull();
    expect(totalPopulation(arrasado.resources)).toBe(0);
  });

  it('resuelve el empate de día y fragmento por orden lexicográfico de (q, r)', () => {
    const construccion = () => constructionOf('granja', { workers: 2, completedDay: 5 });
    const state = stateOf({
      resources: resourcesOf({ employedPopulation: 6 }),
      map: mapOf([
        cellOf({ q: 1, r: 1 }, construccion()),
        cellOf({ q: 1, r: -1 }, construccion()),
        cellOf({ q: 0, r: 2 }, construccion()),
      ]),
    });

    const next = applyPopulationLoss(state, 1, DATA);

    // (0, 2) < (1, -1) < (1, 1): cae la primera del orden lexicográfico.
    expect(constructionAt(next, { q: 0, r: 2 })).toBeNull();
    expect(constructionAt(next, { q: 1, r: -1 })).not.toBeNull();
    expect(constructionAt(next, { q: 1, r: 1 })).not.toBeNull();
  });

  it('prefiere la obra en curso a cualquier construcción completada', () => {
    const enCurso = constructionOf('granja', { workers: 2, completedDay: 1 });
    const completada = constructionOf('granja', { workers: 2, completedDay: 9 });
    const state = stateOf({
      resources: resourcesOf({ employedPopulation: 4 }),
      map: mapOf([
        cellOf({ q: 1, r: 0 }, enCurso),
        cellOf({ q: 2, r: 0 }, completada),
      ]),
      // La obra empezó el día 2, antes de que se completara la otra granja.
      scheduledActions: [actionOf('construction', { q: 1, r: 0 }, 2)],
    });

    const next = applyPopulationLoss(state, 1, DATA);

    expect(constructionAt(next, { q: 1, r: 0 })).toBeNull();
    expect(constructionAt(next, { q: 2, r: 0 })).toEqual(completada);
    expect(next.scheduledActions).toHaveLength(0);
  });

  it('elige la obra en curso de inicio más reciente', () => {
    const state = stateOf({
      resources: resourcesOf({ employedPopulation: 4 }),
      map: mapOf([
        cellOf({ q: 1, r: 0 }, constructionOf('granja', { workers: 2 })),
        cellOf({ q: 2, r: 0 }, constructionOf('granja', { workers: 2 })),
      ]),
      scheduledActions: [
        actionOf('construction', { q: 1, r: 0 }, 3, 4),
        actionOf('construction', { q: 2, r: 0 }, 3, 1),
      ],
    });

    const next = applyPopulationLoss(state, 1, DATA);

    expect(constructionAt(next, { q: 1, r: 0 })).toBeNull();
    expect(constructionAt(next, { q: 2, r: 0 })).not.toBeNull();
    expect(next.scheduledActions).toHaveLength(1);
  });

  it('cancelar una mejora deja la construcción en su nivel actual (Requisitos 4.9, 7.13)', () => {
    const casa = constructionOf('casa', {
      level: 1,
      workers: 1,
      completedDay: 2,
      upgradeInProgress: {
        targetLevel: 2,
        startDay: 4,
        startFragment: 1,
        endDay: 6,
        endFragment: 1,
        committedResources: { materials: 15 },
        additionalWorkers: 3,
      },
    });
    const state = stateOf({
      resources: resourcesOf({ employedPopulation: 4, materials: 0 }),
      map: mapOf([cellOf({ q: 1, r: 0 }, casa)]),
      scheduledActions: [actionOf('upgrade', { q: 1, r: 0 }, 4, 1)],
    });

    // La pérdida de 2 se cubre con dos de los tres trabajadores adicionales.
    const next = applyPopulationLoss(state, 2, DATA);
    const resultante = constructionAt(next, { q: 1, r: 0 });

    expect(resultante).toEqual({ ...casa, upgradeInProgress: null });
    expect(next.resources).toEqual(
      resourcesOf({ freePopulation: 1, employedPopulation: 1 }),
    );
    expect(next.scheduledActions).toHaveLength(0);
    // Sin materiales devueltos y con la entrada de la mejora perdida.
    expect(next.resources.materials).toBe(0);
    expect(next.eventLog).toEqual([
      {
        type: 'upgrade',
        day: 4,
        fragment: 2,
        hex: { q: 1, r: 0 },
        messageKey: 'event.upgrade_lost',
        params: { construction: 'casa', level: 2, hex: '1,0' },
      },
    ]);
  });

  it('cuenta los trabajadores adicionales de la mejora al eliminar la construcción', () => {
    const casa = constructionOf('casa', {
      workers: 1,
      completedDay: 2,
      upgradeInProgress: {
        targetLevel: 2,
        startDay: 3,
        startFragment: 0,
        endDay: 5,
        endFragment: 0,
        committedResources: {},
        additionalWorkers: 2,
      },
    });
    const state = stateOf({
      resources: resourcesOf({ employedPopulation: 3 }),
      map: mapOf([cellOf({ q: 1, r: 0 }, casa)]),
      // Sin acción programada: la mejora se pierde con la construcción.
      scheduledActions: [],
    });

    const next = applyPopulationLoss(state, 3, DATA);

    expect(constructionAt(next, { q: 1, r: 0 })).toBeNull();
    expect(totalPopulation(next.resources)).toBe(0);
    expect(next.eventLog.map((event) => event.messageKey)).toEqual([
      'event.upgrade_lost',
      'event.construction_sacrificed',
    ]);
  });

  it('restaura el elemento sobre el que se montaba la construcción (Requisito 4.9)', () => {
    const granja = constructionOf('granja', { workers: 2, mountedOnElement: 'vaca' });
    const state = stateOf({
      resources: resourcesOf({ employedPopulation: 2 }),
      map: mapOf([cellOf({ q: 1, r: 0 }, granja)]),
    });

    const next = applyPopulationLoss(state, 2, DATA);
    const cell = next.map.cells.get(hexKey({ q: 1, r: 0 }));

    expect(cell?.construction).toBeNull();
    expect(cell?.element).toEqual({ id: 'vaca', category: 'domestic_animal' });
  });

  it('sacrifica de una en una hasta cubrir la pérdida', () => {
    const granja = (q: number, day: number) =>
      cellOf({ q, r: 0 }, constructionOf('granja', { workers: 2, completedDay: day }));
    const state = stateOf({
      resources: resourcesOf({ freePopulation: 1, employedPopulation: 6 }),
      map: mapOf([granja(1, 2), granja(2, 4), granja(3, 6)]),
    });

    // 1 de Poblacion_Libre y dos granjas (4 trabajadores) cubren la pérdida de 5.
    const next = applyPopulationLoss(state, 5, DATA);

    expect(constructionAt(next, { q: 3, r: 0 })).toBeNull();
    expect(constructionAt(next, { q: 2, r: 0 })).toBeNull();
    expect(constructionAt(next, { q: 1, r: 0 })).not.toBeNull();
    expect(next.resources).toEqual(
      resourcesOf({ freePopulation: 0, employedPopulation: 2 }),
    );
    expect(next.eventLog).toHaveLength(2);
  });

  it('devuelve un estado nuevo sin tocar el mapa recibido', () => {
    const granja = constructionOf('granja', { workers: 2 });
    const state = stateOf({
      resources: resourcesOf({ employedPopulation: 2 }),
      map: mapOf([cellOf({ q: 1, r: 0 }, granja)]),
    });

    const next = applyPopulationLoss(state, 1, DATA);

    expect(next.map).not.toBe(state.map);
    expect(next.map.cells).not.toBe(state.map.cells);
    expect(constructionAt(state, { q: 1, r: 0 })).toEqual(granja);
  });

  it('trata como sacrificable una construcción que los datos no declaran', () => {
    const desconocida = constructionOf('ruina_desconocida', { workers: 2 });
    const state = stateOf({
      resources: resourcesOf({ employedPopulation: 2 }),
      map: mapOf([cellOf({ q: 1, r: 0 }, desconocida)]),
    });

    const next = applyPopulationLoss(state, 2, DATA);

    expect(constructionAt(next, { q: 1, r: 0 })).toBeNull();
    expect(totalPopulation(next.resources)).toBe(0);
  });
});
