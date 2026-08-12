/**
 * Tests de propiedades de la capa de datos YAML (tarea 2.6).
 *
 * Todo el contenido y el balance del juego viven en YAML (Requisito 20.1), así
 * que el Cargador_De_Datos y el Serializador_De_Datos son la frontera por la
 * que entra y sale ese contenido. Dos invariantes la protegen:
 *
 * - **Propiedad 35: Ida y vuelta de datos YAML** — para cualquier fichero de
 *   datos válido, cargar → serializar → cargar produce un resultado equivalente
 *   al de la primera carga, y serializar → cargar → serializar produce un
 *   resultado idéntico al primero. Es lo que garantiza que reescribir los datos
 *   desde el editor no pierda ni deforme contenido.
 * - **Propiedad 36: Manejo robusto de YAML inválido** — para cualquier entrada
 *   YAML sintácticamente inválida o que incumpla el esquema, el cargador
 *   devuelve un error que identifica la posición del problema, sin lanzar
 *   excepciones no controladas.
 *
 * Los generadores construyen el YAML con `js-yaml` a partir de un plan de
 * contenido, no como texto suelto: así toda entrada de la Propiedad 35 es un
 * fichero de datos válido, con las mismas formas de declaración que admite el
 * cargador (colección como lista o como mapa, colección repartida entre
 * ficheros, escenario en la raíz de su fichero o en un bloque `scenario`,
 * varios idiomas).
 *
 * Nota sobre `data_version`: el plan siempre lo declara, como `data/rules.yaml`.
 * En su ausencia el cargador deriva `dataVersion` de un hash del contenido y el
 * serializador lo materializa en las reglas, de modo que la recarga es
 * equivalente pero no idéntica; ese caso lo cubre el test unitario del
 * serializador («materializa data_version cuando los datos no lo declaraban»).
 *
 * **Validates: Requirements 20.9, 20.10, 20.11**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dump, load } from 'js-yaml';
import { loadAll } from '../../src/data/loader.ts';
import type { DataSource, GameData } from '../../src/data/loader.ts';
import { serializeAll } from '../../src/data/serializer.ts';
import type { GameError } from '../../src/core/result.ts';

/** Mínimo exigido por el diseño ("Configuración de tests de propiedades"). */
const RUNS = { numRuns: 1000 } as const;

// ---------------------------------------------------------------------------
// Utilidades de carga y serialización
// ---------------------------------------------------------------------------

/** Carga las fuentes y falla el test si el cargador devolvió errores. */
function expectLoaded(sources: DataSource[]): GameData {
  const result = loadAll(sources);
  if (!result.ok) {
    throw new Error(`carga fallida: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

/** Serializa los datos y falla el test si el serializador devolvió errores. */
function expectSerialized(data: GameData): DataSource[] {
  const result = serializeAll(data);
  if (!result.ok) {
    throw new Error(`serialización fallida: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

/** Devuelve los errores de carga y falla el test si la carga tuvo éxito. */
function expectLoadErrors(sources: DataSource[]): GameError[] {
  const result = loadAll(sources);
  if (result.ok) {
    throw new Error('se esperaba un fallo de carga');
  }
  return result.error;
}

/** Rutas de los ficheros, ordenadas, para comparar conjuntos de ficheros. */
function pathsOf(sources: DataSource[]): string[] {
  return sources.map((source) => source.path).sort();
}

/** Contenido en bruto de los ficheros de datos del juego. */
const RAW_DATA_FILES: Record<string, string> = import.meta.glob('../../data/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Los ficheros de `data/`, con la ruta con la que los carga el arranque. */
const REAL_SOURCES: DataSource[] = Object.entries(RAW_DATA_FILES)
  .map(([globPath, content]) => ({ path: globPath.replace('../../', ''), content }))
  .sort((left, right) => left.path.localeCompare(right.path));

// ---------------------------------------------------------------------------
// Emisión del YAML de las entradas generadas
// ---------------------------------------------------------------------------

/**
 * `noRefs` evita anclas y alias, que al recargar producirían objetos
 * compartidos entre definiciones; `lineWidth: -1` no pliega las líneas largas.
 */
function dumpYaml(mapping: Record<string, unknown>): string {
  return dump(mapping, { lineWidth: -1, noRefs: true, sortKeys: false });
}

/** ¿El texto es un documento YAML que `js-yaml` acepta? */
function parsesAsYaml(text: string): boolean {
  try {
    load(text, { filename: 'data/probe.yaml' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Generadores básicos
// ---------------------------------------------------------------------------

/** Palabra corta: base de identificadores, ramas y claves de catálogo. */
const arbWord = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''));

/** Clave de catálogo i18n: segmentos separados por puntos. */
const arbI18nKey = fc
  .array(arbWord, { minLength: 2, maxLength: 3 })
  .map((parts) => parts.join('.'));

/** Texto de catálogo: varias palabras, con acentos y marcadores de parámetro. */
const arbText = fc
  .array(fc.oneof(arbWord, fc.constantFrom('{count}', 'día', 'Ñu', '1.000', 'sí:')), {
    minLength: 1,
    maxLength: 4,
  })
  .map((parts) => parts.join(' '));

/** Cantidad de un recurso. */
const arbAmount = fc.integer({ min: 0, max: 400 });

/** Proporción con dos decimales, como las densidades y los modificadores. */
const arbRate = fc.integer({ min: 0, max: 200 }).map((value) => value / 100);

/** Recursos del juego (Requisito 4.1). */
const RESOURCES = ['comida', 'materiales', 'ciencia', 'oro'] as const;

/** Mapa de recurso a cantidad, como los costes y las producciones. */
const arbResourceMap = fc.dictionary(fc.constantFrom(...RESOURCES), arbAmount, { maxKeys: 4 });

/** Definición de contenido tal como se declara en el YAML. */
type Declaration = Record<string, unknown>;

/** Descarta los campos sin valor: en YAML equivalen a no declararlos. */
function compact(mapping: Record<string, unknown>): Declaration {
  const result: Declaration = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** Un valor por cada elemento de la lista, generado a partir de él. */
function arbEach<T>(
  items: readonly string[],
  build: (item: string, index: number) => fc.Arbitrary<T>,
): fc.Arbitrary<T[]> {
  return items.length === 0 ? fc.constant([]) : fc.tuple(...items.map(build));
}

/** Sublista de identificadores; lista vacía si no hay ninguno declarado. */
function arbSubsetOf(ids: readonly string[], minLength = 0): fc.Arbitrary<string[]> {
  if (ids.length === 0) {
    return fc.constant([]);
  }
  return fc.subarray([...ids], { minLength: Math.min(minLength, ids.length) });
}

// ---------------------------------------------------------------------------
// Generadores de definiciones de contenido
// ---------------------------------------------------------------------------

/** Terreno con sus claves de catálogo y algún campo propio. */
function arbTerrain(id: string): fc.Arbitrary<Declaration> {
  return fc
    .record({
      es_oceano: fc.option(fc.boolean(), { nil: undefined }),
      coste_exploracion: fc.option(arbAmount, { nil: undefined }),
      peso_por_defecto: fc.option(arbRate, { nil: undefined }),
    })
    .map((body) =>
      compact({
        id,
        name_key: `terrain.${id}.name`,
        desc_key: `terrain.${id}.desc`,
        ...body,
      }),
    );
}

/** Elemento del mapa, restringido a los terrenos declarados. */
function arbElement(id: string, terrainIds: readonly string[]): fc.Arbitrary<Declaration> {
  return fc
    .record({
      category: fc.constantFrom('bosque', 'montana', 'animal', 'poblado', 'misterio', 'amenaza'),
      allowed_terrains: arbSubsetOf(terrainIds, 1),
      production_per_day: fc.option(arbResourceMap, { nil: undefined }),
      passive_effect: fc.option(
        fc.record({ radius: fc.integer({ min: 1, max: 3 }), bonus: arbRate }),
        { nil: undefined },
      ),
      actions: fc.option(
        fc.array(fc.record({ id: arbWord, text_key: arbI18nKey }), { maxLength: 2 }),
        { nil: undefined },
      ),
    })
    .map((body) => compact({ id, name_key: `element.${id}.name`, ...body }));
}

/** Nivel de construcción, sin su número: lo asigna la construcción. */
function arbConstructionLevel(technologyIds: readonly string[]): fc.Arbitrary<Declaration> {
  return fc
    .record({
      build_time: fc.integer({ min: 1, max: 10 }),
      cost: arbResourceMap,
      employs: fc.integer({ min: 0, max: 6 }),
      requires_tech: fc.option(arbSubsetOf(technologyIds), { nil: undefined }),
      production_per_day: fc.option(arbResourceMap, { nil: undefined }),
    })
    .map((body) => compact(body));
}

/** Construcción con sus niveles numerados consecutivamente desde 1. */
function arbConstruction(
  id: string,
  terrainIds: readonly string[],
  technologyIds: readonly string[],
): fc.Arbitrary<Declaration> {
  return fc
    .record({
      allowed_terrains: arbSubsetOf(terrainIds, 1),
      tags: fc.option(fc.array(arbWord, { maxLength: 2 }), { nil: undefined }),
      produce_durante_mejora: fc.option(fc.boolean(), { nil: undefined }),
      levels: fc.array(arbConstructionLevel(technologyIds), { minLength: 1, maxLength: 3 }),
    })
    .map((body) =>
      compact({
        id,
        name_key: `construction.${id}.name`,
        ...body,
        levels: body.levels.map((level, position) => ({ level: position + 1, ...level })),
      }),
    );
}

/** Tecnología que solo depende de las declaradas antes: el grafo es acíclico. */
function arbTechnology(id: string, previousIds: readonly string[]): fc.Arbitrary<Declaration> {
  return fc
    .record({
      branch: fc.constantFrom('agricultura', 'construccion', 'defensa', 'ciencia'),
      tier: fc.integer({ min: 1, max: 4 }),
      cost: arbAmount,
      research_time: fc.integer({ min: 1, max: 8 }),
      dependencies: fc.option(arbSubsetOf(previousIds), { nil: undefined }),
      unlocks: fc.option(fc.dictionary(arbWord, arbAmount, { maxKeys: 2 }), { nil: undefined }),
    })
    .map((body) => compact({ id, name_key: `tech.${id}.name`, ...body }));
}

/** Puzzle con sus opciones, cuyos textos también son claves de catálogo. */
function arbPuzzle(id: string): fc.Arbitrary<Declaration> {
  return fc
    .record({
      kind: fc.constantFrom('poblado', 'misterio'),
      mode: fc.option(fc.constantFrom('fijo', 'generado'), { nil: undefined }),
      options: fc.array(fc.record({ text_key: arbI18nKey, correct: fc.boolean() }), {
        minLength: 1,
        maxLength: 3,
      }),
      reward: fc.option(arbResourceMap, { nil: undefined }),
    })
    .map((body) =>
      compact({
        id,
        name_key: `puzzle.${id}.name`,
        desc_key: `puzzle.${id}.desc`,
        ...body,
      }),
    );
}

/** Misión intermedia de un escenario. */
const arbMission: fc.Arbitrary<Declaration> = fc
  .record({
    id: arbWord,
    desc_key: arbI18nKey,
    condition: fc.record({
      kind: fc.constantFrom('resource', 'constructions'),
      threshold: arbAmount,
    }),
  })
  .map((body) => compact(body));

/** Escenario con su bloque `map`, sus recursos iniciales y sus objetivos. */
function arbScenario(
  id: string,
  terrainIds: readonly string[],
  elementIds: readonly string[],
): fc.Arbitrary<Declaration> {
  const arbWeights =
    terrainIds.length === 0
      ? fc.constant({})
      : fc.dictionary(fc.constantFrom(...terrainIds), arbAmount, { minKeys: 1 });
  const arbDensity =
    elementIds.length === 0
      ? fc.constant({})
      : fc.dictionary(fc.constantFrom(...elementIds), arbRate, { minKeys: 1 });

  return fc
    .record({
      map: fc
        .record({
          radius: fc.integer({ min: 1, max: 10 }),
          terrain_weights: arbWeights,
          element_density: arbDensity,
          constraints: fc.option(
            fc.record({ intentos_maximos: fc.integer({ min: 1, max: 50 }) }),
            { nil: undefined },
          ),
        })
        .map((body) => compact(body)),
      starting_resources: arbResourceMap,
      main_objective: fc
        .record({
          desc_key: fc.constant(`scenario.${id}.objective.desc`),
          condition: fc.record({
            kind: fc.constantFrom('resource', 'constructions'),
            threshold: arbAmount,
          }),
          // Ausente en la mitad de los casos: el cargador aplica 1 (15.1).
          sustained_days: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
        })
        .map((body) => compact(body)),
      missions: fc.option(fc.array(arbMission, { maxLength: 2 }), { nil: undefined }),
    })
    .map((body) => compact({ id, name_key: `scenario.${id}.name`, ...body }));
}

// ---------------------------------------------------------------------------
// Generadores de reglas globales y catálogos i18n
// ---------------------------------------------------------------------------

/** Valores por defecto por categoría, como los de `data/rules.yaml`. */
const arbDefaults = fc
  .record({
    elements: fc.option(fc.constant({ production_per_day: {}, actions: [] }), { nil: undefined }),
    constructions: fc.option(fc.constant({ tags: [], demolishable: true }), { nil: undefined }),
    technologies: fc.option(fc.constant({ dependencies: [] }), { nil: undefined }),
    construction_levels: fc.option(fc.constant({ requires_tech: [] }), { nil: undefined }),
    puzzles: fc.option(fc.constant({ mode: 'fijo' }), { nil: undefined }),
    missions: fc.option(fc.constant({ opcional: false }), { nil: undefined }),
  })
  .map((body) => compact(body));

/** Reglas globales: siempre declaran `data_version` y el grupo `day`. */
const arbRules = fc
  .record({
    data_version: fc.constantFrom('0.9.0', '1.0.0', '2.4.7'),
    defaults: fc.option(arbDefaults, { nil: undefined }),
    day: fc.record({
      fragments: fc.integer({ min: 1, max: 8 }),
      seconds_normal: fc.integer({ min: 1, max: 60 }),
      seconds_fast: fc.integer({ min: 1, max: 30 }),
    }),
    upgrades: fc.record({
      produce_durante_mejora: fc.boolean(),
      devolucion_por_cancelacion: arbRate,
    }),
    balance: fc.option(fc.record({ pesos_recurso: arbResourceMap }), { nil: undefined }),
    // `atlas_sprites: null` comprueba que el nulo sobrevive a la ida y vuelta.
    render: fc.option(
      fc.record({
        paleta: fc.array(fc.constantFrom('#000000', '#fff1e8', '#ff004d'), {
          minLength: 1,
          maxLength: 3,
        }),
        atlas_sprites: fc.constant(null),
      }),
      { nil: undefined },
    ),
  })
  .map((body) => compact(body));

/** Catálogo de textos de un idioma, tal como se declara en el YAML. */
function arbLocale(locale: string): fc.Arbitrary<Declaration> {
  return fc
    .record({
      locale: fc.constant(locale),
      number_format: fc.option(
        fc.record({
          decimal_separator: fc.constantFrom(',', '.'),
          thousands_separator: fc.constantFrom('.', ',', ' '),
        }),
        { nil: undefined },
      ),
      plural_rules: fc.option(fc.constantFrom('spanish', 'english', 'desconocida'), {
        nil: undefined,
      }),
      strings: fc.dictionary(arbI18nKey, arbText, { maxKeys: 6 }),
    })
    .map((body) => compact(body));
}

// ---------------------------------------------------------------------------
// Plan de datos y reparto por ficheros
// ---------------------------------------------------------------------------

/** Colecciones de contenido reconocidas por el cargador. */
const COLLECTION_KEYS = [
  'terrains',
  'elements',
  'constructions',
  'technologies',
  'puzzles',
  'scenarios',
] as const;

type CollectionKey = (typeof COLLECTION_KEYS)[number];

/** Fichero por defecto de cada colección. */
const COLLECTION_FILES: Record<CollectionKey, string> = {
  terrains: 'data/terrains.yaml',
  elements: 'data/elements.yaml',
  constructions: 'data/constructions.yaml',
  technologies: 'data/technologies.yaml',
  puzzles: 'data/puzzles/todos.yaml',
  scenarios: 'data/scenarios/todos.yaml',
};

/** Forma en que se declara una colección y cómo se reparte entre ficheros. */
interface Layout {
  /** Lista (`- id: prado`) o mapa indexado por identificador (`prado: {…}`). */
  style: 'list' | 'map';
  /**
   * Definiciones que van al primer fichero; el resto van al segundo. Un valor
   * de 0 o mayor o igual que el número de definiciones deja un solo fichero.
   */
  splitAt: number;
}

const arbLayout: fc.Arbitrary<Layout> = fc.record({
  style: fc.constantFrom('list' as const, 'map' as const),
  splitAt: fc.nat({ max: 4 }),
});

/** Contenido completo a emitir como ficheros YAML. */
interface DataPlan {
  rules: Declaration;
  terrains: Declaration[];
  elements: Declaration[];
  constructions: Declaration[];
  technologies: Declaration[];
  puzzles: Declaration[];
  scenarios: Declaration[];
  layouts: Record<CollectionKey, Layout>;
  /** Cómo se declaran los escenarios: en colección, anidados o en la raíz. */
  scenarioPlacement: 'collection' | 'nested' | 'root';
  locales: Declaration[];
}

const arbDataPlan: fc.Arbitrary<DataPlan> = fc
  .record({
    terrainIds: fc.uniqueArray(arbWord, { minLength: 1, maxLength: 4 }),
    elementIds: fc.uniqueArray(arbWord, { maxLength: 3 }),
    constructionIds: fc.uniqueArray(arbWord, { maxLength: 3 }),
    technologyIds: fc.uniqueArray(arbWord, { maxLength: 3 }),
    puzzleIds: fc.uniqueArray(arbWord, { maxLength: 2 }),
    scenarioIds: fc.uniqueArray(arbWord, { maxLength: 2 }),
    localeCodes: fc.uniqueArray(fc.constantFrom('es', 'en', 'gl'), {
      minLength: 1,
      maxLength: 3,
    }),
  })
  .chain((ids) =>
    fc.record({
      rules: arbRules,
      terrains: arbEach(ids.terrainIds, (id) => arbTerrain(id)),
      elements: arbEach(ids.elementIds, (id) => arbElement(id, ids.terrainIds)),
      constructions: arbEach(ids.constructionIds, (id) =>
        arbConstruction(id, ids.terrainIds, ids.technologyIds),
      ),
      technologies: arbEach(ids.technologyIds, (id, position) =>
        arbTechnology(id, ids.technologyIds.slice(0, position)),
      ),
      puzzles: arbEach(ids.puzzleIds, (id) => arbPuzzle(id)),
      scenarios: arbEach(ids.scenarioIds, (id) =>
        arbScenario(id, ids.terrainIds, ids.elementIds),
      ),
      layouts: fc.record({
        terrains: arbLayout,
        elements: arbLayout,
        constructions: arbLayout,
        technologies: arbLayout,
        puzzles: arbLayout,
        scenarios: arbLayout,
      }),
      scenarioPlacement: fc.constantFrom(
        'collection' as const,
        'nested' as const,
        'root' as const,
      ),
      locales: arbEach(ids.localeCodes, (code) => arbLocale(code)),
    }),
  );

/** Sección de una colección: lista o mapa indexado por identificador. */
function sectionBody(declarations: Declaration[], style: Layout['style']): unknown {
  if (style === 'list') {
    return declarations;
  }
  const mapping: Record<string, unknown> = {};
  for (const declaration of declarations) {
    mapping[String(declaration['id'])] = declaration;
  }
  return mapping;
}

/** Ficheros de una colección, repartidos según su `Layout`. */
function collectionDocuments(
  key: CollectionKey,
  declarations: Declaration[],
  layout: Layout,
): DataSource[] {
  if (declarations.length === 0) {
    return [];
  }
  const base = COLLECTION_FILES[key];
  const splits =
    layout.splitAt > 0 && layout.splitAt < declarations.length
      ? [declarations.slice(0, layout.splitAt), declarations.slice(layout.splitAt)]
      : [declarations];

  return splits.map((group, position) => ({
    path: splits.length === 1 ? base : base.replace('.yaml', `-${String(position + 1)}.yaml`),
    content: dumpYaml({ [key]: sectionBody(group, layout.style) }),
  }));
}

/** Ficheros de los escenarios según su forma de declaración. */
function scenarioDocuments(plan: DataPlan): DataSource[] {
  if (plan.scenarios.length === 0) {
    return [];
  }
  if (plan.scenarioPlacement === 'collection') {
    return collectionDocuments('scenarios', plan.scenarios, plan.layouts.scenarios);
  }
  return plan.scenarios.map((scenario) => ({
    path: `data/scenarios/${String(scenario['id'])}.yaml`,
    content:
      plan.scenarioPlacement === 'root' ? dumpYaml(scenario) : dumpYaml({ scenario }),
  }));
}

/** Ficheros de datos del plan, en el orden en que los cargaría el arranque. */
function sourcesOf(plan: DataPlan): DataSource[] {
  const sources: DataSource[] = [
    { path: 'data/rules.yaml', content: dumpYaml({ rules: plan.rules }) },
  ];
  for (const key of ['terrains', 'elements', 'constructions', 'technologies', 'puzzles'] as const) {
    sources.push(...collectionDocuments(key, plan[key], plan.layouts[key]));
  }
  sources.push(...scenarioDocuments(plan));
  for (const locale of plan.locales) {
    sources.push({
      path: `data/i18n/${String(locale['locale'])}.yaml`,
      content: dumpYaml(locale),
    });
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Propiedad 35: ida y vuelta de datos YAML
// ---------------------------------------------------------------------------

// Feature: hextown-base-game, Property 35: Ida y vuelta de datos YAML
describe('Propiedad 35: ida y vuelta de los datos YAML', () => {
  it('cargar → serializar → cargar reproduce el resultado de la primera carga', () => {
    // Requisito 20.9.
    fc.assert(
      fc.property(arbDataPlan, (plan) => {
        const first = expectLoaded(sourcesOf(plan));
        const second = expectLoaded(expectSerialized(first));

        expect(second).toEqual(first);
      }),
      RUNS,
    );
  });

  it('serializar → cargar → serializar produce el mismo YAML', () => {
    // Requisito 20.10.
    fc.assert(
      fc.property(arbDataPlan, (plan) => {
        const first = expectSerialized(expectLoaded(sourcesOf(plan)));
        const second = expectSerialized(expectLoaded(first));

        expect(second).toEqual(first);
      }),
      RUNS,
    );
  });

  it('escribe los mismos ficheros que se cargaron, sin perder ni inventar ninguno', () => {
    fc.assert(
      fc.property(arbDataPlan, (plan) => {
        const sources = sourcesOf(plan);
        const serialized = expectSerialized(expectLoaded(sources));

        expect(pathsOf(serialized)).toEqual(pathsOf(sources));
      }),
      RUNS,
    );
  });

  it('conserva el fichero y la ruta de cada definición, y sus claves de catálogo', () => {
    fc.assert(
      fc.property(arbDataPlan, (plan) => {
        const first = expectLoaded(sourcesOf(plan));
        const serialized = expectSerialized(first);
        const second = expectLoaded(serialized);

        // El fichero y la ruta son lo que el Validador_De_Datos muestra en sus
        // diagnósticos (Requisito 20.4): reescribir los datos no puede moverlos.
        for (const key of COLLECTION_KEYS) {
          expect(second[key].map((definition) => definition.sourceFile)).toEqual(
            first[key].map((definition) => definition.sourceFile),
          );
          expect(second[key].map((definition) => definition.fieldPath)).toEqual(
            first[key].map((definition) => definition.fieldPath),
          );
        }

        // Requisito 22.3: el fichero de contenido declara la clave de catálogo,
        // no el texto que el Gestor_De_Textos resolvería con ella.
        for (const terrain of second.terrains) {
          const source = serialized.find((candidate) => candidate.path === terrain.sourceFile);
          expect(terrain.nameKey).toBe(`terrain.${terrain.id}.name`);
          expect(source?.content).toContain(`terrain.${terrain.id}.name`);
        }
      }),
      RUNS,
    );
  });

  it('vale también para los ficheros de datos del juego', () => {
    // El caso concreto que más importa: el contenido de `data/` es el fichero
    // de datos válido con el que arranca el juego (Requisito 20.1), y sirve de
    // contraste para que los generadores no se separen de su forma real.
    expect(REAL_SOURCES.length).toBeGreaterThan(0);

    const first = expectLoaded(REAL_SOURCES);
    const serialized = expectSerialized(first);
    const second = expectLoaded(serialized);

    // Requisitos 20.9 y 20.10.
    expect(second).toEqual(first);
    expect(expectSerialized(second)).toEqual(serialized);
    expect(pathsOf(serialized)).toEqual(pathsOf(REAL_SOURCES));
  });
});

// ---------------------------------------------------------------------------
// Propiedad 36: manejo robusto de YAML inválido
// ---------------------------------------------------------------------------

/** Reglas válidas: sin ellas el cargador informa además de su ausencia. */
const VALID_RULES: DataSource = {
  path: 'data/rules.yaml',
  content: 'rules:\n  data_version: "1.0.0"\n  day:\n    fragments: 5\n',
};

/** Fichero al que se dirigen las entradas inválidas de los tests. */
const BROKEN_PATH = 'data/terrains.yaml';

/**
 * YAML sintácticamente inválido, por familias de fallo real: colección de flujo
 * sin cerrar, comilla sin cerrar, indentación incoherente, clave duplicada,
 * raíz que mezcla lista y mapa, alias inexistente, tabulador en la indentación
 * y etiqueta que no se puede resolver.
 */
const arbMalformedYaml = fc.oneof(
  arbWord.map((id) => `terrains:\n  - id: ${id}\n    tags: [uno, dos\n`),
  arbWord.map((id) => `terrains:\n  - id: "${id}\n`),
  fc.tuple(arbWord, arbWord).map(([id, key]) => `terrains:\n  - id: ${id}\n   name_key: ${key}\n`),
  arbWord.map((id) => `terrains:\n  - id: ${id}\n    id: ${id}\n`),
  arbWord.map((id) => `- ${id}\nterrains: 1\n`),
  arbWord.map((id) => `terrains: *${id}\n`),
  arbWord.map((id) => `terrains:\n\t- id: ${id}\n`),
  arbWord.map((id) => `terrains:\n  - id: !!int ${id}\n`),
  arbWord.map((id) => `terrains: {id: ${id}\n`),
  arbWord.map((id) => `terrains: @${id}\n`),
);

/** Documento que incumple el esquema, con el código de error que le toca. */
interface SchemaViolation {
  content: string;
  code: string;
}

/**
 * Documentos que sí son YAML válido pero que el cargador no puede interpretar:
 * raíz que no es un mapa, colección con la forma equivocada, definición sin
 * identificador, campo con el tipo equivocado y catálogo i18n mal declarado.
 */
const arbSchemaViolation: fc.Arbitrary<SchemaViolation> = fc.oneof(
  arbWord.map((id) => ({ content: `- id: ${id}\n`, code: 'invalid_document' })),
  arbWord.map((word) => ({ content: `"${word}"\n`, code: 'invalid_document' })),
  arbAmount.map((value) => ({
    content: `terrains: ${String(value)}\n`,
    code: 'invalid_collection',
  })),
  arbAmount.map((value) => ({
    content: `terrains:\n  - ${String(value)}\n`,
    code: 'invalid_definition',
  })),
  arbWord.map((key) => ({
    content: `terrains:\n  - name_key: ${key}\n`,
    code: 'missing_id',
  })),
  arbWord.map((id) => ({
    content: `technologies:\n  - id: ${id}\n    cost: [1, 2]\n`,
    code: 'invalid_field',
  })),
  arbWord.map((id) => ({
    content: `constructions:\n  - id: ${id}\n    levels: 3\n`,
    code: 'invalid_field',
  })),
  arbI18nKey.map((key) => ({
    content: `locale: es\nstrings:\n  ${key}: [1]\n`,
    code: 'invalid_i18n_value',
  })),
  fc.tuple(arbI18nKey, arbText).map(([key, text]) => ({
    content: dumpYaml({ strings: { [key]: text } }),
    code: 'missing_locale',
  })),
  fc.constant({ content: '\n', code: 'empty_document' }),
  arbWord.map((word) => ({
    content: `seccion_${word}: 1\n`,
    code: 'unrecognized_data_file',
  })),
);

// Feature: hextown-base-game, Property 36: Manejo robusto de YAML inválido
describe('Propiedad 36: manejo robusto del YAML inválido', () => {
  it('devuelve la posición del problema ante YAML sintácticamente inválido', () => {
    // Requisito 20.11.
    fc.assert(
      fc.property(arbMalformedYaml, (content) => {
        // El generador construye fallos reales de sintaxis; se comprueba antes
        // de exigir el diagnóstico, para no depender de js-yaml.
        fc.pre(!parsesAsYaml(content));
        const sources = [VALID_RULES, { path: BROKEN_PATH, content }];

        expect(() => loadAll(sources)).not.toThrow();
        const errors = expectLoadErrors(sources);
        const parseError = errors.find((error) => error.code === 'yaml_parse_error');

        expect(parseError).toBeDefined();
        expect(parseError?.message).toContain(BROKEN_PATH);
        expect(parseError?.context?.['file']).toBe(BROKEN_PATH);
        expect(typeof parseError?.context?.['reason']).toBe('string');
        // La posición se informa contando desde 1, como la muestra un editor.
        expect(parseError?.context?.['line']).toBeGreaterThanOrEqual(1);
        expect(parseError?.context?.['column']).toBeGreaterThanOrEqual(1);
      }),
      RUNS,
    );
  });

  it('identifica el fichero y el campo ante documentos que incumplen el esquema', () => {
    // Requisito 20.11: el error dice dónde está el problema, sin lanzar.
    fc.assert(
      fc.property(arbSchemaViolation, (violation) => {
        const sources = [VALID_RULES, { path: BROKEN_PATH, content: violation.content }];

        expect(() => loadAll(sources)).not.toThrow();
        const errors = expectLoadErrors(sources);

        expect(errors.map((error) => error.code)).toContain(violation.code);
        for (const error of errors) {
          expect(error.context?.['file']).toBe(BROKEN_PATH);
          expect(error.message).toContain(BROKEN_PATH);
        }
      }),
      RUNS,
    );
  });

  it('nunca lanza una excepción, sea cual sea el texto del fichero', () => {
    // Requisito 20.11: el cargador es total sobre cualquier entrada.
    const arbAnyContent = fc.oneof(
      fc.string({ maxLength: 80 }),
      fc.string({ unit: 'binary', maxLength: 40 }),
      arbMalformedYaml,
      arbSchemaViolation.map((violation) => violation.content),
    );

    fc.assert(
      fc.property(arbAnyContent, (content) => {
        const sources = [VALID_RULES, { path: BROKEN_PATH, content }];

        expect(() => loadAll(sources)).not.toThrow();
        const result = loadAll(sources);
        if (result.ok) {
          return;
        }
        expect(result.error.length).toBeGreaterThan(0);
        for (const error of result.error) {
          expect(error.code.length).toBeGreaterThan(0);
          expect(error.message.length).toBeGreaterThan(0);
        }
      }),
      RUNS,
    );
  });

  it('acumula un diagnóstico por fichero roto y no descarta los válidos', () => {
    fc.assert(
      fc.property(arbMalformedYaml, arbMalformedYaml, arbWord, (first, second, id) => {
        fc.pre(!parsesAsYaml(first) && !parsesAsYaml(second));
        const sources = [
          VALID_RULES,
          { path: 'data/terrains.yaml', content: first },
          { path: 'data/elements.yaml', content: second },
          { path: 'data/technologies.yaml', content: `technologies:\n  - id: ${id}\n` },
        ];

        const errors = expectLoadErrors(sources);
        const files = errors.map((error) => error.context?.['file']);

        expect(files).toContain('data/terrains.yaml');
        expect(files).toContain('data/elements.yaml');
        expect(files).not.toContain('data/technologies.yaml');
      }),
      RUNS,
    );
  });
});
