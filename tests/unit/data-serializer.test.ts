/**
 * Tests del Serializador_De_Datos (tarea 2.3).
 *
 * Cubre el Requisito 20.8: cualquier estructura de datos de contenido válida se
 * escribe en YAML que el Cargador_De_Datos vuelve a aceptar. Como comprobación
 * de que la escritura no pierde información se verifica también la ida y vuelta
 * de los Requisitos 20.9 (cargar → serializar → cargar) y 20.10 (serializar →
 * cargar → serializar) sobre una estructura escrita a mano y sobre los ficheros
 * reales de `data/`. La versión con datos generados de esta propiedad
 * (Propiedad 35) es la tarea 2.6.
 *
 * Nota sobre la equivalencia: no hace falta ignorar `sourceFile` ni `fieldPath`.
 * El serializador agrupa por fichero de origen y reconstruye la forma en que
 * cada definición se declaró (lista, mapa, escenario en la raíz o en un bloque
 * `scenario`), así que el `GameData` recargado los conserva y la comparación es
 * de igualdad profunda.
 */
import { describe, expect, it } from 'vitest';
import { loadAll } from '../../src/data/loader.ts';
import type { DataSource, GameData } from '../../src/data/loader.ts';
import { serializeAll, toDocuments } from '../../src/data/serializer.ts';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function expectLoaded(sources: DataSource[]): GameData {
  const result = loadAll(sources);
  if (!result.ok) {
    throw new Error(`carga fallida: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

function expectSerialized(data: GameData): DataSource[] {
  const result = serializeAll(data);
  if (!result.ok) {
    throw new Error(`serialización fallida: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

function contentOf(sources: DataSource[], path: string): string {
  const source = sources.find((candidate) => candidate.path === path);
  if (source === undefined) {
    throw new Error(`el serializador no ha escrito ${path}`);
  }
  return source.content;
}

// ---------------------------------------------------------------------------
// Estructura escrita a mano
// ---------------------------------------------------------------------------

/**
 * Estructura de contenido válida construida a mano, con la forma exacta que
 * entrega el Cargador_De_Datos: valores por defecto ya aplicados en cada `raw`,
 * claves i18n sin resolver y rutas de campo por definición.
 */
function handBuiltData(): GameData {
  const elementRaw = {
    id: 'bosque',
    name_key: 'element.bosque.name',
    category: 'forest',
    allowed_terrains: ['prado', 'tundra'],
    passive_effect: { radius: 2, comida_por_dia: 3 },
  };
  const levelRaw = { level: 1, build_time: 2, employs: 1, cost: { materiales: 10 } };
  const constructionRaw = {
    id: 'casa',
    name_key: 'construction.casa.name',
    allowed_terrains: ['prado'],
    produce_durante_mejora: true,
    levels: [levelRaw],
  };
  const optionRaw = { text_key: 'puzzle.monolito.option.1.text', correct: true };
  const puzzleRaw = {
    id: 'monolito',
    kind: 'misterio',
    mode: 'fijo',
    name_key: 'puzzle.monolito.name',
    options: [optionRaw],
  };
  const mapRaw = {
    radius: 8,
    seed: 12345,
    terrain_weights: { prado: 30, oceano: 20 },
    element_density: { bosque: 0.09 },
    constraints: { intentos_maximos: 50 },
  };
  const objectiveRaw = {
    desc_key: 'objective.main.desc',
    condition: { kind: 'resource', resource: 'oro', threshold: 500 },
    sustained_days: 1,
  };
  const missionRaw = {
    id: 'primera_casa',
    desc_key: 'mission.primera_casa.desc',
    condition: { kind: 'constructions', construction_id: 'casa', threshold: 1 },
  };
  const scenarioRaw = {
    id: 'valle_inicial',
    name_key: 'scenario.valle_inicial.name',
    map: mapRaw,
    starting_resources: { comida: 20, materiales: 10 },
    main_objective: objectiveRaw,
    missions: [missionRaw],
  };

  return {
    dataVersion: '2.0.0',
    rules: {
      values: {
        data_version: '2.0.0',
        day: { fragments: 5, seconds_normal: 6 },
        upgrades: { produce_durante_mejora: true },
        render: { paleta: ['#000000', '#fff1e8'], atlas_sprites: null },
        defaults: { elements: { production_per_day: {} } },
      },
      defaults: { elements: { production_per_day: {} } },
      sourceFiles: ['data/rules.yaml'],
    },
    terrains: [
      {
        id: 'prado',
        nameKey: 'terrain.prado.name',
        descKey: 'terrain.prado.desc',
        sourceFile: 'data/terrains.yaml',
        fieldPath: 'terrains[0]',
        raw: {
          id: 'prado',
          name_key: 'terrain.prado.name',
          desc_key: 'terrain.prado.desc',
          es_oceano: false,
        },
      },
    ],
    elements: [
      {
        id: 'bosque',
        nameKey: 'element.bosque.name',
        category: 'forest',
        allowedTerrains: ['prado', 'tundra'],
        sourceFile: 'data/elements.yaml',
        fieldPath: 'elements[0]',
        // El cargador aplica `defaults.elements` al cargar, así que la
        // estructura ya trae el campo por defecto en su `raw`.
        raw: { ...elementRaw, production_per_day: {} },
      },
    ],
    constructions: [
      {
        id: 'casa',
        nameKey: 'construction.casa.name',
        allowedTerrains: ['prado'],
        produceDuringUpgrade: true,
        sourceFile: 'data/constructions.yaml',
        fieldPath: 'constructions[0]',
        raw: constructionRaw,
        levels: [
          {
            level: 1,
            buildTime: 2,
            employs: 1,
            cost: { materiales: 10 },
            fieldPath: 'constructions[0].levels[0]',
            raw: levelRaw,
          },
        ],
      },
    ],
    technologies: [
      {
        id: 'ganaderia',
        nameKey: 'tech.ganaderia.name',
        branch: 'agricultura',
        tier: 1,
        cost: 20,
        researchTime: 3,
        sourceFile: 'data/technologies.yaml',
        fieldPath: 'technologies[0]',
        raw: {
          id: 'ganaderia',
          name_key: 'tech.ganaderia.name',
          branch: 'agricultura',
          tier: 1,
          cost: 20,
          research_time: 3,
        },
      },
    ],
    puzzles: [
      {
        id: 'monolito',
        nameKey: 'puzzle.monolito.name',
        kind: 'misterio',
        mode: 'fijo',
        sourceFile: 'data/puzzles/mysteries.yaml',
        fieldPath: 'puzzles[0]',
        raw: puzzleRaw,
        options: [
          {
            textKey: 'puzzle.monolito.option.1.text',
            correct: true,
            fieldPath: 'puzzles[0].options[0]',
            raw: optionRaw,
          },
        ],
      },
    ],
    scenarios: [
      {
        id: 'valle_inicial',
        nameKey: 'scenario.valle_inicial.name',
        sourceFile: 'data/scenarios/valle_inicial.yaml',
        fieldPath: 'scenario',
        raw: scenarioRaw,
        startingResources: { comida: 20, materiales: 10 },
        map: {
          radius: 8,
          terrainWeights: { prado: 30, oceano: 20 },
          elementDensity: { bosque: 0.09 },
          constraints: { intentos_maximos: 50 },
          fieldPath: 'scenario.map',
          raw: mapRaw,
        },
        mainObjective: {
          descKey: 'objective.main.desc',
          condition: { kind: 'resource', resource: 'oro', threshold: 500 },
          sustainedDays: 1,
          fieldPath: 'scenario.main_objective',
          raw: objectiveRaw,
        },
        missions: [
          {
            id: 'primera_casa',
            descKey: 'mission.primera_casa.desc',
            condition: { kind: 'constructions', construction_id: 'casa', threshold: 1 },
            fieldPath: 'scenario.missions[0]',
            raw: missionRaw,
          },
        ],
      },
    ],
    locales: [
      {
        locale: 'es',
        numberFormat: { decimalSeparator: ',', thousandsSeparator: '.' },
        pluralRules: 'spanish',
        strings: new Map([
          ['terrain.prado.name', 'Prado'],
          ['terrain.prado.desc', 'Tierra fértil para cultivos y ganado.'],
          ['element.bosque.name', 'Bosque'],
        ]),
        sourceFiles: ['data/i18n/es.yaml'],
      },
    ],
  };
}

describe('serializeAll: estructuras de contenido escritas a mano', () => {
  it('escribe YAML que el cargador acepta y que reproduce la estructura', () => {
    // Requisitos 20.8 y 20.9.
    const original = handBuiltData();
    const serialized = expectSerialized(original);

    expect(serialized.map((source) => source.path).sort()).toEqual([
      'data/constructions.yaml',
      'data/elements.yaml',
      'data/i18n/es.yaml',
      'data/puzzles/mysteries.yaml',
      'data/rules.yaml',
      'data/scenarios/valle_inicial.yaml',
      'data/technologies.yaml',
      'data/terrains.yaml',
    ]);

    expect(expectLoaded(serialized)).toEqual(original);
  });

  it('serializar → cargar → serializar produce el mismo YAML', () => {
    // Requisito 20.10.
    const first = expectSerialized(handBuiltData());
    const second = expectSerialized(expectLoaded(first));
    expect(second).toEqual(first);
  });

  it('escribe las claves i18n, no el texto del catálogo', () => {
    // Requisito 22.3: los datos declaran claves; el Gestor_De_Textos resuelve.
    const serialized = expectSerialized(handBuiltData());
    const terrains = contentOf(serialized, 'data/terrains.yaml');
    expect(terrains).toContain('name_key: terrain.prado.name');
    expect(terrains).not.toContain('Prado');
  });

  it('conserva los tipos numéricos y de cadena de cada campo', () => {
    const reloaded = expectLoaded(expectSerialized(handBuiltData()));
    const level = reloaded.constructions[0]?.levels?.[0];
    expect(level?.buildTime).toBe(2);
    expect(level?.cost).toEqual({ materiales: 10 });
    expect(reloaded.scenarios[0]?.map?.elementDensity).toEqual({ bosque: 0.09 });
    expect(reloaded.scenarios[0]?.raw['id']).toBe('valle_inicial');
    expect(reloaded.terrains[0]?.raw['es_oceano']).toBe(false);
    expect(reloaded.rules.values['render']).toEqual({
      paleta: ['#000000', '#fff1e8'],
      atlas_sprites: null,
    });
  });

  it('escribe una cabecera de comentario cuando se le indica', () => {
    const result = serializeAll(handBuiltData(), { header: 'Fichero generado\npor Hextown' });
    if (!result.ok) {
      throw new Error('serialización fallida');
    }
    const terrains = contentOf(result.value, 'data/terrains.yaml');
    expect(terrains.startsWith('# Fichero generado\n# por Hextown\n')).toBe(true);
    // La cabecera es un comentario: el cargador la ignora.
    expect(expectLoaded(result.value).terrains[0]?.id).toBe('prado');
  });
});

describe('serializeAll: formas de declaración', () => {
  const RULES = 'rules:\n  data_version: "1.0"\n  upgrades:\n    produce_durante_mejora: true\n';

  it('conserva una colección declarada como mapa', () => {
    const sources: DataSource[] = [
      { path: 'data/rules.yaml', content: RULES },
      {
        path: 'data/terrains.yaml',
        content: 'terrains:\n  prado:\n    name_key: terrain.prado.name\n  tundra:\n    id: helada\n',
      },
    ];
    const first = expectLoaded(sources);
    const serialized = expectSerialized(first);

    expect(contentOf(serialized, 'data/terrains.yaml')).toContain('terrains:\n  prado:');
    const second = expectLoaded(serialized);
    expect(second).toEqual(first);
    // La clave del mapa se conserva aunque no coincida con el id declarado.
    expect(second.terrains[1]?.fieldPath).toBe('terrains.tundra');
    expect(second.terrains[1]?.id).toBe('helada');
  });

  it('conserva un escenario declarado en la raíz de su fichero', () => {
    const sources: DataSource[] = [
      { path: 'data/rules.yaml', content: RULES },
      {
        path: 'data/scenarios/valle.yaml',
        content: 'id: valle\nname_key: scenario.valle.name\nmap:\n  radius: 4\n',
      },
    ];
    const first = expectLoaded(sources);
    const serialized = expectSerialized(first);

    expect(contentOf(serialized, 'data/scenarios/valle.yaml').startsWith('id: valle')).toBe(true);
    const second = expectLoaded(serialized);
    expect(second).toEqual(first);
    expect(second.scenarios[0]?.fieldPath).toBe('');
  });

  it('conserva el orden de una colección repartida entre varios ficheros', () => {
    // El orden de declaración de los elementos es significativo (Requisito 1.4).
    const sources: DataSource[] = [
      { path: 'data/rules.yaml', content: RULES },
      { path: 'data/elements-b.yaml', content: 'elements:\n  - id: montana\n  - id: bosque\n' },
      { path: 'data/elements-a.yaml', content: 'elements:\n  - id: vaca\n' },
    ];
    const first = expectLoaded(sources);
    const second = expectLoaded(expectSerialized(first));
    expect(second.elements.map((element) => element.id)).toEqual(['montana', 'bosque', 'vaca']);
    expect(second).toEqual(first);
  });

  it('conserva los ficheros de un idioma repartido en varios catálogos', () => {
    const sources: DataSource[] = [
      { path: 'data/rules.yaml', content: RULES },
      {
        path: 'data/i18n/es.yaml',
        content: 'locale: es\nplural_rules: spanish\nstrings:\n  ui.explore: Explorar\n',
      },
      { path: 'data/i18n/es-eventos.yaml', content: 'locale: es\nstrings:\n  event.famine: Hambruna\n' },
    ];
    const first = expectLoaded(sources);
    const second = expectLoaded(expectSerialized(first));
    expect(second).toEqual(first);
    expect(second.locales[0]?.sourceFiles).toEqual([
      'data/i18n/es.yaml',
      'data/i18n/es-eventos.yaml',
    ]);
    expect(second.locales[0]?.strings.size).toBe(2);
  });

  it('materializa data_version cuando los datos no lo declaraban', () => {
    // Sin `data_version` el cargador deriva `dataVersion` de un hash del
    // contenido; escribirlo mantiene el identificador de los datos al reescribir
    // los ficheros (Requisito 21.3).
    const sources: DataSource[] = [
      { path: 'data/rules.yaml', content: 'rules:\n  day:\n    fragments: 5\n' },
      { path: 'data/terrains.yaml', content: 'terrains:\n  - id: prado\n' },
    ];
    const first = expectLoaded(sources);
    const second = expectLoaded(expectSerialized(first));
    expect(second.dataVersion).toBe(first.dataVersion);
    expect(second.rules.values['data_version']).toBe(first.dataVersion);
  });
});

describe('serializeAll: condiciones de error', () => {
  it('devuelve un error con el fichero cuando un valor no es representable', () => {
    const data = handBuiltData();
    const terrain = data.terrains[0];
    if (terrain === undefined) {
      throw new Error('estructura de prueba incompleta');
    }
    terrain.raw['al_construir'] = (): number => 1;

    const result = serializeAll(data);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error[0]?.code).toBe('yaml_dump_error');
    expect(result.error[0]?.context?.['file']).toBe('data/terrains.yaml');
  });

  it('no lanza ante estructuras incompletas y escribe siempre las reglas', () => {
    const empty: GameData = {
      dataVersion: 'vacio',
      rules: { values: {}, defaults: {}, sourceFiles: [] },
      terrains: [],
      elements: [],
      constructions: [],
      technologies: [],
      puzzles: [],
      scenarios: [],
      locales: [],
    };
    const serialized = expectSerialized(empty);
    expect(serialized.map((source) => source.path)).toEqual(['data/rules.yaml']);
    // El documento de reglas se sigue reconociendo, así que la salida carga.
    expect(expectLoaded(serialized).dataVersion).toBe('vacio');
  });

  it('descarta los campos sin valor en lugar de fallar', () => {
    const data = handBuiltData();
    const terrain = data.terrains[0];
    if (terrain === undefined) {
      throw new Error('estructura de prueba incompleta');
    }
    terrain.raw['sin_valor'] = undefined;
    const documents = toDocuments(data);
    const terrains = documents.find((document) => document.path === 'data/terrains.yaml');
    const declared = (terrains?.mapping['terrains'] as Record<string, unknown>[] | undefined)?.[0];
    expect(declared).toBeDefined();
    expect(Object.keys(declared ?? {})).not.toContain('sin_valor');
    expect(expectLoaded(expectSerialized(data)).terrains[0]?.id).toBe('prado');
  });
});

// ---------------------------------------------------------------------------
// Ficheros reales de `data/`
// ---------------------------------------------------------------------------

/** Contenido en bruto de todos los ficheros de datos, indexado por ruta. */
const RAW_YAML: Record<string, string> = import.meta.glob('../../data/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Ficheros reales en orden de ruta, como los cargaría el arranque del juego. */
const REAL_SOURCES: DataSource[] = Object.keys(RAW_YAML)
  .sort()
  .map((key) => {
    const content = RAW_YAML[key];
    if (typeof content !== 'string') {
      throw new Error(`no se ha podido leer ${key}`);
    }
    return { path: key.replace('../../', ''), content };
  });

describe('serializeAll: ficheros reales de data/', () => {
  it('cargar → serializar → cargar produce el mismo GameData', () => {
    // Requisito 20.9 sobre los ficheros de contenido del juego.
    const first = expectLoaded(REAL_SOURCES);
    const serialized = expectSerialized(first);

    expect(serialized.map((source) => source.path).sort()).toEqual(
      REAL_SOURCES.map((source) => source.path).sort(),
    );
    expect(expectLoaded(serialized)).toEqual(first);
  });

  it('serializar → cargar → serializar produce el mismo YAML', () => {
    // Requisito 20.10 sobre los ficheros de contenido del juego.
    const first = expectSerialized(expectLoaded(REAL_SOURCES));
    const second = expectSerialized(expectLoaded(first));
    expect(second).toEqual(first);
  });

  it('conserva las claves del catálogo sin resolverlas a texto', () => {
    const data = expectLoaded(REAL_SOURCES);
    const serialized = expectSerialized(data);
    const casaName = data.locales[0]?.strings.get('construction.casa.name');

    const constructions = contentOf(serialized, 'data/constructions.yaml');
    expect(constructions).toContain('name_key: construction.casa.name');
    expect(constructions).not.toContain(`name_key: ${String(casaName)}`);
    // Los textos siguen viviendo solo en el catálogo del idioma.
    expect(contentOf(serialized, 'data/i18n/es.yaml')).toContain(
      `construction.casa.name: ${String(casaName)}`,
    );
  });
});
