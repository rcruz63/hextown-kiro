/**
 * Sistema_De_Exploracion: calcula el tiempo y el coste en población de explorar
 * un hexágono atenuado, valida y ejecuta la solicitud comprometiendo la
 * población, y resuelve la exploración cuando vence (Requisitos 3.1, 3.2, 3.3,
 * 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10).
 *
 * Decisiones de diseño:
 *
 * - **La estimación y la ejecución comparten el mismo camino de código.** El
 *   Requisito 3.9 exige que el tiempo y el coste que la interfaz muestra antes
 *   de confirmar coincidan exactamente con los que el reloj programa y el
 *   Gestor_De_Recursos resta. Por eso `requestExploration` no recalcula nada:
 *   llama a `canExplore`, que devuelve la misma `ExplorationEstimate` que la
 *   interfaz ya tenía, y paga y programa con esos números.
 * - **La estimación normaliza los días como lo hará el reloj.** El tiempo del
 *   Requisito 3.1 sale entero y mayor o igual que 1 con los datos válidos, pero
 *   `rules.day.minimo_dias_accion` podría ser mayor (Requisito 5.17); aplicar
 *   `normalizeActionDays` en la estimación evita que la interfaz prometa un día
 *   y el reloj programe otro.
 * - **El mínimo de 1 unidad de población no es un parámetro de balance.** Lo
 *   fija el enunciado del Requisito 3.2 y lo exige el Requisito 3.12 como
 *   propiedad: si saliera de `data/`, un 0 en el fichero convertiría en falsa
 *   una propiedad del diseño. Es una constante estructural, como el primer día 1
 *   o las distancias 1 y 2 de la visibilidad inicial (Requisito 2.2). Los tres
 *   números que sí son balance —`tiempo_base`, `dias_por_distancia` y
 *   `poblacion_por_distancia`— salen de `rules.exploration`.
 * - **El rechazo por hexágono ocupado se comprueba antes de pagar.** El reloj ya
 *   rechaza la segunda acción sobre un mismo hexágono (Requisito 5.13), pero lo
 *   hace después de que el Gestor_De_Recursos haya restado la población, y los
 *   Requisitos 3.5 y 5.13 exigen no comprometer nada. Por eso se consulta
 *   `actionInProgressAt` en la validación y se distinguen dos códigos: la
 *   exploración en curso del Requisito 3.5 y cualquier otra acción del
 *   Requisito 5.13.
 * - **`coste >= Poblacion_Total` es un rechazo propio, no una insuficiencia de
 *   recursos.** El Requisito 3.4 lo enumera aparte de la falta de
 *   Poblacion_Libre porque el motivo es distinto: la exploración sería viable
 *   pero dejaría la partida sin población y provocaría la derrota del Requisito
 *   4.17. Tiene su código y su clave de interfaz propios.
 * - **La falta de Poblacion_Libre no se diagnostica aquí.** `canExplore` delega
 *   en `applyCost` del Gestor_De_Recursos y devuelve su error tal cual, de modo
 *   que el código y el contexto de `insufficient_population` son los mismos por
 *   los que se rechaza cualquier otra acción (Requisito 4.16). En la validación
 *   se descarta el estado que `applyCost` devuelve; el trabajo repetido es un
 *   objeto y la alternativa era duplicar la comparación.
 * - **El producto de los Efecto_Global se recalcula aquí.** El Gestor_De_Recursos
 *   tiene un ayudante equivalente para la probabilidad de enfermedad, pero es
 *   interno: cada módulo declara el tipo de Efecto_Global que consume
 *   —`EXPLORATION_COST_EFFECT`, como `DISEASE_PROBABILITY_EFFECT`— y aplica sus
 *   factores. Solo cuentan los efectos activos y solo su `multiplier`: el
 *   Requisito 3.2 habla de un producto de factores, así que un `value` aditivo
 *   sobre este tipo de efecto se ignora.
 * - **La Ciudad se recibe como argumento, con `CITY_COORD` por defecto.** La
 *   distancia del Requisito 3.1 se mide desde la Ciudad, que el Generador_De_Mapa
 *   fija en `(0, 0)` (Requisito 1.2). Tomar la constante de `map-generator.ts` en
 *   lugar de repetir el literal deja una sola fuente de verdad, y el parámetro
 *   permite a los tests medir desde otro centro.
 * - **El resolutor no puede informar de errores.** El contrato `ActionResolver`
 *   del reloj devuelve estado, no `Result`. Si al vencer la exploración el
 *   hexágono ya no está atenuado —un guardado incoherente, porque una segunda
 *   exploración del mismo hexágono no se puede programar— la acción se retira
 *   sin efecto y sin pausa: la población ya se gastó al solicitarla y el
 *   Requisito 3.13 exige que la finalización no la altere.
 * - **La resolución simultánea no necesita código.** El Requisito 3.10 pide
 *   orden lexicográfico de `(q, r)` y una única transición a parado: las dos
 *   cosas las garantiza ya el reloj con `dueActions` y con la acumulación de
 *   causas de pausa del Requisito 5.15.
 *
 * Algoritmo:
 *
 * 1. `readExplorationRules(rules)` interpreta `rules.exploration` y acumula un
 *    diagnóstico por parámetro ausente o inservible (Requisitos 3.1, 3.2). Las
 *    cotas no son balance: `tiempo_base` sale entero y mayor o igual que 1
 *    porque el tiempo de una acción lo es (Requisitos 3.12, 5.16),
 *    `dias_por_distancia` entero y mayor o igual que 1 porque es el divisor de
 *    la fórmula, y `poblacion_por_distancia` mayor o igual que 0 porque un valor
 *    negativo rompería la monotonía del Requisito 3.11.
 * 2. `explorationDays(D, rules)` es `tiempo_base + piso(D / dias_por_distancia)`
 *    (Requisito 3.1) y `explorationPopulationCost(state, D, rules)` es
 *    `max(1, techo(D × poblacion_por_distancia × producto de factores))`
 *    (Requisito 3.2). Las dos son monótonas no decrecientes en D y valen al
 *    menos 1 (Requisitos 3.11, 3.12).
 * 3. `estimateExploration(state, hex, ...)` mide la distancia a la Ciudad y
 *    devuelve los días ya normalizados y el coste (Requisito 3.9).
 * 4. `canExplore(state, hex, ...)` rechaza, en este orden: el hexágono que no
 *    pertenece al mapa, el que no está atenuado (Requisitos 2.7, 3.6), el que
 *    tiene una acción en curso (Requisitos 3.5, 5.13), el coste que alcanza la
 *    Poblacion_Total (Requisito 3.4) y la falta de Poblacion_Libre (Requisitos
 *    3.4, 4.16). Si nada de eso ocurre devuelve la estimación.
 * 5. `requestExploration(state, hex, ...)` valida con `canExplore`, resta el
 *    coste en concepto de consumo con `applyCost` —lo que reduce la
 *    Poblacion_Libre y la Poblacion_Total (Requisitos 3.3, 3.13, 4.2)— y programa
 *    la acción en el reloj, que la sitúa en el día `d + tiempo` y en el mismo
 *    fragmento de la solicitud (Requisitos 5.7, 5.18). Cualquier rechazo
 *    devuelve el error sin estado, así que no queda población comprometida.
 * 6. `resolveExploration(state, action, instant)` es el resolutor que el reloj
 *    invoca al vencer la acción:
 *    a. Llama a `revealHex`, que marca el hexágono como explorado y atenúa sus
 *       vecinos ocultos (Requisito 3.6).
 *    b. Anota la entrada de exploración completada y, si el hexágono tiene
 *       elemento, la del elemento descubierto con su día y su fragmento
 *       (Requisito 3.7).
 *    c. Devuelve la causa de pausa si el elemento revelado es un poblado, un
 *       misterio o una amenaza (Requisito 3.8); el reloj hace la transición a
 *       parado cuando termina el instante (Requisito 5.15).
 *
 * Reparto de responsabilidades: este módulo no toca la visibilidad, la aplica el
 * Gestor_De_Visibilidad con `revealHex` (Requisitos 2.9, 2.10, 2.11); no mueve
 * recursos, los mueve el Gestor_De_Recursos con `applyCost` (Requisitos 4.2,
 * 4.16); y no cuenta el tiempo, lo cuenta el Reloj_De_Juego con `scheduleAction`
 * (Requisitos 5.7, 5.18), que además decide el orden de las exploraciones
 * simultáneas y la única transición a parado (Requisitos 3.10, 5.8, 5.15). Del
 * elemento revelado solo se registra el descubrimiento: *dibujarlo* y mostrar su
 * ficha es del Motor_De_Render y del Sistema_De_Interfaz (Requisitos 2.5, 3.7,
 * 19), el puzzle del poblado o del misterio lo instancia y presenta el
 * Sistema_De_Puzzles (Requisito 16.5, tarea 13.2), el combate contra la amenaza
 * descubierta es del Resolutor_De_Combate (Requisito 13, tarea 12.2) y su
 * expansión y sus efectos pasivos del Sistema_De_Amenazas (Requisito 12, tarea
 * 12.1). Tampoco decide si la acción se admite estando la partida terminada: eso
 * es del Nucleo_De_Simulacion (Requisito 15.12, tarea 15.1), que es también
 * quien registra el resolutor de este módulo en el reloj al arrancar (tarea
 * 21.1). La recolección y la tala sobre el elemento descubierto son del
 * Sistema_De_Explotacion (Requisito 9, tarea 10.1).
 */
import { actionInProgressAt, normalizeActionDays, scheduleAction } from './clock.ts';
import type {
  ActionResolvers,
  ClockRules,
  GameInstant,
  InstantResolution,
  PauseCause,
} from './clock.ts';
import { hexDistance, hexKey } from './hex-math.ts';
import type { AxialCoord } from './hex-math.ts';
import { CITY_COORD } from './map-generator.ts';
import { applyCost, totalPopulation } from './resources.ts';
import { err, ok } from './result.ts';
import type { GameError, Result } from './result.ts';
import type {
  ElementCategory,
  GameEvent,
  GameState,
  GlobalEffect,
  MapElement,
  ScheduledAction,
  VisibilityState,
} from './types.ts';
import { getVisibility, revealHex } from './visibility.ts';
import type { RulesData } from '../data/loader.ts';

// ---------------------------------------------------------------------------
// Vocabulario y constantes estructurales
// ---------------------------------------------------------------------------

/**
 * Tipo de Efecto_Global que modifica el coste en población de explorar como
 * factor multiplicativo (Requisito 3.2). Es el vocabulario de
 * `global_effects.effect` de los datos: para reconocer un tipo nuevo hay que
 * añadirlo aquí, como `DISEASE_PROBABILITY_EFFECT` en el Gestor_De_Recursos.
 */
export const EXPLORATION_COST_EFFECT = 'coste_poblacion_exploracion';

/** Grupo de reglas globales del que sale la configuración de la exploración. */
const EXPLORATION_GROUP = 'exploration';

/**
 * Coste mínimo en población de una exploración (Requisito 3.2). No es un
 * parámetro de balance: el Requisito 3.12 lo exige como propiedad, así que
 * llevarlo a `data/` permitiría que un fichero la incumpliese.
 */
const MINIMUM_POPULATION_COST = 1;

/**
 * Causa de pausa automática de cada categoría de elemento que, al revelarse,
 * para el reloj (Requisitos 3.8, 5.15). Las categorías que no figuran aquí no
 * paran nada.
 */
const DISCOVERY_PAUSE_CAUSES: Partial<Record<ElementCategory, PauseCause>> = {
  settlement: 'settlement_discovered',
  mystery: 'mystery_discovered',
  animal_threat: 'threat_discovered',
  human_threat: 'threat_discovered',
};

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/**
 * Parámetros de balance de la exploración, ya interpretados con
 * `readExplorationRules`. Se leen una vez al arrancar la partida y se pasan a
 * cada operación, de modo que la validación de los datos ocurre en el límite y
 * no en cada solicitud.
 */
export interface ExplorationRules {
  /** `rules.exploration.tiempo_base`, en días (Requisito 3.1). */
  baseDays: number;
  /** `rules.exploration.dias_por_distancia` (Requisito 3.1). */
  daysPerDistance: number;
  /** `rules.exploration.poblacion_por_distancia` (Requisito 3.2). */
  populationPerDistance: number;
}

/**
 * Tiempo y coste de explorar un hexágono, con los Efecto_Global vigentes ya
 * aplicados y los días ya normalizados por el reloj (Requisito 3.9). Es lo que
 * la interfaz muestra antes de confirmar y lo que se paga y se programa al
 * confirmar.
 */
export interface ExplorationEstimate {
  /** Hexágono que se exploraría. */
  hex: AxialCoord;
  /** Distancia a la Ciudad, la `D` de los Requisitos 3.1 y 3.2. */
  distance: number;
  /** Días que tardará la exploración (Requisitos 3.1, 5.17). */
  days: number;
  /** Unidades de Poblacion_Libre que consumirá (Requisitos 3.2, 3.3). */
  populationCost: number;
}

// ---------------------------------------------------------------------------
// API pública: lectura de datos
// ---------------------------------------------------------------------------

/**
 * Interpreta los parámetros de `rules.exploration` (Requisitos 3.1, 3.2).
 *
 * Acumula un diagnóstico por parámetro ausente o inservible; nunca lanza.
 *
 * Códigos de error, estables: `missing_field` y `invalid_value`.
 */
export function readExplorationRules(rules: RulesData): Result<ExplorationRules, GameError[]> {
  const errors: GameError[] = [];
  const baseDays = readRuleNumber(rules, 'tiempo_base', DAYS_SPEC, errors);
  const daysPerDistance = readRuleNumber(rules, 'dias_por_distancia', DAYS_SPEC, errors);
  const populationPerDistance = readRuleNumber(
    rules,
    'poblacion_por_distancia',
    RATE_SPEC,
    errors,
  );

  if (
    baseDays === undefined ||
    daysPerDistance === undefined ||
    populationPerDistance === undefined
  ) {
    return err(errors);
  }

  return ok({ baseDays, daysPerDistance, populationPerDistance });
}

// ---------------------------------------------------------------------------
// API pública: cálculo del tiempo y del coste
// ---------------------------------------------------------------------------

/**
 * Días que tarda explorar un hexágono situado a distancia `distance` de la
 * Ciudad: `tiempo_base + piso(distance / dias_por_distancia)` (Requisito 3.1).
 *
 * No decrece con la distancia y vale al menos `tiempo_base`, que los datos
 * garantizan mayor o igual que 1 (Requisitos 3.11, 3.12).
 *
 * @throws RangeError Si `distance` no es un entero mayor o igual que 0: la
 *   distancia la mide `hexDistance`, así que un valor así es un error de
 *   programación y no un dato del jugador.
 */
export function explorationDays(distance: number, rules: ExplorationRules): number {
  assertDistance(distance, 'explorationDays');
  return rules.baseDays + Math.floor(distance / rules.daysPerDistance);
}

/**
 * Unidades de Poblacion_Libre que consume explorar un hexágono situado a
 * distancia `distance` de la Ciudad:
 * `max(1, techo(distance × poblacion_por_distancia × producto de factores))`
 * (Requisito 3.2).
 *
 * Los factores son los `multiplier` de los Efecto_Global activos de tipo
 * `coste_poblacion_exploracion` vigentes en el estado; su `value` se ignora,
 * porque el requisito solo declara factores.
 *
 * @throws RangeError En los mismos casos que {@link explorationDays}.
 */
export function explorationPopulationCost(
  state: GameState,
  distance: number,
  rules: ExplorationRules,
): number {
  assertDistance(distance, 'explorationPopulationCost');
  const raw =
    distance * rules.populationPerDistance * explorationCostMultiplier(state.globalEffects);
  return Math.max(MINIMUM_POPULATION_COST, Math.ceil(raw));
}

/**
 * Tiempo y coste de explorar un hexágono, tal como se mostrarán antes de
 * confirmar y tal como se programarán y se pagarán al confirmar
 * (Requisitos 3.1, 3.2, 3.9).
 *
 * No comprueba si la exploración se admite: para eso está {@link canExplore}.
 *
 * @param city Hexágono de la Ciudad, desde el que se mide la distancia
 *   (Requisito 1.2).
 */
export function estimateExploration(
  state: GameState,
  hex: AxialCoord,
  rules: ExplorationRules,
  clockRules: ClockRules,
  city: AxialCoord = CITY_COORD,
): ExplorationEstimate {
  const distance = hexDistance(city, hex);
  return {
    hex: { q: hex.q, r: hex.r },
    distance,
    // El reloj normalizará el tiempo al programarlo (Requisito 5.17); hacerlo
    // aquí también es lo que garantiza que los dos números coincidan (3.9).
    days: normalizeActionDays(explorationDays(distance, rules), clockRules),
    populationCost: explorationPopulationCost(state, distance, rules),
  };
}

// ---------------------------------------------------------------------------
// API pública: solicitud de exploración
// ---------------------------------------------------------------------------

/**
 * Comprueba si el hexágono se puede explorar ahora y devuelve el tiempo y el
 * coste que costaría (Requisitos 3.4, 3.5, 3.9).
 *
 * Es lo que el Sistema_De_Interfaz necesita para ofrecer la acción de explorar,
 * deshabilitarla con su motivo o mostrar los números antes de confirmar
 * (Requisitos 2.6, 2.7, 3.4, 3.5).
 *
 * Códigos de error, estables, que el Sistema_De_Interfaz resuelve con las claves
 * homónimas `ui.error.*` del catálogo i18n:
 *
 * - `hex_outside_map`: la coordenada no pertenece al mapa. Es una incoherencia,
 *   no un rechazo que el jugador provoque; comparte código y contexto con el
 *   error homónimo del Gestor_De_Visibilidad.
 * - `only_dimmed_can_be_explored`: el hexágono está oculto o ya explorado
 *   (Requisitos 2.7, 3.6). Mismo código y contexto que en `revealHex`.
 * - `exploration_in_progress`: ya hay una exploración en curso sobre ese
 *   hexágono; el contexto lleva su día y su fragmento de finalización, que es lo
 *   que el Requisito 3.5 exige mostrar.
 * - `action_in_progress`: hay otra acción en curso sobre ese hexágono
 *   (Requisito 5.13). Mismo código y contexto que en `scheduleAction`.
 * - `population_would_end_game`: el coste alcanza la Poblacion_Total y la
 *   exploración dejaría la partida sin población (Requisitos 3.4, 4.17).
 * - `insufficient_population`: no hay Poblacion_Libre bastante. Lo produce el
 *   Gestor_De_Recursos y se devuelve tal cual (Requisitos 3.4, 4.16).
 */
export function canExplore(
  state: GameState,
  hex: AxialCoord,
  rules: ExplorationRules,
  clockRules: ClockRules,
  city: AxialCoord = CITY_COORD,
): Result<ExplorationEstimate> {
  const visibility = getVisibility(state.map, hex);
  if (visibility === undefined) {
    return err(outsideMapError(hex));
  }
  if (visibility !== 'dimmed') {
    return err(notDimmedError(hex, visibility));
  }

  // Antes de pagar: el reloj rechazaría la acción después de que el
  // Gestor_De_Recursos hubiera restado la población (Requisitos 3.5, 5.13).
  const inProgress = actionInProgressAt(state, hex);
  if (inProgress !== undefined) {
    return err(inProgressError(hex, inProgress));
  }

  const estimate = estimateExploration(state, hex, rules, clockRules, city);
  const total = totalPopulation(state.resources);
  if (estimate.populationCost >= total) {
    return err(populationWouldEndGameError(hex, estimate.populationCost, state, total));
  }

  // La insuficiencia de Poblacion_Libre la diagnostica el Gestor_De_Recursos con
  // su código y su contexto (Requisito 4.16); aquí se descarta su estado.
  const charged = applyCost(state, { population: estimate.populationCost }, 'consume');
  if (!charged.ok) {
    return err(charged.error);
  }

  return ok(estimate);
}

/**
 * Confirma una exploración: resta el coste en población en concepto de consumo y
 * programa su finalización en el reloj (Requisitos 3.1, 3.2, 3.3, 3.5).
 *
 * Devuelve un estado nuevo; el estado recibido no se toca. Cualquier rechazo
 * devuelve el error y ningún estado, así que no queda población comprometida ni
 * acciones a medias (Requisitos 3.4, 3.5, 5.13).
 *
 * La acción queda con `metadata` que lleva la distancia y el coste pagado, para
 * que el Sistema_De_Interfaz pueda describir la exploración en curso sin
 * recalcularla; el resolutor no los necesita, porque la finalización no altera
 * la población (Requisito 3.13).
 *
 * Códigos de error, estables: los de {@link canExplore}.
 */
export function requestExploration(
  state: GameState,
  hex: AxialCoord,
  rules: ExplorationRules,
  clockRules: ClockRules,
  city: AxialCoord = CITY_COORD,
): Result<GameState> {
  const admissible = canExplore(state, hex, rules, clockRules, city);
  if (!admissible.ok) {
    return err(admissible.error);
  }
  const estimate = admissible.value;

  const charged = applyCost(state, { population: estimate.populationCost }, 'consume');
  if (!charged.ok) {
    return err(charged.error);
  }

  return scheduleAction(
    charged.value,
    {
      type: 'exploration',
      hex: estimate.hex,
      days: estimate.days,
      metadata: { distance: estimate.distance, populationCost: estimate.populationCost },
    },
    clockRules,
  );
}

// ---------------------------------------------------------------------------
// API pública: resolución al vencer
// ---------------------------------------------------------------------------

/**
 * Resuelve una exploración que acaba de vencer: revela el hexágono, registra el
 * descubrimiento y pide la pausa si aparece un poblado, un misterio o una
 * amenaza (Requisitos 3.6, 3.7, 3.8).
 *
 * Cumple el contrato `ActionResolver` del reloj, que es quien lo invoca en el
 * instante de vencimiento y quien ordena las exploraciones simultáneas y aplica
 * la pausa una sola vez (Requisitos 3.10, 5.8, 5.15). No devuelve la población:
 * el coste se consumió al solicitar la exploración (Requisito 3.13).
 *
 * Si el hexágono ya no está atenuado o no pertenece al mapa, deja el estado tal
 * cual: el resolutor no puede informar de errores y la acción ya se retiró del
 * calendario.
 */
export function resolveExploration(
  state: GameState,
  action: ScheduledAction,
  instant: GameInstant,
): InstantResolution {
  const hex = action.hex;
  if (hex === null) {
    return { state };
  }

  const revealed = revealHex(state.map, hex);
  if (!revealed.ok) {
    return { state };
  }

  const fragment = instantFragment(state, instant);
  const element = revealed.value.cells.get(hexKey(hex))?.element ?? null;
  const events: GameEvent[] = [explorationCompletedEvent(hex, instant.day, fragment)];
  if (element !== null) {
    events.push(elementDiscoveredEvent(hex, instant.day, fragment, element));
  }

  const pause = discoveryPauseCauses(element);
  return {
    state: {
      ...state,
      map: revealed.value,
      eventLog: [...state.eventLog, ...events],
    },
    pause,
  };
}

/**
 * Resolutor de exploración listo para registrar en `ClockHooks.actions`
 * (Requisito 5.8). Lo hace el arranque de la partida (tarea 21.1):
 *
 * ```ts
 * const hooks: ClockHooks = { actions: { ...createExplorationActions() } };
 * ```
 */
export function createExplorationActions(): ActionResolvers {
  return { exploration: resolveExploration };
}

// ---------------------------------------------------------------------------
// Internos: cálculo
// ---------------------------------------------------------------------------

/**
 * Producto de los factores de los Efecto_Global activos que modifican el coste
 * en población de explorar (Requisito 3.2).
 */
function explorationCostMultiplier(effects: readonly GlobalEffect[]): number {
  let product = 1;
  for (const effect of effects) {
    if (
      effect.active &&
      effect.effectType === EXPLORATION_COST_EFFECT &&
      effect.multiplier !== undefined
    ) {
      product *= effect.multiplier;
    }
  }
  return product;
}

/**
 * Causas de pausa que provoca revelar un elemento: poblado, misterio o amenaza
 * (Requisito 3.8). Lista vacía si el elemento no para el reloj o si el hexágono
 * estaba vacío.
 */
function discoveryPauseCauses(element: MapElement | null): readonly PauseCause[] {
  if (element === null) {
    return [];
  }
  const cause = DISCOVERY_PAUSE_CAUSES[element.category];
  return cause === undefined ? [] : [cause];
}

/**
 * Fragmento en el que se fecha la resolución. Las acciones vencen siempre en un
 * fragmento concreto (Requisito 5.18); el Fin_De_Dia no tiene fragmento propio y
 * se fecha en el fragmento en curso.
 */
function instantFragment(state: GameState, instant: GameInstant): number {
  return instant.kind === 'fragment' ? instant.fragment : state.currentFragment;
}

/**
 * Comprueba que la distancia recibida es una distancia de hexágonos.
 *
 * @throws RangeError Si no lo es.
 */
function assertDistance(distance: number, label: string): void {
  if (!Number.isInteger(distance) || distance < 0) {
    throw new RangeError(
      `${label}: se esperaba una distancia entera mayor o igual que 0, recibido ${String(distance)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internos: entradas del Registro_De_Eventos
// ---------------------------------------------------------------------------

/** Entrada de exploración completada con su día y su fragmento (Req. 3.7). */
function explorationCompletedEvent(hex: AxialCoord, day: number, fragment: number): GameEvent {
  return {
    type: 'exploration',
    day,
    fragment,
    hex: { q: hex.q, r: hex.r },
    messageKey: 'event.exploration_completed',
    params: { hex: hexKey(hex) },
  };
}

/** Entrada del elemento descubierto al explorar (Requisito 3.7). */
function elementDiscoveredEvent(
  hex: AxialCoord,
  day: number,
  fragment: number,
  element: MapElement,
): GameEvent {
  return {
    type: 'exploration',
    day,
    fragment,
    hex: { q: hex.q, r: hex.r },
    messageKey: 'event.element_discovered',
    params: { hex: hexKey(hex), element: element.id },
  };
}

// ---------------------------------------------------------------------------
// Internos: errores
// ---------------------------------------------------------------------------

/** Error de coordenada que no pertenece al mapa. */
function outsideMapError(hex: AxialCoord): GameError {
  return {
    code: 'hex_outside_map',
    message: `El hexágono (${String(hex.q)}, ${String(hex.r)}) no pertenece al mapa`,
    context: { hex: hexKey(hex) },
  };
}

/** Error de exploración sobre un hexágono que no está atenuado (Req. 2.7, 3.6). */
function notDimmedError(hex: AxialCoord, visibility: VisibilityState): GameError {
  return {
    code: 'only_dimmed_can_be_explored',
    message:
      `El hexágono (${String(hex.q)}, ${String(hex.r)}) está en estado ${visibility}: ` +
      'solo se exploran hexágonos atenuados',
    context: { hex: hexKey(hex), visibility },
  };
}

/**
 * Error de exploración solicitada sobre un hexágono ocupado (Requisitos 3.5,
 * 5.13). El código distingue la exploración en curso de cualquier otra acción,
 * porque el Requisito 3.5 y el Requisito 5.13 son rechazos distintos para el
 * jugador; el contexto es el mismo en los dos casos.
 */
function inProgressError(hex: AxialCoord, action: ScheduledAction): GameError {
  const isExploration = action.type === 'exploration';
  return {
    code: isExploration ? 'exploration_in_progress' : 'action_in_progress',
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

/**
 * Error de exploración cuyo coste alcanza la Poblacion_Total (Requisito 3.4). El
 * contexto lleva el coste requerido y la Poblacion_Libre disponible, que es lo
 * que el requisito exige mostrar, y además la Poblacion_Total como diagnóstico.
 */
function populationWouldEndGameError(
  hex: AxialCoord,
  required: number,
  state: GameState,
  total: number,
): GameError {
  return {
    code: 'population_would_end_game',
    message:
      `Explorar el hexágono (${String(hex.q)}, ${String(hex.r)}) cuesta ${String(required)} ` +
      `de población y la Poblacion_Total es ${String(total)}: la exploración dejaría la ` +
      'partida sin población',
    context: {
      hex: hexKey(hex),
      resource: 'population',
      required,
      available: state.resources.freePopulation,
      total,
    },
  };
}

// ---------------------------------------------------------------------------
// Internos: lectura de reglas
// ---------------------------------------------------------------------------

/** Forma admisible de un parámetro numérico de `rules.exploration`. */
interface NumberSpec {
  /** `true` si el valor debe ser entero. */
  integer: boolean;
  /** Cota inferior admisible, inclusive. */
  minimum: number;
}

/**
 * Parámetros del tiempo de exploración. Enteros y mayores o iguales que 1: el
 * tiempo de una acción lo es (Requisitos 3.12, 5.16) y `dias_por_distancia` es
 * el divisor de la fórmula del Requisito 3.1.
 */
const DAYS_SPEC: NumberSpec = { integer: true, minimum: 1 };

/**
 * Población por unidad de distancia. Admite decimales, y mayor o igual que 0
 * porque un valor negativo rompería la monotonía del Requisito 3.11.
 */
const RATE_SPEC: NumberSpec = { integer: false, minimum: 0 };

/**
 * Lee un parámetro numérico de `rules.exploration` y acumula el diagnóstico si
 * falta o no sirve.
 */
function readRuleNumber(
  rules: RulesData,
  field: string,
  spec: NumberSpec,
  errors: GameError[],
): number | undefined {
  const file = rules.sourceFiles[rules.sourceFiles.length - 1] ?? 'data/rules.yaml';
  const fieldPath = `rules.${EXPLORATION_GROUP}.${field}`;
  const group = rules.values[EXPLORATION_GROUP];
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
  return value >= spec.minimum;
}

/** Descripción en español de la forma exigida, para el mensaje del error. */
function describe(spec: NumberSpec): string {
  const kind = spec.integer ? 'un entero' : 'un número';
  return `${kind} mayor o igual que ${String(spec.minimum)}`;
}

/** `true` si el valor es un mapa de claves, no una lista ni `null`. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
