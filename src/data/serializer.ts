/**
 * Serializador_De_Datos: escribe un `GameData` como ficheros YAML que el
 * Cargador_De_Datos vuelve a aceptar (Requisito 20.8).
 *
 * Responsabilidades y decisiones de diseño:
 *
 * - La unidad de salida es la misma que la de entrada del cargador: una lista
 *   de `DataSource` (ruta y contenido YAML). Así `loadAll(serializeAll(data))`
 *   cierra la ida y vuelta de los Requisitos 20.9 y 20.10 sin pasar por disco.
 * - Se escribe el `raw` de cada definición, no los campos interpretados: `raw`
 *   conserva los valores por defecto ya aplicados y también los campos que el
 *   cargador no interpreta, de modo que la reescritura no pierde contenido
 *   (Requisito 20.7). Los campos de nombre y descripción se emiten tal cual, es
 *   decir como claves del catálogo i18n y nunca como texto resuelto
 *   (Requisito 22.3).
 * - Se agrupa por fichero de origen y se reconstruye la forma en que cada
 *   definición se declaró (lista `terrains[0]`, mapa `terrains.prado`,
 *   escenario en la raíz o en un bloque `scenario`), leyéndola de su
 *   `fieldPath`. Así el `GameData` recargado conserva `sourceFile` y
 *   `fieldPath`, que son lo que el Validador_De_Datos usa en sus diagnósticos.
 * - El orden de los ficheros de salida respeta el orden relativo que se deduce
 *   del `GameData`: las colecciones que reparten definiciones entre varios
 *   ficheros (por ejemplo los puzzles) mantienen su orden de declaración, que
 *   es significativo (Requisito 1.4).
 * - No lanza excepciones al flujo superior: devuelve `Result` y acumula un
 *   error por fichero que no se haya podido emitir.
 *
 * Límites conocidos, inherentes a serializar desde el `GameData` cargado:
 *
 * - Los comentarios y el estilo del YAML original no se conservan; solo se
 *   escribe la cabecera que se pase en `SerializeOptions.header`.
 * - Los valores por defecto de las reglas globales aparecen ya aplicados en
 *   cada definición, porque es así como el cargador los entrega.
 * - Cuando las reglas o un catálogo i18n se reparten entre varios ficheros, el
 *   `GameData` no dice qué fichero aportó cada grupo o cada texto: se escriben
 *   todos en el primer fichero del grupo y los demás quedan como documentos
 *   reconocibles pero sin contenido, para conservar la lista de ficheros.
 * - `rules.data_version` se emite siempre, aunque los datos originales no lo
 *   declarasen, porque en su ausencia el cargador deriva `dataVersion` de un
 *   hash del contenido y este cambia al reescribirlo (Requisito 21.3).
 */
import { dump } from 'js-yaml';
import type { DumpOptions } from 'js-yaml';
import { err, ok } from '../core/result.ts';
import type { GameError, Result } from '../core/result.ts';
import type {
  DataSource,
  DefinitionBase,
  GameData,
  I18nCatalog,
  ScenarioDef,
} from './loader.ts';

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Opciones de emisión del YAML. */
export interface SerializeOptions {
  /** Indentación de los bloques, como en `data/`. Por defecto 2. */
  indent?: number;
  /**
   * Comentario de cabecera de cada fichero. Se emite con `#` al principio de
   * cada línea; el YAML de salida no conserva los comentarios del original.
   */
  header?: string;
}

/** Documento a emitir: su ruta y su mapa de primer nivel. */
export interface SerializedDocument {
  path: string;
  mapping: Record<string, unknown>;
}

/**
 * Escribe el `GameData` como ficheros YAML aceptados por `loadAll`
 * (Requisito 20.8).
 *
 * Devuelve `err` con un error por fichero cuando algún valor no es
 * representable en YAML (por ejemplo una función en el `raw` de una
 * definición construida a mano).
 */
export function serializeAll(
  data: GameData,
  options: SerializeOptions = {},
): Result<DataSource[], GameError[]> {
  const errors: GameError[] = [];
  const sources: DataSource[] = [];

  for (const document of toDocuments(data)) {
    const content = emitDocument(document, options, errors);
    if (content !== undefined) {
      sources.push({ path: document.path, content });
    }
  }

  return errors.length > 0 ? err(errors) : ok(sources);
}

/**
 * Reconstruye los documentos que se emitirán, uno por fichero de origen y en el
 * orden en que deben cargarse. Se expone para poder inspeccionar la estructura
 * sin pasar por el texto YAML.
 */
export function toDocuments(data: GameData): SerializedDocument[] {
  const plans = planFiles(data);
  return plans.map((plan) => ({ path: plan.path, mapping: buildMapping(plan) }));
}

// ---------------------------------------------------------------------------
// Emisión del YAML
// ---------------------------------------------------------------------------

/**
 * Opciones de `js-yaml` elegidas para que el resultado sea estable y lo vuelva
 * a leer el cargador sin cambios de tipo:
 *
 * - `lineWidth: -1` evita plegar las líneas largas de los catálogos de textos.
 * - `noRefs: true` repite el valor en lugar de emitir anclas y alias, que
 *   producirían objetos compartidos al recargar.
 * - `sortKeys: false` conserva el orden de declaración.
 * - `quotingType: '"'` reproduce el estilo de comillas de `data/`.
 */
const DUMP_OPTIONS = {
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
  quotingType: '"',
  skipInvalid: false,
} satisfies DumpOptions;

/** Emite un documento, acumulando el error si algún valor no es serializable. */
function emitDocument(
  document: SerializedDocument,
  options: SerializeOptions,
  errors: GameError[],
): string | undefined {
  let body: string;
  try {
    body = dump(document.mapping, { ...DUMP_OPTIONS, indent: options.indent ?? 2 });
  } catch (cause) {
    errors.push({
      code: 'yaml_dump_error',
      message: `${document.path}: no se ha podido escribir el YAML: ${describeError(cause)}`,
      context: { file: document.path, reason: describeError(cause) },
    });
    return undefined;
  }
  return `${formatHeader(options.header)}${body}`;
}

/** Convierte la cabecera en comentarios YAML. */
function formatHeader(header: string | undefined): string {
  if (header === undefined || header.length === 0) {
    return '';
  }
  return `${header
    .split('\n')
    .map((line) => (line.length === 0 ? '#' : `# ${line}`))
    .join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Reparto por fichero
// ---------------------------------------------------------------------------

/** Colecciones de contenido, en el orden en que se emiten. */
const COLLECTION_KEYS = [
  'terrains',
  'elements',
  'constructions',
  'technologies',
  'puzzles',
  'scenarios',
] as const;

type CollectionKey = (typeof COLLECTION_KEYS)[number];

/**
 * Grupos que hacen que el cargador interprete un documento como reglas
 * globales. Copia de la lista del Cargador_De_Datos: solo se usa para no emitir
 * un escenario en la raíz de un documento que se confundiría con las reglas.
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

/** `fieldPath` de un escenario declarado en la raíz de su fichero. */
const ROOT_SCENARIO_PATH = '';

/** `fieldPath` de un escenario declarado en un bloque `scenario`. */
const NESTED_SCENARIO_PATH = 'scenario';

/** Contenido que aporta un fichero de salida. */
interface FilePlan {
  path: string;
  /** Reglas globales completas, solo en el primer fichero que las declaraba. */
  rules?: Record<string, unknown>;
  /** El fichero declaraba reglas, pero otro se lleva su contenido. */
  rulesPlaceholder: boolean;
  /** Catálogos i18n del fichero; `strings` solo en el primero de cada idioma. */
  catalogs: { catalog: I18nCatalog; primary: boolean }[];
  /** Definiciones por colección, en orden de declaración. */
  collections: Map<CollectionKey, DefinitionBase[]>;
  /** Escenario emitido en la raíz del documento. */
  rootScenario?: ScenarioDef;
  /** Escenario emitido en un bloque `scenario`. */
  nestedScenario?: ScenarioDef;
}

/** Reparte el `GameData` por fichero y ordena los ficheros para su carga. */
function planFiles(data: GameData): FilePlan[] {
  const rulesFiles = rulesPaths(data);
  const catalogFiles = new Map<I18nCatalog, string[]>();
  for (const catalog of data.locales) {
    catalogFiles.set(catalog, catalogPaths(catalog));
  }

  const sequences: string[][] = [rulesFiles];
  for (const key of COLLECTION_KEYS) {
    sequences.push(definitionsOf(data, key).map((definition) => resolvePath(definition, key)));
  }
  for (const paths of catalogFiles.values()) {
    sequences.push(paths);
  }

  const plans: FilePlan[] = [];
  for (const path of orderFiles(sequences)) {
    const plan: FilePlan = {
      path,
      rulesPlaceholder: false,
      catalogs: [],
      collections: new Map<CollectionKey, DefinitionBase[]>(),
    };

    if (rulesFiles.includes(path)) {
      if (path === rulesFiles[0]) {
        plan.rules = rulesMapping(data);
      } else {
        plan.rulesPlaceholder = true;
      }
    }

    for (const [catalog, paths] of catalogFiles) {
      if (paths.includes(path)) {
        plan.catalogs.push({ catalog, primary: path === paths[0] });
      }
    }

    assignDefinitions(data, path, plan);
    plans.push(plan);
  }
  return plans;
}

/** Reparte las definiciones del fichero entre sus colecciones y escenarios. */
function assignDefinitions(data: GameData, path: string, plan: FilePlan): void {
  const scenarios = data.scenarios.filter((scenario) => resolvePath(scenario, 'scenarios') === path);
  const rootCandidate = scenarios.find(
    (scenario) => scenario.fieldPath === ROOT_SCENARIO_PATH && canBeRootDocument(scenario.raw),
  );
  const nested = scenarios.find((scenario) => scenario.fieldPath === NESTED_SCENARIO_PATH);

  // Un escenario solo puede ocupar la raíz del documento si el fichero no
  // aporta nada más: el cargador no lo reconocería junto a otras secciones.
  const fileHasOtherContent =
    plan.rules !== undefined ||
    plan.rulesPlaceholder ||
    plan.catalogs.length > 0 ||
    nested !== undefined ||
    scenarios.length > 1 ||
    COLLECTION_KEYS.filter((key) => key !== 'scenarios').some((key) =>
      definitionsOf(data, key).some((definition) => resolvePath(definition, key) === path),
    );

  const root = fileHasOtherContent ? undefined : rootCandidate;
  plan.rootScenario = root;
  plan.nestedScenario = nested;

  for (const key of COLLECTION_KEYS) {
    const definitions = definitionsOf(data, key).filter(
      (definition) =>
        resolvePath(definition, key) === path && definition !== root && definition !== nested,
    );
    if (definitions.length > 0) {
      plan.collections.set(key, definitions);
    }
  }
}

/** Construye el mapa de primer nivel del documento de un fichero. */
function buildMapping(plan: FilePlan): Record<string, unknown> {
  if (plan.rootScenario !== undefined && plan.collections.size === 0) {
    return emitMapping(plan.rootScenario.raw);
  }

  const mapping: Record<string, unknown> = {};
  if (plan.rules !== undefined) {
    mapping['rules'] = plan.rules;
  } else if (plan.rulesPlaceholder) {
    // Documento reconocido como reglas que no aporta ningún grupo: conserva el
    // fichero en `rules.sourceFiles` sin duplicar los valores de otro fichero.
    mapping['rules'] = {};
  }

  for (const { catalog, primary } of plan.catalogs) {
    Object.assign(mapping, catalogMapping(catalog, primary));
  }

  for (const key of COLLECTION_KEYS) {
    const definitions = plan.collections.get(key);
    if (definitions !== undefined) {
      mapping[key] = collectionSection(definitions, key);
    }
  }

  if (plan.nestedScenario !== undefined) {
    mapping[NESTED_SCENARIO_PATH] = emitMapping(plan.nestedScenario.raw);
  }
  return mapping;
}

/**
 * Emite una colección con la forma en que se declaró: mapa indexado por clave
 * cuando todos los `fieldPath` la traen (`terrains.prado`) y lista en cualquier
 * otro caso.
 */
function collectionSection(definitions: DefinitionBase[], key: CollectionKey): unknown {
  const keyed = mapStyleKeys(definitions, key);
  if (keyed !== undefined) {
    const mapping: Record<string, unknown> = {};
    for (const [mapKey, definition] of keyed) {
      mapping[mapKey] = emitMapping(definition.raw);
    }
    return mapping;
  }
  return definitions.map((definition) => emitMapping(definition.raw));
}

/** Claves de una colección declarada como mapa, o `undefined` si era lista. */
function mapStyleKeys(
  definitions: DefinitionBase[],
  key: CollectionKey,
): Map<string, DefinitionBase> | undefined {
  const prefix = `${key}.`;
  const keyed = new Map<string, DefinitionBase>();
  for (const definition of definitions) {
    if (!definition.fieldPath.startsWith(prefix)) {
      return undefined;
    }
    const mapKey = definition.fieldPath.slice(prefix.length);
    if (mapKey.length === 0 || keyed.has(mapKey)) {
      return undefined;
    }
    keyed.set(mapKey, definition);
  }
  return keyed.size > 0 ? keyed : undefined;
}

/**
 * Un escenario puede ocupar la raíz de su documento solo si el cargador lo
 * reconocería así: necesita un bloque `map` y ninguna clave que lo confunda con
 * las reglas globales, con un catálogo i18n o con una colección.
 */
function canBeRootDocument(raw: Record<string, unknown>): boolean {
  if (!isMapping(raw['map'])) {
    return false;
  }
  if (raw['locale'] !== undefined || raw['strings'] !== undefined) {
    return false;
  }
  if (raw['rules'] !== undefined || raw[NESTED_SCENARIO_PATH] !== undefined) {
    return false;
  }
  if (RULE_GROUP_KEYS.some((key) => raw[key] !== undefined)) {
    return false;
  }
  return !COLLECTION_KEYS.some((key) => raw[key] !== undefined);
}

// ---------------------------------------------------------------------------
// Reglas globales y catálogos i18n
// ---------------------------------------------------------------------------

/** Ficheros de reglas; siempre hay uno, para que la salida sea cargable. */
function rulesPaths(data: GameData): string[] {
  return data.rules.sourceFiles.length > 0 ? [...data.rules.sourceFiles] : ['data/rules.yaml'];
}

/** Ficheros de un catálogo i18n; en su ausencia, uno por idioma. */
function catalogPaths(catalog: I18nCatalog): string[] {
  return catalog.sourceFiles.length > 0
    ? [...catalog.sourceFiles]
    : [`data/i18n/${catalog.locale}.yaml`];
}

/**
 * Reglas globales completas. Se emiten bajo la clave `rules`, como en
 * `data/rules.yaml`, con `data_version` y `defaults` materializados para que la
 * recarga reproduzca el `dataVersion` y los valores por defecto.
 */
function rulesMapping(data: GameData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data.rules.values)) {
    if (value !== undefined) {
      values[key] = emitValue(value);
    }
  }
  if (values['defaults'] === undefined && Object.keys(data.rules.defaults).length > 0) {
    values['defaults'] = emitValue(data.rules.defaults);
  }
  if (values['data_version'] === undefined) {
    values['data_version'] = data.dataVersion;
  }
  return values;
}

/** Documento de un catálogo i18n, con los textos solo en su primer fichero. */
function catalogMapping(catalog: I18nCatalog, primary: boolean): Record<string, unknown> {
  const mapping: Record<string, unknown> = { locale: catalog.locale };
  if (!primary) {
    return mapping;
  }
  if (catalog.numberFormat !== undefined) {
    mapping['number_format'] = {
      decimal_separator: catalog.numberFormat.decimalSeparator,
      thousands_separator: catalog.numberFormat.thousandsSeparator,
    };
  }
  if (catalog.pluralRules !== undefined) {
    mapping['plural_rules'] = catalog.pluralRules;
  }
  if (catalog.strings.size > 0) {
    mapping['strings'] = Object.fromEntries(catalog.strings);
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Orden de los ficheros
// ---------------------------------------------------------------------------

/**
 * Ordena los ficheros de salida respetando el orden relativo que imponen las
 * secuencias observadas en el `GameData` (definiciones de una colección,
 * ficheros de reglas y ficheros de cada idioma). Se resuelve como una
 * ordenación topológica con desempate por ruta, para que el resultado sea
 * determinista. Si la evidencia es contradictoria (imposible en datos
 * cargados), se cae al orden lexicográfico de los ficheros restantes.
 */
function orderFiles(sequences: string[][]): string[] {
  const successors = new Map<string, Set<string>>();
  const pendingCount = new Map<string, number>();

  for (const sequence of sequences) {
    for (const path of sequence) {
      if (!successors.has(path)) {
        successors.set(path, new Set<string>());
        pendingCount.set(path, 0);
      }
    }
  }

  for (const sequence of sequences) {
    let previous: string | undefined;
    for (const path of sequence) {
      if (previous !== undefined && previous !== path) {
        const next = successors.get(previous);
        if (next !== undefined && !next.has(path)) {
          next.add(path);
          pendingCount.set(path, (pendingCount.get(path) ?? 0) + 1);
        }
      }
      previous = path;
    }
  }

  const remaining = [...successors.keys()].sort();
  const ordered: string[] = [];
  while (remaining.length > 0) {
    const index = remaining.findIndex((path) => (pendingCount.get(path) ?? 0) === 0);
    const [path] = remaining.splice(index === -1 ? 0 : index, 1);
    if (path === undefined) {
      break;
    }
    ordered.push(path);
    for (const next of successors.get(path) ?? []) {
      pendingCount.set(next, (pendingCount.get(next) ?? 0) - 1);
    }
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Definiciones de una colección del `GameData`. */
function definitionsOf(data: GameData, key: CollectionKey): DefinitionBase[] {
  return data[key];
}

/**
 * Fichero en que se escribe una definición. Las estructuras construidas a mano
 * pueden no declarar `sourceFile`; entonces se agrupan por colección.
 */
function resolvePath(definition: DefinitionBase, key: CollectionKey): string {
  return definition.sourceFile.length > 0 ? definition.sourceFile : `data/${key}.yaml`;
}

/**
 * Prepara un mapa para su emisión: descarta los campos sin valor, que en YAML
 * equivalen a no declararlos, y copia el resto sin compartir referencias.
 */
function emitMapping(mapping: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (value !== undefined) {
      result[key] = emitValue(value);
    }
  }
  return result;
}

/** Copia un valor YAML descartando los campos sin valor de sus mapas. */
function emitValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    // Una lista no puede tener huecos en YAML: el hueco se escribe como nulo.
    return value.map((entry) => (entry === undefined ? null : emitValue(entry)));
  }
  if (isMapping(value)) {
    return emitMapping(value);
  }
  return value;
}

/** Un mapa YAML: objeto plano, nunca una lista. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extrae un motivo legible de una excepción de origen desconocido. */
function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
