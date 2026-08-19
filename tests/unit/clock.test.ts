/**
 * Tests unitarios del Reloj_De_Juego (tarea 7.1).
 *
 * Cubren la lectura de `rules.day`, la duración de un fragmento a cada
 * velocidad, el estado inicial del reloj y sus transiciones, la programación de
 * acciones con su normalización de tiempo y su rechazo por hexágono ocupado, el
 * orden de resolución de las acciones simultáneas, la conversión de tiempo real
 * en tiempo de juego con su acumulación de fracciones, el orden fijo de los
 * pasos del Fin_De_Dia, el avance al siguiente evento y la pausa automática, con
 * sus ramas de error.
 *
 * Los invariantes sobre cualquier acción y cualquier semilla son las Propiedades
 * 9, 10 y 11 (tarea 7.2); aquí se comprueban sobre ejemplos concretos.
 *
 * Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.11, 5.12, 5.13,
 * 5.15, 5.16, 5.17
 */
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import {
  END_OF_DAY_STEPS,
  FIRST_DAY,
  FIRST_FRAGMENT,
  actionInProgressAt,
  advanceFragment,
  advanceTime,
  compareInstants,
  createGameClock,
  createResourceEndOfDaySteps,
  currentInstant,
  dayDurationMs,
  dueActions,
  fragmentDurationMs,
  initializeClock,
  nextEventInstant,
  normalizeActionDays,
  pauseClock,
  readClockRules,
  resolveEndOfDay,
  resumeClock,
  scheduleAction,
  setClockState,
  skipToNextEvent,
} from '../../src/core/clock.ts';
import type {
  ActionResolvers,
  ClockHooks,
  ClockRules,
  EndOfDaySteps,
  GameInstant,
} from '../../src/core/clock.ts';
import { hexKey } from '../../src/core/hex-math.ts';
import type { AxialCoord } from '../../src/core/hex-math.ts';
import type { ResourceData, ResourceRules } from '../../src/core/resources.ts';
import { createRng } from '../../src/core/rng.ts';
import type { GameError, Result } from '../../src/core/result.ts';
import type { ActionType, GameState, HexCell, HexMap, Resources } from '../../src/core/types.ts';
import type { RulesData } from '../../src/data/loader.ts';

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

/**
 * Reglas del reloj de los tests: 4 fragmentos por día, 8 segundos reales por día
 * en play y 4 en avance rápido, de modo que un fragmento dura 2000 ms y 1000 ms
 * respectivamente y los números redondos se leen de un tirón.
 */
const RULES: ClockRules = {
  fragments: 4,
  secondsPerDayNormal: 8,
  secondsPerDayFast: 4,
  minimumActionDays: 1,
};

/** Último fragmento de un día con las reglas de los tests. */
const LAST_FRAGMENT = RULES.fragments - 1;

/** Duración real de un fragmento en play, en milisegundos. */
const FRAGMENT_MS = fragmentDurationMs(RULES, 'play');

/** Catálogo vacío: los pasos de recursos de estos tests no sacrifican nada. */
const RESOURCE_DATA: ResourceData = { constructions: [], elements: [] };

/** Parámetros de recursos con la enfermedad desactivada, para aislar la comida. */
const RESOURCE_RULES: ResourceRules = {
  foodPerPopulation: 0.5,
  populationLostPerMissingFood: 1,
  diseaseBaseProbability: 0,
  diseaseIncrementPerPopulation: 0,
  diseasePopulationLoss: 1,
};

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
    freePopulation: 0,
    employedPopulation: 0,
    food: 0,
    materials: 0,
    science: 0,
    gold: 0,
    ...partial,
  };
}

function cellOf(coord: AxialCoord): HexCell {
  return {
    coord,
    terrain: 'prado',
    element: null,
    construction: null,
    visibility: 'explored',
  };
}

function mapOf(coords: AxialCoord[]): HexMap {
  const cells = new Map<string, HexCell>();
  for (const coord of coords) {
    cells.set(hexKey(coord), cellOf(coord));
  }
  return { radius: 2, cells };
}

function stateOf(overrides: Partial<GameState> = {}): GameState {
  return {
    seed: 12345,
    scenarioId: 'valle_inicial',
    saveFormatVersion: 1,
    dataVersion: 'test',
    rngState: createRng(12345).getState(),
    currentDay: FIRST_DAY,
    currentFragment: FIRST_FRAGMENT,
    clockState: 'stopped',
    lastActiveClockState: 'play',
    map: mapOf([{ q: 0, r: 0 }]),
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

/** Estado con una acción programada por cada hexágono indicado, con coste 1 día. */
function withActions(
  state: GameState,
  requests: { type: ActionType; hex: AxialCoord | null }[],
): GameState {
  let current = state;
  for (const request of requests) {
    current = expectOk(scheduleAction(current, { ...request, days: 1 }, RULES));
  }
  return current;
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

/**
 * Resolutores que anotan en `log` qué se resolvió y en qué orden, sin tocar el
 * estado más allá de eso.
 */
function recordingHooks(log: string[], types: ActionType[]): ClockHooks {
  const actions: ActionResolvers = {};
  for (const type of types) {
    actions[type] = (state, action) => {
      log.push(action.hex === null ? `${action.type}:sin-hex` : hexKey(action.hex));
      return { state };
    };
  }
  return { actions };
}

/** Resolutores del Fin_De_Dia que anotan en `log` el nombre de cada paso. */
function recordingEndOfDay(log: string[]): ClockHooks {
  const endOfDay: EndOfDaySteps = {};
  for (const step of END_OF_DAY_STEPS) {
    endOfDay[step] = (state) => {
      log.push(step);
      return { state };
    };
  }
  return { endOfDay };
}

// ---------------------------------------------------------------------------
// Lectura de reglas (Requisitos 5.1, 5.3, 5.4, 5.16)
// ---------------------------------------------------------------------------

describe('readClockRules', () => {
  it('lee los cuatro parámetros de rules.day', () => {
    const rules = rulesOf({
      day: { fragments: 5, seconds_normal: 6, seconds_fast: 3, minimo_dias_accion: 1 },
    });

    expect(expectOk(readClockRules(rules))).toEqual({
      fragments: 5,
      secondsPerDayNormal: 6,
      secondsPerDayFast: 3,
      minimumActionDays: 1,
    });
  });

  it('acumula un missing_field por cada parámetro sin declarar', () => {
    const errors = expectErrors(readClockRules(rulesOf({})));

    expect(errors.map((error) => error.code)).toEqual([
      'missing_field',
      'missing_field',
      'missing_field',
      'missing_field',
    ]);
    expect(errors.map((error) => error.context?.['path'])).toEqual([
      'rules.day.fragments',
      'rules.day.seconds_normal',
      'rules.day.seconds_fast',
      'rules.day.minimo_dias_accion',
    ]);
  });

  it('rechaza fragmentos no enteros y días de duración 0 con invalid_value', () => {
    const errors = expectErrors(
      readClockRules(
        rulesOf({
          day: { fragments: 2.5, seconds_normal: 0, seconds_fast: 3, minimo_dias_accion: 1 },
        }),
      ),
    );

    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error.code === 'invalid_value')).toBe(true);
    expect(errors[0]?.context?.['path']).toBe('rules.day.fragments');
    expect(errors[1]?.context?.['path']).toBe('rules.day.seconds_normal');
  });

  it('rechaza un mínimo de días de acción inferior a 1 (Requisito 5.16)', () => {
    const errors = expectErrors(
      readClockRules(
        rulesOf({
          day: { fragments: 4, seconds_normal: 6, seconds_fast: 3, minimo_dias_accion: 0 },
        }),
      ),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('invalid_value');
    expect(errors[0]?.context?.['path']).toBe('rules.day.minimo_dias_accion');
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

    const rules = expectOk(readClockRules(rulesOf(declared as Record<string, unknown>)));

    expect(rules.fragments).toBeGreaterThanOrEqual(1);
    expect(rules.secondsPerDayFast).toBeLessThan(rules.secondsPerDayNormal);
    expect(rules.minimumActionDays).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Duración del día y del fragmento (Requisitos 5.1, 5.3, 5.4)
// ---------------------------------------------------------------------------

describe('duración del tiempo real', () => {
  it('reparte el día en fragmentos de igual duración a cada velocidad', () => {
    expect(dayDurationMs(RULES, 'play')).toBe(8000);
    expect(dayDurationMs(RULES, 'fast')).toBe(4000);
    expect(fragmentDurationMs(RULES, 'play')).toBe(2000);
    expect(fragmentDurationMs(RULES, 'fast')).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Estado del reloj (Requisitos 5.2, 5.5, 5.6)
// ---------------------------------------------------------------------------

describe('estado del reloj', () => {
  it('arranca la partida en el día 1, el primer fragmento y parado', () => {
    const state = initializeClock(
      stateOf({ currentDay: 9, currentFragment: 2, clockState: 'fast' }),
    );

    expect(state.currentDay).toBe(1);
    expect(state.currentFragment).toBe(0);
    expect(state.clockState).toBe('stopped');
  });

  it('recuerda la última velocidad elegida al parar y reanudar', () => {
    const fast = setClockState(stateOf({}), 'fast');
    const stopped = pauseClock(fast);

    expect(stopped.clockState).toBe('stopped');
    expect(stopped.lastActiveClockState).toBe('fast');
    expect(resumeClock(stopped).clockState).toBe('fast');
  });

  it('mantiene el día y el fragmento al parar (Requisito 5.5)', () => {
    const running = stateOf({ currentDay: 4, currentFragment: 2, clockState: 'play' });
    const stopped = pauseClock(running);

    expect(stopped.currentDay).toBe(4);
    expect(stopped.currentFragment).toBe(2);
  });

  it('no crea un estado nuevo si el reloj ya estaba en ese estado', () => {
    const running = stateOf({ clockState: 'play' });

    expect(setClockState(running, 'play')).toBe(running);
  });
});

// ---------------------------------------------------------------------------
// Programación de acciones (Requisitos 5.7, 5.12, 5.13, 5.16, 5.17)
// ---------------------------------------------------------------------------

describe('scheduleAction', () => {
  it('programa la finalización en el día d + C y en el fragmento de la solicitud', () => {
    const state = stateOf({ currentDay: 4, currentFragment: 2 });

    const scheduled = expectOk(
      scheduleAction(state, { type: 'exploration', hex: { q: 1, r: -1 }, days: 3 }, RULES),
    );

    expect(scheduled.scheduledActions).toHaveLength(1);
    expect(scheduled.scheduledActions[0]).toMatchObject({
      type: 'exploration',
      hex: { q: 1, r: -1 },
      startDay: 4,
      startFragment: 2,
      endDay: 7,
      endFragment: 2,
    });
  });

  it('aplica max(mínimo, techo(tiempo)) al tiempo reducido por efectos (Req. 5.17)', () => {
    const state = stateOf({ currentDay: 4, currentFragment: 1 });

    const fractional = expectOk(
      scheduleAction(state, { type: 'construction', hex: { q: 0, r: 1 }, days: 2.1 }, RULES),
    );
    const reduced = expectOk(
      scheduleAction(state, { type: 'construction', hex: { q: 0, r: 2 }, days: 0.4 }, RULES),
    );

    expect(fractional.scheduledActions[0]?.endDay).toBe(7);
    expect(reduced.scheduledActions[0]?.endDay).toBe(5);
    expect(normalizeActionDays(0, RULES)).toBe(1);
    expect(normalizeActionDays(3, RULES)).toBe(3);
  });

  it('admite acciones simultáneas en hexágonos distintos y sin hexágono (Req. 5.12)', () => {
    const state = withActions(stateOf({}), [
      { type: 'exploration', hex: { q: 1, r: 0 } },
      { type: 'construction', hex: { q: 0, r: 1 } },
      { type: 'research', hex: null },
    ]);

    expect(state.scheduledActions).toHaveLength(3);
  });

  it('rechaza una segunda acción sobre el mismo hexágono sin tocar el estado (Req. 5.13)', () => {
    const state = withActions(stateOf({ currentDay: 2, currentFragment: 3 }), [
      { type: 'exploration', hex: { q: 1, r: 0 } },
    ]);

    const rejected = scheduleAction(
      state,
      { type: 'construction', hex: { q: 1, r: 0 }, days: 2 },
      RULES,
    );
    const error = expectErr(rejected);

    expect(error.code).toBe('action_in_progress');
    expect(error.context).toEqual({
      hex: '1,0',
      type: 'exploration',
      endDay: 3,
      endFragment: 3,
    });
    expect(state.scheduledActions).toHaveLength(1);
  });

  it('no comparte la coordenada con quien la solicita', () => {
    const hex: AxialCoord = { q: 1, r: 0 };
    const state = expectOk(scheduleAction(stateOf({}), { type: 'harvest', hex, days: 1 }, RULES));

    hex.q = 99;

    expect(state.scheduledActions[0]?.hex).toEqual({ q: 1, r: 0 });
  });

  it('lanza RangeError si el tiempo calculado es negativo o no finito', () => {
    const state = stateOf({});

    expect(() => normalizeActionDays(-1, RULES)).toThrow(RangeError);
    expect(() =>
      scheduleAction(state, { type: 'exploration', hex: { q: 1, r: 0 }, days: Number.NaN }, RULES),
    ).toThrow(RangeError);
  });

  it('encuentra la acción en curso de un hexágono', () => {
    const state = withActions(stateOf({}), [{ type: 'exploration', hex: { q: 1, r: 0 } }]);

    expect(actionInProgressAt(state, { q: 1, r: 0 })?.type).toBe('exploration');
    expect(actionInProgressAt(state, { q: 0, r: 1 })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Instantes (Requisitos 5.8, 5.9)
// ---------------------------------------------------------------------------

describe('instantes', () => {
  it('coloca el Fin_De_Dia tras los fragmentos del día y antes del día siguiente', () => {
    const endOfDay: GameInstant = { kind: 'end_of_day', day: 1 };

    expect(compareInstants({ kind: 'fragment', day: 1, fragment: 3 }, endOfDay)).toBeLessThan(0);
    expect(
      compareInstants({ kind: 'fragment', day: 2, fragment: 0 }, endOfDay),
    ).toBeGreaterThan(0);
    expect(compareInstants(endOfDay, { kind: 'end_of_day', day: 1 })).toBe(0);
  });

  it('elige el vencimiento más próximo del día en curso como siguiente evento', () => {
    // Dos acciones solicitadas en fragmentos distintos del día 1, con el reloj
    // ya en el día 2: la que vence antes es la del fragmento 1.
    let state = stateOf({ currentDay: 1, currentFragment: LAST_FRAGMENT });
    state = expectOk(
      scheduleAction(state, { type: 'exploration', hex: { q: 1, r: 0 }, days: 1 }, RULES),
    );
    state = { ...state, currentFragment: 1 };
    state = expectOk(
      scheduleAction(state, { type: 'construction', hex: { q: 0, r: 1 }, days: 1 }, RULES),
    );
    state = { ...state, currentDay: 2, currentFragment: FIRST_FRAGMENT };

    expect(nextEventInstant(state)).toEqual({ kind: 'fragment', day: 2, fragment: 1 });
  });

  it('no cuenta los vencimientos posteriores al Fin_De_Dia del día en curso', () => {
    const state = withActions(stateOf({ currentDay: 1, currentFragment: 1 }), [
      { type: 'exploration', hex: { q: 1, r: 0 } },
    ]);

    expect(nextEventInstant(state)).toEqual({ kind: 'end_of_day', day: 1 });
  });

  it('cae en el Fin_De_Dia del día en curso cuando no hay nada antes', () => {
    const state = stateOf({ currentDay: 5, currentFragment: 1 });

    expect(nextEventInstant(state)).toEqual({ kind: 'end_of_day', day: 5 });
  });

  it('tiene en cuenta los eventos programados que no son acciones (Req. 5.9)', () => {
    const state = stateOf({ currentDay: 5, currentFragment: 1 });
    const hooks: ClockHooks = {
      nextScheduledEvent: () => ({ kind: 'fragment', day: 5, fragment: 2 }),
    };

    expect(nextEventInstant(state, hooks)).toEqual({ kind: 'fragment', day: 5, fragment: 2 });
  });

  it('ordena las acciones vencidas por (q, r) y deja al final las que no tienen hex', () => {
    const state = withActions(stateOf({}), [
      { type: 'research', hex: null },
      { type: 'exploration', hex: { q: 1, r: 0 } },
      { type: 'construction', hex: { q: -1, r: 2 } },
      { type: 'upgrade', hex: { q: 0, r: 1 } },
      { type: 'harvest', hex: { q: 0, r: -1 } },
    ]);

    const due = dueActions(state, { kind: 'fragment', day: 2, fragment: 0 });

    expect(due.map((action) => (action.hex === null ? 'sin-hex' : hexKey(action.hex)))).toEqual([
      '-1,2',
      '0,-1',
      '0,1',
      '1,0',
      'sin-hex',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Avance del tiempo real (Requisitos 5.3, 5.4, 5.5)
// ---------------------------------------------------------------------------

describe('advanceTime', () => {
  it('con el reloj parado no avanza nada y descarta el tiempo (Requisito 5.5)', () => {
    const state = stateOf({ currentDay: 3, currentFragment: 2, clockState: 'stopped' });

    const outcome = advanceTime(state, 10 * FRAGMENT_MS, RULES);

    expect(outcome.state).toBe(state);
    expect(outcome.carryMs).toBe(0);
    expect(outcome.paused).toBe(true);
  });

  it('acumula el tiempo que no llega a un fragmento y lo devuelve en carryMs', () => {
    const state = stateOf({ clockState: 'play' });

    const first = advanceTime(state, FRAGMENT_MS / 2, RULES);
    const second = advanceTime(first.state, first.carryMs + FRAGMENT_MS / 4, RULES);
    const third = advanceTime(second.state, second.carryMs + FRAGMENT_MS / 2, RULES);

    expect(first.state.currentFragment).toBe(0);
    expect(second.carryMs).toBe(FRAGMENT_MS * 0.75);
    expect(third.state.currentFragment).toBe(1);
    expect(third.carryMs).toBe(FRAGMENT_MS * 0.25);
  });

  it('completa un día en seconds_normal segundos reales (Requisito 5.3)', () => {
    const state = stateOf({ clockState: 'play' });

    const outcome = advanceTime(state, dayDurationMs(RULES, 'play'), RULES);

    expect(outcome.state.currentDay).toBe(2);
    expect(outcome.state.currentFragment).toBe(FIRST_FRAGMENT);
    expect(outcome.carryMs).toBe(0);
  });

  it('completa un día en seconds_fast segundos reales en avance rápido (Req. 5.4)', () => {
    const state = stateOf({ clockState: 'fast' });

    const outcome = advanceTime(state, dayDurationMs(RULES, 'fast'), RULES);

    expect(outcome.state.currentDay).toBe(2);
    expect(outcome.state.currentFragment).toBe(FIRST_FRAGMENT);
  });

  it('lanza RangeError si el tiempo transcurrido es negativo o no finito', () => {
    const state = stateOf({ clockState: 'play' });

    expect(() => advanceTime(state, -1, RULES)).toThrow(RangeError);
    expect(() => advanceTime(state, Number.POSITIVE_INFINITY, RULES)).toThrow(RangeError);
  });

  it('el cierre de createGameClock transporta el resto entre ticks', () => {
    const clock = createGameClock(RULES);
    let state = stateOf({ clockState: 'play' });

    state = clock.tick(state, FRAGMENT_MS / 2);
    expect(state.currentFragment).toBe(0);

    state = clock.tick(state, FRAGMENT_MS / 2);
    expect(state.currentFragment).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Resolución de instantes (Requisitos 5.8, 5.10, 5.11)
// ---------------------------------------------------------------------------

describe('advanceFragment', () => {
  it('resuelve las acciones vencidas en el orden del Requisito 5.8', () => {
    const log: string[] = [];
    const hooks = recordingHooks(log, ['exploration', 'construction', 'upgrade', 'research']);
    let state = withActions(stateOf({ clockState: 'play' }), [
      { type: 'research', hex: null },
      { type: 'exploration', hex: { q: 1, r: 0 } },
      { type: 'construction', hex: { q: -1, r: 2 } },
      { type: 'upgrade', hex: { q: 0, r: 1 } },
    ]);

    // Cuatro avances: los tres fragmentos que quedan del día 1, el Fin_De_Dia y
    // la llegada al primer fragmento del día 2, donde vencen las cuatro.
    for (let step = 0; step < RULES.fragments; step += 1) {
      state = advanceFragment(state, RULES, hooks);
    }

    expect(state.currentDay).toBe(2);
    expect(state.currentFragment).toBe(FIRST_FRAGMENT);
    expect(log).toEqual(['-1,2', '0,1', '1,0', 'research:sin-hex']);
    expect(state.scheduledActions).toEqual([]);
  });

  it('retira del calendario una acción cuyo tipo no tiene resolutor registrado', () => {
    let state = withActions(stateOf({ clockState: 'play' }), [
      { type: 'construction', hex: { q: 1, r: 0 } },
    ]);

    for (let step = 0; step < RULES.fragments; step += 1) {
      state = advanceFragment(state, RULES, {});
    }

    expect(state.scheduledActions).toEqual([]);
  });

  it('resuelve los pasos del Fin_De_Dia en el orden fijo del Requisito 5.11', () => {
    const log: string[] = [];
    const state = stateOf({ currentFragment: LAST_FRAGMENT, clockState: 'play' });

    const advanced = advanceFragment(state, RULES, recordingEndOfDay(log));

    expect(log).toEqual([...END_OF_DAY_STEPS]);
    expect(advanced.currentDay).toBe(2);
    expect(advanced.currentFragment).toBe(FIRST_FRAGMENT);
  });

  it('resuelve el Fin_De_Dia antes de las acciones que vencen al día siguiente', () => {
    const log: string[] = [];
    const actionHooks = recordingHooks(log, ['exploration']);
    // Solicitada en el primer fragmento del día 1, vence en el primer fragmento
    // del día 2; el reloj llega ahí desde el último fragmento del día 1.
    const scheduled = withActions(stateOf({ clockState: 'play' }), [
      { type: 'exploration', hex: { q: 1, r: 0 } },
    ]);
    const state: GameState = { ...scheduled, currentFragment: LAST_FRAGMENT };
    const hooks: ClockHooks = {
      ...actionHooks,
      endOfDay: {
        production: (current) => {
          log.push('production');
          return { state: current };
        },
      },
    };

    advanceFragment(state, RULES, hooks);

    expect(log).toEqual(['production', '1,0']);
  });

  it('solo resuelve el Fin_De_Dia al salir del último fragmento del día', () => {
    const log: string[] = [];
    const state = stateOf({ currentFragment: 0, clockState: 'play' });

    const advanced = advanceFragment(state, RULES, recordingEndOfDay(log));

    expect(log).toEqual([]);
    expect(advanced.currentDay).toBe(1);
    expect(advanced.currentFragment).toBe(1);
  });

  it('aplica los pasos de recursos del Fin_De_Dia: consume la comida del día', () => {
    const state = stateOf({
      currentFragment: LAST_FRAGMENT,
      clockState: 'play',
      resources: resourcesOf({ freePopulation: 4, food: 10 }),
    });
    const hooks: ClockHooks = {
      endOfDay: createResourceEndOfDaySteps(RESOURCE_DATA, RESOURCE_RULES),
    };

    const advanced = advanceFragment(state, RULES, hooks);

    expect(advanced.resources.food).toBe(8);
    expect(advanced.currentDay).toBe(2);
  });

  it('resuelve los pasos del Fin_De_Dia sin cruzar de día con resolveEndOfDay', () => {
    const log: string[] = [];
    const state = stateOf({ currentDay: 6, currentFragment: LAST_FRAGMENT, clockState: 'play' });

    const resolved = resolveEndOfDay(state, recordingEndOfDay(log));

    expect(log).toEqual([...END_OF_DAY_STEPS]);
    expect(currentInstant(resolved)).toEqual({ kind: 'fragment', day: 6, fragment: LAST_FRAGMENT });
  });
});

// ---------------------------------------------------------------------------
// Pausa automática (Requisito 5.15)
// ---------------------------------------------------------------------------

describe('pausa automática', () => {
  it('para el reloj tras resolver todos los pasos del instante y no sigue avanzando', () => {
    const log: string[] = [];
    const hooks: ClockHooks = {
      actions: {
        exploration: (state, action) => {
          log.push(action.hex === null ? 'sin-hex' : hexKey(action.hex));
          return { state, pause: ['mystery_discovered'] };
        },
        construction: (state, action) => {
          log.push(action.hex === null ? 'sin-hex' : hexKey(action.hex));
          return { state, pause: ['combat'] };
        },
      },
    };
    const state = withActions(stateOf({ clockState: 'play' }), [
      { type: 'exploration', hex: { q: 1, r: 0 } },
      { type: 'construction', hex: { q: 0, r: 1 } },
    ]);

    // Tiempo real de sobra para varios días: el reloj debe pararse en el
    // instante del evento y no consumir el resto.
    const outcome = advanceTime(state, 10 * dayDurationMs(RULES, 'play'), RULES, hooks);

    expect(log).toEqual(['0,1', '1,0']);
    expect(outcome.state.clockState).toBe('stopped');
    expect(outcome.state.currentDay).toBe(2);
    expect(outcome.state.currentFragment).toBe(FIRST_FRAGMENT);
    expect(outcome.carryMs).toBe(0);
    expect(outcome.paused).toBe(true);
  });

  it('para el reloj cuando la causa nace de un paso del Fin_De_Dia', () => {
    const state = stateOf({ currentFragment: LAST_FRAGMENT, clockState: 'play' });
    const hooks: ClockHooks = {
      endOfDay: {
        threat_expansion: (current) => ({ state: current, pause: ['threat_expansion'] }),
      },
    };

    const advanced = advanceFragment(state, RULES, hooks);

    expect(advanced.clockState).toBe('stopped');
    expect(advanced.currentDay).toBe(2);
  });

  it('deja las acciones que no han vencido en el calendario al pararse', () => {
    const hooks: ClockHooks = {
      actions: { exploration: (state) => ({ state, pause: ['settlement_discovered'] }) },
    };
    let state = stateOf({ clockState: 'play' });
    state = expectOk(
      scheduleAction(state, { type: 'exploration', hex: { q: 1, r: 0 }, days: 1 }, RULES),
    );
    state = expectOk(
      scheduleAction(state, { type: 'construction', hex: { q: 0, r: 1 }, days: 4 }, RULES),
    );

    const outcome = advanceTime(state, 10 * dayDurationMs(RULES, 'play'), RULES, hooks);

    expect(outcome.state.scheduledActions).toHaveLength(1);
    expect(outcome.state.scheduledActions[0]?.type).toBe('construction');
  });
});

// ---------------------------------------------------------------------------
// Avanzar al siguiente evento (Requisito 5.9)
// ---------------------------------------------------------------------------

describe('skipToNextEvent', () => {
  it('sin nada programado avanza al Fin_De_Dia, lo resuelve y para', () => {
    const log: string[] = [];
    const state = stateOf({ currentDay: 3, currentFragment: 1, clockState: 'play' });

    const advanced = skipToNextEvent(state, RULES, recordingEndOfDay(log));

    expect(log).toEqual([...END_OF_DAY_STEPS]);
    expect(advanced.currentDay).toBe(4);
    expect(advanced.currentFragment).toBe(FIRST_FRAGMENT);
    expect(advanced.clockState).toBe('stopped');
  });

  it('para en el fragmento en que vence una acción del día en curso', () => {
    const log: string[] = [];
    const hooks = recordingHooks(log, ['exploration']);
    let state = stateOf({ currentDay: 3, currentFragment: 2, clockState: 'play' });
    state = expectOk(
      scheduleAction(state, { type: 'exploration', hex: { q: 1, r: 0 }, days: 1 }, RULES),
    );
    // La acción vence el día 4 en el fragmento 2. Con el reloj en el día 4,
    // fragmento 0, ese vencimiento llega antes que el Fin_De_Dia del día 4.
    state = { ...state, currentDay: 4, currentFragment: 0 };

    const advanced = skipToNextEvent(state, RULES, hooks);

    expect(log).toEqual(['1,0']);
    expect(currentInstant(advanced)).toEqual({ kind: 'fragment', day: 4, fragment: 2 });
    expect(advanced.clockState).toBe('stopped');
  });

  it('no adelanta una acción que vence más allá del Fin_De_Dia del día en curso', () => {
    const log: string[] = [];
    const hooks = recordingHooks(log, ['exploration']);
    let state = stateOf({ currentDay: 3, currentFragment: 1, clockState: 'play' });
    state = expectOk(
      scheduleAction(state, { type: 'exploration', hex: { q: 1, r: 0 }, days: 2 }, RULES),
    );

    const advanced = skipToNextEvent(state, RULES, hooks);

    expect(log).toEqual([]);
    expect(advanced.currentDay).toBe(4);
    expect(advanced.scheduledActions).toHaveLength(1);
  });

  it('respeta el evento programado que aporta el llamante', () => {
    const state = stateOf({ currentDay: 2, currentFragment: 0, clockState: 'play' });
    const hooks: ClockHooks = {
      nextScheduledEvent: () => ({ kind: 'fragment', day: 2, fragment: 2 }),
    };

    const advanced = skipToNextEvent(state, RULES, hooks);

    expect(currentInstant(advanced)).toEqual({ kind: 'fragment', day: 2, fragment: 2 });
    expect(advanced.clockState).toBe('stopped');
  });

  it('deja el reloj parado aunque estuviera parado antes', () => {
    const state = stateOf({ currentDay: 2, currentFragment: 0, clockState: 'stopped' });

    const advanced = skipToNextEvent(state, RULES);

    expect(advanced.clockState).toBe('stopped');
    expect(advanced.currentDay).toBe(3);
  });
});
