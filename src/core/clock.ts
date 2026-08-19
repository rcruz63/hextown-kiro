/**
 * Reloj_De_Juego: divide el día en fragmentos, convierte el tiempo real en
 * tiempo de juego según la velocidad, programa la finalización de las acciones,
 * resuelve cada instante al que llega y para el reloj ante los eventos que
 * exigen atención del jugador (Requisitos 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7,
 * 5.8, 5.9, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17).
 *
 * Decisiones de diseño:
 *
 * - **El reloj no consulta el tiempo real, lo recibe.** `advanceTime` toma los
 *   milisegundos transcurridos como argumento porque `src/core/` no puede usar
 *   `Date.now` ni `performance.now`: quien mide el tiempo es el bucle de render
 *   (tarea 18.1). Así el avance del tiempo es una función pura y los tests
 *   pueden simular cualquier cadencia.
 * - **El resto de tiempo real no es estado de partida.** Un tick de 16 ms es
 *   mucho menor que un fragmento, así que hay que acumular la fracción que
 *   sobra; ese resto no entra en `GameState` porque no interviene en la
 *   simulación, no debe viajar en el guardado y no debe intervenir en la
 *   comparación de determinismo (Requisito 5.19). `advanceTime` lo devuelve en
 *   `carryMs` y quien llama lo vuelve a pasar; el cierre de `createGameClock` lo
 *   guarda por comodidad y ofrece el `tick(state, deltaMs)` del diseño.
 * - **La velocidad es un estado, no un multiplicador.** `ClockState` ya declara
 *   exactamente uno de `stopped`, `play` o `fast` (Requisito 5.2) y la duración
 *   de un fragmento se deriva de `rules.day.seconds_normal` o
 *   `rules.day.seconds_fast` dividido entre `rules.day.fragments` (Requisitos
 *   5.1, 5.3, 5.4). En código no hay ni un número de balance: solo la conversión
 *   de segundos a milisegundos, el primer día 1 y el primer fragmento 0.
 * - **El Fin_De_Dia se resuelve al salir del último fragmento del día**, con el
 *   estado todavía en el día `d` y su último fragmento, y solo después el reloj
 *   cruza a `(d + 1, primer fragmento)`. `GameState` solo guarda día y fragmento,
 *   así que no hay forma de representar «estoy en el Fin_De_Dia»; resolverlo en
 *   la transición evita inventar un campo de estado y deja las entradas del
 *   Registro_De_Eventos fechadas en el día que termina. Como consecuencia, todas
 *   las construcciones completadas ese día ya están completadas cuando corre la
 *   producción (Requisito 5.10).
 * - **Los resolutores se inyectan.** Al completarse una acción hay que
 *   resolverla, y quien sabe hacerlo es el sistema de su tipo: ninguno de esos
 *   módulos existe todavía. En lugar de importarlos, el reloj recibe en
 *   `ClockHooks.actions` un registro de `ActionType` a resolutor y en
 *   `ClockHooks.endOfDay` un resolutor por paso del Fin_De_Dia. El reloj aporta
 *   lo que es suyo: *cuándo* ocurre cada cosa y en *qué orden*.
 * - **Un tipo de acción sin resolutor registrado se retira del calendario sin
 *   más efecto.** La alternativa —dejarla programada— bloquearía su hexágono
 *   para siempre (Requisito 5.13) y volvería a intentar resolverse en cada
 *   fragmento. Mientras las tareas 9.1, 9.2, 9.4, 12.2, 13.1 y 13.2 no registren
 *   sus resolutores, sus acciones caducan sin consecuencias.
 * - **La pausa automática se acumula durante el instante y se aplica al final.**
 *   Los resolutores no paran el reloj: devuelven las causas en
 *   `InstantResolution.pause` y el reloj hace una única transición a `stopped`
 *   cuando ya ha resuelto todos los pasos del instante, aunque varias causas
 *   coincidan en el mismo día y fragmento (Requisito 5.15).
 * - **`scheduleAction` normaliza el tiempo en lugar de rechazarlo.** Un coste de
 *   `2.4` días o de `0.5` días no es un error del jugador sino el resultado de
 *   aplicar Efecto_Global, y el Requisito 5.17 dice qué hacer con él:
 *   `max(minimo_dias_accion, techo(tiempo))`. Un tiempo negativo o no finito, en
 *   cambio, es un error de programación de quien lo calcula y lanza `RangeError`.
 * - **El orden de resolución simultánea no depende de estructuras con orden de
 *   inserción.** `dueActions` ordena por coordenada axial y deja al final las
 *   acciones sin hexágono (Requisito 5.8); entre dos acciones sin hexágono
 *   ordena por tipo y, a igualdad, por su posición en el calendario, que es
 *   función determinista de la secuencia de acciones del jugador.
 * - **Una acción vencida se resuelve en el primer instante al que llega el
 *   reloj**, no solo en el instante exacto de su vencimiento: `dueActions`
 *   compara con «vence en este instante o antes». Por construcción no se salta
 *   ningún vencimiento, pero un guardado incoherente no deja acciones colgadas.
 *
 * Algoritmo:
 *
 * 1. `readClockRules(rules)` (Requisitos 5.1, 5.3, 5.4, 5.16) interpreta
 *    `rules.day` y acumula un diagnóstico por parámetro ausente o inservible.
 *    `fragmentDurationMs(rules, velocidad)` es la duración real de un fragmento.
 * 2. `initializeClock(state)` (Requisito 5.6) fija el día 1, el primer fragmento
 *    y el estado parado.
 * 3. `scheduleAction(state, request, rules)` (Requisitos 5.7, 5.13, 5.16, 5.17):
 *    rechaza la solicitud si el hexágono ya tiene una acción en curso, sin tocar
 *    el estado, y si no añade al calendario una acción que empieza en el día y
 *    fragmento actuales y termina en el día `d + max(minimo, techo(C))`, en el
 *    mismo fragmento de la solicitud (Requisito 5.18).
 * 4. `advanceTime(state, elapsedMs, rules, hooks)` (Requisitos 5.3, 5.4, 5.5):
 *    con el reloj parado devuelve el estado tal cual y descarta el tiempo. Si
 *    no, consume un fragmento por cada `fragmentDurationMs` acumulado y devuelve
 *    el resto sin consumir.
 * 5. `advanceFragment(state, rules, hooks)` resuelve un instante:
 *    a. Si el fragmento actual es el último del día, resuelve los pasos del
 *       Fin_De_Dia en el orden fijo de `END_OF_DAY_STEPS` (Requisito 5.11) y
 *       cruza a `(día + 1, primer fragmento)`; si no, avanza un fragmento.
 *    b. Resuelve todas las acciones vencidas en el nuevo instante, en el orden
 *       del Requisito 5.8, antes de que el reloj pueda volver a avanzar.
 *    c. Si algún paso pidió pausa, deja el reloj parado (Requisito 5.15).
 * 6. `skipToNextEvent(state, rules, hooks)` (Requisito 5.9): calcula con
 *    `nextEventInstant` el primero de estos instantes en orden cronológico —el
 *    vencimiento de una acción en curso, un evento programado o el Fin_De_Dia
 *    del día en curso—, avanza fragmento a fragmento hasta alcanzarlo
 *    resolviendo lo que encuentre, y para el reloj. El Fin_De_Dia del día en
 *    curso es siempre candidato, así que el objetivo nunca está más allá del
 *    final del día y el bucle termina en `rules.day.fragments` pasos.
 *
 * Reparto de responsabilidades: el reloj no sabe qué significa ninguna acción.
 * Cuánto cuesta y cuánto tarda cada una lo calculan sus sistemas —exploración
 * (Requisitos 3.1, 3.2, tarea 5.2), construcción (tarea 9.1), mejora (tarea
 * 9.2), demolición (tarea 9.3), investigación (tarea 11.1)—, que llaman a
 * `scheduleAction` con el tiempo ya calculado; y qué ocurre al completarse lo
 * resuelven los resolutores que esos mismos sistemas registran en
 * `ClockHooks.actions`: `exploration` la tarea 5.2, `construction` la 9.1,
 * `upgrade` la 9.2, `demolition` la 9.3, `harvest` y `logging` la 10.1 y
 * `research` la 11.1. Los pasos del Fin_De_Dia los escriben la producción
 * (tarea 9.4) para `production`, las fábricas (10.2) para `factory_conversion`,
 * el Sistema_De_Amenazas (12.1) para `threat_passive_effects`, `threat_respawn`
 * y `threat_expansion`, el Sistema_De_Objetivos (13.1) para `objectives` y
 * `defeat_check`, y la persistencia (16.1) para `autosave`; los pasos de comida
 * y enfermedad los aporta ya el Gestor_De_Recursos con
 * `createResourceEndOfDaySteps`. El reloj tampoco valida recursos ni población:
 * comprometerlos antes de programar es del Gestor_De_Recursos (Requisitos 4.2,
 * 4.3, 4.16), y por eso el Requisito 5.12 se cumple sin código —el reloj no
 * impone ningún tope al número de acciones simultáneas—. El límite de una
 * investigación simultánea (Requisito 5.14) es del Sistema_De_Investigacion,
 * que lo comprueba antes de programar: aquí solo se rechaza la segunda acción
 * sobre un mismo hexágono (Requisito 5.13). No decide qué se muestra al parar
 * ni cómo se dibuja el fragmento en curso: eso es del Sistema_De_Interfaz y del
 * Motor_De_Render (Requisitos 5.15, 19). Y no acota el `deltaMs` que recibe: si
 * la pestaña estuvo minutos en segundo plano, quien mide el tiempo decide
 * cuánto entrega (tarea 18.1).
 */
import type { AxialCoord } from './hex-math.ts';
import { hexKey } from './hex-math.ts';
import { resolveDiseaseRoll, resolveFoodConsumption } from './resources.ts';
import type { ResourceData, ResourceRules } from './resources.ts';
import { err, ok } from './result.ts';
import type { GameError, Result } from './result.ts';
import type { ActionType, ClockState, GameState, ScheduledAction } from './types.ts';
import type { RulesData } from '../data/loader.ts';

// ---------------------------------------------------------------------------
// Constantes estructurales
// ---------------------------------------------------------------------------

/** Primer día de una partida (Requisito 5.6). No es un parámetro de balance. */
export const FIRST_DAY = 1;

/** Primer fragmento de un día (Requisito 5.6). Los fragmentos van de 0 a N-1. */
export const FIRST_FRAGMENT = 0;

/** Conversión de segundos a milisegundos: unidades, no balance. */
const MS_PER_SECOND = 1000;

/** Grupo de reglas globales del que sale la configuración del reloj. */
const DAY_GROUP = 'day';

/**
 * Pasos del Fin_De_Dia en el orden fijo del Requisito 5.11. El orden es el
 * contrato del reloj; qué hace cada paso lo aporta su sistema por inyección.
 *
 * `famine` figura aquí porque el requisito la enumera, pero el
 * Gestor_De_Recursos la resuelve dentro de `food_consumption`: la hambruna
 * necesita el déficit de comida anterior a fijarla en 0. Los dos pasos son
 * contiguos, así que el orden observable no cambia.
 */
export const END_OF_DAY_STEPS = [
  'production',
  'factory_conversion',
  'threat_passive_effects',
  'food_consumption',
  'famine',
  'disease_roll',
  'threat_respawn',
  'threat_expansion',
  'objectives',
  'defeat_check',
  'autosave',
] as const;

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Paso del Fin_De_Dia (Requisito 5.11). */
export type EndOfDayStep = (typeof END_OF_DAY_STEPS)[number];

/** Estados del reloj en los que el tiempo corre (Requisitos 5.3, 5.4). */
export type ClockSpeed = 'play' | 'fast';

/**
 * Parámetros de balance del reloj, ya interpretados con `readClockRules`. Se
 * leen una vez al arrancar la partida y se pasan a cada operación, de modo que
 * la validación de los datos ocurre en el límite y no en cada tick.
 */
export interface ClockRules {
  /** `rules.day.fragments`: fragmentos de igual duración por día (Req. 5.1). */
  fragments: number;
  /** `rules.day.seconds_normal`: segundos reales por día en play (Req. 5.3). */
  secondsPerDayNormal: number;
  /** `rules.day.seconds_fast`: segundos reales por día en rápido (Req. 5.4). */
  secondsPerDayFast: number;
  /** `rules.day.minimo_dias_accion`: mínimo en días (Requisitos 5.16, 5.17). */
  minimumActionDays: number;
}

/**
 * Instante del calendario de la partida: un fragmento concreto de un día o el
 * Fin_De_Dia de un día, que va después de todos sus fragmentos y antes del
 * primer fragmento del día siguiente.
 */
export type GameInstant =
  | { kind: 'fragment'; day: number; fragment: number }
  | { kind: 'end_of_day'; day: number };

/**
 * Motivos por los que el reloj pasa a parado una vez resueltos todos los pasos
 * del instante en curso (Requisito 5.15).
 */
export type PauseCause =
  | 'combat'
  | 'mystery_discovered'
  | 'settlement_discovered'
  | 'threat_expansion'
  | 'mission_completed'
  | 'objective_completed';

/**
 * Resultado de resolver un paso: el estado nuevo y, si procede, los motivos por
 * los que el reloj debe parar. El resolutor nunca cambia `clockState`: la pausa
 * la aplica el reloj al terminar el instante.
 */
export interface InstantResolution {
  state: GameState;
  /** Motivos de pausa automática; ausente o vacío si no hay ninguno. */
  pause?: readonly PauseCause[];
}

/** Resolutor de una acción que acaba de vencer (Requisito 5.8). */
export type ActionResolver = (
  state: GameState,
  action: ScheduledAction,
  instant: GameInstant,
) => InstantResolution;

/** Resolutor de un paso del Fin_De_Dia (Requisito 5.11). */
export type EndOfDayStepResolver = (state: GameState, instant: GameInstant) => InstantResolution;

/** Registro de resolutores por tipo de acción. */
export type ActionResolvers = Partial<Record<ActionType, ActionResolver>>;

/** Registro de resolutores por paso del Fin_De_Dia. */
export type EndOfDaySteps = Partial<Record<EndOfDayStep, EndOfDayStepResolver>>;

/**
 * Puntos de extensión del reloj. Todo es opcional: un reloj sin resolutores
 * avanza el tiempo y retira las acciones vencidas sin resolverlas, que es el
 * comportamiento útil mientras los sistemas se van escribiendo.
 */
export interface ClockHooks {
  /** Qué hacer cuando vence una acción de cada tipo (Requisito 5.8). */
  actions?: ActionResolvers;
  /** Qué hacer en cada paso del Fin_De_Dia (Requisito 5.11). */
  endOfDay?: EndOfDaySteps;
  /**
   * Próximo evento programado que no es el vencimiento de una acción, para
   * `skipToNextEvent` (Requisito 5.9). Lo aporta el Registro_De_Eventos
   * (tarea 15.2) o el Sistema_De_Amenazas (tarea 12.1).
   */
  nextScheduledEvent?: (state: GameState) => GameInstant | undefined;
}

/**
 * Solicitud de programación de una acción. El tiempo llega en días tal como lo
 * calcula el sistema que la solicita, con sus Efecto_Global ya aplicados; el
 * reloj lo normaliza (Requisitos 5.16, 5.17).
 */
export interface ActionRequest {
  type: ActionType;
  /** Hexágono afectado, o `null` para las acciones sin hex (investigación). */
  hex: AxialCoord | null;
  /** Coste en días, no necesariamente entero (Requisitos 5.16, 5.17). */
  days: number;
  /** Datos que el resolutor de la acción necesitará al vencer. */
  metadata?: Record<string, unknown>;
}

/** Resultado de convertir tiempo real en tiempo de juego. */
export interface TickOutcome {
  state: GameState;
  /**
   * Tiempo real acumulado que no llega a completar un fragmento. Quien llama
   * debe sumarlo al siguiente delta o perderá ese tiempo.
   */
  carryMs: number;
  /** `true` si el reloj quedó parado, por pausa automática o por estarlo ya. */
  paused: boolean;
}

/**
 * Reloj con sus reglas y sus resolutores ya ligados, que además guarda el resto
 * de tiempo real entre ticks (design.md, `GameClock`).
 */
export interface GameClock {
  tick(state: GameState, deltaMs: number): GameState;
  scheduleAction(state: GameState, request: ActionRequest): Result<GameState>;
  skipToNextEvent(state: GameState): GameState;
}

// ---------------------------------------------------------------------------
// API pública: lectura de datos
// ---------------------------------------------------------------------------

/**
 * Interpreta los parámetros de `rules.day` (Requisitos 5.1, 5.3, 5.4, 5.16).
 *
 * Acumula un diagnóstico por parámetro ausente o inservible; nunca lanza. Las
 * cotas no son balance: el número de fragmentos y el mínimo de días salen
 * enteros y mayores o iguales que 1 porque lo dicen los Requisitos 5.1 y 5.16,
 * y la duración de un día en segundos es estrictamente positiva porque un día
 * de duración 0 haría que el tiempo no avanzase.
 *
 * Códigos de error, estables: `missing_field` y `invalid_value`.
 */
export function readClockRules(rules: RulesData): Result<ClockRules, GameError[]> {
  const errors: GameError[] = [];
  const fragments = readRuleNumber(rules, 'fragments', COUNT_SPEC, errors);
  const secondsPerDayNormal = readRuleNumber(rules, 'seconds_normal', SECONDS_SPEC, errors);
  const secondsPerDayFast = readRuleNumber(rules, 'seconds_fast', SECONDS_SPEC, errors);
  const minimumActionDays = readRuleNumber(rules, 'minimo_dias_accion', COUNT_SPEC, errors);

  if (
    fragments === undefined ||
    secondsPerDayNormal === undefined ||
    secondsPerDayFast === undefined ||
    minimumActionDays === undefined
  ) {
    return err(errors);
  }

  return ok({ fragments, secondsPerDayNormal, secondsPerDayFast, minimumActionDays });
}

/** Duración real de un día completo a la velocidad dada (Requisitos 5.3, 5.4). */
export function dayDurationMs(rules: ClockRules, speed: ClockSpeed): number {
  const seconds = speed === 'fast' ? rules.secondsPerDayFast : rules.secondsPerDayNormal;
  return seconds * MS_PER_SECOND;
}

/**
 * Duración real de un fragmento a la velocidad dada: el día repartido en
 * `rules.day.fragments` partes iguales (Requisitos 5.1, 5.3, 5.4).
 */
export function fragmentDurationMs(rules: ClockRules, speed: ClockSpeed): number {
  return dayDurationMs(rules, speed) / rules.fragments;
}

// ---------------------------------------------------------------------------
// API pública: estado del reloj
// ---------------------------------------------------------------------------

/**
 * Deja el reloj como al comenzar una partida: día 1, primer fragmento del día y
 * estado parado (Requisito 5.6).
 *
 * El estado activo al que se reanuda arranca en `play`, que es el neutro: el
 * jugador nunca ha elegido velocidad todavía.
 */
export function initializeClock(state: GameState): GameState {
  return {
    ...state,
    currentDay: FIRST_DAY,
    currentFragment: FIRST_FRAGMENT,
    clockState: 'stopped',
    lastActiveClockState: 'play',
  };
}

/**
 * Cambia el estado del reloj (Requisito 5.2) y devuelve un estado nuevo.
 *
 * Al elegir una velocidad la recuerda como `lastActiveClockState`, de modo que
 * reanudar desde parado vuelve a la última velocidad usada.
 */
export function setClockState(state: GameState, next: ClockState): GameState {
  if (state.clockState === next) {
    return state;
  }
  return next === 'stopped'
    ? { ...state, clockState: 'stopped' }
    : { ...state, clockState: next, lastActiveClockState: next };
}

/** Para el reloj: mantiene el día y el fragmento actuales (Requisito 5.5). */
export function pauseClock(state: GameState): GameState {
  return setClockState(state, 'stopped');
}

/** Reanuda el reloj a la última velocidad elegida (Requisito 5.2). */
export function resumeClock(state: GameState): GameState {
  return setClockState(state, state.lastActiveClockState);
}

// ---------------------------------------------------------------------------
// API pública: instantes
// ---------------------------------------------------------------------------

/** Instante en el que está el reloj. */
export function currentInstant(state: GameState): GameInstant {
  return { kind: 'fragment', day: state.currentDay, fragment: state.currentFragment };
}

/** Instante en el que vence una acción programada (Requisitos 5.7, 5.18). */
export function actionEndInstant(action: ScheduledAction): GameInstant {
  return { kind: 'fragment', day: action.endDay, fragment: action.endFragment };
}

/**
 * Orden cronológico de dos instantes: negativo si `a` es anterior, 0 si son el
 * mismo y positivo si `a` es posterior.
 *
 * El Fin_De_Dia de un día va después de todos sus fragmentos y antes del primer
 * fragmento del día siguiente.
 */
export function compareInstants(a: GameInstant, b: GameInstant): number {
  if (a.day !== b.day) {
    return a.day - b.day;
  }
  if (a.kind !== b.kind) {
    return a.kind === 'end_of_day' ? 1 : -1;
  }
  return a.kind === 'fragment' && b.kind === 'fragment' ? a.fragment - b.fragment : 0;
}

/**
 * Primero de estos instantes en orden cronológico: el vencimiento de una acción
 * en curso, un evento programado o el Fin_De_Dia del día en curso
 * (Requisito 5.9).
 *
 * Siempre devuelve un instante, porque el Fin_De_Dia del día en curso es
 * siempre candidato. Los vencimientos que ya pasaron no cuentan: se resolverán
 * en el siguiente fragmento al que llegue el reloj.
 */
export function nextEventInstant(state: GameState, hooks: ClockHooks = {}): GameInstant {
  const now = currentInstant(state);
  let best: GameInstant = { kind: 'end_of_day', day: state.currentDay };

  for (const action of state.scheduledActions) {
    const end = actionEndInstant(action);
    if (compareInstants(end, now) > 0 && compareInstants(end, best) < 0) {
      best = end;
    }
  }

  const scheduled = hooks.nextScheduledEvent?.(state);
  if (
    scheduled !== undefined &&
    compareInstants(scheduled, now) > 0 &&
    compareInstants(scheduled, best) < 0
  ) {
    best = scheduled;
  }

  return best;
}

// ---------------------------------------------------------------------------
// API pública: programación de acciones
// ---------------------------------------------------------------------------

/**
 * Días que el reloj aplica a una acción cuyo coste calculado es `days`:
 * `max(minimo_dias_accion, techo(days))` (Requisitos 5.16, 5.17).
 *
 * @throws RangeError Si `days` es negativo o no finito: el tiempo lo calcula el
 *   sistema que solicita la acción, así que un valor así es un error de
 *   programación y no un dato del jugador.
 */
export function normalizeActionDays(days: number, rules: ClockRules): number {
  if (!Number.isFinite(days) || days < 0) {
    throw new RangeError(
      `normalizeActionDays: se esperaba un número mayor o igual que 0, recibido ${String(days)}`,
    );
  }
  return Math.max(rules.minimumActionDays, Math.ceil(days));
}

/**
 * Acción en curso sobre un hexágono, o `undefined` si no hay ninguna
 * (Requisito 5.13).
 */
export function actionInProgressAt(
  state: GameState,
  hex: AxialCoord,
): ScheduledAction | undefined {
  return state.scheduledActions.find(
    (action) => action.hex !== null && action.hex.q === hex.q && action.hex.r === hex.r,
  );
}

/**
 * Programa la finalización de una acción en el día `d + C`, mismo fragmento de
 * la solicitud (Requisitos 5.7, 5.18), y devuelve un estado nuevo.
 *
 * `C` es `normalizeActionDays(request.days, rules)`, de modo que un Efecto_Global
 * que reduzca el tiempo por debajo de un día o a un valor no entero no rompe el
 * calendario (Requisitos 5.16, 5.17). No hay tope al número de acciones
 * simultáneas: comprometer sus recursos es del Gestor_De_Recursos
 * (Requisito 5.12).
 *
 * Rechaza la solicitud sobre un hexágono que ya tiene una acción en curso sin
 * tocar el estado, para que quien la pidió no comprometa nada
 * (Requisito 5.13).
 *
 * Código de error, estable, que el Sistema_De_Interfaz resuelve con la clave
 * `ui.error.action_in_progress` del catálogo i18n:
 *
 * - `action_in_progress`: el hexágono tiene una acción en curso. El contexto
 *   lleva su tipo y su día y fragmento de finalización, que es lo que el
 *   Requisito 5.13 exige mostrar; interpolarlos en el texto es del
 *   Sistema_De_Interfaz (tarea 19.1).
 *
 * @throws RangeError En los mismos casos que {@link normalizeActionDays}.
 */
export function scheduleAction(
  state: GameState,
  request: ActionRequest,
  rules: ClockRules,
): Result<GameState> {
  const days = normalizeActionDays(request.days, rules);

  if (request.hex !== null) {
    const inProgress = actionInProgressAt(state, request.hex);
    if (inProgress !== undefined) {
      return err(actionInProgressError(request.hex, inProgress));
    }
  }

  const action: ScheduledAction = {
    type: request.type,
    // Copia de la coordenada: el estado no comparte estructuras con quien llama.
    hex: request.hex === null ? null : { q: request.hex.q, r: request.hex.r },
    startDay: state.currentDay,
    startFragment: state.currentFragment,
    endDay: state.currentDay + days,
    endFragment: state.currentFragment,
    metadata: request.metadata ?? {},
  };

  return ok({ ...state, scheduledActions: [...state.scheduledActions, action] });
}

/**
 * Acciones que vencen en un instante o que ya vencieron, en el orden en que hay
 * que resolverlas: orden lexicográfico ascendente de coordenada axial `(q, r)`
 * y, después de todas ellas, las acciones sin hexágono asociado
 * (Requisito 5.8).
 *
 * Dos acciones con hexágono nunca comparten coordenada (Requisito 5.13); entre
 * las que no tienen hexágono el orden es por tipo y, a igualdad, por posición en
 * el calendario. El resultado no depende del orden de inserción de ninguna
 * estructura del estado.
 */
export function dueActions(state: GameState, instant: GameInstant): ScheduledAction[] {
  const due: DueEntry[] = [];
  state.scheduledActions.forEach((action, index) => {
    if (compareInstants(actionEndInstant(action), instant) <= 0) {
      due.push({ action, index });
    }
  });
  due.sort(compareDueEntries);
  return due.map((entry) => entry.action);
}

// ---------------------------------------------------------------------------
// API pública: avance del tiempo
// ---------------------------------------------------------------------------

/**
 * Convierte tiempo real en tiempo de juego (Requisitos 5.3, 5.4, 5.5).
 *
 * `elapsedMs` es el tiempo real pendiente de consumir: el `carryMs` de la
 * llamada anterior más el nuevo delta del bucle de render. Consume un fragmento
 * por cada `fragmentDurationMs(rules, velocidad)` acumulado, resolviendo cada
 * instante al que llega, y devuelve en `carryMs` lo que no llega a un fragmento.
 *
 * Con el reloj parado devuelve el estado tal cual y descarta el tiempo: el día y
 * el fragmento no cambian y ni la producción ni las acciones avanzan
 * (Requisito 5.5). Si un instante pide pausa, para el reloj, descarta el resto
 * del tiempo —así reanudar no salta inmediatamente al fragmento siguiente, que
 * dejaría al jugador sin ver el evento— y no sigue avanzando (Requisito 5.15).
 *
 * @throws RangeError Si `elapsedMs` es negativo o no finito.
 */
export function advanceTime(
  state: GameState,
  elapsedMs: number,
  rules: ClockRules,
  hooks: ClockHooks = {},
): TickOutcome {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError(
      `advanceTime: se esperaban milisegundos mayores o iguales que 0, recibido ${String(elapsedMs)}`,
    );
  }
  if (state.clockState === 'stopped') {
    return { state, carryMs: 0, paused: true };
  }

  const perFragment = fragmentDurationMs(rules, state.clockState);
  let carryMs = elapsedMs;
  let current = state;

  while (carryMs >= perFragment) {
    carryMs -= perFragment;
    const outcome = stepFragment(current, rules, hooks);
    current = outcome.state;
    if (outcome.pause.length > 0) {
      return { state: current, carryMs: 0, paused: true };
    }
  }

  return { state: current, carryMs, paused: false };
}

/**
 * Avanza un fragmento y resuelve el instante al que llega, con el Fin_De_Dia por
 * delante si el fragmento actual es el último del día (Requisitos 5.8, 5.11).
 *
 * Es la unidad de avance que usan `advanceTime` y `skipToNextEvent`. Deja el
 * reloj parado si algún paso del instante pidió pausa (Requisito 5.15).
 */
export function advanceFragment(
  state: GameState,
  rules: ClockRules,
  hooks: ClockHooks = {},
): GameState {
  return stepFragment(state, rules, hooks).state;
}

/**
 * Resuelve los pasos del Fin_De_Dia del día en curso en el orden fijo del
 * Requisito 5.11, y para el reloj si alguno pide pausa (Requisito 5.15).
 *
 * No cruza al día siguiente: eso es de `advanceFragment`, que resuelve el
 * Fin_De_Dia al salir del último fragmento del día. Los pasos sin resolutor
 * registrado no hacen nada.
 */
export function resolveEndOfDay(state: GameState, hooks: ClockHooks = {}): GameState {
  const outcome = resolveEndOfDaySteps(state, hooks);
  return outcome.pause.length > 0 ? pauseClock(outcome.state) : outcome.state;
}

/**
 * Avanza hasta el primero de estos instantes en orden cronológico —el
 * vencimiento de una acción en curso, un evento programado o el Fin_De_Dia del
 * día en curso—, lo resuelve y para el reloj (Requisito 5.9).
 *
 * Resuelve también lo que encuentre en los fragmentos intermedios, que por
 * construcción no tienen nada pendiente. Si un instante anterior al objetivo
 * pide pausa, se detiene ahí (Requisito 5.15).
 */
export function skipToNextEvent(
  state: GameState,
  rules: ClockRules,
  hooks: ClockHooks = {},
): GameState {
  const target = nextEventInstant(state, hooks);
  let current = state;

  // El Fin_De_Dia del día en curso es siempre candidato, así que el objetivo
  // está a lo sumo al final del día: `fragments` avances bastan para llegar.
  for (let step = 0; step <= rules.fragments; step += 1) {
    const outcome = stepFragment(current, rules, hooks);
    current = outcome.state;
    if (outcome.pause.length > 0) {
      return current;
    }
    if (compareInstants(currentInstant(current), target) >= 0) {
      break;
    }
  }

  return pauseClock(current);
}

// ---------------------------------------------------------------------------
// API pública: composición
// ---------------------------------------------------------------------------

/**
 * Reloj con sus reglas y resolutores ligados, que guarda además el resto de
 * tiempo real entre ticks (design.md, `GameClock`).
 *
 * Es la forma recomendada de usar el reloj desde el bucle de render (tarea
 * 18.1): quien llame a `advanceTime` directamente tiene que transportar el
 * `carryMs` a mano o el reloj no avanzará nunca con deltas menores que un
 * fragmento.
 */
export function createGameClock(rules: ClockRules, hooks: ClockHooks = {}): GameClock {
  let carryMs = 0;

  return {
    tick(state: GameState, deltaMs: number): GameState {
      const outcome = advanceTime(state, carryMs + deltaMs, rules, hooks);
      carryMs = outcome.carryMs;
      return outcome.state;
    },
    scheduleAction(state: GameState, request: ActionRequest): Result<GameState> {
      return scheduleAction(state, request, rules);
    },
    skipToNextEvent(state: GameState): GameState {
      carryMs = 0;
      return skipToNextEvent(state, rules, hooks);
    },
  };
}

/**
 * Pasos del Fin_De_Dia que aporta el Gestor_De_Recursos: el consumo diario de
 * comida con su hambruna y la tirada de enfermedad (Requisitos 4.5, 4.6, 4.10,
 * 4.11, 5.11).
 *
 * `famine` no lleva resolutor propio porque `resolveFoodConsumption` la resuelve
 * dentro de `food_consumption`. El crecimiento de población del Requisito 4.12
 * es parte del paso `production`, que escribe la tarea 9.4.
 */
export function createResourceEndOfDaySteps(
  data: ResourceData,
  rules: ResourceRules,
): EndOfDaySteps {
  return {
    food_consumption: (state) => ({ state: resolveFoodConsumption(state, data, rules) }),
    disease_roll: (state) => ({ state: resolveDiseaseRoll(state, data, rules) }),
  };
}

// ---------------------------------------------------------------------------
// Internos: resolución de instantes
// ---------------------------------------------------------------------------

/** Resultado interno de resolver un instante o uno de sus pasos. */
interface StepOutcome {
  state: GameState;
  pause: readonly PauseCause[];
}

/** Acción vencida con su posición en el calendario, para desempatar. */
interface DueEntry {
  action: ScheduledAction;
  index: number;
}

/**
 * Avanza un fragmento resolviendo lo que corresponda: primero el Fin_De_Dia del
 * día que termina, si el reloj está en su último fragmento, y después las
 * acciones vencidas en el fragmento al que llega (Requisitos 5.8, 5.10, 5.11).
 *
 * La pausa se aplica una sola vez al final, aunque varias causas coincidan en el
 * mismo instante (Requisito 5.15).
 */
function stepFragment(state: GameState, rules: ClockRules, hooks: ClockHooks): StepOutcome {
  const causes: PauseCause[] = [];
  let current = state;

  if (state.currentFragment >= rules.fragments - 1) {
    const endOfDay = resolveEndOfDaySteps(current, hooks);
    causes.push(...endOfDay.pause);
    current = {
      ...endOfDay.state,
      currentDay: endOfDay.state.currentDay + 1,
      currentFragment: FIRST_FRAGMENT,
    };
  } else {
    current = { ...current, currentFragment: current.currentFragment + 1 };
  }

  const arrivals = resolveDueActions(current, currentInstant(current), hooks);
  causes.push(...arrivals.pause);
  current = arrivals.state;

  return { state: causes.length > 0 ? pauseClock(current) : current, pause: causes };
}

/**
 * Retira del calendario las acciones vencidas en el instante y las resuelve en
 * el orden del Requisito 5.8.
 *
 * Se retiran todas antes de resolver la primera, de modo que un resolutor vea el
 * calendario sin las acciones de este instante y pueda programar otras sin
 * interferir. Un tipo sin resolutor registrado se retira sin más efecto.
 */
function resolveDueActions(
  state: GameState,
  instant: GameInstant,
  hooks: ClockHooks,
): StepOutcome {
  const due = dueActions(state, instant);
  if (due.length === 0) {
    return { state, pause: [] };
  }

  const resolving = new Set(due);
  let current: GameState = {
    ...state,
    scheduledActions: state.scheduledActions.filter((action) => !resolving.has(action)),
  };
  const causes: PauseCause[] = [];

  for (const action of due) {
    const resolver = hooks.actions?.[action.type];
    if (resolver === undefined) {
      continue;
    }
    const resolution = resolver(current, action, instant);
    current = resolution.state;
    if (resolution.pause !== undefined) {
      causes.push(...resolution.pause);
    }
  }

  return { state: current, pause: causes };
}

/** Ejecuta los pasos del Fin_De_Dia en el orden fijo del Requisito 5.11. */
function resolveEndOfDaySteps(state: GameState, hooks: ClockHooks): StepOutcome {
  const instant: GameInstant = { kind: 'end_of_day', day: state.currentDay };
  let current = state;
  const causes: PauseCause[] = [];

  for (const step of END_OF_DAY_STEPS) {
    const resolver = hooks.endOfDay?.[step];
    if (resolver === undefined) {
      continue;
    }
    const resolution = resolver(current, instant);
    current = resolution.state;
    if (resolution.pause !== undefined) {
      causes.push(...resolution.pause);
    }
  }

  return { state: current, pause: causes };
}

/**
 * Orden de resolución de dos acciones vencidas: las que tienen hexágono antes
 * que las que no, por orden lexicográfico ascendente de `(q, r)`, y las que no
 * tienen hexágono por tipo y posición en el calendario (Requisito 5.8).
 */
function compareDueEntries(a: DueEntry, b: DueEntry): number {
  const hexA = a.action.hex;
  const hexB = b.action.hex;

  if (hexA !== null && hexB !== null) {
    if (hexA.q !== hexB.q) {
      return hexA.q - hexB.q;
    }
    if (hexA.r !== hexB.r) {
      return hexA.r - hexB.r;
    }
    return a.index - b.index;
  }
  if (hexA !== null) {
    return -1;
  }
  if (hexB !== null) {
    return 1;
  }
  if (a.action.type !== b.action.type) {
    return a.action.type < b.action.type ? -1 : 1;
  }
  return a.index - b.index;
}

// ---------------------------------------------------------------------------
// Internos: lectura de reglas
// ---------------------------------------------------------------------------

/** Forma admisible de un parámetro numérico de `rules.day`. */
interface NumberSpec {
  /** `true` si el valor debe ser entero. */
  integer: boolean;
  /** Cota inferior admisible. */
  minimum: number;
  /** `true` si la cota inferior es estricta. */
  exclusive: boolean;
}

/** Fragmentos por día y mínimo de días de una acción (Requisitos 5.1, 5.16). */
const COUNT_SPEC: NumberSpec = { integer: true, minimum: 1, exclusive: false };

/** Duración de un día en segundos reales (Requisitos 5.3, 5.4). */
const SECONDS_SPEC: NumberSpec = { integer: false, minimum: 0, exclusive: true };

/**
 * Lee un parámetro numérico de `rules.day` y acumula el diagnóstico si falta o
 * no sirve.
 */
function readRuleNumber(
  rules: RulesData,
  field: string,
  spec: NumberSpec,
  errors: GameError[],
): number | undefined {
  const file = rules.sourceFiles[rules.sourceFiles.length - 1] ?? 'data/rules.yaml';
  const fieldPath = `rules.${DAY_GROUP}.${field}`;
  const group = rules.values[DAY_GROUP];
  const value = isMapping(group) ? group[field] : undefined;

  if (value === undefined || value === null) {
    errors.push(missingField(file, fieldPath));
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !satisfies(value, spec)) {
    errors.push(invalidValue(file, fieldPath, `debe ser ${describe(spec)}`, value));
    return undefined;
  }
  return value;
}

/** `true` si el valor cumple la forma exigida. */
function satisfies(value: number, spec: NumberSpec): boolean {
  if (spec.integer && !Number.isInteger(value)) {
    return false;
  }
  return spec.exclusive ? value > spec.minimum : value >= spec.minimum;
}

/** Descripción en español de la forma exigida, para el mensaje del error. */
function describe(spec: NumberSpec): string {
  const kind = spec.integer ? 'un entero' : 'un número';
  const bound = spec.exclusive
    ? `mayor que ${String(spec.minimum)}`
    : `mayor o igual que ${String(spec.minimum)}`;
  return `${kind} ${bound}`;
}

/** `true` si el valor es un mapa de claves, no una lista ni `null`. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Internos: errores
// ---------------------------------------------------------------------------

/** Error de acción solicitada sobre un hexágono ocupado (Requisito 5.13). */
function actionInProgressError(hex: AxialCoord, action: ScheduledAction): GameError {
  return {
    code: 'action_in_progress',
    message:
      `El hexágono (${String(hex.q)}, ${String(hex.r)}) ya tiene una acción de tipo ` +
      `${action.type} en curso, que termina el día ${String(action.endDay)} ` +
      `en el fragmento ${String(action.endFragment)}`,
    context: {
      hex: hexKey(hex),
      type: action.type,
      endDay: action.endDay,
      endFragment: action.endFragment,
    },
  };
}

/** Error de campo obligatorio ausente. */
function missingField(file: string, fieldPath: string): GameError {
  return {
    code: 'missing_field',
    message: `${file}: ${fieldPath} no se declara`,
    context: { file, path: fieldPath },
  };
}

/** Error de campo declarado con un valor inservible. */
function invalidValue(
  file: string,
  fieldPath: string,
  reason: string,
  found: unknown,
): GameError {
  return {
    code: 'invalid_value',
    message: `${file}: ${fieldPath} ${reason}`,
    context: { file, path: fieldPath, reason, found },
  };
}
