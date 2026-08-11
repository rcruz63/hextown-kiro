/**
 * Cargador_De_Datos: lee los ficheros YAML de contenido y de reglas globales.
 *
 * Responsabilidades (Requisitos 20.1, 20.2, 20.3, 20.11, 22.3):
 *
 * - Parsear cada fichero YAML y clasificarlo por las secciones que declara
 *   (terrenos, elementos, construcciones, tecnologías, puzzles, escenarios,
 *   reglas globales y catálogos i18n).
 * - Aplicar a cada definición los valores por defecto declarados en las reglas
 *   globales (`rules.defaults.<categoría>`), además de los valores por defecto
 *   exigidos por la especificación: `produce_durante_mejora` de
 *   `rules.upgrades` (Requisito 7.8) y `sustained_days` igual a 1 en el
 *   objetivo principal (Requisito 15.1).
 * - Interpretar los campos de nombre y descripción como claves del catálogo
 *   i18n, nunca como cadenas literales (Requisito 22.3).
 * - Devolver `Result<GameData, GameError[]>`: nunca lanza excepciones al flujo
 *   superior y acumula todos los errores encontrados, cada uno con fichero,
 *   ruta del campo y motivo (Requisitos 20.4, 20.11).
 *
 * Reparto de responsabilidades con el Validador_De_Datos: el cargador solo
 * rechaza lo que impide construir la estructura (YAML inválido, documento que
 * no es un mapa, colección con forma incorrecta, definición sin `id`, campo
 * interpretado con el tipo equivocado). La obligatoriedad de campos, las
 * referencias cruzadas, los identificadores duplicados y las claves i18n
 * ausentes las comprueba el Validador_De_Datos sobre el `GameData` cargado, por
 * lo que aquí se conservan el orden de declaración, el fichero de origen y la
 * ruta de cada definición, incluidas las que repiten identificador.
 */
import { YAMLException, load } from 'js-yaml';
import { err, ok } from '../core/result.ts';
import type { GameError, Result } from '../core/result.ts';

// ---------------------------------------------------------------------------
// Entrada del cargador
// ---------------------------------------------------------------------------

/** Fichero de datos a cargar: su ruta (para diagnósticos) y su contenido YAML. */
export interface DataSource {
  /** Ruta del fichero, e.g. `data/terrains.yaml`. */
  path: string;
  /** Contenido YAML sin parsear. */
  content: string;
}

// ---------------------------------------------------------------------------
// Definiciones de contenido
// ---------------------------------------------------------------------------

/**
 * Clave del catálogo i18n (e.g. `terrain.prado.name`). Los datos declaran
 * claves, no textos: el Gestor_De_Textos las resuelve (Requisitos 22.1, 22.3).
 */
export type I18nKey = string;

/** Campos comunes a toda definición de contenido. */
export interface DefinitionBase {
  id: string;
  /** Clave i18n del nombre, tal como se declara en `name_key`. */
  nameKey?: I18nKey;
  /** Clave i18n de la descripción, tal como se declara en `desc_key`. */
  descKey?: I18nKey;
  /** Fichero en que se declara, para los diagnósticos del Validador_De_Datos. */
  sourceFile: string;
  /** Ruta del campo dentro del fichero, e.g. `elements[3]`. */
  fieldPath: string;
  /**
   * Definición completa con los valores por defecto ya aplicados. Contiene
   * también los campos que el cargador no interpreta, de modo que añadir
   * contenido nuevo no exige cambios en el código (Requisito 20.7) y el
   * Serializador_De_Datos puede reescribir el dato sin pérdidas.
   */
  raw: Record<string, unknown>;
}

/** Terreno declarado en `terrains`. */
export type TerrainDef = DefinitionBase;

/** Elemento del mapa declarado en `elements`. */
export interface ElementDef extends DefinitionBase {
  category?: string;
  allowedTerrains?: string[];
}

/** Nivel de una construcción, declarado en `constructions[].levels`. */
export interface ConstructionLevelDef {
  level?: number;
  /** Días de obra del nivel. */
  buildTime?: number;
  /** Coste del nivel por recurso. */
  cost?: Record<string, number>;
  /** Trabajadores empleados por el nivel. */
  employs?: number;
  /** Tecnologías exigidas por el nivel. */
  requiresTech?: string[];
  nameKey?: I18nKey;
  descKey?: I18nKey;
  fieldPath: string;
  raw: Record<string, unknown>;
}

/** Construcción declarada en `constructions`. */
export interface ConstructionDef extends DefinitionBase {
  allowedTerrains?: string[];
  levels?: ConstructionLevelDef[];
  /** Valor efectivo tras aplicar `rules.upgrades.produce_durante_mejora`. */
  produceDuringUpgrade?: boolean;
}

/** Tecnología declarada en `technologies`. */
export interface TechnologyDef extends DefinitionBase {
  branch?: string;
  tier?: number;
  /** Coste en ciencia. */
  cost?: number;
  /** Días de investigación. */
  researchTime?: number;
  dependencies?: string[];
  /** Tecnología que esta reemplaza (Requisito 11.9). */
  replaces?: string;
}

/** Opción de un puzzle, declarada en `puzzles[].options`. */
export interface PuzzleOptionDef {
  /** Clave i18n del texto de la opción. */
  textKey?: I18nKey;
  correct?: boolean;
  fieldPath: string;
  raw: Record<string, unknown>;
}

/** Puzzle declarado en `puzzles`. */
export interface PuzzleDef extends DefinitionBase {
  /** Tipo de elemento al que se asigna: `settlement` o `mystery`. */
  kind?: string;
  /** Modo de instanciación: `fixed` o `generated`. */
  mode?: string;
  options?: PuzzleOptionDef[];
}

/** Objetivo principal o misión intermedia de un escenario. */
export interface ObjectiveDef {
  /** Clave i18n de la descripción del objetivo. */
  descKey?: I18nKey;
  /** Condición evaluable en el Fin_De_Dia, tal como se declara. */
  condition?: Record<string, unknown>;
  /** Días consecutivos exigidos; 1 cuando la condición no lo declara. */
  sustainedDays?: number;
  fieldPath: string;
  raw: Record<string, unknown>;
}

/** Misión intermedia declarada en `scenarios[].missions`. */
export interface MissionDef {
  id?: string;
  descKey?: I18nKey;
  condition?: Record<string, unknown>;
  fieldPath: string;
  raw: Record<string, unknown>;
}

/** Bloque `map` de un escenario. */
export interface ScenarioMapDef {
  radius?: number;
  terrainWeights?: Record<string, number>;
  elementDensity?: Record<string, number>;
  constraints?: Record<string, unknown>;
  fieldPath: string;
  raw: Record<string, unknown>;
}

/** Escenario declarado en `scenarios` o como documento único. */
export interface ScenarioDef extends DefinitionBase {
  map?: ScenarioMapDef;
  startingResources?: Record<string, number>;
  mainObjective?: ObjectiveDef;
  missions?: MissionDef[];
}

// ---------------------------------------------------------------------------
// Reglas globales y catálogos i18n
// ---------------------------------------------------------------------------

/** Reglas globales: el contenido de `rules.yaml` sin interpretar. */
export interface RulesData {
  /**
   * Grupos de reglas tal como se declaran (`day`, `food`, `combat`, …). El
   * cargador no impone su esquema: lo comprueba el Validador_De_Datos.
   */
  values: Record<string, unknown>;
  /**
   * Valores por defecto por categoría (`rules.defaults`), ya aplicados a las
   * definiciones cargadas (Requisito 20.2). Se conservan para el
   * Serializador_De_Datos y para los diagnósticos.
   */
  defaults: Record<string, Record<string, unknown>>;
  /** Ficheros que aportan reglas, en orden de carga. */
  sourceFiles: string[];
}

/** Formato numérico declarado por un catálogo i18n. */
export interface NumberFormat {
  decimalSeparator: string;
  thousandsSeparator: string;
}

/** Catálogo de textos de un idioma. */
export interface I18nCatalog {
  locale: string;
  numberFormat?: NumberFormat;
  /** Identificador de la forma plural declarada, e.g. `spanish`. */
  pluralRules?: string;
  /** Textos indexados por clave de catálogo. */
  strings: Map<string, string>;
  /** Ficheros que aportan textos a este idioma, en orden de carga. */
  sourceFiles: string[];
}

// ---------------------------------------------------------------------------
// Resultado del cargador
// ---------------------------------------------------------------------------

/**
 * Contenido y reglas cargados.
 *
 * Las colecciones son listas en orden de declaración: el Generador_De_Mapa
 * recorre los elementos en ese orden (Requisito 1.4) y el Validador_De_Datos
 * necesita ver las definiciones repetidas para informar de identificadores
 * duplicados (Requisito 20.5).
 */
export interface GameData {
  /** Identificador de la versión de los datos cargados, usado al persistir. */
  dataVersion: string;
  rules: RulesData;
  terrains: TerrainDef[];
  elements: ElementDef[];
  constructions: ConstructionDef[];
  technologies: TechnologyDef[];
  puzzles: PuzzleDef[];
  scenarios: ScenarioDef[];
  /** Catálogos i18n, uno por idioma. */
  locales: I18nCatalog[];
}

// ---------------------------------------------------------------------------
// Claves reconocidas
// ---------------------------------------------------------------------------

/** Colecciones de contenido reconocidas como claves de primer nivel. */
const COLLECTION_KEYS = [
  'terrains',
  'elements',
  'constructions',
  'technologies',
  'puzzles',
  'scenarios',
] as const;

/**
 * Grupos que identifican un documento de reglas globales. Basta uno para que el
 * documento se interprete como `rules.yaml`.
 */
const RULE_GROUP_KEYS = [
  'defaults',
  'day',
  'food',
  'disease',
  'combat',
  'exploration',
  'upgrades',
  'demolition',
  'research',
  'balance',
  'render',
  'respawn',
  'expansion',
  'data_version',
] as const;

/** Campos admitidos para la clave i18n del nombre, en orden de preferencia. */
const NAME_KEY_FIELDS = ['name_key', 'name'] as const;

/** Campos admitidos para la clave i18n de la descripción. */
const DESC_KEY_FIELDS = ['desc_key', 'description_key', 'description', 'desc'] as const;

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Carga todos los ficheros de datos.
 *
 * Devuelve `ok(GameData)` cuando todos los documentos se han podido
 * interpretar, o `err(GameError[])` con un error por problema encontrado. No
 * lanza excepciones: los fallos de sintaxis YAML se traducen en errores con la
 * posición del problema (Requisito 20.11).
 */
export function loadAll(sources: DataSource[]): Result<GameData, GameError[]> {
  const errors: GameError[] = [];
  const documents: ParsedDocument[] = [];

  for (const source of sources) {
    const parsed = parseDocument(source, errors);
    if (parsed !== undefined) {
      documents.push(parsed);
    }
  }

  const rules = collectRules(documents, errors);
  const data: GameData = {
    dataVersion: computeDataVersion(sources, rules),
    rules,
    terrains: [],
    elements: [],
    constructions: [],
    technologies: [],
    puzzles: [],
    scenarios: [],
    locales: [],
  };

  for (const document of documents) {
    readSections(document, data, rules, errors);
  }

  return errors.length > 0 ? err(errors) : ok(data);
}

// ---------------------------------------------------------------------------
// Parseo y clasificación de documentos
// ---------------------------------------------------------------------------

/** Documento YAML ya parseado y comprobado como mapa de primer nivel. */
interface ParsedDocument {
  file: string;
  mapping: Record<string, unknown>;
}

/** Parsea un fichero y comprueba que su raíz es un mapa. */
function parseDocument(source: DataSource, errors: GameError[]): ParsedDocument | undefined {
  let parsed: unknown;
  try {
    parsed = load(source.content, { filename: source.path });
  } catch (cause) {
    errors.push(yamlError(source.path, cause));
    return undefined;
  }

  if (parsed === undefined || parsed === null) {
    errors.push({
      code: 'empty_document',
      message: `${source.path}: el documento está vacío`,
      context: { file: source.path },
    });
    return undefined;
  }
  if (!isMapping(parsed)) {
    errors.push({
      code: 'invalid_document',
      message: `${source.path}: la raíz del documento debe ser un mapa de claves`,
      context: { file: source.path, found: describeType(parsed) },
    });
    return undefined;
  }
  return { file: source.path, mapping: parsed };
}

/** Traduce una excepción de js-yaml en un `GameError` con posición. */
function yamlError(file: string, cause: unknown): GameError {
  if (cause instanceof YAMLException) {
    const line = cause.mark?.line;
    const column = cause.mark?.column;
    const position =
      line === undefined ? '' : ` (línea ${String(line + 1)}, columna ${String((column ?? 0) + 1)})`;
    return {
      code: 'yaml_parse_error',
      message: `${file}: YAML inválido${position}: ${cause.reason}`,
      context: {
        file,
        reason: cause.reason,
        // js-yaml cuenta líneas y columnas desde 0; se informa desde 1.
        line: line === undefined ? undefined : line + 1,
        column: column === undefined ? undefined : column + 1,
        snippet: cause.mark?.snippet,
      },
    };
  }
  return {
    code: 'yaml_parse_error',
    message: `${file}: YAML inválido: ${describeError(cause)}`,
    context: { file, reason: describeError(cause) },
  };
}

/**
 * Interpreta las secciones que declara un documento. Un mismo fichero puede
 * declarar varias colecciones; si no declara ninguna reconocible, se rechaza
 * indicando sus claves de primer nivel.
 */
function readSections(
  document: ParsedDocument,
  data: GameData,
  rules: RulesData,
  errors: GameError[],
): void {
  let recognized = false;

  if (isI18nDocument(document.mapping)) {
    readI18nCatalog(document, data, errors);
    recognized = true;
  }

  for (const key of COLLECTION_KEYS) {
    if (document.mapping[key] === undefined) {
      continue;
    }
    recognized = true;
    const definitions = readCollection(document, key, errors);
    for (const definition of definitions) {
      appendDefinition(key, definition, document.file, data, rules, errors);
    }
  }

  const singleScenario = readSingleScenarioDocument(document, errors);
  if (singleScenario !== undefined) {
    recognized = true;
    appendDefinition('scenarios', singleScenario, document.file, data, rules, errors);
  }

  if (isRulesDocument(document.mapping)) {
    // Las reglas ya se han recogido antes de interpretar las definiciones.
    recognized = true;
  }

  if (!recognized) {
    errors.push({
      code: 'unrecognized_data_file',
      message: `${document.file}: el fichero no declara ninguna sección de datos reconocida`,
      context: { file: document.file, topLevelKeys: Object.keys(document.mapping) },
    });
  }
}

/** Un documento es un catálogo i18n cuando declara `locale` o `strings`. */
function isI18nDocument(mapping: Record<string, unknown>): boolean {
  return mapping['locale'] !== undefined || mapping['strings'] !== undefined;
}

/** Un documento es de reglas cuando declara `rules` o algún grupo de reglas. */
function isRulesDocument(mapping: Record<string, unknown>): boolean {
  if (isMapping(mapping['rules'])) {
    return true;
  }
  return RULE_GROUP_KEYS.some((key) => mapping[key] !== undefined);
}

// ---------------------------------------------------------------------------
// Reglas globales
// ---------------------------------------------------------------------------

/**
 * Reúne las reglas globales de todos los documentos que las declaran. Se leen
 * antes que las definiciones porque aportan los valores por defecto
 * (Requisito 20.2). Varios ficheros pueden aportar grupos distintos; ante el
 * mismo grupo, prevalece el último cargado.
 */
function collectRules(documents: ParsedDocument[], errors: GameError[]): RulesData {
  const values: Record<string, unknown> = {};
  const sourceFiles: string[] = [];

  for (const document of documents) {
    if (!isRulesDocument(document.mapping)) {
      continue;
    }
    const nested = document.mapping['rules'];
    const groups = isMapping(nested) ? nested : document.mapping;
    for (const [key, value] of Object.entries(groups)) {
      values[key] = value;
    }
    sourceFiles.push(document.file);
  }

  if (sourceFiles.length === 0) {
    errors.push({
      code: 'missing_rules',
      message:
        'No se ha cargado ningún fichero de reglas globales: sin él no pueden aplicarse los valores por defecto',
      context: { expected: 'data/rules.yaml' },
    });
  }

  return { values, defaults: readDefaults(values, sourceFiles, errors), sourceFiles };
}

/** Lee `rules.defaults` como un mapa de categoría a valores por defecto. */
function readDefaults(
  values: Record<string, unknown>,
  sourceFiles: string[],
  errors: GameError[],
): Record<string, Record<string, unknown>> {
  const declared = values['defaults'];
  if (declared === undefined) {
    return {};
  }
  const file = sourceFiles[sourceFiles.length - 1] ?? 'rules';
  if (!isMapping(declared)) {
    errors.push({
      code: 'invalid_field',
      message: `${file}: defaults debe ser un mapa de categorías`,
      context: { file, path: 'defaults', found: describeType(declared) },
    });
    return {};
  }

  const defaults: Record<string, Record<string, unknown>> = {};
  for (const [category, group] of Object.entries(declared)) {
    if (!isMapping(group)) {
      errors.push({
        code: 'invalid_field',
        message: `${file}: defaults.${category} debe ser un mapa de campos`,
        context: { file, path: `defaults.${category}`, found: describeType(group) },
      });
      continue;
    }
    defaults[category] = group;
  }
  return defaults;
}

/**
 * Identificador de la versión de los datos cargados (`dataVersion` del
 * guardado, Requisito 21.3). Se toma de `rules.data_version` cuando se declara
 * y, si no, se calcula como hash FNV-1a de los ficheros cargados, ordenados por
 * ruta para que el identificador no dependa del orden de carga.
 */
function computeDataVersion(sources: DataSource[], rules: RulesData): string {
  const declared = rules.values['data_version'];
  if (typeof declared === 'string' && declared.length > 0) {
    return declared;
  }
  const digest = [...sources]
    .map((source) => `${source.path}\n${source.content}`)
    .sort()
    .join('\n\u0000\n');
  return fnv1a32(digest).toString(16).padStart(8, '0');
}

/** Hash FNV-1a de 32 bits, determinista en cualquier motor de JavaScript. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Colecciones de definiciones
// ---------------------------------------------------------------------------

/** Definición sin interpretar, con su ruta dentro del fichero. */
interface RawDefinition {
  mapping: Record<string, unknown>;
  fieldPath: string;
}

/**
 * Normaliza una colección declarada como lista (`- id: prado`) o como mapa
 * (`prado: {...}`) a una lista de definiciones en orden de declaración.
 */
function readCollection(
  document: ParsedDocument,
  key: string,
  errors: GameError[],
): RawDefinition[] {
  const container = document.mapping[key];
  const definitions: RawDefinition[] = [];

  if (Array.isArray(container)) {
    container.forEach((entry, index) => {
      const fieldPath = `${key}[${String(index)}]`;
      if (!isMapping(entry)) {
        errors.push({
          code: 'invalid_definition',
          message: `${document.file}: ${fieldPath} debe ser un mapa de campos`,
          context: { file: document.file, path: fieldPath, found: describeType(entry) },
        });
        return;
      }
      definitions.push({ mapping: entry, fieldPath });
    });
    return definitions;
  }

  if (isMapping(container)) {
    for (const [id, entry] of Object.entries(container)) {
      const fieldPath = `${key}.${id}`;
      if (!isMapping(entry)) {
        errors.push({
          code: 'invalid_definition',
          message: `${document.file}: ${fieldPath} debe ser un mapa de campos`,
          context: { file: document.file, path: fieldPath, found: describeType(entry) },
        });
        continue;
      }
      // La clave del mapa actúa como identificador cuando la definición no lo
      // declara explícitamente.
      definitions.push({ mapping: entry['id'] === undefined ? { id, ...entry } : entry, fieldPath });
    }
    return definitions;
  }

  errors.push({
    code: 'invalid_collection',
    message: `${document.file}: ${key} debe ser una lista o un mapa de definiciones`,
    context: { file: document.file, path: key, found: describeType(container) },
  });
  return definitions;
}

/**
 * Reconoce un escenario declarado como documento único (`scenarios/*.yaml` con
 * `id` y `map` en la raíz, o con un bloque `scenario`).
 */
function readSingleScenarioDocument(
  document: ParsedDocument,
  errors: GameError[],
): RawDefinition | undefined {
  const nested = document.mapping['scenario'];
  if (nested !== undefined) {
    if (!isMapping(nested)) {
      errors.push({
        code: 'invalid_definition',
        message: `${document.file}: scenario debe ser un mapa de campos`,
        context: { file: document.file, path: 'scenario', found: describeType(nested) },
      });
      return undefined;
    }
    return { mapping: nested, fieldPath: 'scenario' };
  }
  // Escenario declarado en la raíz del fichero (`scenarios/valle_inicial.yaml`).
  // El bloque `map` lo distingue de los demás ficheros de datos; el `id` se
  // exige después, para que su ausencia se informe como tal.
  if (
    isMapping(document.mapping['map']) &&
    !isI18nDocument(document.mapping) &&
    !isRulesDocument(document.mapping) &&
    !COLLECTION_KEYS.some((key) => document.mapping[key] !== undefined)
  ) {
    return { mapping: document.mapping, fieldPath: '' };
  }
  return undefined;
}

/** Construye la definición de la categoría indicada y la añade a `GameData`. */
function appendDefinition(
  category: (typeof COLLECTION_KEYS)[number],
  definition: RawDefinition,
  file: string,
  data: GameData,
  rules: RulesData,
  errors: GameError[],
): void {
  const ctx: ReadContext = { file, path: definition.fieldPath, errors };
  const raw = withDefaults(definition.mapping, rules.defaults[category]);
  const id = readRequiredId(ctx, raw);
  if (id === undefined) {
    return;
  }
  const base: DefinitionBase = {
    id,
    nameKey: readI18nKey(ctx, raw, NAME_KEY_FIELDS),
    descKey: readI18nKey(ctx, raw, DESC_KEY_FIELDS),
    sourceFile: file,
    fieldPath: definition.fieldPath,
    raw,
  };

  switch (category) {
    case 'terrains':
      data.terrains.push(base);
      return;
    case 'elements':
      data.elements.push({
        ...base,
        category: readString(ctx, raw, 'category'),
        allowedTerrains: readStringArray(ctx, raw, 'allowed_terrains'),
      });
      return;
    case 'constructions':
      data.constructions.push(readConstruction(ctx, base, raw, rules));
      return;
    case 'technologies':
      data.technologies.push({
        ...base,
        branch: readString(ctx, raw, 'branch'),
        tier: readNumber(ctx, raw, 'tier'),
        cost: readNumber(ctx, raw, 'cost'),
        researchTime: readNumber(ctx, raw, 'research_time'),
        dependencies: readStringArray(ctx, raw, 'dependencies'),
        replaces: readString(ctx, raw, 'replaces'),
      });
      return;
    case 'puzzles':
      data.puzzles.push({
        ...base,
        kind: readString(ctx, raw, 'kind'),
        mode: readString(ctx, raw, 'mode'),
        options: readPuzzleOptions(ctx, raw),
      });
      return;
    case 'scenarios':
      data.scenarios.push(readScenario(ctx, base, raw, rules));
      return;
    default:
      return;
  }
}

/** Lee el `id` de una definición; sin él la definición no puede cargarse. */
function readRequiredId(ctx: ReadContext, raw: Record<string, unknown>): string | undefined {
  const declared = raw['id'];
  if (declared === undefined || declared === null) {
    ctx.errors.push({
      code: 'missing_id',
      message: `${ctx.file}: ${describePath(ctx.path)} no declara id`,
      context: { file: ctx.file, path: joinPath(ctx.path, 'id') },
    });
    return undefined;
  }
  return readString(ctx, raw, 'id');
}

// ---------------------------------------------------------------------------
// Construcciones
// ---------------------------------------------------------------------------

/** Lee una construcción con sus niveles y su `produce_durante_mejora`. */
function readConstruction(
  ctx: ReadContext,
  base: DefinitionBase,
  raw: Record<string, unknown>,
  rules: RulesData,
): ConstructionDef {
  // Requisito 7.8: el valor de la construcción prevalece; en su ausencia se
  // aplica el declarado en `rules.upgrades.produce_durante_mejora`.
  if (raw['produce_durante_mejora'] === undefined) {
    const fallback = readRuleValue(rules, 'upgrades', 'produce_durante_mejora');
    if (typeof fallback === 'boolean') {
      raw['produce_durante_mejora'] = fallback;
    }
  }

  return {
    ...base,
    allowedTerrains: readStringArray(ctx, raw, 'allowed_terrains'),
    levels: readConstructionLevels(ctx, raw, rules),
    produceDuringUpgrade: readBoolean(ctx, raw, 'produce_durante_mejora'),
  };
}

/** Lee los niveles de una construcción aplicando `defaults.construction_levels`. */
function readConstructionLevels(
  ctx: ReadContext,
  raw: Record<string, unknown>,
  rules: RulesData,
): ConstructionLevelDef[] | undefined {
  const declared = raw['levels'];
  if (declared === undefined) {
    return undefined;
  }
  if (!Array.isArray(declared)) {
    fieldError(ctx, 'levels', 'debe ser una lista de niveles', declared);
    return undefined;
  }

  const levelDefaults = rules.defaults['construction_levels'];
  const levels: ConstructionLevelDef[] = [];
  const normalized: unknown[] = [];

  declared.forEach((entry, index) => {
    const fieldPath = joinPath(ctx.path, `levels[${String(index)}]`);
    if (!isMapping(entry)) {
      ctx.errors.push({
        code: 'invalid_definition',
        message: `${ctx.file}: ${fieldPath} debe ser un mapa de campos`,
        context: { file: ctx.file, path: fieldPath, found: describeType(entry) },
      });
      normalized.push(entry);
      return;
    }
    const levelRaw = withDefaults(entry, levelDefaults);
    const levelCtx: ReadContext = { file: ctx.file, path: fieldPath, errors: ctx.errors };
    normalized.push(levelRaw);
    levels.push({
      level: readNumber(levelCtx, levelRaw, 'level'),
      buildTime: readNumber(levelCtx, levelRaw, 'build_time'),
      cost: readNumberRecord(levelCtx, levelRaw, 'cost'),
      employs: readNumber(levelCtx, levelRaw, 'employs'),
      requiresTech: readStringArray(levelCtx, levelRaw, 'requires_tech'),
      nameKey: readI18nKey(levelCtx, levelRaw, NAME_KEY_FIELDS),
      descKey: readI18nKey(levelCtx, levelRaw, DESC_KEY_FIELDS),
      fieldPath,
      raw: levelRaw,
    });
  });

  // `raw` conserva los niveles con sus valores por defecto aplicados, para que
  // el Serializador_De_Datos reescriba exactamente lo que se cargó.
  raw['levels'] = normalized;
  return levels;
}

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

/** Lee las opciones de un puzzle interpretando sus textos como claves i18n. */
function readPuzzleOptions(
  ctx: ReadContext,
  raw: Record<string, unknown>,
): PuzzleOptionDef[] | undefined {
  const declared = raw['options'];
  if (declared === undefined) {
    return undefined;
  }
  if (!Array.isArray(declared)) {
    fieldError(ctx, 'options', 'debe ser una lista de opciones', declared);
    return undefined;
  }

  const options: PuzzleOptionDef[] = [];
  declared.forEach((entry, index) => {
    const fieldPath = joinPath(ctx.path, `options[${String(index)}]`);
    if (!isMapping(entry)) {
      ctx.errors.push({
        code: 'invalid_definition',
        message: `${ctx.file}: ${fieldPath} debe ser un mapa de campos`,
        context: { file: ctx.file, path: fieldPath, found: describeType(entry) },
      });
      return;
    }
    const optionCtx: ReadContext = { file: ctx.file, path: fieldPath, errors: ctx.errors };
    options.push({
      textKey: readI18nKey(optionCtx, entry, ['text_key', 'text', ...NAME_KEY_FIELDS]),
      correct: readBoolean(optionCtx, entry, 'correct'),
      fieldPath,
      raw: entry,
    });
  });
  return options;
}

// ---------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------

/** Lee un escenario con su mapa, sus recursos iniciales y sus objetivos. */
function readScenario(
  ctx: ReadContext,
  base: DefinitionBase,
  raw: Record<string, unknown>,
  rules: RulesData,
): ScenarioDef {
  return {
    ...base,
    map: readScenarioMap(ctx, raw),
    startingResources: readNumberRecord(ctx, raw, 'starting_resources'),
    mainObjective: readMainObjective(ctx, raw),
    missions: readMissions(ctx, raw, rules),
  };
}

/** Lee el bloque `map` del escenario. */
function readScenarioMap(
  ctx: ReadContext,
  raw: Record<string, unknown>,
): ScenarioMapDef | undefined {
  const declared = raw['map'];
  if (declared === undefined) {
    return undefined;
  }
  if (!isMapping(declared)) {
    fieldError(ctx, 'map', 'debe ser un mapa de campos', declared);
    return undefined;
  }
  const fieldPath = joinPath(ctx.path, 'map');
  const mapCtx: ReadContext = { file: ctx.file, path: fieldPath, errors: ctx.errors };
  return {
    radius: readNumber(mapCtx, declared, 'radius'),
    terrainWeights: readNumberRecord(mapCtx, declared, 'terrain_weights'),
    elementDensity: readNumberRecord(mapCtx, declared, 'element_density'),
    constraints: readMapping(mapCtx, declared, 'constraints'),
    fieldPath,
    raw: declared,
  };
}

/**
 * Lee el objetivo principal aplicando `sustained_days` igual a 1 cuando la
 * condición no lo declara (Requisito 15.1).
 */
function readMainObjective(
  ctx: ReadContext,
  raw: Record<string, unknown>,
): ObjectiveDef | undefined {
  const declared = raw['main_objective'];
  if (declared === undefined) {
    return undefined;
  }
  if (!isMapping(declared)) {
    fieldError(ctx, 'main_objective', 'debe ser un mapa de campos', declared);
    return undefined;
  }
  if (declared['sustained_days'] === undefined) {
    declared['sustained_days'] = 1;
  }
  const fieldPath = joinPath(ctx.path, 'main_objective');
  const objectiveCtx: ReadContext = { file: ctx.file, path: fieldPath, errors: ctx.errors };
  return {
    descKey: readI18nKey(objectiveCtx, declared, DESC_KEY_FIELDS),
    condition: readMapping(objectiveCtx, declared, 'condition'),
    sustainedDays: readNumber(objectiveCtx, declared, 'sustained_days'),
    fieldPath,
    raw: declared,
  };
}

/** Lee las misiones intermedias del escenario. */
function readMissions(
  ctx: ReadContext,
  raw: Record<string, unknown>,
  rules: RulesData,
): MissionDef[] | undefined {
  const declared = raw['missions'];
  if (declared === undefined) {
    return undefined;
  }
  if (!Array.isArray(declared)) {
    fieldError(ctx, 'missions', 'debe ser una lista de misiones', declared);
    return undefined;
  }

  const missionDefaults = rules.defaults['missions'];
  const missions: MissionDef[] = [];
  const normalized: unknown[] = [];

  declared.forEach((entry, index) => {
    const fieldPath = joinPath(ctx.path, `missions[${String(index)}]`);
    if (!isMapping(entry)) {
      ctx.errors.push({
        code: 'invalid_definition',
        message: `${ctx.file}: ${fieldPath} debe ser un mapa de campos`,
        context: { file: ctx.file, path: fieldPath, found: describeType(entry) },
      });
      normalized.push(entry);
      return;
    }
    const missionRaw = withDefaults(entry, missionDefaults);
    const missionCtx: ReadContext = { file: ctx.file, path: fieldPath, errors: ctx.errors };
    normalized.push(missionRaw);
    missions.push({
      id: readString(missionCtx, missionRaw, 'id'),
      descKey: readI18nKey(missionCtx, missionRaw, DESC_KEY_FIELDS),
      condition: readMapping(missionCtx, missionRaw, 'condition'),
      fieldPath,
      raw: missionRaw,
    });
  });

  raw['missions'] = normalized;
  return missions;
}

// ---------------------------------------------------------------------------
// Catálogos i18n
// ---------------------------------------------------------------------------

/**
 * Lee un catálogo de textos. Varios ficheros pueden aportar textos al mismo
 * idioma; declarar dos veces la misma clave es un error, porque el texto
 * aplicado dependería del orden de carga.
 */
function readI18nCatalog(document: ParsedDocument, data: GameData, errors: GameError[]): void {
  const ctx: ReadContext = { file: document.file, path: '', errors };
  const locale = readString(ctx, document.mapping, 'locale');
  if (locale === undefined) {
    if (document.mapping['locale'] === undefined) {
      errors.push({
        code: 'missing_locale',
        message: `${document.file}: el catálogo de textos no declara locale`,
        context: { file: document.file, path: 'locale' },
      });
    }
    return;
  }

  let catalog = data.locales.find((candidate) => candidate.locale === locale);
  if (catalog === undefined) {
    catalog = { locale, strings: new Map<string, string>(), sourceFiles: [] };
    data.locales.push(catalog);
  }
  catalog.sourceFiles.push(document.file);

  const numberFormat = readNumberFormat(ctx, document.mapping);
  if (numberFormat !== undefined) {
    catalog.numberFormat = numberFormat;
  }
  const pluralRules = readString(ctx, document.mapping, 'plural_rules');
  if (pluralRules !== undefined) {
    catalog.pluralRules = pluralRules;
  }

  readCatalogStrings(ctx, document, catalog);
}

/** Lee el bloque `number_format` del catálogo. */
function readNumberFormat(
  ctx: ReadContext,
  mapping: Record<string, unknown>,
): NumberFormat | undefined {
  const declared = readMapping(ctx, mapping, 'number_format');
  if (declared === undefined) {
    return undefined;
  }
  const formatCtx: ReadContext = { file: ctx.file, path: 'number_format', errors: ctx.errors };
  const decimalSeparator = readString(formatCtx, declared, 'decimal_separator');
  const thousandsSeparator = readString(formatCtx, declared, 'thousands_separator');
  if (decimalSeparator === undefined || thousandsSeparator === undefined) {
    return undefined;
  }
  return { decimalSeparator, thousandsSeparator };
}

/** Lee el bloque `strings` y lo mezcla en el catálogo del idioma. */
function readCatalogStrings(
  ctx: ReadContext,
  document: ParsedDocument,
  catalog: I18nCatalog,
): void {
  const declared = document.mapping['strings'];
  if (declared === undefined) {
    return;
  }
  if (!isMapping(declared)) {
    fieldError(ctx, 'strings', 'debe ser un mapa de clave a texto', declared);
    return;
  }

  for (const [key, value] of Object.entries(declared)) {
    const path = `strings.${key}`;
    if (typeof value !== 'string') {
      ctx.errors.push({
        code: 'invalid_i18n_value',
        message: `${document.file}: ${path} debe ser una cadena`,
        context: { file: document.file, path, found: describeType(value) },
      });
      continue;
    }
    if (catalog.strings.has(key)) {
      ctx.errors.push({
        code: 'duplicate_i18n_key',
        message: `${document.file}: la clave ${key} del idioma ${catalog.locale} ya estaba declarada`,
        context: { file: document.file, path, key, files: [...catalog.sourceFiles] },
      });
      continue;
    }
    catalog.strings.set(key, value);
  }
}

// ---------------------------------------------------------------------------
// Valores por defecto
// ---------------------------------------------------------------------------

/**
 * Copia la definición aplicando los valores por defecto a los campos ausentes
 * (Requisito 20.2). No sobrescribe ningún campo declarado y clona los valores
 * por defecto para que dos definiciones no compartan la misma lista o mapa.
 */
function withDefaults(
  mapping: Record<string, unknown>,
  defaults: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...mapping };
  if (defaults === undefined) {
    return result;
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (result[key] === undefined) {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

/** Lee un valor de un grupo de reglas globales, e.g. `upgrades.devolucion`. */
function readRuleValue(rules: RulesData, group: string, field: string): unknown {
  const groupValue = rules.values[group];
  return isMapping(groupValue) ? groupValue[field] : undefined;
}

// ---------------------------------------------------------------------------
// Lectura de campos
// ---------------------------------------------------------------------------

/** Contexto de lectura: fichero, ruta del campo y acumulador de errores. */
interface ReadContext {
  file: string;
  path: string;
  errors: GameError[];
}

/**
 * Interpreta un campo de nombre o de descripción como clave de catálogo i18n y
 * no como cadena literal (Requisito 22.3). Se admite el primer campo declarado
 * de la lista, en orden de preferencia.
 */
function readI18nKey(
  ctx: ReadContext,
  mapping: Record<string, unknown>,
  fields: readonly string[],
): I18nKey | undefined {
  for (const field of fields) {
    if (mapping[field] === undefined || mapping[field] === null) {
      continue;
    }
    return readString(ctx, mapping, field);
  }
  return undefined;
}

function readString(
  ctx: ReadContext,
  mapping: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = mapping[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    fieldError(ctx, field, 'debe ser una cadena', value);
    return undefined;
  }
  return value;
}

function readNumber(
  ctx: ReadContext,
  mapping: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = mapping[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fieldError(ctx, field, 'debe ser un número finito', value);
    return undefined;
  }
  return value;
}

function readBoolean(
  ctx: ReadContext,
  mapping: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = mapping[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    fieldError(ctx, field, 'debe ser un booleano', value);
    return undefined;
  }
  return value;
}

function readStringArray(
  ctx: ReadContext,
  mapping: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = mapping[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    fieldError(ctx, field, 'debe ser una lista de identificadores', value);
    return undefined;
  }
  const items: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      fieldError(ctx, `${field}[${String(index)}]`, 'debe ser una cadena', entry);
      continue;
    }
    items.push(entry);
  }
  return items;
}

function readNumberRecord(
  ctx: ReadContext,
  mapping: Record<string, unknown>,
  field: string,
): Record<string, number> | undefined {
  const value = mapping[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isMapping(value)) {
    fieldError(ctx, field, 'debe ser un mapa de valores numéricos', value);
    return undefined;
  }
  const record: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      fieldError(ctx, `${field}.${key}`, 'debe ser un número finito', entry);
      continue;
    }
    record[key] = entry;
  }
  return record;
}

function readMapping(
  ctx: ReadContext,
  mapping: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  const value = mapping[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isMapping(value)) {
    fieldError(ctx, field, 'debe ser un mapa de campos', value);
    return undefined;
  }
  return value;
}

/** Registra un error de campo con su fichero, su ruta y el valor encontrado. */
function fieldError(ctx: ReadContext, field: string, reason: string, found: unknown): void {
  const path = joinPath(ctx.path, field);
  ctx.errors.push({
    code: 'invalid_field',
    message: `${ctx.file}: ${path} ${reason}`,
    context: { file: ctx.file, path, reason, found: describeType(found) },
  });
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Un mapa YAML: objeto plano, nunca una lista. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compone la ruta de un campo dentro del fichero. */
function joinPath(base: string, field: string): string {
  return base.length === 0 ? field : `${base}.${field}`;
}

/** Nombra la ruta de una definición para los mensajes de error. */
function describePath(path: string): string {
  return path.length === 0 ? 'la raíz del documento' : path;
}

/** Describe el tipo de un valor YAML para los mensajes de error. */
function describeType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'lista';
  }
  if (typeof value === 'object') {
    return 'mapa';
  }
  return typeof value;
}

/** Extrae un motivo legible de una excepción de origen desconocido. */
function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
