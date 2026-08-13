import { describe, expect, it } from 'vitest';
import { loadAll } from '../../src/data/loader.ts';
import type { DataSource, GameData } from '../../src/data/loader.ts';
import type { GameError } from '../../src/core/result.ts';

/** Reglas globales mínimas con los valores por defecto usados en los tests. */
const RULES_YAML = `
day:
  fragments: 6
  seconds_normal: 30
  seconds_fast: 10
upgrades:
  produce_durante_mejora: true
  devolucion_por_cancelacion: 0.5
defaults:
  elements:
    allowed_terrains: [prado]
  technologies:
    dependencies: []
    tier: 1
  construction_levels:
    requires_tech: []
  puzzles:
    mode: fixed
`;

function source(path: string, content: string): DataSource {
  return { path, content };
}

/** Reglas siempre presentes: sin ellas el cargador no puede aplicar defaults. */
function withRules(...sources: DataSource[]): DataSource[] {
  return [source('data/rules.yaml', RULES_YAML), ...sources];
}

/** Devuelve los datos cargados y falla el test si el cargador devolvió errores. */
function expectLoaded(sources: DataSource[]): GameData {
  const result = loadAll(sources);
  if (!result.ok) {
    throw new Error(`carga fallida: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

/** Devuelve los errores acumulados y falla el test si la carga tuvo éxito. */
function expectErrors(sources: DataSource[]): GameError[] {
  const result = loadAll(sources);
  if (result.ok) {
    throw new Error('se esperaba un fallo de carga');
  }
  return result.error;
}

describe('loadAll: colecciones de contenido', () => {
  it('carga terrenos, elementos, construcciones, tecnologías, puzzles y escenarios', () => {
    const data = expectLoaded(
      withRules(
        source(
          'data/terrains.yaml',
          `
terrains:
  - id: prado
    name_key: terrain.prado.name
    desc_key: terrain.prado.desc
  - id: oceano
    name_key: terrain.oceano.name
`,
        ),
        source(
          'data/elements.yaml',
          `
elements:
  - id: bosque
    name_key: element.bosque.name
    category: forest
    allowed_terrains: [prado, tundra]
`,
        ),
        source(
          'data/constructions.yaml',
          `
constructions:
  - id: casa
    name_key: construction.casa.name
    allowed_terrains: [prado, tundra]
    levels:
      - level: 1
        build_time: 2
        employs: 1
        cost:
          materiales: 10
      - level: 2
        build_time: 3
        employs: 2
        cost:
          materiales: 25
          oro: 5
        requires_tech: [carpinteria]
`,
        ),
        source(
          'data/technologies.yaml',
          `
technologies:
  - id: ganaderia
    name_key: tech.ganaderia.name
    branch: agricultura
    tier: 1
    cost: 20
    research_time: 3
  - id: carpinteria
    name_key: tech.carpinteria.name
    branch: construccion
    tier: 2
    cost: 30
    research_time: 4
    dependencies: [ganaderia]
`,
        ),
        source(
          'data/puzzles/mysteries.yaml',
          `
puzzles:
  - id: monolito
    kind: mystery
    name_key: puzzle.monolito.name
    options:
      - text_key: puzzle.monolito.option.1
        correct: true
      - text_key: puzzle.monolito.option.2
        correct: false
`,
        ),
        source(
          'data/scenarios/valle_inicial.yaml',
          `
id: valle_inicial
name_key: scenario.valle_inicial.name
map:
  radius: 8
  terrain_weights:
    prado: 40
    oceano: 10
  element_density:
    bosque: 0.1
  constraints:
    intentos_maximos: 50
    nivel_amenaza_por_anillo: 0.5
starting_resources:
  comida: 20
  materiales: 10
main_objective:
  desc_key: objective.main.desc
  condition:
    kind: resource
    resource: oro
    threshold: 500
missions:
  - id: primera_casa
    desc_key: mission.primera_casa.desc
    condition:
      kind: constructions
      construction_id: casa
      threshold: 1
`,
        ),
      ),
    );

    expect(data.terrains.map((terrain) => terrain.id)).toEqual(['prado', 'oceano']);
    expect(data.elements[0]?.category).toBe('forest');
    expect(data.elements[0]?.allowedTerrains).toEqual(['prado', 'tundra']);

    const casa = data.constructions[0];
    expect(casa?.allowedTerrains).toEqual(['prado', 'tundra']);
    expect(casa?.levels?.map((level) => level.level)).toEqual([1, 2]);
    expect(casa?.levels?.[1]?.cost).toEqual({ materiales: 25, oro: 5 });
    expect(casa?.levels?.[1]?.requiresTech).toEqual(['carpinteria']);

    expect(data.technologies[1]?.dependencies).toEqual(['ganaderia']);
    expect(data.technologies[1]?.researchTime).toBe(4);

    expect(data.puzzles[0]?.kind).toBe('mystery');
    expect(data.puzzles[0]?.options?.map((option) => option.correct)).toEqual([true, false]);

    const scenario = data.scenarios[0];
    expect(scenario?.id).toBe('valle_inicial');
    expect(scenario?.map?.radius).toBe(8);
    expect(scenario?.map?.terrainWeights).toEqual({ prado: 40, oceano: 10 });
    expect(scenario?.map?.elementDensity).toEqual({ bosque: 0.1 });
    expect(scenario?.map?.constraints?.['intentos_maximos']).toBe(50);
    expect(scenario?.startingResources).toEqual({ comida: 20, materiales: 10 });
    expect(scenario?.missions?.map((mission) => mission.id)).toEqual(['primera_casa']);
  });

  it('conserva el orden de declaración de los elementos', () => {
    // El Generador_De_Mapa coloca los elementos en el orden declarado (Req 1.4).
    const data = expectLoaded(
      withRules(
        source(
          'data/elements.yaml',
          `
elements:
  - id: montana
  - id: bosque
  - id: vaca
  - id: lobos
`,
        ),
      ),
    );
    expect(data.elements.map((element) => element.id)).toEqual([
      'montana',
      'bosque',
      'vaca',
      'lobos',
    ]);
  });

  it('admite colecciones declaradas como mapa tomando la clave como id', () => {
    const data = expectLoaded(
      withRules(
        source(
          'data/terrains.yaml',
          `
terrains:
  prado:
    name_key: terrain.prado.name
  desierto:
    name_key: terrain.desierto.name
`,
        ),
      ),
    );
    expect(data.terrains.map((terrain) => terrain.id)).toEqual(['prado', 'desierto']);
    expect(data.terrains[1]?.nameKey).toBe('terrain.desierto.name');
  });

  it('admite el escenario en un bloque scenario', () => {
    const data = expectLoaded(
      withRules(
        source(
          'data/scenarios/otro.yaml',
          `
scenario:
  id: otro_valle
  map:
    radius: 6
`,
        ),
      ),
    );
    expect(data.scenarios[0]?.id).toBe('otro_valle');
    expect(data.scenarios[0]?.map?.radius).toBe(6);
  });

  it('conserva las definiciones que repiten identificador para el validador', () => {
    // Los identificadores duplicados los rechaza el Validador_De_Datos (Req 20.5),
    // por lo que el cargador no puede descartar ninguna definición.
    const data = expectLoaded(
      withRules(
        source('data/terrains.yaml', 'terrains:\n  - id: prado\n'),
        source('data/extra.yaml', 'terrains:\n  - id: prado\n'),
      ),
    );
    expect(data.terrains.map((terrain) => terrain.sourceFile)).toEqual([
      'data/terrains.yaml',
      'data/extra.yaml',
    ]);
  });

  it('conserva los campos que no interpreta', () => {
    // Requisito 20.7: contenido nuevo sin cambios en el código.
    const data = expectLoaded(
      withRules(
        source(
          'data/elements.yaml',
          `
elements:
  - id: ballenas
    passive_effect:
      radius: 2
      comida_por_dia: 3
`,
        ),
      ),
    );
    expect(data.elements[0]?.raw['passive_effect']).toEqual({
      radius: 2,
      comida_por_dia: 3,
    });
  });
});

describe('loadAll: valores por defecto de las reglas globales', () => {
  it('aplica los defaults declarados a los campos ausentes', () => {
    // Requisito 20.2.
    const data = expectLoaded(
      withRules(
        source('data/elements.yaml', 'elements:\n  - id: vaca\n'),
        source('data/technologies.yaml', 'technologies:\n  - id: ganaderia\n    cost: 10\n'),
        source(
          'data/constructions.yaml',
          'constructions:\n  - id: casa\n    levels:\n      - level: 1\n',
        ),
        source('data/puzzles/settlements.yaml', 'puzzles:\n  - id: vado\n'),
      ),
    );

    expect(data.elements[0]?.allowedTerrains).toEqual(['prado']);
    expect(data.technologies[0]?.dependencies).toEqual([]);
    expect(data.technologies[0]?.tier).toBe(1);
    expect(data.constructions[0]?.levels?.[0]?.requiresTech).toEqual([]);
    expect(data.puzzles[0]?.mode).toBe('fixed');
  });

  it('no sobrescribe los campos declarados', () => {
    const data = expectLoaded(
      withRules(
        source(
          'data/elements.yaml',
          'elements:\n  - id: peces\n    allowed_terrains: [oceano]\n',
        ),
        source('data/puzzles/settlements.yaml', 'puzzles:\n  - id: pozo\n    mode: generated\n'),
      ),
    );
    expect(data.elements[0]?.allowedTerrains).toEqual(['oceano']);
    expect(data.puzzles[0]?.mode).toBe('generated');
  });

  it('no comparte los valores por defecto entre definiciones', () => {
    const data = expectLoaded(
      withRules(source('data/elements.yaml', 'elements:\n  - id: vaca\n  - id: oveja\n')),
    );
    const first = data.elements[0]?.raw['allowed_terrains'];
    const second = data.elements[1]?.raw['allowed_terrains'];
    expect(first).toEqual(['prado']);
    expect(second).toEqual(['prado']);
    expect(first).not.toBe(second);
  });

  it('toma produce_durante_mejora de rules.upgrades cuando la construcción no lo declara', () => {
    // Requisito 7.8.
    const data = expectLoaded(
      withRules(
        source(
          'data/constructions.yaml',
          `
constructions:
  - id: casa
    levels:
      - level: 1
  - id: mina
    produce_durante_mejora: false
    levels:
      - level: 1
`,
        ),
      ),
    );
    expect(data.constructions[0]?.produceDuringUpgrade).toBe(true);
    expect(data.constructions[1]?.produceDuringUpgrade).toBe(false);
  });

  it('aplica sustained_days igual a 1 cuando el objetivo no lo declara', () => {
    // Requisito 15.1.
    const data = expectLoaded(
      withRules(
        source(
          'data/scenarios/valle.yaml',
          `
id: valle
map:
  radius: 4
main_objective:
  desc_key: objective.main.desc
  condition:
    kind: explored_hexes
    threshold: 30
`,
        ),
        source(
          'data/scenarios/otro.yaml',
          `
id: otro
map:
  radius: 4
main_objective:
  condition:
    kind: explored_hexes
    threshold: 30
  sustained_days: 5
`,
        ),
      ),
    );
    expect(data.scenarios[0]?.mainObjective?.sustainedDays).toBe(1);
    expect(data.scenarios[0]?.mainObjective?.raw['sustained_days']).toBe(1);
    expect(data.scenarios[1]?.mainObjective?.sustainedDays).toBe(5);
  });
});

describe('loadAll: claves de catálogo i18n', () => {
  it('interpreta nombre y descripción como claves, no como textos', () => {
    // Requisito 22.3.
    const data = expectLoaded(
      withRules(
        source(
          'data/terrains.yaml',
          'terrains:\n  - id: prado\n    name_key: terrain.prado.name\n    desc_key: terrain.prado.desc\n',
        ),
        source(
          'data/i18n/es.yaml',
          `
locale: es
number_format:
  decimal_separator: ","
  thousands_separator: "."
plural_rules: spanish
strings:
  terrain.prado.name: Prado
  terrain.prado.desc: Tierra fértil para cultivos y ganado.
`,
        ),
      ),
    );

    const prado = data.terrains[0];
    expect(prado?.nameKey).toBe('terrain.prado.name');
    expect(prado?.descKey).toBe('terrain.prado.desc');

    const catalog = data.locales[0];
    expect(catalog?.locale).toBe('es');
    expect(catalog?.pluralRules).toBe('spanish');
    expect(catalog?.numberFormat).toEqual({ decimalSeparator: ',', thousandsSeparator: '.' });
    expect(catalog?.strings.get('terrain.prado.name')).toBe('Prado');
    // El cargador no resuelve la clave: eso es tarea del Gestor_De_Textos.
    expect(prado?.nameKey).not.toBe('Prado');
  });

  it('interpreta el campo name como clave cuando no hay name_key', () => {
    const data = expectLoaded(
      withRules(source('data/terrains.yaml', 'terrains:\n  - id: tundra\n    name: terrain.tundra.name\n')),
    );
    expect(data.terrains[0]?.nameKey).toBe('terrain.tundra.name');
  });

  it('mezcla varios ficheros del mismo idioma', () => {
    const data = expectLoaded(
      withRules(
        source('data/i18n/es.yaml', 'locale: es\nstrings:\n  ui.button.explore: Explorar\n'),
        source('data/i18n/es-eventos.yaml', 'locale: es\nstrings:\n  event.famine: Hambruna\n'),
      ),
    );
    expect(data.locales).toHaveLength(1);
    expect(data.locales[0]?.strings.size).toBe(2);
    expect(data.locales[0]?.sourceFiles).toEqual(['data/i18n/es.yaml', 'data/i18n/es-eventos.yaml']);
  });

  it('rechaza la misma clave declarada en dos ficheros del mismo idioma', () => {
    const errors = expectErrors(
      withRules(
        source('data/i18n/es.yaml', 'locale: es\nstrings:\n  ui.button.explore: Explorar\n'),
        source('data/i18n/es-extra.yaml', 'locale: es\nstrings:\n  ui.button.explore: Descubrir\n'),
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('duplicate_i18n_key');
    expect(errors[0]?.context?.['file']).toBe('data/i18n/es-extra.yaml');
  });
});

describe('loadAll: dataVersion', () => {
  it('usa data_version de las reglas cuando se declara', () => {
    const data = expectLoaded([source('data/rules.yaml', `${RULES_YAML}data_version: "2024.1"\n`)]);
    expect(data.dataVersion).toBe('2024.1');
  });

  it('calcula un identificador estable e independiente del orden de carga', () => {
    const terrains = source('data/terrains.yaml', 'terrains:\n  - id: prado\n');
    const elements = source('data/elements.yaml', 'elements:\n  - id: bosque\n');
    const rules = source('data/rules.yaml', RULES_YAML);

    const first = expectLoaded([rules, terrains, elements]).dataVersion;
    const second = expectLoaded([elements, rules, terrains]).dataVersion;
    const changed = expectLoaded([
      rules,
      source('data/terrains.yaml', 'terrains:\n  - id: tundra\n'),
      elements,
    ]).dataVersion;

    expect(first).toBe(second);
    expect(first).not.toBe(changed);
  });
});

describe('loadAll: condiciones de error', () => {
  it('devuelve la posición del YAML sintácticamente inválido sin lanzar', () => {
    // Requisito 20.11.
    const errors = expectErrors(
      withRules(source('data/terrains.yaml', 'terrains:\n  - id: prado\n   name_key: mal\n')),
    );
    expect(errors[0]?.code).toBe('yaml_parse_error');
    expect(errors[0]?.context?.['file']).toBe('data/terrains.yaml');
    expect(errors[0]?.context?.['line']).toBeGreaterThan(0);
    expect(errors[0]?.context?.['column']).toBeGreaterThan(0);
  });

  it('acumula los errores de todos los ficheros', () => {
    // Requisito 20.4: se informa de cada error, no solo del primero.
    const errors = expectErrors(
      withRules(
        source('data/terrains.yaml', 'terrains:\n  - {id: prado\n'),
        source('data/elements.yaml', 'elements:\n  - name_key: element.bosque.name\n'),
        source('data/constructions.yaml', 'constructions:\n  - id: casa\n    levels: 3\n'),
      ),
    );
    expect(errors.map((error) => error.code)).toEqual([
      'yaml_parse_error',
      'missing_id',
      'invalid_field',
    ]);
  });

  it('informa del fichero y de la ruta del campo con tipo incorrecto', () => {
    const errors = expectErrors(
      withRules(
        source(
          'data/elements.yaml',
          'elements:\n  - id: bosque\n    allowed_terrains: prado\n',
        ),
      ),
    );
    expect(errors[0]?.code).toBe('invalid_field');
    expect(errors[0]?.context?.['file']).toBe('data/elements.yaml');
    expect(errors[0]?.context?.['path']).toBe('elements[0].allowed_terrains');
    expect(errors[0]?.context?.['found']).toBe('string');
  });

  it('informa de la ruta de un nivel de construcción con coste inválido', () => {
    const errors = expectErrors(
      withRules(
        source(
          'data/constructions.yaml',
          'constructions:\n  - id: casa\n    levels:\n      - level: 1\n        cost:\n          materiales: mucho\n',
        ),
      ),
    );
    expect(errors[0]?.context?.['path']).toBe('constructions[0].levels[0].cost.materiales');
  });

  it('rechaza una colección que no es lista ni mapa', () => {
    const errors = expectErrors(withRules(source('data/terrains.yaml', 'terrains: prado\n')));
    expect(errors[0]?.code).toBe('invalid_collection');
    expect(errors[0]?.context?.['path']).toBe('terrains');
  });

  it('rechaza un documento vacío y uno cuya raíz no es un mapa', () => {
    const errors = expectErrors(
      withRules(
        source('data/vacio.yaml', '# sin contenido\n'),
        source('data/lista.yaml', '- prado\n- tundra\n'),
      ),
    );
    expect(errors.map((error) => error.code)).toEqual(['empty_document', 'invalid_document']);
  });

  it('informa del id ausente en un escenario declarado en la raíz', () => {
    const errors = expectErrors(
      withRules(source('data/scenarios/sin-id.yaml', 'map:\n  radius: 4\n')),
    );
    expect(errors[0]?.code).toBe('missing_id');
    expect(errors[0]?.context?.['file']).toBe('data/scenarios/sin-id.yaml');
    expect(errors[0]?.context?.['path']).toBe('id');
  });

  it('rechaza un fichero sin secciones reconocibles', () => {
    const errors = expectErrors(withRules(source('data/otro.yaml', 'cosas:\n  - id: prado\n')));
    expect(errors[0]?.code).toBe('unrecognized_data_file');
    expect(errors[0]?.context?.['topLevelKeys']).toEqual(['cosas']);
  });

  it('rechaza la carga cuando no hay reglas globales', () => {
    const errors = expectErrors([source('data/terrains.yaml', 'terrains:\n  - id: prado\n')]);
    expect(errors.map((error) => error.code)).toContain('missing_rules');
  });

  it('rechaza un catálogo de textos sin locale y textos que no son cadenas', () => {
    const errors = expectErrors(
      withRules(
        source('data/i18n/sin-locale.yaml', 'strings:\n  ui.button.explore: Explorar\n'),
        source('data/i18n/es.yaml', 'locale: es\nstrings:\n  ui.button.attack:\n    a: 1\n'),
      ),
    );
    expect(errors.map((error) => error.code)).toEqual(['missing_locale', 'invalid_i18n_value']);
    expect(errors[1]?.context?.['path']).toBe('strings.ui.button.attack');
  });

  it('no lanza ante entradas que no son YAML de datos', () => {
    for (const content of ['', '???', '\t- a', 'a: [1, 2', '{"a": 1}', 'null']) {
      expect(() => loadAll([source('data/raro.yaml', content)])).not.toThrow();
      expect(loadAll([source('data/raro.yaml', content)]).ok).toBe(false);
    }
  });
});
