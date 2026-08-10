/**
 * Modelos de datos del estado de partida.
 *
 * Todo el estado mutable de una partida vive en `GameState`. Los subsistemas son
 * funciones puras `(GameState, ...) => GameState`, por lo que este módulo solo
 * declara tipos: no contiene lógica ni valores en tiempo de ejecución.
 *
 * Fuente única de verdad de coordenadas y RNG: `hex-math.ts` y `rng.ts`.
 */
import type { AxialCoord } from './hex-math.ts';
import type { RngState } from './rng.ts';

export type { AxialCoord } from './hex-math.ts';
export type { RngState } from './rng.ts';

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------

export type TerrainType = 'prado' | 'tundra' | 'desierto' | 'no_fertil' | 'oceano';

/**
 * Estado de visibilidad de un hexágono. Solo se admiten las transiciones
 * `hidden` → `dimmed` y `dimmed` → `explored`, sin retrocesos.
 */
export type VisibilityState = 'hidden' | 'dimmed' | 'explored';

export interface HexCell {
  coord: AxialCoord;
  terrain: TerrainType;
  /** Elemento del mapa, o `null` si el hexágono está vacío. Máximo uno por hex. */
  element: MapElement | null;
  /** Construcción completada o en curso, o `null`. Máximo una por hex. */
  construction: Construction | null;
  visibility: VisibilityState;
}

export interface HexMap {
  radius: number;
  /** Celdas indexadas por clave de coordenada `` `${q},${r}` ``. */
  cells: Map<string, HexCell>;
}

// ---------------------------------------------------------------------------
// Elementos del mapa
// ---------------------------------------------------------------------------

export type ElementCategory =
  | 'mountain'
  | 'forest'
  | 'domestic_animal'
  | 'fish'
  | 'whale'
  | 'settlement'
  | 'mystery'
  | 'animal_threat'
  | 'human_threat';

export interface MapElement {
  /** Referencia al dato YAML (e.g. "vaca", "lobos", "barbaros"). */
  id: string;
  category: ElementCategory;
}

export interface ThreatElement extends MapElement {
  category: 'animal_threat' | 'human_threat';
  level: number;
  /** Dano_Acumulado en el intervalo [0, rules.combat.dano_maximo_acumulado]. */
  accumulatedDamage: number;
  appearedDay: number;
  /** Solo amenazas humanas. */
  lastExpansionDay: number;
  /** Solo amenazas humanas. */
  lastLevelUpDay: number;
}

// ---------------------------------------------------------------------------
// Construcciones
// ---------------------------------------------------------------------------

export interface Construction {
  /** Referencia al dato YAML (e.g. "casa", "torre"). */
  id: string;
  level: number;
  /** Trabajadores empleados actualmente (parte de Poblacion_Empleada). */
  workers: number;
  /** Día en que se completó la construcción o la última mejora. */
  completedDay: number;
  completedFragment: number;
  /** Id del elemento sobre el que se monta la construcción (e.g. "vaca"). */
  mountedOnElement: string | null;
  upgradeInProgress: UpgradeInProgress | null;
}

export interface UpgradeInProgress {
  targetLevel: number;
  startDay: number;
  startFragment: number;
  endDay: number;
  endFragment: number;
  committedResources: ResourceCost;
  additionalWorkers: number;
}

// ---------------------------------------------------------------------------
// Recursos
// ---------------------------------------------------------------------------

/**
 * Recursos de la partida. Poblacion_Total es una propiedad derivada
 * (`freePopulation + employedPopulation`), nunca almacenada.
 */
export interface Resources {
  freePopulation: number;
  employedPopulation: number;
  food: number;
  materials: number;
  science: number;
  gold: number;
}

/** Recursos que admiten aparecer en un coste. */
export type ResourceKey = 'population' | 'food' | 'materials' | 'science' | 'gold';

export interface ResourceCost {
  /** Consumo o empleo de población según el contexto de la acción. */
  population?: number;
  food?: number;
  materials?: number;
  science?: number;
  gold?: number;
}

// ---------------------------------------------------------------------------
// Tiempo y acciones programadas
// ---------------------------------------------------------------------------

export type ClockState = 'stopped' | 'play' | 'fast';

export type ActionType =
  | 'exploration'
  | 'construction'
  | 'upgrade'
  | 'demolition'
  | 'harvest'
  | 'logging'
  | 'research';

export interface ScheduledAction {
  type: ActionType;
  /** Hexágono afectado, o `null` para acciones sin hex (investigación). */
  hex: AxialCoord | null;
  startDay: number;
  startFragment: number;
  endDay: number;
  /** Invariante: igual a `startFragment`. */
  endFragment: number;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tecnologías
// ---------------------------------------------------------------------------

export type TechStatus = 'researched' | 'available' | 'locked';

export interface TechState {
  id: string;
  status: TechStatus;
}

export interface ResearchInProgress {
  techId: string;
  startDay: number;
  startFragment: number;
  endDay: number;
  endFragment: number;
  committedScience: number;
}

// ---------------------------------------------------------------------------
// Objetivos y misiones
// ---------------------------------------------------------------------------

/**
 * Condición evaluable en el Fin_De_Dia. Se admiten únicamente los cuatro tipos
 * declarados por el escenario: cantidad acumulada de un recurso, número de
 * hexágonos explorados, número de construcciones completadas de un tipo con
 * nivel mínimo, y conjunto de tecnologías investigadas.
 */
export type ObjectiveCondition =
  | { kind: 'resource'; resource: ResourceKey; threshold: number }
  | { kind: 'explored_hexes'; threshold: number }
  | { kind: 'constructions'; constructionId: string; minLevel: number; threshold: number }
  | { kind: 'technologies'; techIds: string[] };

export interface ObjectiveState {
  /** Clave i18n de la descripción del objetivo. */
  description: string;
  condition: ObjectiveCondition;
  /** Días consecutivos exigidos para la victoria (mínimo 1). */
  sustainedDays: number;
  /** Contador acotado a [0, sustainedDays]. */
  consecutiveDaysCount: number;
}

export interface MissionState {
  id: string;
  completed: boolean;
  rewardGranted: boolean;
}

export type GameEndState = 'playing' | 'victory' | 'defeat';

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

export interface PuzzleState {
  puzzleId: string;
  /** Hexágono del poblado o del misterio al que se asignó el puzzle. */
  assignedTo: AxialCoord;
  resolved: boolean;
  chosenOption: number | null;
  wasCorrect: boolean | null;
}

// ---------------------------------------------------------------------------
// Reaparición de amenazas
// ---------------------------------------------------------------------------

export interface RespawnTracker {
  hex: AxialCoord;
  clearedDay: number;
  /** `false` si se construyó algo en el hexágono y la reaparición queda cancelada. */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Efectos globales
// ---------------------------------------------------------------------------

export interface GlobalEffect {
  id: string;
  source: 'technology' | 'settlement' | 'mystery';
  sourceId: string;
  /** e.g. "combate", "coste_poblacion_combate", "produccion". */
  effectType: string;
  /** Modificador aditivo. */
  value?: number;
  /** Modificador multiplicativo. */
  multiplier?: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Registro de eventos
// ---------------------------------------------------------------------------

export type GameEventType =
  | 'exploration'
  | 'construction'
  | 'upgrade'
  | 'demolition'
  | 'harvest'
  | 'research'
  | 'combat'
  | 'famine'
  | 'disease'
  | 'population_loss'
  | 'sacrifice'
  | 'factory_without_inputs'
  | 'threat_respawn'
  | 'threat_expansion'
  | 'threat_level_up'
  | 'puzzle'
  | 'mission'
  | 'objective'
  | 'victory'
  | 'defeat';

export interface GameEvent {
  type: GameEventType;
  day: number;
  fragment: number;
  /** Hexágono relacionado, o `null` para eventos globales. */
  hex: AxialCoord | null;
  /** Clave del catálogo i18n con el texto del evento (e.g. "event.famine"). */
  messageKey: string;
  /** Parámetros de interpolación del mensaje. */
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Estado global de la partida
// ---------------------------------------------------------------------------

export interface GameState {
  // Metadatos
  seed: number;
  scenarioId: string;
  saveFormatVersion: number;
  dataVersion: string;

  // RNG determinista
  rngState: RngState;

  // Tiempo
  currentDay: number;
  currentFragment: number;
  clockState: ClockState;
  /** Estado al que vuelve el reloj al reanudar desde `stopped`. */
  lastActiveClockState: 'play' | 'fast';

  // Mapa
  map: HexMap;

  // Recursos
  resources: Resources;

  // Acciones en curso
  scheduledActions: ScheduledAction[];

  // Tecnologías
  technologies: Map<string, TechState>;
  researchInProgress: ResearchInProgress | null;

  // Efectos globales
  globalEffects: GlobalEffect[];

  // Objetivos
  mainObjective: ObjectiveState;
  missions: MissionState[];
  gameEnd: GameEndState;

  // Puzzles
  puzzles: PuzzleState[];

  // Reaparición
  respawnTrackers: RespawnTracker[];

  // Registro de eventos
  eventLog: GameEvent[];
}
