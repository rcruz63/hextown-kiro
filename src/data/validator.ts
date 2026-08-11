/**
 * Validador_De_Datos: comprueba el `GameData` cargado antes de iniciar partida.
 *
 * Responsabilidades (Requisitos 20.3, 20.4, 20.5, 20.6, 11.14, 7.14, 15.7,
 * 22.4):
 *
 * - Esquema: cada categoría declara los campos que el diseño exige
 *   («Esquemas de Datos YAML → Esquema de validación» del documento de diseño).
 * - Referencias cruzadas entre terrenos, elementos, construcciones,
 *   tecnologías, puzzles y escenarios (Requisito 20.3).
 * - Identificadores duplicados dentro de una misma categoría, aunque estén en
 *   ficheros distintos, informando el identificador y todos los ficheros que lo
 *   declaran (Requisito 20.5).
 * - Grafo de dependencias de tecnologías acíclico y con dependencias existentes
 *   (Requisito 11.14).
 * - Toda clave i18n referenciada en los datos existe en el catálogo del idioma
 *   por defecto (Requisito 22.4).
 * - Advertencias no bloqueantes de balance: amortización de las mejoras
 *   (Requisito 7.14), progresión de niveles (Requisito 7.15), número de
 *   misiones fuera del rango declarado (Requisito 15.7) y claves ausentes en
 *   los catálogos de los demás idiomas (Requisito 22.8).
 *
 * Reparto de responsabilidades con el Cargador_De_Datos: el cargador rechaza
 * solo lo que impide construir la estructura (YAML inválido, colección con
 * forma incorrecta, definición sin `id`, campo con el tipo equivocado). Todo lo
 * demás se comprueba aquí, sobre el `GameData` ya cargado.
 *
 * Cada diagnóstico lleva el fichero, la ruta del campo y el motivo, de modo que
 * el Sistema_De_Interfaz pueda mostrarlos tal cual (Requisitos 20.4, 20.6).
 */
import type {
  ConstructionDef,
  ConstructionLevelDef,
  ElementDef,
  GameData,
  I18nCatalog,
  MissionDef,
  PuzzleDef,
  RulesData,
  ScenarioDef,
  TechnologyDef,
} from './loader.ts';

// ---------------------------------------------------------------------------
// Informe de validación
// ---------------------------------------------------------------------------

/**
 * Diagnóstico de validación. Es compatible con `GameError` (código, mensaje y
 * contexto) y añade el fichero, la ruta del campo y el motivo por separado,
 * porque el Sistema_De_Interfaz los muestra en columnas distintas
 * (Requisitos 20.4, 20.6).
 */
export interface ValidationIssue {
  /** Código estable para pruebas y para resolver textos i18n. */
  code: string;
  /** Mensaje legible: `fichero: ruta motivo`. */
  message: string;
  /** Fichero que declara el dato rechazado. */
  file: string;
  /** Ruta del campo dentro del fichero, e.g. `elements[3].allowed_terrains`. */
  path: string;
  /** Motivo del rechazo, sin el prefijo de fichero ni de ruta. */
  reason: string;
  /** Datos adicionales del diagnóstico (identificador, valor encontrado, …). */
  context?: Record<string, unknown>;
}

/** Error bloqueante: impide el inicio de la partida (Requisito 20.4). */
export type ValidationError = ValidationIssue;

/** Advertencia: no impide el inicio de la partida (Requisito 20.6). */
export type ValidationWarning = ValidationIssue;

/** Resultado de la validación. */
export interface ValidationReport {
  errors: ValidationError[];
  warnings: ValidationWarning[];
  /** `true` cuando hay al menos un error: la partida no puede iniciarse. */
  isBlocking: boolean;
}

// ---------------------------------------------------------------------------
// Constantes de validación
// ---------------------------------------------------------------------------

/** Grupos de reglas globales que el diseño exige en `rules.yaml`. */
const REQUIRED_RULE_GROUPS = [
  'day',
  'food',
  'disease',
  'combat',
  'exploration',
  'upgrades',
  'demolition',
  'research',
  'balance',
] as const;

/** Comprobación de un valor numérico de las reglas globales. */
interface RuleNumberCheck {
  group: string;
  field: string;
  /** Predicado que el valor debe cumplir. */
  accepts: (value: number) => boolean;
  /** Descripción del rango admitido, para el mensaje de error. */
  expected: string;
}

/**
 * Valores numéricos de las reglas globales con rango acotado por los
 * requisitos. No se enumeran todos los parámetros: solo los que el código usa
 * como divisor, como tope o como número de repeticiones, donde un valor fuera
 * de rango rompería la simulación.
 */
const RULE_NUMBER_CHECKS: readonly RuleNumberCheck[] = [
  // Requisito 5.1: el día se divide en fragmentos.
  { group: 'day', field: 'fragments', accepts: (v) => v >= 1, expected: 'mayor o igual que 1' },
  // Requisitos 5.3, 5.4: duración real del día en cada estado del reloj.
  { group: 'day', field: 'seconds_normal', accepts: (v) => v > 0, expected: 'mayor que 0' },
  { group: 'day', field: 'seconds_fast', accepts: (v) => v > 0, expected: 'mayor que 0' },
  // Requisitos 5.16, 5.17: toda acción cuesta al menos un día entero.
  {
    group: 'day',
    field: 'minimo_dias_accion',
    accepts: (v) => v >= 1,
    expected: 'mayor o igual que 1',
  },
  // Requisito 13.14: la probabilidad de victoria exige un dado de 2 caras o más.
  { group: 'combat', field: 'dado', accepts: (v) => v >= 2, expected: 'mayor o igual que 2' },
  // Requisito 13.9: tope del Dano_Acumulado, que reduce la fuerza de la amenaza.
  {
    group: 'combat',
    field: 'dano_maximo_acumulado',
    accepts: (v) => v >= 0 && v < 1,
    expected: 'mayor o igual que 0 y menor que 1',
  },
  // Requisito 11.11: huecos de investigación simultánea.
  {
    group: 'research',
    field: 'investigaciones_simultaneas',
    accepts: (v) => v >= 1,
    expected: 'mayor o igual que 1',
  },
  // Requisito 8.1: la demolición ocupa días enteros.
  { group: 'demolition', field: 'time', accepts: (v) => v >= 1, expected: 'mayor o igual que 1' },
  // Requisito 7.14: umbral de la advertencia de amortización.
  {
    group: 'balance',
    field: 'amortizacion_minima_dias',
    accepts: (v) => v >= 1,
    expected: 'mayor o igual que 1',
  },
];

/** Rango de misiones por escenario aplicado si las reglas no lo declaran (15.7). */
const DEFAULT_MISSION_RANGE = { min: 8, max: 10 } as const;

/** Idioma por defecto si `rules.i18n.idioma_por_defecto` no lo declara (22.2). */
const DEFAULT_LOCALE = 'es';

/** Recursos que se consideran sobrecoste de una mejora (Requisito 7.14). */
const UPGRADE_COST_RESOURCES = ['materiales', 'oro'] as const;

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Valida los datos cargados y devuelve el informe con los errores bloqueantes
 * y las advertencias. No lanza excepciones: acumula todos los diagnósticos
 * encontrados para que el jugador vea de una vez todo lo que hay que corregir.
 */
export function validate(data: GameData): ValidationReport {
  const report: ValidationReport = { errors: [], warnings: [], isBlocking: false };
  const diagnostics = createDiagnostics(report);
  const index = buildIndex(data);

  checkDuplicateIds(data, diagnostics);
  checkRules(data.rules, diagnostics);
  checkTerrains(data, diagnostics);
  checkElements(data, index, diagnostics);
  checkConstructions(data, index, diagnostics);
  checkTechnologies(data, index, diagnostics);
  checkPuzzles(data, index, diagnostics);
  checkScenarios(data, index, diagnostics);
  checkI18nKeys(data, diagnostics);

  report.isBlocking = report.errors.length > 0;
  return report;
}

// ---------------------------------------------------------------------------
// Acumulador de diagnósticos
// ---------------------------------------------------------------------------

/** Registra errores y advertencias en el informe. */
interface Diagnostics {
  error(issue: NewIssue): void;
  warn(issue: NewIssue): void;
}

/** Diagnóstico antes de componer su mensaje. */
interface NewIssue {
  code: string;
  file: string;
  path: string;
  reason: string;
  context?: Record<string, unknown>;
}

function createDiagnostics(report: ValidationReport): Diagnostics {
  return {
    error(issue) {
      report.errors.push(toIssue(issue));
    },
    warn(issue) {
      report.warnings.push(toIssue(issue));
    },
  };
}

function toIssue(issue: NewIssue): ValidationIssue {
  const location = issue.path.length === 0 ? issue.file : `${issue.file}: ${issue.path}`;
  return {
    code: issue.code,
    message: `${location} ${issue.reason}`,
    file: issue.file,
    path: issue.path,
    reason: issue.reason,
    context: { file: issue.file, path: issue.path, ...issue.context },
  };
}

// ---------------------------------------------------------------------------
// Índice de identificadores declarados
// ---------------------------------------------------------------------------

/**
 * Identificadores y vocabularios declarados en los datos, para resolver las
 * referencias cruzadas. Ante identificadores repetidos se indexa la primera
 * declaración: el duplicado ya se informa aparte (Requisito 20.5).
 */
interface DataIndex {
  terrainIds: Set<string>;
  elementIds: Set<string>;
  elements: Map<string, ElementDef>;
  /** Categorías declaradas por los elementos (`category`). */
  elementCategories: Set<string>;
  /** Identificadores de acción por elemento (`actions[].id`). */
  elementActions: Map<string, Set<string>>;
  /** Tipos de puzzle admitidos por los elementos (`puzzle_kind`). */
  puzzleKinds: Set<string>;
  constructionIds: Set<string>;
  constructions: Map<string, ConstructionDef>;
  /** Etiquetas declaradas por las construcciones (`tags`). */
  constructionTags: Set<string>;
  /** Niveles declarados por construcción, para resolver `casa:2`. */
  constructionLevels: Map<string, Set<number>>;
  /** Modificadores de adyacencia por construcción (`adjacency_modifiers[].id`). */
  constructionModifiers: Map<string, Set<string>>;
  technologyIds: Set<string>;
}

function buildIndex(data: GameData): DataIndex {
  const index: DataIndex = {
    terrainIds: new Set(),
    elementIds: new Set(),
    elements: new Map(),
    elementCategories: new Set(),
    elementActions: new Map(),
    puzzleKinds: new Set(),
    constructionIds: new Set(),
    constructions: new Map(),
    constructionTags: new Set(),
    constructionLevels: new Map(),
    constructionModifiers: new Map(),
    technologyIds: new Set(),
  };

  for (const terrain of data.terrains) {
    index.terrainIds.add(terrain.id);
  }

  for (const element of data.elements) {
    index.elementIds.add(element.id);
    if (!index.elements.has(element.id)) {
      index.elements.set(element.id, element);
    }
    if (element.category !== undefined) {
      index.elementCategories.add(element.category);
    }
    const puzzleKind = readString(element.raw['puzzle_kind']);
    if (puzzleKind !== undefined) {
      index.puzzleKinds.add(puzzleKind);
    }
    const actions = new Set<string>();
    for (const action of readMappingList(element.raw['actions'])) {
      const id = readString(action['id']);
      if (id !== undefined) {
        actions.add(id);
      }
    }
    if (!index.elementActions.has(element.id)) {
      index.elementActions.set(element.id, actions);
    }
  }

  for (const construction of data.constructions) {
    index.constructionIds.add(construction.id);
    if (!index.constructions.has(construction.id)) {
      index.constructions.set(construction.id, construction);
    }
    for (const tag of readStringList(construction.raw['tags']) ?? []) {
      index.constructionTags.add(tag);
    }
    if (!index.constructionLevels.has(construction.id)) {
      const levels = new Set<number>();
      for (const level of construction.levels ?? []) {
        if (level.level !== undefined) {
          levels.add(level.level);
        }
      }
      index.constructionLevels.set(construction.id, levels);
    }
    if (!index.constructionModifiers.has(construction.id)) {
      const modifiers = new Set<string>();
      for (const modifier of readMappingList(construction.raw['adjacency_modifiers'])) {
        const id = readString(modifier['id']);
        if (id !== undefined) {
          modifiers.add(id);
        }
      }
      index.constructionModifiers.set(construction.id, modifiers);
    }
  }

  for (const technology of data.technologies) {
    index.technologyIds.add(technology.id);
  }

  return index;
}

// ---------------------------------------------------------------------------
// Identificadores duplicados (Requisito 20.5)
// ---------------------------------------------------------------------------

/** Definición con identificador, para las comprobaciones genéricas. */
interface IdentifiedDefinition {
  id: string;
  sourceFile: string;
  fieldPath: string;
}

/**
 * Informa de todo identificador declarado dos veces en la misma categoría,
 * incluso en ficheros distintos, indicando el identificador y todos los
 * ficheros que lo declaran (Requisito 20.5).
 */
function checkDuplicateIds(data: GameData, d: Diagnostics): void {
  const categories: [string, IdentifiedDefinition[]][] = [
    ['terreno', data.terrains],
    ['elemento', data.elements],
    ['construcción', data.constructions],
    ['tecnología', data.technologies],
    ['puzzle', data.puzzles],
    ['escenario', data.scenarios],
    ['misión', collectMissions(data.scenarios)],
  ];

  for (const [category, definitions] of categories) {
    const byId = new Map<string, IdentifiedDefinition[]>();
    for (const definition of definitions) {
      const declarations = byId.get(definition.id);
      if (declarations === undefined) {
        byId.set(definition.id, [definition]);
        continue;
      }
      declarations.push(definition);
    }

    for (const [id, declarations] of byId) {
      if (declarations.length < 2) {
        continue;
      }
      const first = declarations[0] as IdentifiedDefinition;
      const files = declarations.map((declaration) => declaration.sourceFile);
      d.error({
        code: 'duplicate_id',
        file: first.sourceFile,
        path: first.fieldPath,
        reason: `declara el identificador de ${category} ${id}, ya declarado en ${files.join(', ')}`,
        context: {
          category,
          id,
          files,
          paths: declarations.map((declaration) => declaration.fieldPath),
        },
      });
    }
  }
}

/** Misiones de todos los escenarios, con su fichero y su ruta. */
function collectMissions(scenarios: ScenarioDef[]): IdentifiedDefinition[] {
  const missions: IdentifiedDefinition[] = [];
  for (const scenario of scenarios) {
    for (const mission of scenario.missions ?? []) {
      if (mission.id !== undefined) {
        missions.push({
          id: mission.id,
          sourceFile: scenario.sourceFile,
          fieldPath: mission.fieldPath,
        });
      }
    }
  }
  return missions;
}

// ---------------------------------------------------------------------------
// Reglas globales
// ---------------------------------------------------------------------------

/** Comprueba que las reglas globales declaran los grupos y rangos exigidos. */
function checkRules(rules: RulesData, d: Diagnostics): void {
  const file = rules.sourceFiles[rules.sourceFiles.length - 1] ?? 'data/rules.yaml';

  for (const group of REQUIRED_RULE_GROUPS) {
    if (!isMapping(rules.values[group])) {
      d.error({
        code: 'missing_rule_group',
        file,
        path: group,
        reason: 'no se declara como grupo de reglas globales',
        context: { group },
      });
    }
  }

  for (const check of RULE_NUMBER_CHECKS) {
    const group = rules.values[check.group];
    if (!isMapping(group)) {
      continue; // La ausencia del grupo ya se ha informado.
    }
    const path = `${check.group}.${check.field}`;
    const value = group[check.field];
    if (value === undefined || value === null) {
      d.error({
        code: 'missing_rule',
        file,
        path,
        reason: 'no se declara',
        context: { group: check.group, field: check.field },
      });
      continue;
    }
    const numberValue = readNumber(value);
    if (numberValue === undefined || !check.accepts(numberValue)) {
      d.error({
        code: 'invalid_rule',
        file,
        path,
        reason: `debe ser un número ${check.expected}`,
        context: { group: check.group, field: check.field, found: value },
      });
    }
  }

  const range = readMissionRange(rules);
  if (range.min > range.max) {
    d.error({
      code: 'invalid_rule',
      file,
      path: 'balance.misiones_minimas',
      reason: `no puede ser mayor que balance.misiones_maximas (${String(range.max)})`,
      context: { min: range.min, max: range.max },
    });
  }
}

// ---------------------------------------------------------------------------
// Terrenos
// ---------------------------------------------------------------------------

/** Esquema de los terrenos: identificador y clave i18n del nombre. */
function checkTerrains(data: GameData, d: Diagnostics): void {
  for (const terrain of data.terrains) {
    requireNameKey(d, terrain.sourceFile, terrain.fieldPath, terrain.nameKey);
  }
}

// ---------------------------------------------------------------------------
// Elementos
// ---------------------------------------------------------------------------

/** Esquema y referencias de los elementos del mapa. */
function checkElements(data: GameData, index: DataIndex, d: Diagnostics): void {
  for (const element of data.elements) {
    const file = element.sourceFile;
    const path = element.fieldPath;
    const ref = referenceCheck(d, file);

    requireNameKey(d, file, path, element.nameKey);

    if (element.category === undefined) {
      missingField(d, file, path, 'category');
    }

    const terrainsPath = joinPath(path, 'allowed_terrains');
    if (element.allowedTerrains === undefined) {
      missingField(d, file, path, 'allowed_terrains');
    } else if (element.allowedTerrains.length === 0) {
      emptyField(d, file, terrainsPath, 'un terreno');
    } else {
      ref(terrainsPath, element.allowedTerrains, index.terrainIds, 'terreno');
    }
  }
}

// ---------------------------------------------------------------------------
// Construcciones
// ---------------------------------------------------------------------------

/** Esquema, referencias, progresión de niveles y balance de las mejoras. */
function checkConstructions(data: GameData, index: DataIndex, d: Diagnostics): void {
  const minAmortizationDays = readRuleNumber(data.rules, 'balance', 'amortizacion_minima_dias') ?? 0;
  const weights = readResourceWeights(data.rules);

  for (const construction of data.constructions) {
    const file = construction.sourceFile;
    const path = construction.fieldPath;

    requireNameKey(d, file, path, construction.nameKey);

    const terrainsPath = joinPath(path, 'allowed_terrains');
    const allowedTerrains = construction.allowedTerrains;
    if (allowedTerrains === undefined) {
      missingField(d, file, path, 'allowed_terrains');
    } else if (allowedTerrains.length === 0) {
      emptyField(d, file, terrainsPath, 'un terreno');
    } else {
      referenceCheck(d, file)(terrainsPath, allowedTerrains, index.terrainIds, 'terreno');
    }

    checkConstructionReferences(construction, index, d);
    checkConstructionLevels(construction, index, d);
    checkMountedElementCoverage(construction, index, d);
    checkUpgradeBalance(construction, weights, minAmortizationDays, d);
  }
}

/** Referencias de la construcción a elementos, construcciones y etiquetas. */
function checkConstructionReferences(
  construction: ConstructionDef,
  index: DataIndex,
  d: Diagnostics,
): void {
  const file = construction.sourceFile;
  const path = construction.fieldPath;
  const raw = construction.raw;
  const ref = referenceCheck(d, file);

  const mounts = readStringList(raw['mounts_on_elements']);
  ref(joinPath(path, 'mounts_on_elements'), mounts, index.elementIds, 'elemento');

  const adjacentElement = readString(raw['requires_adjacent_element']);
  if (adjacentElement !== undefined) {
    const adjacentPath = joinPath(path, 'requires_adjacent_element');
    ref(adjacentPath, [adjacentElement], index.elementIds, 'elemento');
  }

  const terrainModifiers = readMapping(raw['terrain_modifiers']);
  if (terrainModifiers !== undefined) {
    const modifiersPath = joinPath(path, 'terrain_modifiers');
    ref(modifiersPath, Object.keys(terrainModifiers), index.terrainIds, 'terreno');
  }

  const perElement = readMapping(raw['terrain_modifiers_per_element']);
  if (perElement !== undefined) {
    const perElementPath = joinPath(path, 'terrain_modifiers_per_element');
    ref(perElementPath, Object.keys(perElement), index.elementIds, 'elemento');
    for (const [elementId, modifiers] of Object.entries(perElement)) {
      const terrains = readMapping(modifiers);
      if (terrains === undefined) {
        continue;
      }
      const elementPath = joinPath(perElementPath, elementId);
      ref(elementPath, Object.keys(terrains), index.terrainIds, 'terreno');
    }
  }

  const adjacencyPath = joinPath(path, 'adjacency_modifiers');
  readMappingList(raw['adjacency_modifiers']).forEach((modifier, position) => {
    const modifierPath = `${adjacencyPath}[${String(position)}]`;
    const targets = (field: string): string[] | undefined => readStringList(modifier[field]);
    ref(
      joinPath(modifierPath, 'target_constructions'),
      targets('target_constructions'),
      index.constructionIds,
      'construcción',
    );
    ref(
      joinPath(modifierPath, 'target_element_categories'),
      targets('target_element_categories'),
      index.elementCategories,
      'categoría de elemento',
    );
    ref(
      joinPath(modifierPath, 'target_tags'),
      targets('target_tags'),
      index.constructionTags,
      'etiqueta de construcción',
    );
  });
}

/** Esquema de los niveles, sus tecnologías y su numeración creciente. */
function checkConstructionLevels(
  construction: ConstructionDef,
  index: DataIndex,
  d: Diagnostics,
): void {
  const file = construction.sourceFile;
  const path = construction.fieldPath;
  const levels = construction.levels;
  const ref = referenceCheck(d, file);

  if (levels === undefined) {
    missingField(d, file, path, 'levels');
    return;
  }
  if (levels.length === 0) {
    emptyField(d, file, joinPath(path, 'levels'), 'un nivel');
    return;
  }

  levels.forEach((level, position) => {
    const levelPath = level.fieldPath;

    // El Sistema_De_Niveles ofrece la mejora al nivel actual más 1
    // (Requisito 7.1): los niveles se declaran desde 1 y sin saltos.
    const expected = position + 1;
    if (level.level === undefined) {
      missingField(d, file, levelPath, 'level');
    } else if (level.level !== expected) {
      d.error({
        code: 'invalid_level_number',
        file,
        path: joinPath(levelPath, 'level'),
        reason: `debe ser ${String(expected)}: los niveles se declaran consecutivos desde 1`,
        context: { found: level.level, expected },
      });
    }

    if (level.buildTime === undefined) {
      missingField(d, file, levelPath, 'build_time');
    } else if (level.buildTime < 1) {
      d.error({
        code: 'invalid_value',
        file,
        path: joinPath(levelPath, 'build_time'),
        reason: 'debe ser mayor o igual que 1: toda obra ocupa días enteros',
        context: { found: level.buildTime },
      });
    }

    if (level.cost === undefined) {
      missingField(d, file, levelPath, 'cost');
    } else {
      for (const [resource, amount] of Object.entries(level.cost)) {
        if (amount < 0) {
          d.error({
            code: 'invalid_value',
            file,
            path: joinPath(levelPath, `cost.${resource}`),
            reason: 'no puede ser negativo',
            context: { found: amount },
          });
        }
      }
    }

    if (level.employs === undefined) {
      missingField(d, file, levelPath, 'employs');
    } else if (level.employs < 0) {
      d.error({
        code: 'invalid_value',
        file,
        path: joinPath(levelPath, 'employs'),
        reason: 'no puede ser negativo',
        context: { found: level.employs },
      });
    }

    if (level.requiresTech === undefined) {
      missingField(d, file, levelPath, 'requires_tech');
    } else {
      const techPath = joinPath(levelPath, 'requires_tech');
      ref(techPath, level.requiresTech, index.technologyIds, 'tecnología');
    }
  });
}

/**
 * Toda construcción que se monta sobre un elemento declara producción y
 * modificador para cada par (elemento, terreno) posible (Requisito 9.16). Solo
 * se exige a las construcciones que declaran valores por elemento: las que
 * producen con `production_per_day` usan los modificadores de terreno comunes.
 */
function checkMountedElementCoverage(
  construction: ConstructionDef,
  index: DataIndex,
  d: Diagnostics,
): void {
  const mounts = readStringList(construction.raw['mounts_on_elements']);
  if (mounts === undefined || mounts.length === 0) {
    return;
  }
  const file = construction.sourceFile;
  const path = construction.fieldPath;
  const mounted = mounts.filter((id) => index.elementIds.has(id));

  const perElement = readMapping(construction.raw['terrain_modifiers_per_element']);
  if (perElement !== undefined) {
    const perElementPath = joinPath(path, 'terrain_modifiers_per_element');
    for (const elementId of mounted) {
      const modifiers = readMapping(perElement[elementId]);
      if (modifiers === undefined) {
        d.error({
          code: 'missing_mounted_element',
          file,
          path: joinPath(perElementPath, elementId),
          reason: `no declara el modificador de terreno del elemento ${elementId} sobre el que se monta`,
          context: { element: elementId },
        });
        continue;
      }
      for (const terrain of sharedTerrains(construction, index.elements.get(elementId))) {
        if (modifiers[terrain] === undefined) {
          d.error({
            code: 'missing_mounted_element',
            file,
            path: joinPath(joinPath(perElementPath, elementId), terrain),
            reason: `no declara el modificador del par (${elementId}, ${terrain})`,
            context: { element: elementId, terrain },
          });
        }
      }
    }
  }

  for (const level of construction.levels ?? []) {
    const production = readMapping(level.raw['production_per_element']);
    if (production === undefined) {
      continue;
    }
    for (const elementId of mounted) {
      if (production[elementId] === undefined) {
        d.error({
          code: 'missing_mounted_element',
          file,
          path: joinPath(joinPath(level.fieldPath, 'production_per_element'), elementId),
          reason: `no declara la producción del elemento ${elementId} sobre el que se monta`,
          context: { element: elementId },
        });
      }
    }
  }
}

/** ¿La construcción declara ese nivel? */
function hasLevel(index: DataIndex, construction: string, level: number): boolean {
  return index.constructionLevels.get(construction)?.has(level) ?? false;
}

/** ¿La construcción declara ese modificador de adyacencia? */
function hasModifier(index: DataIndex, construction: string, modifier: string): boolean {
  return index.constructionModifiers.get(construction)?.has(modifier) ?? false;
}

/** Terrenos en que la construcción puede montarse sobre ese elemento. */
function sharedTerrains(
  construction: ConstructionDef,
  element: ElementDef | undefined,
): string[] {
  const constructionTerrains = construction.allowedTerrains ?? [];
  const elementTerrains = element?.allowedTerrains ?? [];
  return constructionTerrains.filter((terrain) => elementTerrains.includes(terrain));
}

// ---------------------------------------------------------------------------
// Balance de las mejoras (Requisitos 7.14, 7.15)
// ---------------------------------------------------------------------------

/**
 * Advertencias de balance de cada mejora (Requisito 7.14):
 *
 * - la mejora no aumenta la producción diaria, o
 * - amortiza el sobrecoste en materiales y oro del nivel destino en menos de
 *   `rules.balance.amortizacion_minima_dias` días.
 *
 * Ambos lados del cociente ponderan cada recurso con `rules.balance.pesos_recurso`,
 * la única forma de comparar producciones y costes de recursos distintos.
 *
 * Además advierte cuando el tiempo, el coste total o los trabajadores de un
 * nivel no son mayores o iguales que los del nivel anterior (Requisito 7.15).
 */
function checkUpgradeBalance(
  construction: ConstructionDef,
  weights: Record<string, number>,
  minAmortizationDays: number,
  d: Diagnostics,
): void {
  const levels = construction.levels ?? [];
  const file = construction.sourceFile;

  for (let position = 1; position < levels.length; position += 1) {
    const previous = levels[position - 1] as ConstructionLevelDef;
    const level = levels[position] as ConstructionLevelDef;
    const levelNumber = level.level ?? position + 1;

    checkLevelProgression(construction, previous, level, levelNumber, d);

    const increment =
      weightedValue(dailyProduction(level), weights) -
      weightedValue(dailyProduction(previous), weights);
    const overcost = weightedValue(upgradeCost(level), weights);

    if (increment <= 0) {
      d.warn({
        code: 'upgrade_without_production_gain',
        file,
        path: level.fieldPath,
        reason: `el nivel ${String(levelNumber)} de ${construction.id} no aumenta la producción diaria respecto al nivel anterior`,
        context: { construction: construction.id, level: levelNumber, increment },
      });
      continue;
    }

    const days = Math.ceil(overcost / increment);
    if (days < minAmortizationDays) {
      d.warn({
        code: 'upgrade_amortization_too_fast',
        file,
        path: level.fieldPath,
        reason: `el nivel ${String(levelNumber)} de ${construction.id} amortiza su sobrecoste en ${String(days)} días, menos de los ${String(minAmortizationDays)} exigidos por rules.balance.amortizacion_minima_dias`,
        context: {
          construction: construction.id,
          level: levelNumber,
          days,
          minimum: minAmortizationDays,
          overcost,
          increment,
        },
      });
    }
  }
}

/** Requisito 7.15: tiempo, coste total y trabajadores no decrecen por nivel. */
function checkLevelProgression(
  construction: ConstructionDef,
  previous: ConstructionLevelDef,
  level: ConstructionLevelDef,
  levelNumber: number,
  d: Diagnostics,
): void {
  const comparisons: [string, number | undefined, number | undefined][] = [
    ['build_time', previous.buildTime, level.buildTime],
    ['cost', totalAmount(previous.cost), totalAmount(level.cost)],
    ['employs', previous.employs, level.employs],
  ];

  for (const [field, before, after] of comparisons) {
    if (before === undefined || after === undefined || after >= before) {
      continue;
    }
    d.warn({
      code: 'level_progression_decreases',
      file: construction.sourceFile,
      path: joinPath(level.fieldPath, field),
      reason: `el nivel ${String(levelNumber)} de ${construction.id} declara ${field} menor que el nivel anterior (${String(after)} < ${String(before)})`,
      context: { construction: construction.id, level: levelNumber, field, before, after },
    });
  }
}

/**
 * Producción diaria de referencia del nivel. Se toma `production_per_day` tal
 * cual; para las construcciones que producen por elemento se usa el valor
 * máximo declarado de cada recurso y para las que producen por adyacencia el
 * valor de un único hexágono adyacente, de modo que la comparación entre dos
 * niveles sea siempre determinista.
 */
function dailyProduction(level: ConstructionLevelDef): Record<string, number> {
  const production: Record<string, number> = {};

  const perDay = readMapping(level.raw['production_per_day']);
  if (perDay !== undefined) {
    accumulateMax(production, perDay);
  }

  const perElement = readMapping(level.raw['production_per_element']);
  if (perElement !== undefined) {
    for (const byResource of Object.values(perElement)) {
      const resources = readMapping(byResource);
      if (resources !== undefined) {
        accumulateMax(production, resources);
      }
    }
  }

  const perAdjacent = readMapping(level.raw['production_per_adjacent']);
  if (perAdjacent !== undefined) {
    accumulateMax(production, perAdjacent);
  }

  return production;
}

/** Sobrecoste de la mejora: materiales y oro del nivel destino (7.14). */
function upgradeCost(level: ConstructionLevelDef): Record<string, number> {
  const cost: Record<string, number> = {};
  for (const resource of UPGRADE_COST_RESOURCES) {
    const amount = level.cost?.[resource];
    if (amount !== undefined) {
      cost[resource] = amount;
    }
  }
  return cost;
}

/** Suma los valores de un mapa de recursos, ignorando los campos no numéricos. */
function totalAmount(amounts: Record<string, number> | undefined): number | undefined {
  if (amounts === undefined) {
    return undefined;
  }
  return Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
}

/** Valor de un mapa de recursos ponderado con `rules.balance.pesos_recurso`. */
function weightedValue(amounts: Record<string, number>, weights: Record<string, number>): number {
  let total = 0;
  for (const [resource, amount] of Object.entries(amounts)) {
    total += amount * (weights[resource] ?? 1);
  }
  return total;
}

/** Guarda en `target` el máximo declarado de cada recurso numérico de `source`. */
function accumulateMax(target: Record<string, number>, source: Record<string, unknown>): void {
  for (const [resource, value] of Object.entries(source)) {
    const amount = readNumber(value);
    if (amount === undefined) {
      continue; // `production_per_adjacent.element` y campos análogos.
    }
    target[resource] = Math.max(target[resource] ?? 0, amount);
  }
}

// ---------------------------------------------------------------------------
// Tecnologías
// ---------------------------------------------------------------------------

/** Esquema, referencias, desbloqueos y aciclicidad del árbol (11.14). */
function checkTechnologies(data: GameData, index: DataIndex, d: Diagnostics): void {
  for (const technology of data.technologies) {
    const file = technology.sourceFile;
    const path = technology.fieldPath;
    const ref = referenceCheck(d, file);

    requireNameKey(d, file, path, technology.nameKey);

    if (technology.branch === undefined) {
      missingField(d, file, path, 'branch');
    }
    if (technology.tier === undefined) {
      missingField(d, file, path, 'tier');
    } else if (technology.tier < 1) {
      d.error({
        code: 'invalid_value',
        file,
        path: joinPath(path, 'tier'),
        reason: 'debe ser mayor o igual que 1',
        context: { found: technology.tier },
      });
    }
    if (technology.cost === undefined) {
      missingField(d, file, path, 'cost');
    } else if (technology.cost < 0) {
      d.error({
        code: 'invalid_value',
        file,
        path: joinPath(path, 'cost'),
        reason: 'no puede ser negativo',
        context: { found: technology.cost },
      });
    }
    if (technology.researchTime === undefined) {
      missingField(d, file, path, 'research_time');
    } else if (technology.researchTime < 1) {
      d.error({
        code: 'invalid_value',
        file,
        path: joinPath(path, 'research_time'),
        reason: 'debe ser mayor o igual que 1: toda investigación ocupa días enteros',
        context: { found: technology.researchTime },
      });
    }

    const dependenciesPath = joinPath(path, 'dependencies');
    if (technology.dependencies === undefined) {
      missingField(d, file, path, 'dependencies');
    } else {
      ref(dependenciesPath, technology.dependencies, index.technologyIds, 'tecnología');
      if (technology.dependencies.includes(technology.id)) {
        d.error({
          code: 'self_dependency',
          file,
          path: dependenciesPath,
          reason: `la tecnología ${technology.id} no puede depender de sí misma`,
          context: { technology: technology.id },
        });
      }
    }

    if (technology.replaces !== undefined) {
      const replacesPath = joinPath(path, 'replaces');
      ref(replacesPath, [technology.replaces], index.technologyIds, 'tecnología');
    }

    checkTechnologyUnlocks(technology, index, d);
  }

  checkTechnologyGraphIsAcyclic(data.technologies, index, d);
}

/** Desbloqueos: `casa:2` referencia una construcción y un nivel existentes. */
function checkTechnologyUnlocks(
  technology: TechnologyDef,
  index: DataIndex,
  d: Diagnostics,
): void {
  const unlocks = readMapping(technology.raw['unlocks']);
  if (unlocks === undefined) {
    return;
  }
  const file = technology.sourceFile;
  const basePath = joinPath(technology.fieldPath, 'unlocks');

  for (const reference of readStringList(unlocks['constructions']) ?? []) {
    const [constructionId = '', levelText] = reference.split(':');
    if (!index.constructionIds.has(constructionId)) {
      unknownReference(d, file, joinPath(basePath, 'constructions'), reference, 'construcción');
      continue;
    }
    if (levelText === undefined) {
      continue; // Desbloquea la construcción completa, sin nivel concreto.
    }
    const level = Number(levelText);
    if (!Number.isInteger(level) || !hasLevel(index, constructionId, level)) {
      d.error({
        code: 'unknown_reference',
        file,
        path: joinPath(basePath, 'constructions'),
        reason: `referencia el nivel inexistente ${reference}`,
        context: { reference, construction: constructionId, level: levelText },
      });
    }
  }

  for (const reference of readStringList(unlocks['actions']) ?? []) {
    const [elementId = '', actionId] = reference.split(':');
    const actions = index.elementActions.get(elementId);
    if (actions === undefined) {
      unknownReference(d, file, joinPath(basePath, 'actions'), reference, 'elemento');
      continue;
    }
    if (actionId !== undefined && !actions.has(actionId)) {
      d.error({
        code: 'unknown_reference',
        file,
        path: joinPath(basePath, 'actions'),
        reason: `referencia la acción inexistente ${reference}`,
        context: { reference, element: elementId, action: actionId },
      });
    }
  }
}

/**
 * Requisito 11.14: el grafo de dependencias es acíclico. Recorrido en
 * profundidad con marcas de visita; al cerrar un ciclo se informa el camino
 * completo. Las dependencias a tecnologías inexistentes se ignoran aquí: ya se
 * han informado como referencia desconocida.
 */
function checkTechnologyGraphIsAcyclic(
  technologies: TechnologyDef[],
  index: DataIndex,
  d: Diagnostics,
): void {
  const byId = new Map<string, TechnologyDef>();
  for (const technology of technologies) {
    if (!byId.has(technology.id)) {
      byId.set(technology.id, technology);
    }
  }

  const settled = new Set<string>();
  const reported = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclePath = (technology: TechnologyDef | undefined): string =>
    technology === undefined ? 'technologies' : joinPath(technology.fieldPath, 'dependencies');

  const visit = (id: string): void => {
    if (settled.has(id)) {
      return;
    }
    if (onStack.has(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      const signature = normalizeCycle(cycle);
      if (!reported.has(signature)) {
        reported.add(signature);
        const technology = byId.get(id);
        d.error({
          code: 'technology_cycle',
          file: technology?.sourceFile ?? 'data/technologies.yaml',
          path: cyclePath(technology),
          reason: `el grafo de dependencias de tecnologías tiene un ciclo: ${cycle.join(' → ')}`,
          context: { cycle },
        });
      }
      return;
    }

    onStack.add(id);
    stack.push(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (index.technologyIds.has(dependency)) {
        visit(dependency);
      }
    }
    stack.pop();
    onStack.delete(id);
    settled.add(id);
  };

  for (const id of byId.keys()) {
    visit(id);
  }
}

/** Firma de un ciclo independiente del nodo por el que se ha detectado. */
function normalizeCycle(cycle: string[]): string {
  const nodes = cycle.slice(0, -1);
  const first = [...nodes].sort()[0];
  const pivot = first === undefined ? 0 : nodes.indexOf(first);
  return [...nodes.slice(pivot), ...nodes.slice(0, pivot)].join('→');
}

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

/** Esquema de los puzzles y referencias de sus efectos. */
function checkPuzzles(data: GameData, index: DataIndex, d: Diagnostics): void {
  for (const puzzle of data.puzzles) {
    const file = puzzle.sourceFile;
    const path = puzzle.fieldPath;

    if (puzzle.kind === undefined) {
      missingField(d, file, path, 'kind');
    } else if (!index.puzzleKinds.has(puzzle.kind)) {
      d.error({
        code: 'unknown_reference',
        file,
        path: joinPath(path, 'kind'),
        reason: `referencia el tipo de puzzle ${puzzle.kind}, que ningún elemento declara en puzzle_kind`,
        context: { kind: puzzle.kind, declared: [...index.puzzleKinds] },
      });
    }

    if (puzzle.mode === undefined) {
      missingField(d, file, path, 'mode');
    }

    checkPuzzleOptions(puzzle, d);
    checkEffectReferences(puzzle.raw['on_success'], file, joinPath(path, 'on_success'), index, d);
    checkEffectReferences(puzzle.raw['on_failure'], file, joinPath(path, 'on_failure'), index, d);
  }
}

/**
 * Requisito 16.18: un puzzle con opciones escritas declara al menos 2 y
 * exactamente 1 correcta. Un puzzle sin opciones debe declarar el generador que
 * las construye a partir de la semilla (Requisito 16.3).
 */
function checkPuzzleOptions(puzzle: PuzzleDef, d: Diagnostics): void {
  const file = puzzle.sourceFile;
  const path = puzzle.fieldPath;
  const options = puzzle.options;

  if (options === undefined) {
    if (readString(puzzle.raw['generator']) === undefined) {
      d.error({
        code: 'missing_field',
        file,
        path,
        reason: 'no declara options ni generator: no puede instanciarse',
      });
    }
    return;
  }

  if (options.length < 2) {
    d.error({
      code: 'invalid_options',
      file,
      path: joinPath(path, 'options'),
      reason: `debe declarar al menos 2 opciones y declara ${String(options.length)}`,
      context: { found: options.length },
    });
  }

  const correct = options.filter((option) => option.correct === true);
  if (correct.length !== 1) {
    d.error({
      code: 'invalid_options',
      file,
      path: joinPath(path, 'options'),
      reason: `debe declarar exactamente 1 opción correcta y declara ${String(correct.length)}`,
      context: { found: correct.length },
    });
  }
}

// ---------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------

/** Esquema, referencias y número de misiones de cada escenario. */
function checkScenarios(data: GameData, index: DataIndex, d: Diagnostics): void {
  const range = readMissionRange(data.rules);

  for (const scenario of data.scenarios) {
    const file = scenario.sourceFile;
    const path = scenario.fieldPath;

    checkScenarioMap(scenario, index, d);

    if (scenario.mainObjective === undefined) {
      missingField(d, file, path, 'main_objective');
    } else {
      const objective = scenario.mainObjective;
      if (objective.descKey === undefined) {
        missingField(d, file, objective.fieldPath, 'desc_key');
      }
      if (objective.condition === undefined) {
        missingField(d, file, objective.fieldPath, 'condition');
      } else {
        checkConditionReferences(objective.condition, file, objective.fieldPath, index, d);
      }
      if (objective.sustainedDays !== undefined && objective.sustainedDays < 1) {
        d.error({
          code: 'invalid_value',
          file,
          path: joinPath(objective.fieldPath, 'sustained_days'),
          reason: 'debe ser mayor o igual que 1',
          context: { found: objective.sustainedDays },
        });
      }
    }

    if (scenario.missions === undefined) {
      missingField(d, file, path, 'missions');
      continue;
    }

    for (const mission of scenario.missions) {
      checkMission(mission, file, index, d);
    }

    // Requisito 15.7: advertencia, nunca error, si el número de misiones sale
    // del rango recomendado.
    const count = scenario.missions.length;
    if (count < range.min || count > range.max) {
      d.warn({
        code: 'mission_count_out_of_range',
        file,
        path: joinPath(path, 'missions'),
        reason: `el escenario ${scenario.id} declara ${String(count)} misiones intermedias, fuera del rango recomendado de ${String(range.min)} a ${String(range.max)}`,
        context: { scenario: scenario.id, count, min: range.min, max: range.max },
      });
    }
  }
}

/** Esquema y referencias del bloque `map` del escenario. */
function checkScenarioMap(scenario: ScenarioDef, index: DataIndex, d: Diagnostics): void {
  const file = scenario.sourceFile;
  const path = scenario.fieldPath;
  const map = scenario.map;
  const ref = referenceCheck(d, file);

  if (map === undefined) {
    missingField(d, file, path, 'map');
    return;
  }

  if (map.radius === undefined) {
    missingField(d, file, map.fieldPath, 'radius');
  } else if (map.radius < 1) {
    d.error({
      code: 'invalid_value',
      file,
      path: joinPath(map.fieldPath, 'radius'),
      reason: 'debe ser mayor o igual que 1',
      context: { found: map.radius },
    });
  }

  if (map.terrainWeights === undefined) {
    missingField(d, file, map.fieldPath, 'terrain_weights');
  } else {
    const weightsPath = joinPath(map.fieldPath, 'terrain_weights');
    ref(weightsPath, Object.keys(map.terrainWeights), index.terrainIds, 'terreno');
    const weights = Object.values(map.terrainWeights);
    if (weights.some((weight) => weight < 0)) {
      d.error({
        code: 'invalid_value',
        file,
        path: weightsPath,
        reason: 'ningún peso de terreno puede ser negativo',
        context: { weights: map.terrainWeights },
      });
    } else if (weights.reduce((sum, weight) => sum + weight, 0) <= 0) {
      d.error({
        code: 'invalid_value',
        file,
        path: weightsPath,
        reason: 'la suma de los pesos de terreno debe ser mayor que 0',
        context: { weights: map.terrainWeights },
      });
    }
  }

  if (map.elementDensity !== undefined) {
    const densityPath = joinPath(map.fieldPath, 'element_density');
    ref(densityPath, Object.keys(map.elementDensity), index.elementIds, 'elemento');
    for (const [elementId, density] of Object.entries(map.elementDensity)) {
      if (density < 0) {
        d.error({
          code: 'invalid_value',
          file,
          path: joinPath(densityPath, elementId),
          reason: 'no puede ser negativa',
          context: { found: density },
        });
      }
    }
  }

  const cityConstruction = readString(map.raw['city_construction_id']);
  if (cityConstruction !== undefined) {
    const cityPath = joinPath(map.fieldPath, 'city_construction_id');
    ref(cityPath, [cityConstruction], index.constructionIds, 'construcción');
  }

  if (map.constraints === undefined) {
    missingField(d, file, map.fieldPath, 'constraints');
    return;
  }

  // Requisito 1.8: el generador cuenta al menos un candidato antes de abortar.
  const attemptsPath = joinPath(joinPath(map.fieldPath, 'constraints'), 'intentos_maximos');
  const attempts = readNumber(map.constraints['intentos_maximos']);
  if (map.constraints['intentos_maximos'] === undefined) {
    d.error({
      code: 'missing_field',
      file,
      path: attemptsPath,
      reason: 'no se declara',
    });
  } else if (attempts === undefined || attempts < 1) {
    d.error({
      code: 'invalid_value',
      file,
      path: attemptsPath,
      reason: 'debe ser un número mayor o igual que 1',
      context: { found: map.constraints['intentos_maximos'] },
    });
  }
}

/** Esquema y referencias de una misión intermedia. */
function checkMission(
  mission: MissionDef,
  file: string,
  index: DataIndex,
  d: Diagnostics,
): void {
  if (mission.id === undefined) {
    missingField(d, file, mission.fieldPath, 'id');
  }
  if (mission.descKey === undefined) {
    missingField(d, file, mission.fieldPath, 'desc_key');
  }
  if (mission.condition === undefined) {
    missingField(d, file, mission.fieldPath, 'condition');
    return;
  }
  if (readString(mission.condition['type']) === undefined) {
    missingField(d, file, joinPath(mission.fieldPath, 'condition'), 'type');
  }
  checkConditionReferences(mission.condition, file, mission.fieldPath, index, d);
}

/**
 * Referencias de la condición de un objetivo o de una misión. No se impone el
 * vocabulario de `type`: el Sistema_De_Objetivos es quien lo interpreta. Aquí
 * solo se comprueba que los identificadores citados existan (Requisito 20.3).
 */
function checkConditionReferences(
  condition: Record<string, unknown>,
  file: string,
  basePath: string,
  index: DataIndex,
  d: Diagnostics,
): void {
  const path = joinPath(basePath, 'condition');
  const ref = referenceCheck(d, file);

  const construction = readString(condition['construction']);
  if (construction !== undefined) {
    ref(joinPath(path, 'construction'), [construction], index.constructionIds, 'construcción');
    const minLevel = readNumber(condition['min_level']);
    if (minLevel !== undefined && !hasLevel(index, construction, minLevel)) {
      d.error({
        code: 'unknown_reference',
        file,
        path: joinPath(path, 'min_level'),
        reason: `referencia el nivel ${String(minLevel)}, que ${construction} no declara`,
        context: { construction, level: minLevel },
      });
    }
  }

  const element = readString(condition['element']);
  if (element !== undefined) {
    ref(joinPath(path, 'element'), [element], index.elementIds, 'elemento');
  }

  const technologies = readStringList(condition['technologies']);
  ref(joinPath(path, 'technologies'), technologies, index.technologyIds, 'tecnología');
}

// ---------------------------------------------------------------------------
// Efectos declarados en puzzles y tecnologías
// ---------------------------------------------------------------------------

/**
 * Referencias de los efectos de un bloque `on_success` / `on_failure`: los
 * efectos de un puzzle deben apuntar a datos válidos (tabla de validación del
 * documento de diseño).
 */
function checkEffectReferences(
  block: unknown,
  file: string,
  basePath: string,
  index: DataIndex,
  d: Diagnostics,
): void {
  const mapping = readMapping(block);
  if (mapping === undefined) {
    return;
  }

  const effectsPath = joinPath(basePath, 'global_effects');
  const ref = referenceCheck(d, file);

  readMappingList(mapping['global_effects']).forEach((effect, position) => {
    const effectPath = `${effectsPath}[${String(position)}]`;
    const construction = readString(effect['target_construction']);
    if (construction !== undefined) {
      const targetPath = joinPath(effectPath, 'target_construction');
      ref(targetPath, [construction], index.constructionIds, 'construcción');

      const modifier = readString(effect['target_modifier']);
      if (modifier !== undefined && !hasModifier(index, construction, modifier)) {
        d.error({
          code: 'unknown_reference',
          file,
          path: joinPath(effectPath, 'target_modifier'),
          reason: `referencia el modificador ${modifier}, que ${construction} no declara`,
          context: { construction, modifier },
        });
      }
    }
    ref(
      joinPath(effectPath, 'target_element_categories'),
      readStringList(effect['target_element_categories']),
      index.elementCategories,
      'categoría de elemento',
    );
    ref(
      joinPath(effectPath, 'target_tags'),
      readStringList(effect['target_tags']),
      index.constructionTags,
      'etiqueta de construcción',
    );
  });
}

// ---------------------------------------------------------------------------
// Catálogos i18n
// ---------------------------------------------------------------------------

/**
 * Requisito 22.4: toda clave de nombre o de descripción declarada en los datos
 * existe en el catálogo del idioma por defecto. Se recorre cada definición
 * completa, de modo que las claves de campos que el cargador no interpreta
 * (`text_key`, `message_key`, `option_text_key`, …) también se comprueben sin
 * cambios en el código al añadir contenido nuevo (Requisito 20.7).
 *
 * Requisito 22.8: las claves del catálogo por defecto ausentes en otro idioma
 * cargado se informan como advertencia.
 */
function checkI18nKeys(data: GameData, d: Diagnostics): void {
  const locale = readDefaultLocale(data.rules);
  const catalog = data.locales.find((candidate) => candidate.locale === locale);

  if (catalog === undefined) {
    d.error({
      code: 'missing_locale_catalog',
      file: data.rules.sourceFiles[data.rules.sourceFiles.length - 1] ?? 'data/rules.yaml',
      path: 'i18n.idioma_por_defecto',
      reason: `no se ha cargado el catálogo de textos del idioma por defecto ${locale}`,
      context: { locale, loaded: data.locales.map((entry) => entry.locale) },
    });
    return;
  }

  for (const definition of allDefinitions(data)) {
    const keys = new Map<string, string>();
    collectI18nKeys(definition.raw, definition.fieldPath, keys);
    for (const [key, path] of keys) {
      if (!catalog.strings.has(key)) {
        d.error({
          code: 'missing_i18n_key',
          file: definition.sourceFile,
          path,
          reason: `referencia la clave ${key}, ausente en el catálogo de ${locale}`,
          context: { key, locale },
        });
      }
    }
  }

  checkLocaleCompleteness(data.locales, catalog, d);
}

/** Requisito 22.8: claves del idioma por defecto ausentes en otro catálogo. */
function checkLocaleCompleteness(
  locales: I18nCatalog[],
  reference: I18nCatalog,
  d: Diagnostics,
): void {
  for (const catalog of locales) {
    if (catalog.locale === reference.locale) {
      continue;
    }
    const missing = [...reference.strings.keys()].filter((key) => !catalog.strings.has(key));
    for (const key of missing) {
      d.warn({
        code: 'incomplete_locale_catalog',
        file: catalog.sourceFiles[0] ?? `data/i18n/${catalog.locale}.yaml`,
        path: `strings.${key}`,
        reason: `el catálogo de ${catalog.locale} no declara la clave ${key}, presente en el catálogo de ${reference.locale}`,
        context: { locale: catalog.locale, key, reference: reference.locale },
      });
    }
  }
}

/**
 * Recoge las claves i18n de una definición: el valor de todo campo cuyo nombre
 * acaba en `_key`, con la ruta en que aparece para el diagnóstico.
 */
function collectI18nKeys(node: unknown, path: string, found: Map<string, string>): void {
  if (Array.isArray(node)) {
    node.forEach((item, position) => {
      collectI18nKeys(item, `${path}[${String(position)}]`, found);
    });
    return;
  }
  if (!isMapping(node)) {
    return;
  }
  for (const [field, value] of Object.entries(node)) {
    const fieldPath = joinPath(path, field);
    if (field.endsWith('_key')) {
      const key = readString(value);
      if (key !== undefined && !found.has(key)) {
        found.set(key, fieldPath);
      }
      continue;
    }
    collectI18nKeys(value, fieldPath, found);
  }
}

/** Todas las definiciones de contenido cargadas, sin distinguir categoría. */
function allDefinitions(data: GameData): {
  sourceFile: string;
  fieldPath: string;
  raw: Record<string, unknown>;
}[] {
  return [
    ...data.terrains,
    ...data.elements,
    ...data.constructions,
    ...data.technologies,
    ...data.puzzles,
    ...data.scenarios,
  ];
}

// ---------------------------------------------------------------------------
// Diagnósticos reutilizados
// ---------------------------------------------------------------------------

/** Exige la clave i18n del nombre, que toda definición con nombre declara. */
function requireNameKey(
  d: Diagnostics,
  file: string,
  path: string,
  nameKey: string | undefined,
): void {
  if (nameKey === undefined) {
    missingField(d, file, path, 'name_key');
  }
}

/** Registra un campo obligatorio ausente. */
function missingField(d: Diagnostics, file: string, path: string, field: string): void {
  d.error({
    code: 'missing_field',
    file,
    path: joinPath(path, field),
    reason: 'no se declara y es obligatorio',
    context: { field },
  });
}

/** Registra una colección obligatoria declarada vacía. */
function emptyField(d: Diagnostics, file: string, path: string, expected: string): void {
  d.error({
    code: 'empty_field',
    file,
    path,
    reason: `debe declarar al menos ${expected}`,
  });
}

/**
 * Comprueba que los identificadores referenciados en un campo existan. `ids`
 * admite `undefined` para poder invocarla sobre campos opcionales sin
 * comprobarlos antes.
 */
type ReferenceCheck = (
  path: string,
  ids: readonly string[] | undefined,
  known: ReadonlySet<string>,
  kind: string,
) => void;

/** Devuelve el comprobador de referencias de un fichero concreto. */
function referenceCheck(d: Diagnostics, file: string): ReferenceCheck {
  return (path, ids, known, kind) => {
    for (const id of ids ?? []) {
      if (!known.has(id)) {
        unknownReference(d, file, path, id, kind);
      }
    }
  };
}

/** Registra una referencia a un identificador inexistente (Requisito 20.4). */
function unknownReference(
  d: Diagnostics,
  file: string,
  path: string,
  reference: string,
  kind: string,
): void {
  d.error({
    code: 'unknown_reference',
    file,
    path,
    reason: `referencia el ${kind} inexistente ${reference}`,
    context: { kind, id: reference },
  });
}

// ---------------------------------------------------------------------------
// Lectura de las reglas globales
// ---------------------------------------------------------------------------

/** Lee un número de un grupo de reglas globales. */
function readRuleNumber(rules: RulesData, group: string, field: string): number | undefined {
  const values = rules.values[group];
  return isMapping(values) ? readNumber(values[field]) : undefined;
}

/** Rango recomendado de misiones por escenario (Requisito 15.7). */
function readMissionRange(rules: RulesData): { min: number; max: number } {
  return {
    min: readRuleNumber(rules, 'balance', 'misiones_minimas') ?? DEFAULT_MISSION_RANGE.min,
    max: readRuleNumber(rules, 'balance', 'misiones_maximas') ?? DEFAULT_MISSION_RANGE.max,
  };
}

/** Pesos por recurso usados para comparar producciones y costes (7.14). */
function readResourceWeights(rules: RulesData): Record<string, number> {
  const balance = rules.values['balance'];
  const declared = isMapping(balance) ? readMapping(balance['pesos_recurso']) : undefined;
  if (declared === undefined) {
    return {};
  }
  const weights: Record<string, number> = {};
  for (const [resource, value] of Object.entries(declared)) {
    const weight = readNumber(value);
    if (weight !== undefined) {
      weights[resource] = weight;
    }
  }
  return weights;
}

/** Idioma por defecto declarado en las reglas globales (Requisito 22.2). */
function readDefaultLocale(rules: RulesData): string {
  const i18n = rules.values['i18n'];
  const declared = isMapping(i18n) ? readString(i18n['idioma_por_defecto']) : undefined;
  return declared ?? DEFAULT_LOCALE;
}

// ---------------------------------------------------------------------------
// Utilidades de lectura de valores sin interpretar
// ---------------------------------------------------------------------------

/** Un mapa YAML: objeto plano, nunca una lista. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMapping(value: unknown): Record<string, unknown> | undefined {
  return isMapping(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Lee una lista de cadenas; devuelve `undefined` si el campo no es una lista. */
function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Lee una lista de mapas, ignorando las entradas que no lo son. */
function readMappingList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isMapping);
}

/** Compone la ruta de un campo dentro del fichero. */
function joinPath(base: string, field: string): string {
  return base.length === 0 ? field : `${base}.${field}`;
}
