/**
 * Gestor_De_Recursos: mantiene Poblacion_Libre, Poblacion_Empleada, comida,
 * materiales, ciencia y oro, aplica los costes de las acciones, el consumo
 * diario de comida, la hambruna, la enfermedad y el crecimiento de población, y
 * cubre las pérdidas de población sacrificando construcciones (Requisitos 4.1,
 * 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.15, 4.16, 4.17).
 *
 * Decisiones de diseño:
 *
 * - `Poblacion_Total` no se almacena: es `freePopulation + employedPopulation`
 *   y se consulta con `totalPopulation` (Requisito 4.18). Todas las operaciones
 *   de este módulo se escriben en términos de las dos bolsas, de modo que el
 *   invariante se cumple por construcción y no hace falta comprobarlo.
 * - `applyCost` devuelve `Result<GameState>` y no `GameState` como declaraba
 *   design.md: la insuficiencia de recursos es un rechazo achacable al jugador
 *   (Requisito 4.16) y el error transporta el recurso deficitario, la cantidad
 *   requerida y la disponible, que es exactamente lo que el
 *   Sistema_De_Interfaz debe mostrar. Un coste negativo o no entero, en cambio,
 *   es un error de programación y lanza `RangeError`.
 * - El consumo de comida y la hambruna se resuelven en una sola llamada
 *   (`resolveFoodConsumption`) aunque el Requisito 5.11 los enumere como dos
 *   pasos consecutivos del Fin_De_Dia: la hambruna necesita la comida que
 *   faltaba antes de fijarla en 0, así que separarlos obligaría a almacenar ese
 *   déficit en el estado. Los dos pasos son contiguos, de modo que el orden
 *   observable no cambia.
 * - El consumo diario se calcula exactamente como declara el Requisito 4.5, sin
 *   aplicar los Efecto_Global de tipo `consumo_comida`. Ese tipo de efecto
 *   existe en el vocabulario de `data/technologies.yaml` pero ningún requisito
 *   lo aplica al consumo, y aplicarlo cambiaría la fórmula que fija el
 *   Requisito 4.5. Queda pendiente de un requisito que lo declare.
 * - La tirada de enfermedad consume **siempre** una extracción del RNG, incluso
 *   con probabilidad 0: así el número de extracciones por Fin_De_Dia no depende
 *   del estado de la partida y la secuencia aleatoria sigue siendo reproducible
 *   desde la semilla (Requisito 5.19).
 * - Qué construcción se puede sacrificar y cuál es una torre de defensa sale de
 *   los datos, no del código: una construcción es sacrificable salvo que declare
 *   `sacrificable: false` (la Ciudad, Requisito 4.8) y es torre de defensa si
 *   alguno de sus niveles declara `blocks_expansion_radius`, el mismo campo con
 *   el que el Sistema_De_Defensa reconoce las torres (Requisitos 8.9, 12.15,
 *   14.2). Una construcción que los datos no declaran se trata como
 *   sacrificable y no torre.
 * - Las obras en curso se identifican por `state.scheduledActions`, no por un
 *   campo de la construcción: una construcción de nivel 1 en curso es una acción
 *   de tipo `construction` sobre su hexágono y una mejora es una de tipo
 *   `upgrade`. Es la única representación que el modelo de datos ofrece hoy, la
 *   que fija `ScheduledAction`, y quien la establece es el
 *   Sistema_De_Construccion (tarea 9.1).
 * - El Requisito 4.7 no excluye ninguna obra en curso de la lista de candidatas,
 *   mientras que sí excluye explícitamente la Ciudad de las construcciones
 *   completadas. Por eso la mejora en curso de la Ciudad **sí** puede
 *   cancelarse: cancelarla no sacrifica la Ciudad, que permanece en su nivel
 *   actual, y el Requisito 4.8 solo prohíbe sacrificar la construcción.
 * - El Requisito 4.8 (fijar la Poblacion_Total en 0 cuando la pérdida no queda
 *   cubierta) y la Propiedad 8 (`total = max(0, total previa - P)`) coinciden
 *   exactamente mientras las construcciones no sacrificables no empleen
 *   trabajadores, que es lo que garantizan los datos: la Ciudad declara
 *   `employs: 0` en todos sus niveles.
 *
 * Algoritmo:
 *
 * 1. `applyCost(state, cost, kind)` (Requisitos 4.2, 4.3, 4.16): busca el primer
 *    recurso insuficiente en el orden población, comida, materiales, ciencia,
 *    oro y rechaza el coste completo si lo encuentra. Si no, resta cada recurso
 *    y, según el tipo, resta la población de la Poblacion_Libre sin más
 *    (`consume`, reduce la Poblacion_Total) o la traslada a la Poblacion_Empleada
 *    (`employ`, deja la Poblacion_Total invariante).
 * 2. `resolveFoodConsumption(state, data, rules)` (Requisitos 4.5, 4.6):
 *    calcula `techo(Poblacion_Total × consumo_por_poblacion)`. Si hay comida
 *    suficiente la resta y termina. Si no, fija la comida en 0, anota la entrada
 *    de hambruna con el déficit y la población perdida, y aplica una pérdida de
 *    `min(Poblacion_Total, techo(déficit × poblacion_perdida_por_hambre))`.
 * 3. `resolveDiseaseRoll(state, data, rules)` (Requisitos 4.10, 4.11): calcula
 *    `probabilidad_base_diaria + incremento_por_poblacion × Poblacion_Total`,
 *    multiplica por los Efecto_Global activos de tipo `probabilidad_enfermedad`,
 *    acota el resultado a [0, 1], extrae un número del RNG de la partida y, si
 *    la tirada sale positiva, anota la entrada de enfermedad y aplica una
 *    pérdida de `poblacion_perdida`.
 * 4. `applyPopulationGrowth(state, gained)` (Requisito 4.12): suma la cantidad a
 *    la Poblacion_Libre, con lo que la Poblacion_Total crece igual y la
 *    Poblacion_Empleada no varía. No hay tope superior.
 * 5. `applyPopulationLoss(state, loss, data)` (Requisitos 4.7, 4.8, 4.9, 7.13):
 *    a. Resta de la Poblacion_Libre disponible todo lo que cubra.
 *    b. Mientras quede pérdida por cubrir, elige la primera candidata del orden
 *       del Requisito 4.7: obra en curso de inicio más reciente, construcción
 *       completada sacrificable que no sea torre de defensa de finalización más
 *       reciente y torre de defensa completada de finalización más reciente,
 *       resolviendo los empates de día y fragmento por orden lexicográfico
 *       ascendente de `(q, r)`. El orden es total, así que la elegida no depende
 *       del orden de inserción de `HexMap.cells` ni de `scheduledActions`.
 *    c. La sacrifica en el mismo fragmento, sin aplicar `rules.demolition.time`
 *       y sin devolver materiales: si la obra cancelada es una mejora, la
 *       construcción se queda en su nivel actual y solo se libera a sus
 *       trabajadores adicionales; en cualquier otro caso el hexágono se queda
 *       sin construcción, se restaura el elemento sobre el que estuviera montada
 *       y se liberan sus trabajadores y los adicionales de la mejora que tuviera
 *       en curso (Requisito 7.13). Los trabajadores liberados cubren la pérdida
 *       y el excedente vuelve a la Poblacion_Libre.
 *    d. Si no queda ninguna candidata y la pérdida sigue sin cubrir, fija la
 *       Poblacion_Total en 0 (Requisito 4.8). El bucle siempre termina porque
 *       cada iteración elimina una construcción o una mejora en curso.
 *
 * Reparto de responsabilidades: aquí no se decide cuánto cuesta una acción ni
 * cuánto produce una construcción. El coste y el tiempo de explorar los calcula
 * el Sistema_De_Exploracion (Requisitos 3.1, 3.2), los trabajadores de una obra
 * el Sistema_De_Construccion y el Sistema_De_Niveles (Requisitos 6, 7), y la
 * producción diaria que `applyPopulationGrowth` y `addResources` reciben, el
 * cálculo de producción y la conversión de fábricas (Requisitos 9, 10). Este
 * módulo tampoco decide *cuándo* se resuelve cada paso: el orden del Fin_De_Dia
 * y la programación de acciones son del Reloj_De_Juego (Requisitos 5.7, 5.11,
 * tarea 7.1), que llama a `resolveFoodConsumption`, `resolveDiseaseRoll` y
 * `applyPopulationGrowth` en su posición. No termina la partida: `Poblacion_Total`
 * a 0 es la condición de derrota del Requisito 4.17, pero el `gameEnd` y su
 * entrada en el Registro_De_Eventos los escribe el Sistema_De_Objetivos (tarea
 * 13.1); aquí solo se ofrece la consulta `isPopulationDepleted`. La fuerza del
 * jugador en combate la calcula el Resolutor_De_Combate (Requisito 13.2); de él
 * solo se cubre aquí la exclusión de la Poblacion_Empleada (Requisito 4.4) con
 * `combatPopulation`. La mutación del hexágono al sacrificar una construcción
 * corresponde al Sistema_De_Construccion (Requisito 4.9, tarea 9.1); mientras
 * ese módulo no exista se aplica aquí para que el estado quede coherente, y al
 * escribirlo debe pasar a delegarse. La ciencia y el oro solo entran por las
 * vías de los Requisitos 4.13 y 4.14, que son de los sistemas de misiones,
 * puzzles, producción y fábricas: este módulo se limita a sumar lo que le pasen.
 */
import { hexKey } from './hex-math.ts';
import type { AxialCoord } from './hex-math.ts';
import { createRngFromState } from './rng.ts';
import { err, ok } from './result.ts';
import type { GameError, Result } from './result.ts';
import type {
  Construction,
  ElementCategory,
  GameEvent,
  GameState,
  GlobalEffect,
  HexCell,
  MapElement,
  ResourceCost,
  ResourceKey,
  Resources,
  ScheduledAction,
} from './types.ts';
import type { ConstructionDef, GameData, RulesData, ScenarioDef } from '../data/loader.ts';

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

/**
 * Recursos acumulables, en el orden en que se comprueba la suficiencia después
 * de la población. El nombre de cada uno es a la vez la clave del coste y el
 * campo de `Resources`.
 */
const STOCK_KEYS = ['food', 'materials', 'science', 'gold'] as const;

/**
 * Campos de `Resources` que rellena `scenario.starting_resources`, en el orden
 * en que se informan sus errores (Requisito 4.1).
 */
const STARTING_RESOURCE_FIELDS: Readonly<Record<string, keyof Resources>> = {
  poblacion_libre: 'freePopulation',
  poblacion_empleada: 'employedPopulation',
  comida: 'food',
  materiales: 'materials',
  ciencia: 'science',
  oro: 'gold',
};

/**
 * Tipo de Efecto_Global que modifica la probabilidad diaria de enfermedad como
 * factor multiplicativo (Requisito 4.10). Es el vocabulario de
 * `global_effects.effect` de los datos: para reconocer un tipo nuevo hay que
 * añadirlo aquí, como las claves de `CONSTRAINT_EVALUATORS` del
 * Generador_De_Mapa.
 */
export const DISEASE_PROBABILITY_EFFECT = 'probabilidad_enfermedad';

/**
 * Campo de un nivel de construcción con el que los datos marcan una torre de
 * defensa (Requisitos 8.9, 12.15, 14.2).
 */
const DEFENSE_TOWER_FIELD = 'blocks_expansion_radius';

/** Campo con el que una construcción se declara no sacrificable (Req. 4.8). */
const SACRIFICEABLE_FIELD = 'sacrificable';

/**
 * Categorías de elemento del modelo de datos, para restaurar el elemento sobre
 * el que se montaba una construcción sacrificada (Requisito 4.9).
 *
 * Es la segunda lista espejo de `ElementCategory`, junto a la de
 * `map-generator.ts`: ampliar el vocabulario exige tocar `types.ts` y las dos.
 * `satisfies` hace que el compilador rechace la tabla si le falta una categoría.
 */
const ELEMENT_CATEGORIES = {
  mountain: 'mountain',
  forest: 'forest',
  domestic_animal: 'domestic_animal',
  fish: 'fish',
  whale: 'whale',
  settlement: 'settlement',
  mystery: 'mystery',
  animal_threat: 'animal_threat',
  human_threat: 'human_threat',
} as const satisfies Record<ElementCategory, ElementCategory>;

/** Tipos de acción programada que representan una obra en curso (Req. 4.7). */
const WORK_ACTION_TYPES: ReadonlySet<string> = new Set(['construction', 'upgrade']);

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/**
 * Parámetros de balance que este módulo necesita, ya interpretados con
 * `readResourceRules`. Se leen una vez al arrancar la partida y se pasan a cada
 * paso del Fin_De_Dia, de modo que la validación de los datos ocurre en el
 * límite y no en cada llamada.
 */
export interface ResourceRules {
  /** `rules.food.consumo_por_poblacion` (Requisito 4.5). */
  foodPerPopulation: number;
  /** `rules.food.poblacion_perdida_por_hambre` (Requisito 4.6). */
  populationLostPerMissingFood: number;
  /** `rules.disease.probabilidad_base_diaria` (Requisito 4.10). */
  diseaseBaseProbability: number;
  /** `rules.disease.incremento_por_poblacion` (Requisito 4.10). */
  diseaseIncrementPerPopulation: number;
  /** `rules.disease.poblacion_perdida` (Requisito 4.11). */
  diseasePopulationLoss: number;
}

/**
 * Concepto por el que se aplica un coste en población: consumo, que reduce la
 * Poblacion_Total (Requisito 4.2), o empleo, que la deja invariante
 * (Requisito 4.3).
 */
export type CostKind = 'consume' | 'employ';

/**
 * Datos que el sacrificio de construcciones necesita: las construcciones, de
 * donde salen `sacrificable` y `blocks_expansion_radius`, y los elementos, de
 * donde sale la categoría del elemento que se restaura. `GameData` los cumple,
 * así que se puede pasar tal cual.
 */
export type ResourceData = Pick<GameData, 'constructions' | 'elements'>;

/** Recurso insuficiente para pagar un coste (Requisito 4.16). */
export interface ResourceShortage {
  resource: ResourceKey;
  required: number;
  available: number;
}

// ---------------------------------------------------------------------------
// API pública: consultas
// ---------------------------------------------------------------------------

/**
 * Poblacion_Total: propiedad derivada, nunca almacenada (Requisito 4.18).
 */
export function totalPopulation(resources: Resources): number {
  return resources.freePopulation + resources.employedPopulation;
}

/**
 * Población que aporta fuerza en combate: solo la Poblacion_Libre, porque la
 * Poblacion_Empleada queda excluida del cálculo (Requisito 4.4).
 *
 * Los Efecto_Global de combate y el mínimo de 1 los aplica el
 * Resolutor_De_Combate (Requisito 13.2).
 */
export function combatPopulation(resources: Resources): number {
  return resources.freePopulation;
}

/**
 * `true` si la Poblacion_Total ha llegado a 0, que es la condición de derrota
 * que evalúa el Sistema_De_Objetivos (Requisito 4.17).
 */
export function isPopulationDepleted(resources: Resources): boolean {
  return totalPopulation(resources) === 0;
}

/**
 * Consumo diario de comida: `techo(Poblacion_Total × consumo_por_poblacion)`
 * (Requisito 4.5).
 */
export function foodConsumption(state: GameState, rules: ResourceRules): number {
  return Math.ceil(totalPopulation(state.resources) * rules.foodPerPopulation);
}

/**
 * Probabilidad de la tirada diaria de enfermedad, ya acotada a [0, 1]
 * (Requisito 4.10).
 *
 * Los Efecto_Global activos de tipo `probabilidad_enfermedad` se aplican como
 * factores multiplicativos; su campo `value` se ignora, porque el requisito solo
 * declara factores.
 */
export function diseaseProbability(state: GameState, rules: ResourceRules): number {
  const base =
    rules.diseaseBaseProbability +
    rules.diseaseIncrementPerPopulation * totalPopulation(state.resources);
  return clampProbability(base * effectMultiplier(state.globalEffects, DISEASE_PROBABILITY_EFFECT));
}

// ---------------------------------------------------------------------------
// API pública: lectura de datos
// ---------------------------------------------------------------------------

/**
 * Recursos iniciales de la partida a partir de `scenario.starting_resources`
 * (Requisito 4.1).
 *
 * Exige los seis campos declarados: un recurso ausente es ambiguo entre «vale 0»
 * y «me he olvidado», y el escenario es un fichero escrito a mano. Acumula todos
 * los diagnósticos antes de devolver.
 *
 * Códigos de error, estables: `missing_field` y `invalid_value`.
 */
export function createInitialResources(
  scenario: ScenarioDef,
): Result<Resources, GameError[]> {
  const errors: GameError[] = [];
  const basePath = [scenario.fieldPath, 'starting_resources']
    .filter((part) => part.length > 0)
    .join('.');
  const declared = scenario.startingResources;

  if (declared === undefined) {
    return err([missingField(scenario.sourceFile, basePath)]);
  }

  const resources: Resources = {
    freePopulation: 0,
    employedPopulation: 0,
    food: 0,
    materials: 0,
    science: 0,
    gold: 0,
  };

  for (const [dataKey, field] of Object.entries(STARTING_RESOURCE_FIELDS)) {
    const fieldPath = `${basePath}.${dataKey}`;
    const value = declared[dataKey];
    if (value === undefined) {
      errors.push(missingField(scenario.sourceFile, fieldPath));
      continue;
    }
    if (!Number.isInteger(value) || value < 0) {
      errors.push(
        invalidValue(
          scenario.sourceFile,
          fieldPath,
          'debe ser un entero mayor o igual que 0',
          value,
        ),
      );
      continue;
    }
    resources[field] = value;
  }

  return errors.length > 0 ? err(errors) : ok(resources);
}

/**
 * Interpreta los parámetros de balance de `rules.food` y `rules.disease`
 * (Requisitos 4.5, 4.6, 4.10, 4.11).
 *
 * Acumula un diagnóstico por parámetro ausente o inservible; nunca lanza.
 *
 * Códigos de error, estables: `missing_field` y `invalid_value`.
 */
export function readResourceRules(rules: RulesData): Result<ResourceRules, GameError[]> {
  const errors: GameError[] = [];
  const foodPerPopulation = readRuleNumber(rules, 'food', 'consumo_por_poblacion', errors, false);
  const populationLostPerMissingFood = readRuleNumber(
    rules,
    'food',
    'poblacion_perdida_por_hambre',
    errors,
    false,
  );
  const diseaseBaseProbability = readRuleNumber(
    rules,
    'disease',
    'probabilidad_base_diaria',
    errors,
    false,
  );
  const diseaseIncrementPerPopulation = readRuleNumber(
    rules,
    'disease',
    'incremento_por_poblacion',
    errors,
    false,
  );
  const diseasePopulationLoss = readRuleNumber(rules, 'disease', 'poblacion_perdida', errors, true);

  if (
    foodPerPopulation === undefined ||
    populationLostPerMissingFood === undefined ||
    diseaseBaseProbability === undefined ||
    diseaseIncrementPerPopulation === undefined ||
    diseasePopulationLoss === undefined
  ) {
    return err(errors);
  }

  return ok({
    foodPerPopulation,
    populationLostPerMissingFood,
    diseaseBaseProbability,
    diseaseIncrementPerPopulation,
    diseasePopulationLoss,
  });
}

// ---------------------------------------------------------------------------
// API pública: costes
// ---------------------------------------------------------------------------

/**
 * Primer recurso insuficiente para pagar `cost`, en el orden población, comida,
 * materiales, ciencia y oro, o `undefined` si el coste es pagable
 * (Requisito 4.16).
 *
 * La población se compara siempre contra la Poblacion_Libre, tanto en consumo
 * como en empleo: la Poblacion_Empleada no está disponible para gastar.
 *
 * @throws RangeError Si el coste declara una cantidad negativa, no finita o una
 *   población no entera: es un error de programación de quien lo calcula.
 */
export function resourceShortage(
  state: GameState,
  cost: ResourceCost,
): ResourceShortage | undefined {
  assertCost(cost);
  const resources = state.resources;

  const population = cost.population ?? 0;
  if (population > resources.freePopulation) {
    return { resource: 'population', required: population, available: resources.freePopulation };
  }
  for (const key of STOCK_KEYS) {
    const required = cost[key] ?? 0;
    if (required > resources[key]) {
      return { resource: key, required, available: resources[key] };
    }
  }
  return undefined;
}

/**
 * `true` si el estado tiene con qué pagar el coste completo (Requisito 4.16).
 *
 * @throws RangeError En los mismos casos que {@link resourceShortage}.
 */
export function canAfford(state: GameState, cost: ResourceCost): boolean {
  return resourceShortage(state, cost) === undefined;
}

/**
 * Aplica un coste completo y devuelve un estado nuevo (Requisitos 4.2, 4.3).
 *
 * Con `kind` igual a `consume` la población sale de la Poblacion_Libre y la
 * Poblacion_Total baja en la misma cantidad (exploración, recolección, tala,
 * combate). Con `employ` la población pasa de la Poblacion_Libre a la
 * Poblacion_Empleada y la Poblacion_Total no varía (construcción y mejora).
 *
 * Si algún recurso no alcanza no se compromete nada y se devuelve el error, para
 * que el Nucleo_De_Simulacion rechace la acción sin dejar el estado a medias
 * (Requisitos 4.16, 5.13).
 *
 * Códigos de error, estables, que el Sistema_De_Interfaz resuelve con las claves
 * homónimas `ui.error.*` del catálogo i18n:
 *
 * - `insufficient_population`: falta Poblacion_Libre.
 * - `insufficient_resources`: falta comida, materiales, ciencia u oro.
 *
 * @throws RangeError En los mismos casos que {@link resourceShortage}.
 */
export function applyCost(
  state: GameState,
  cost: ResourceCost,
  kind: CostKind,
): Result<GameState> {
  const shortage = resourceShortage(state, cost);
  if (shortage !== undefined) {
    return err(shortageError(shortage));
  }

  const resources: Resources = { ...state.resources };
  const population = cost.population ?? 0;
  resources.freePopulation -= population;
  if (kind === 'employ') {
    resources.employedPopulation += population;
  }
  for (const key of STOCK_KEYS) {
    resources[key] -= cost[key] ?? 0;
  }

  return ok({ ...state, resources });
}

// ---------------------------------------------------------------------------
// API pública: ingresos
// ---------------------------------------------------------------------------

/**
 * Suma recursos al estado y devuelve un estado nuevo (Requisito 4.15).
 *
 * La población entra siempre como Poblacion_Libre. No hay tope superior en
 * ningún recurso.
 *
 * @throws RangeError Si alguna cantidad es negativa, no finita o la población no
 *   es entera. Para restar recursos está {@link applyCost}.
 */
export function addResources(state: GameState, gain: ResourceCost): GameState {
  assertCost(gain);

  const resources: Resources = { ...state.resources };
  resources.freePopulation += gain.population ?? 0;
  for (const key of STOCK_KEYS) {
    resources[key] += gain[key] ?? 0;
  }
  return { ...state, resources };
}

/**
 * Suma a la Poblacion_Libre la producción de población del Fin_De_Dia
 * (Requisito 4.12): la Poblacion_Total crece en la misma cantidad, la
 * Poblacion_Empleada no varía y la población se acumula sin límite.
 *
 * La producción la calcula el Sistema_De_Produccion (Requisito 9.4) contando
 * solo las construcciones completadas (Requisito 5.10). La entrada del
 * Registro_De_Eventos, si la hay, es del Registro_De_Eventos (tarea 15.2): el
 * Requisito 4.12 no exige ninguna.
 *
 * @throws RangeError Si `gained` no es un entero mayor o igual que 0.
 */
export function applyPopulationGrowth(state: GameState, gained: number): GameState {
  assertCount(gained, 'applyPopulationGrowth: gained');
  return gained === 0 ? state : addResources(state, { population: gained });
}

// ---------------------------------------------------------------------------
// API pública: pasos del Fin_De_Dia
// ---------------------------------------------------------------------------

/**
 * Resuelve el consumo diario de comida y, si no alcanza, la hambruna
 * (Requisitos 4.5, 4.6).
 *
 * Cuando la comida no llega al consumo la deja en 0, añade la entrada de
 * hambruna con el déficit y la población perdida, y aplica la pérdida
 * `min(Poblacion_Total, techo(déficit × poblacion_perdida_por_hambre))`, que
 * puede sacrificar construcciones (Requisito 4.7).
 */
export function resolveFoodConsumption(
  state: GameState,
  data: ResourceData,
  rules: ResourceRules,
): GameState {
  const consumption = foodConsumption(state, rules);
  const available = state.resources.food;

  if (available >= consumption) {
    return { ...state, resources: { ...state.resources, food: available - consumption } };
  }

  const missing = consumption - available;
  const lost = Math.min(
    totalPopulation(state.resources),
    Math.ceil(missing * rules.populationLostPerMissingFood),
  );
  const starving: GameState = {
    ...state,
    resources: { ...state.resources, food: 0 },
    eventLog: [...state.eventLog, famineEvent(state, missing, lost)],
  };

  return applyPopulationLoss(starving, lost, data);
}

/**
 * Resuelve la tirada diaria de enfermedad (Requisitos 4.10, 4.11).
 *
 * Consume siempre una extracción del RNG de la partida y devuelve el estado con
 * el `rngState` avanzado. Si la tirada sale positiva añade la entrada de
 * enfermedad y aplica la pérdida de `rules.disease.poblacion_perdida`, acotada a
 * la Poblacion_Total disponible.
 *
 * @throws RangeError Si `state.rngState` está mal formado (error de
 *   programación o guardado corrupto que la capa de datos debió rechazar).
 */
export function resolveDiseaseRoll(
  state: GameState,
  data: ResourceData,
  rules: ResourceRules,
): GameState {
  const probability = diseaseProbability(state, rules);
  const rng = createRngFromState(state.rngState);
  const roll = rng.next();
  const rolled: GameState = { ...state, rngState: rng.getState() };

  if (roll >= probability) {
    return rolled;
  }

  const lost = Math.min(totalPopulation(rolled.resources), rules.diseasePopulationLoss);
  if (lost === 0) {
    return rolled;
  }

  const sick: GameState = { ...rolled, eventLog: [...rolled.eventLog, diseaseEvent(rolled, lost)] };
  return applyPopulationLoss(sick, lost, data);
}

// ---------------------------------------------------------------------------
// API pública: pérdida de población
// ---------------------------------------------------------------------------

/**
 * Aplica una pérdida de población cubriéndola con la Poblacion_Libre y, si no
 * basta, sacrificando construcciones (Requisitos 4.7, 4.8, 4.9, 7.13).
 *
 * La Poblacion_Total resultante es `max(0, Poblacion_Total previa - loss)` y los
 * trabajadores de las construcciones que permanecen en pie no cambian
 * (Propiedad 8). Cada sacrificio añade su entrada al Registro_De_Eventos, y las
 * mejoras que se pierden añaden la suya.
 *
 * La entrada del evento que causó la pérdida (hambruna, enfermedad, combate,
 * efecto pasivo de una amenaza) la anota quien la provoca, antes de llamar aquí.
 *
 * @throws RangeError Si `loss` no es un entero mayor o igual que 0.
 */
export function applyPopulationLoss(
  state: GameState,
  loss: number,
  data: ResourceData,
): GameState {
  assertCount(loss, 'applyPopulationLoss: loss');
  if (loss === 0) {
    return state;
  }

  const resources: Resources = { ...state.resources };
  const work: LossWork = {
    cells: new Map(state.map.cells),
    actions: state.scheduledActions,
    events: [],
    catalog: readCatalog(data),
    day: state.currentDay,
    fragment: state.currentFragment,
  };

  let remaining = loss;
  const fromFree = Math.min(remaining, resources.freePopulation);
  resources.freePopulation -= fromFree;
  remaining -= fromFree;

  let sacrificed = false;
  while (remaining > 0) {
    const candidate = chooseCandidate(work);
    if (candidate === undefined) {
      // Requisito 4.8: no queda nada que sacrificar y la pérdida sigue viva.
      resources.freePopulation = 0;
      resources.employedPopulation = 0;
      break;
    }
    sacrificed = true;
    const freed = applySacrifice(work, candidate);
    const consumed = Math.min(remaining, freed);
    remaining -= consumed;
    resources.employedPopulation = Math.max(0, resources.employedPopulation - freed);
    resources.freePopulation += freed - consumed;
  }

  return {
    ...state,
    resources,
    map: sacrificed ? { ...state.map, cells: work.cells } : state.map,
    scheduledActions: work.actions,
    eventLog:
      work.events.length === 0 ? state.eventLog : [...state.eventLog, ...work.events],
  };
}

// ---------------------------------------------------------------------------
// Internos: sacrificio de construcciones
// ---------------------------------------------------------------------------

/** Clasificación de los datos que necesita el sacrificio (Requisitos 4.8, 4.9). */
interface LossCatalog {
  /** Construcciones que declaran `sacrificable: false`. */
  nonSacrificeable: ReadonlySet<string>;
  /** Construcciones con algún nivel que declara `blocks_expansion_radius`. */
  defenseTowers: ReadonlySet<string>;
  /** Categoría de cada elemento declarado, para restaurarlo. */
  elementCategories: ReadonlyMap<string, ElementCategory>;
}

/**
 * Estado en construcción de una pérdida de población. Se muta durante el bucle
 * de sacrificios y se vuelca en un `GameState` nuevo al terminar.
 */
interface LossWork {
  cells: Map<string, HexCell>;
  actions: ScheduledAction[];
  events: GameEvent[];
  readonly catalog: LossCatalog;
  readonly day: number;
  readonly fragment: number;
}

/** Construcción candidata a ser sacrificada, con su criterio de antigüedad. */
interface SacrificeCandidate {
  key: string;
  coord: AxialCoord;
  cell: HexCell;
  construction: Construction;
  /** Obra en curso que se cancela, o `undefined` si la construcción está completada. */
  work: ScheduledAction | undefined;
  /** Día de inicio de la obra en curso o de finalización de la construcción. */
  day: number;
  fragment: number;
}

/** Índices de los datos que el sacrificio consulta. */
function readCatalog(data: ResourceData): LossCatalog {
  const nonSacrificeable = new Set<string>();
  const defenseTowers = new Set<string>();
  for (const construction of data.constructions) {
    if (construction.raw[SACRIFICEABLE_FIELD] === false) {
      nonSacrificeable.add(construction.id);
    }
    if (declaresDefenseTower(construction)) {
      defenseTowers.add(construction.id);
    }
  }

  const elementCategories = new Map<string, ElementCategory>();
  for (const element of data.elements) {
    const category = asElementCategory(element.category);
    if (category !== undefined) {
      elementCategories.set(element.id, category);
    }
  }

  return { nonSacrificeable, defenseTowers, elementCategories };
}

/** `true` si algún nivel declara `blocks_expansion_radius` (Requisito 14.2). */
function declaresDefenseTower(construction: ConstructionDef): boolean {
  return (construction.levels ?? []).some(
    (level) => level.raw[DEFENSE_TOWER_FIELD] !== undefined,
  );
}

/**
 * Primera candidata del orden del Requisito 4.7: obra en curso, construcción
 * completada que no sea torre de defensa, torre de defensa completada.
 */
function chooseCandidate(work: LossWork): SacrificeCandidate | undefined {
  return (
    chooseInProgress(work) ??
    chooseCompleted(work, false) ??
    chooseCompleted(work, true)
  );
}

/** Obra en curso de inicio más reciente (Requisito 4.7). */
function chooseInProgress(work: LossWork): SacrificeCandidate | undefined {
  let best: SacrificeCandidate | undefined;
  for (const action of work.actions) {
    const coord = action.hex;
    if (coord === null || !WORK_ACTION_TYPES.has(action.type)) {
      continue;
    }
    const key = hexKey(coord);
    const cell = work.cells.get(key);
    const construction = cell?.construction;
    if (cell === undefined || construction === null || construction === undefined) {
      continue;
    }
    const candidate: SacrificeCandidate = {
      key,
      coord,
      cell,
      construction,
      work: action,
      day: action.startDay,
      fragment: action.startFragment,
    };
    if (best === undefined || isMoreRecent(candidate, best)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Construcción completada de finalización más reciente (Requisito 4.7). Con
 * `towers` a `false` se excluyen las torres de defensa y con `true` solo se
 * consideran ellas. Las construcciones no sacrificables quedan siempre fuera
 * (Requisito 4.8).
 */
function chooseCompleted(work: LossWork, towers: boolean): SacrificeCandidate | undefined {
  let best: SacrificeCandidate | undefined;
  for (const [key, cell] of work.cells) {
    const construction = cell.construction;
    if (construction === null) {
      continue;
    }
    if (work.catalog.nonSacrificeable.has(construction.id)) {
      continue;
    }
    if (work.catalog.defenseTowers.has(construction.id) !== towers) {
      continue;
    }
    if (hasPendingBuild(work, cell.coord)) {
      // La construcción todavía no existe: es una obra en curso y su turno ya
      // pasó en `chooseInProgress`.
      continue;
    }
    const candidate: SacrificeCandidate = {
      key,
      coord: cell.coord,
      cell,
      construction,
      work: undefined,
      day: construction.completedDay,
      fragment: construction.completedFragment,
    };
    if (best === undefined || isMoreRecent(candidate, best)) {
      best = candidate;
    }
  }
  return best;
}

/** `true` si el hexágono tiene una construcción de nivel 1 en curso. */
function hasPendingBuild(work: LossWork, coord: AxialCoord): boolean {
  return work.actions.some(
    (action) =>
      action.type === 'construction' &&
      action.hex !== null &&
      sameCoord(action.hex, coord),
  );
}

/**
 * `true` si `candidate` gana a `best`: día y fragmento más recientes y, en caso
 * de empate, orden lexicográfico ascendente de `(q, r)` (Requisito 4.7).
 */
function isMoreRecent(candidate: SacrificeCandidate, best: SacrificeCandidate): boolean {
  if (candidate.day !== best.day) {
    return candidate.day > best.day;
  }
  if (candidate.fragment !== best.fragment) {
    return candidate.fragment > best.fragment;
  }
  return compareCoords(candidate.coord, best.coord) < 0;
}

/**
 * Sacrifica la candidata y devuelve los trabajadores liberados (Requisitos 4.9,
 * 7.13). Muta `work`.
 *
 * Cancelar una mejora en curso deja la construcción en su nivel actual y libera
 * solo sus trabajadores adicionales. En cualquier otro caso el hexágono se queda
 * sin construcción, se restaura el elemento sobre el que se montaba y se liberan
 * todos sus trabajadores, incluidos los adicionales de una mejora en curso.
 */
function applySacrifice(work: LossWork, candidate: SacrificeCandidate): number {
  const construction = candidate.construction;
  const upgrade = construction.upgradeInProgress;

  if (candidate.work?.type === 'upgrade') {
    work.cells.set(candidate.key, {
      ...candidate.cell,
      construction: { ...construction, upgradeInProgress: null },
    });
    work.actions = work.actions.filter((action) => action !== candidate.work);
    work.events.push(upgradeLostEvent(work, candidate));
    return upgrade?.additionalWorkers ?? 0;
  }

  work.cells.set(candidate.key, {
    ...candidate.cell,
    construction: null,
    element: restoredElement(work, candidate),
  });
  work.actions = work.actions.filter(
    (action) =>
      !(
        WORK_ACTION_TYPES.has(action.type) &&
        action.hex !== null &&
        sameCoord(action.hex, candidate.coord)
      ),
  );
  if (upgrade !== null) {
    work.events.push(upgradeLostEvent(work, candidate));
  }
  work.events.push(sacrificeEvent(work, candidate));

  return construction.workers + (upgrade?.additionalWorkers ?? 0);
}

/**
 * Elemento que queda en el hexágono tras retirar la construcción
 * (Requisito 4.9).
 *
 * Si el hexágono conserva su elemento no se toca; si la construcción estaba
 * montada sobre uno y el hexágono está vacío, se restaura con la categoría que
 * declaran los datos. Un elemento que los datos no declaran deja el hexágono
 * vacío: el Validador_De_Datos ya rechaza esa referencia (Requisito 20.3).
 */
function restoredElement(work: LossWork, candidate: SacrificeCandidate): MapElement | null {
  const existing = candidate.cell.element;
  if (existing !== null) {
    return existing;
  }
  const mounted = candidate.construction.mountedOnElement;
  if (mounted === null) {
    return null;
  }
  const category = work.catalog.elementCategories.get(mounted);
  return category === undefined ? null : { id: mounted, category };
}

// ---------------------------------------------------------------------------
// Internos: entradas del Registro_De_Eventos
// ---------------------------------------------------------------------------

/** Entrada de hambruna con el déficit y la población perdida (Requisito 4.6). */
function famineEvent(state: GameState, missing: number, lost: number): GameEvent {
  return {
    type: 'famine',
    day: state.currentDay,
    fragment: state.currentFragment,
    hex: null,
    messageKey: 'event.famine',
    params: { missing, lost },
  };
}

/** Entrada de enfermedad con la población perdida (Requisito 4.11). */
function diseaseEvent(state: GameState, lost: number): GameEvent {
  return {
    type: 'disease',
    day: state.currentDay,
    fragment: state.currentFragment,
    hex: null,
    messageKey: 'event.disease',
    params: { lost },
  };
}

/** Entrada de construcción sacrificada (Requisito 4.9). */
function sacrificeEvent(work: LossWork, candidate: SacrificeCandidate): GameEvent {
  return {
    type: 'sacrifice',
    day: work.day,
    fragment: work.fragment,
    hex: candidate.coord,
    messageKey: 'event.construction_sacrificed',
    params: { construction: candidate.construction.id, hex: candidate.key },
  };
}

/** Entrada de mejora perdida al desaparecer o cancelarse la obra (Req. 7.13). */
function upgradeLostEvent(work: LossWork, candidate: SacrificeCandidate): GameEvent {
  return {
    type: 'upgrade',
    day: work.day,
    fragment: work.fragment,
    hex: candidate.coord,
    messageKey: 'event.upgrade_lost',
    params: {
      construction: candidate.construction.id,
      level: candidate.construction.upgradeInProgress?.targetLevel ?? null,
      hex: candidate.key,
    },
  };
}

// ---------------------------------------------------------------------------
// Internos: utilidades
// ---------------------------------------------------------------------------

/** Categoría de elemento del modelo de datos, o `undefined` si no lo es. */
function asElementCategory(declared: string | undefined): ElementCategory | undefined {
  if (declared === undefined) {
    return undefined;
  }
  const table: Readonly<Record<string, ElementCategory>> = ELEMENT_CATEGORIES;
  return table[declared];
}

/** Producto de los factores de los Efecto_Global activos del tipo indicado. */
function effectMultiplier(effects: readonly GlobalEffect[], effectType: string): number {
  let product = 1;
  for (const effect of effects) {
    if (effect.active && effect.effectType === effectType && effect.multiplier !== undefined) {
      product *= effect.multiplier;
    }
  }
  return product;
}

/** Acota una probabilidad al intervalo [0, 1] (Requisito 4.10). */
function clampProbability(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value > 1 ? 1 : value;
}

/** `true` si el valor es un mapa de claves, no una lista ni `null`. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Orden lexicográfico ascendente de coordenada axial (Requisitos 4.7, 5.8). */
function compareCoords(a: AxialCoord, b: AxialCoord): number {
  return a.q !== b.q ? a.q - b.q : a.r - b.r;
}

/** `true` si las dos coordenadas son la misma. */
function sameCoord(a: AxialCoord, b: AxialCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Error del recurso que falta, con lo requerido y lo disponible (Req. 4.16). */
function shortageError(shortage: ResourceShortage): GameError {
  const isPopulation = shortage.resource === 'population';
  return {
    code: isPopulation ? 'insufficient_population' : 'insufficient_resources',
    message: isPopulation
      ? `Poblacion_Libre insuficiente: hacen falta ${String(shortage.required)} y hay ${String(shortage.available)}`
      : `Recurso insuficiente ${shortage.resource}: hacen falta ${String(shortage.required)} y hay ${String(shortage.available)}`,
    context: {
      resource: shortage.resource,
      required: shortage.required,
      available: shortage.available,
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

/**
 * Lee un parámetro numérico mayor o igual que 0 de un grupo de reglas globales y
 * acumula el diagnóstico si falta o no sirve.
 */
function readRuleNumber(
  rules: RulesData,
  group: string,
  field: string,
  errors: GameError[],
  integer: boolean,
): number | undefined {
  const file = rules.sourceFiles[rules.sourceFiles.length - 1] ?? 'data/rules.yaml';
  const fieldPath = `rules.${group}.${field}`;
  const groupValue = rules.values[group];
  const value = isMapping(groupValue) ? groupValue[field] : undefined;

  if (value === undefined || value === null) {
    errors.push(missingField(file, fieldPath));
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(invalidValue(file, fieldPath, 'debe ser un número mayor o igual que 0', value));
    return undefined;
  }
  if (integer && !Number.isInteger(value)) {
    errors.push(invalidValue(file, fieldPath, 'debe ser un entero', value));
    return undefined;
  }
  return value;
}

/**
 * Comprueba que un coste o un ingreso es utilizable.
 *
 * @throws RangeError Si alguna cantidad es negativa o no finita, o si la
 *   población no es entera. La cantidad la calcula el código, así que un valor
 *   así es un error de programación y no un dato del jugador.
 */
function assertCost(cost: ResourceCost): void {
  const population = cost.population;
  if (population !== undefined) {
    assertCount(population, 'coste en población');
  }
  for (const key of STOCK_KEYS) {
    const amount = cost[key];
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      throw new RangeError(
        `coste en ${key}: se esperaba un número mayor o igual que 0, recibido ${String(amount)}`,
      );
    }
  }
}

/**
 * Comprueba que una cantidad de población es un entero mayor o igual que 0.
 *
 * @throws RangeError Si no lo es.
 */
function assertCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${label}: se esperaba un entero mayor o igual que 0, recibido ${String(value)}`,
    );
  }
}
