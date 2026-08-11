/**
 * Comprobaciones de los ficheros de datos YAML de `data/` (tarea 2.4).
 *
 * Estos tests no dependen del Cargador_De_Datos: parsean los ficheros con
 * js-yaml y verifican lo que el Validador_De_Datos exigirá más adelante, para
 * que los datos no puedan romperse en silencio.
 *
 * Cubre: Requisitos 20.1 (todo el contenido en YAML), 20.3 (referencias
 * cruzadas), 20.5 (identificadores únicos), 22.1 y 22.4 (toda clave declarada
 * existe en el catálogo de español), 16.15 y 16.16 (poblados y misterios de la
 * Fase 1), 7.15 (monotonía de costes por nivel) y 15.7 (número de misiones).
 */
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

/** Contenido en bruto de todos los ficheros de datos, indexado por ruta. */
const RAW_YAML: Record<string, string> = import.meta.glob('../../data/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

type Dict = Record<string, unknown>;

function readYaml(relativePath: string): Dict {
  const raw = RAW_YAML[`../../data/${relativePath}`];

  if (typeof raw !== 'string') {
    throw new Error(`No existe el fichero de datos data/${relativePath}`);
  }

  const parsed = load(raw);

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`data/${relativePath} no parsea a un objeto YAML`);
  }

  return parsed as Dict;
}

function asList(value: unknown): Dict[] {
  expect(Array.isArray(value)).toBe(true);

  return value as Dict[];
}

/** Recoge recursivamente el valor de todo campo cuyo nombre acaba en `_key`. */
function collectTextKeys(node: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) collectTextKeys(item, found);

    return found;
  }

  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Dict)) {
      if (key.endsWith('_key') && typeof value === 'string') {
        found.add(value);
      } else {
        collectTextKeys(value, found);
      }
    }
  }

  return found;
}

function ids(entries: Dict[]): string[] {
  return entries.map((entry) => entry['id'] as string);
}

function totalCost(cost: unknown): number {
  if (cost === null || cost === undefined) return 0;

  return Object.values(cost as Record<string, number>).reduce((sum, value) => sum + value, 0);
}

// --- Ficheros cargados una sola vez para todos los tests -------------------
const RULES_FILE = readYaml('rules.yaml');
const TERRAINS_FILE = readYaml('terrains.yaml');
const ELEMENTS_FILE = readYaml('elements.yaml');
const CONSTRUCTIONS_FILE = readYaml('constructions.yaml');
const TECHNOLOGIES_FILE = readYaml('technologies.yaml');
const SETTLEMENTS_FILE = readYaml('puzzles/settlements.yaml');
const MYSTERIES_FILE = readYaml('puzzles/mysteries.yaml');
const SCENARIO_FILE = readYaml('scenarios/valle_inicial.yaml');
const I18N_FILE = readYaml('i18n/es.yaml');

const rules = RULES_FILE['rules'] as Dict;
const terrains = asList(TERRAINS_FILE['terrains']);
const elements = asList(ELEMENTS_FILE['elements']);
const constructions = asList(CONSTRUCTIONS_FILE['constructions']);
const technologies = asList(TECHNOLOGIES_FILE['technologies']);
const settlementPuzzles = asList(SETTLEMENTS_FILE['puzzles']);
const mysteryPuzzles = asList(MYSTERIES_FILE['puzzles']);
const scenario = SCENARIO_FILE['scenario'] as Dict;
const strings = I18N_FILE['strings'] as Record<string, string>;

const terrainIds = new Set(ids(terrains));
const elementIds = new Set(ids(elements));
const constructionIds = new Set(ids(constructions));
const technologyIds = new Set(ids(technologies));
const puzzles = [...settlementPuzzles, ...mysteryPuzzles];

describe('reglas globales (rules.yaml)', () => {
  it('declara la versión de los datos y los valores por defecto por categoría', () => {
    expect(rules['data_version']).toBeTypeOf('string');

    const defaults = rules['defaults'] as Dict;

    expect(defaults).toBeDefined();

    for (const category of Object.keys(defaults)) {
      expect(defaults[category], `defaults.${category}`).toBeTypeOf('object');
    }
  });

  it('declara todos los bloques de parámetros que usan los sistemas', () => {
    for (const block of [
      'day',
      'food',
      'disease',
      'exploration',
      'combat',
      'research',
      'upgrades',
      'demolition',
      'balance',
      'render',
      'persistence',
      'i18n',
    ]) {
      expect(rules[block], `rules.${block}`).toBeDefined();
    }
  });

  it('declara los parámetros numéricos referenciados por los requisitos', () => {
    const day = rules['day'] as Dict;
    const food = rules['food'] as Dict;
    const disease = rules['disease'] as Dict;
    const exploration = rules['exploration'] as Dict;
    const combat = rules['combat'] as Dict;
    const demolition = rules['demolition'] as Dict;
    const upgrades = rules['upgrades'] as Dict;
    const research = rules['research'] as Dict;
    const balance = rules['balance'] as Dict;
    const render = rules['render'] as Dict;

    expect(day['fragments']).toBe(5);
    expect(day['seconds_normal']).toBeGreaterThan(0);
    expect(day['seconds_fast']).toBeGreaterThan(0);
    expect(food['consumo_por_poblacion']).toBeGreaterThan(0);
    expect(food['poblacion_perdida_por_hambre']).toBeGreaterThan(0);
    expect(disease['probabilidad_base_diaria']).toBeGreaterThanOrEqual(0);
    expect(disease['incremento_por_poblacion']).toBeGreaterThanOrEqual(0);
    expect(disease['poblacion_perdida']).toBeGreaterThan(0);
    expect(exploration['tiempo_base']).toBeGreaterThanOrEqual(1);
    expect(exploration['dias_por_distancia']).toBeGreaterThan(0);
    expect(exploration['poblacion_por_distancia']).toBeGreaterThan(0);
    expect(combat['dado']).toBeGreaterThanOrEqual(2);
    expect(combat['dano_por_punto_dado']).toBeGreaterThan(0);
    expect(combat['dano_maximo_acumulado']).toBeLessThan(1);
    expect(demolition['time']).toBeGreaterThanOrEqual(1);
    expect(demolition['returns_materials_ratio']).toBeGreaterThanOrEqual(0);
    expect(upgrades['produce_durante_mejora']).toBeTypeOf('boolean');
    expect(upgrades['devolucion_por_cancelacion']).toBeGreaterThanOrEqual(0);
    expect(research['devolucion_ciencia_al_cancelar']).toBeGreaterThanOrEqual(0);
    expect(balance['amortizacion_minima_dias']).toBeGreaterThan(0);
    expect(balance['pesos_recurso']).toBeDefined();
    expect(Array.isArray(render['paleta'])).toBe(true);
    expect((render['paleta'] as string[]).length).toBeLessThanOrEqual(
      render['paleta_max_colores'] as number,
    );
  });
});

describe('terrenos (terrains.yaml)', () => {
  it('declara los cinco terrenos con identificador único', () => {
    expect(ids(terrains).sort()).toEqual(
      ['desierto', 'no_fertil', 'oceano', 'prado', 'tundra'].sort(),
    );
    expect(terrainIds.size).toBe(terrains.length);
  });
});

describe('elementos (elements.yaml)', () => {
  const validCategories = new Set([
    'mountain',
    'forest',
    'domestic_animal',
    'fish',
    'whale',
    'settlement',
    'mystery',
    'animal_threat',
    'human_threat',
  ]);

  it('tiene identificadores únicos y categorías conocidas', () => {
    expect(elementIds.size).toBe(elements.length);

    for (const element of elements) {
      expect(validCategories, `categoría de ${element['id']}`).toContain(element['category']);
    }
  });

  it('referencia solo terrenos existentes y no produce por sí mismo', () => {
    for (const element of elements) {
      for (const terrain of element['allowed_terrains'] as string[]) {
        expect(terrainIds, `${element['id']}.allowed_terrains`).toContain(terrain);
      }

      expect(element['production_per_day'], `${element['id']}.production_per_day`).toEqual({});
    }
  });

  it('declara combate y comportamiento de cada amenaza', () => {
    const threats = elements.filter((element) =>
      ['animal_threat', 'human_threat'].includes(element['category'] as string),
    );

    expect(threats.length).toBeGreaterThan(0);

    for (const threat of threats) {
      const combat = threat['combat'] as Dict;

      expect(combat, `${threat['id']}.combat`).toBeDefined();
      expect(combat['coste_base_poblacion']).toBeGreaterThan(0);
      expect(combat['reward_instant']).toBeDefined();
      expect(threat['passive_effects']).toBeDefined();

      if (threat['category'] === 'animal_threat') {
        expect((threat['respawn'] as Dict)['dias_reaparicion']).toBeGreaterThan(0);
      } else {
        const expansion = threat['expansion'] as Dict;

        expect(expansion['dias_expansion']).toBeGreaterThan(0);
        expect(expansion['dias_expansion_con_construccion']).toBeGreaterThan(0);
        expect(expansion['sube_nivel_cada']).toBeGreaterThan(0);
      }
    }
  });

  it('declara los elementos con acciones de recolección requeridas por el diseño', () => {
    const withHarvest = elements
      .filter((element) => ((element['actions'] as Dict[] | undefined) ?? []).length > 0)
      .map((element) => element['id']);

    expect(withHarvest).toEqual(
      expect.arrayContaining(['bosque', 'vaca', 'gallinas', 'cabras', 'cerdos', 'peces', 'ballenas']),
    );
  });
});

describe('construcciones (constructions.yaml)', () => {
  it('declara todas las construcciones del diseño con identificador único', () => {
    expect(constructionIds.size).toBe(constructions.length);
    expect(ids(constructions)).toEqual(
      expect.arrayContaining([
        'casa',
        'plantacion',
        'granja',
        'bote_pesca',
        'mina',
        'aserradero',
        'fabrica_herramientas',
        'fabrica_pergaminos',
        'centro_estudios',
        'torre',
        'ciudad',
      ]),
    );
  });

  it('referencia solo terrenos, elementos y tecnologías existentes', () => {
    for (const construction of constructions) {
      for (const terrain of construction['allowed_terrains'] as string[]) {
        expect(terrainIds, `${construction['id']}.allowed_terrains`).toContain(terrain);
      }

      for (const element of (construction['mounts_on_elements'] as string[] | undefined) ?? []) {
        expect(elementIds, `${construction['id']}.mounts_on_elements`).toContain(element);
      }

      const adjacentElement = construction['requires_adjacent_element'] as string | undefined;

      if (adjacentElement !== undefined) {
        expect(elementIds).toContain(adjacentElement);
      }

      for (const level of asList(construction['levels'])) {
        for (const tech of (level['requires_tech'] as string[] | undefined) ?? []) {
          expect(technologyIds, `${construction['id']}:${level['level']}.requires_tech`).toContain(
            tech,
          );
        }
      }
    }
  });

  it('tiene niveles consecutivos desde 1 con coste, tiempo y trabajadores no decrecientes', () => {
    for (const construction of constructions) {
      const levels = asList(construction['levels']);

      levels.forEach((level, index) => {
        expect(level['level'], `${construction['id']} nivel ${index + 1}`).toBe(index + 1);
        expect(level['build_time'] as number).toBeGreaterThanOrEqual(1);

        if (index === 0) return;

        const previous = levels[index - 1] as Dict;

        expect(
          level['build_time'] as number,
          `${construction['id']}:${level['level']} build_time`,
        ).toBeGreaterThanOrEqual(previous['build_time'] as number);
        expect(
          totalCost(level['cost']),
          `${construction['id']}:${level['level']} coste total`,
        ).toBeGreaterThanOrEqual(totalCost(previous['cost']));
        expect(
          level['employs'] as number,
          `${construction['id']}:${level['level']} employs`,
        ).toBeGreaterThanOrEqual(previous['employs'] as number);
      });
    }
  });

  it('declara la Ciudad como única y no demolible', () => {
    const city = constructions.find((construction) => construction['id'] === 'ciudad') as Dict;

    expect(city['unique']).toBe(true);
    expect(city['demolishable']).toBe(false);
    expect(city['allowed_terrains']).not.toContain('oceano');
    expect(asList(city['levels'])[3]?.['requires_tech']).toEqual(['ciudadela']);
  });

  it('declara producción y modificador de terreno para cada par (animal, terreno) de la granja', () => {
    const farm = constructions.find((construction) => construction['id'] === 'granja') as Dict;
    const modifiersPerElement = farm['terrain_modifiers_per_element'] as Record<string, Dict>;
    const mounted = farm['mounts_on_elements'] as string[];

    for (const elementId of mounted) {
      const element = elements.find((entry) => entry['id'] === elementId) as Dict;
      const modifiers = modifiersPerElement[elementId];

      expect(modifiers, `granja.terrain_modifiers_per_element.${elementId}`).toBeDefined();

      for (const terrain of element['allowed_terrains'] as string[]) {
        expect(modifiers?.[terrain], `granja ${elementId}/${terrain}`).toBeTypeOf('number');
      }

      for (const level of asList(farm['levels'])) {
        const production = level['production_per_element'] as Record<string, Dict>;

        expect(
          production[elementId],
          `granja:${level['level']}.production_per_element.${elementId}`,
        ).toBeDefined();
      }
    }
  });

  it('declara consumo y producción en cada nivel de fábrica, y radio de bloqueo en las torres', () => {
    const factories = constructions.filter((construction) =>
      ((construction['tags'] as string[] | undefined) ?? []).includes('fabrica'),
    );

    expect(factories.length).toBeGreaterThan(0);

    for (const factory of factories) {
      for (const level of asList(factory['levels'])) {
        expect(totalCost(level['consumes_per_day'])).toBeGreaterThan(0);
        expect(totalCost(level['production_per_day'])).toBeGreaterThan(0);
      }
    }

    const tower = constructions.find((construction) => construction['id'] === 'torre') as Dict;

    for (const level of asList(tower['levels'])) {
      expect(level['production_per_day']).toEqual({});
      expect(level['blocks_expansion_radius'] as number).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('tecnologías (technologies.yaml)', () => {
  it('declara 5 ramas de 6 escalones con identificadores únicos', () => {
    expect(technologies).toHaveLength(30);
    expect(technologyIds.size).toBe(technologies.length);

    const byBranch = new Map<string, number[]>();

    for (const tech of technologies) {
      const branch = tech['branch'] as string;
      const tiers = byBranch.get(branch) ?? [];

      tiers.push(tech['tier'] as number);
      byBranch.set(branch, tiers);
    }

    expect(byBranch.size).toBe(5);

    for (const [branch, tiers] of byBranch) {
      expect(tiers.sort((a, b) => a - b), `escalones de la rama ${branch}`).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    }
  });

  it('cuesta ciencia y días según las series declaradas en las reglas', () => {
    const research = rules['research'] as Dict;
    const costs = research['coste_por_nivel'] as number[];
    const times = research['tiempo_por_nivel'] as number[];

    for (const tech of technologies) {
      const tier = tech['tier'] as number;

      expect(tech['cost'], `${tech['id']}.cost`).toBe(costs[tier - 1]);
      expect(tech['research_time'], `${tech['id']}.research_time`).toBe(times[tier - 1]);
    }
  });

  it('tiene dependencias existentes y un grafo acíclico', () => {
    const dependencies = new Map<string, string[]>(
      technologies.map((tech) => [
        tech['id'] as string,
        (tech['dependencies'] as string[] | undefined) ?? [],
      ]),
    );

    for (const [id, deps] of dependencies) {
      for (const dep of deps) {
        expect(technologyIds, `dependencia de ${id}`).toContain(dep);
      }
    }

    const visiting = new Set<string>();
    const done = new Set<string>();

    const visit = (id: string): void => {
      if (done.has(id)) return;

      expect(visiting.has(id), `ciclo de dependencias en ${id}`).toBe(false);
      visiting.add(id);

      for (const dep of dependencies.get(id) ?? []) visit(dep);

      visiting.delete(id);
      done.add(id);
    };

    for (const id of dependencies.keys()) visit(id);

    expect(done.size).toBe(technologies.length);
  });

  it('desbloquea solo niveles de construcciones existentes', () => {
    for (const tech of technologies) {
      const unlocks = tech['unlocks'] as Dict | undefined;

      for (const entry of (unlocks?.['constructions'] as string[] | undefined) ?? []) {
        const [constructionId, level] = entry.split(':');

        expect(constructionIds, `${tech['id']}.unlocks`).toContain(constructionId);
        expect(Number(level)).toBeGreaterThanOrEqual(1);

        const construction = constructions.find(
          (candidate) => candidate['id'] === constructionId,
        ) as Dict;

        expect(asList(construction['levels']).length).toBeGreaterThanOrEqual(Number(level));
      }

      const replaces = tech['replaces'] as string | undefined;

      if (replaces !== undefined) expect(technologyIds).toContain(replaces);
    }
  });
});

describe('puzzles (puzzles/*.yaml)', () => {
  it('no repite identificadores entre ficheros', () => {
    expect(new Set(ids(puzzles)).size).toBe(puzzles.length);
  });

  it('incluye los poblados y misterios de la Fase 1', () => {
    expect(ids(settlementPuzzles)).toEqual(
      expect.arrayContaining(['poblado_guardianes', 'poblado_tejedores', 'poblado_pozo_seco']),
    );
    expect(ids(mysteryPuzzles)).toEqual(
      expect.arrayContaining([
        'misterio_monolito',
        'misterio_balanza',
        'misterio_mapa_roto',
        'misterio_granero',
      ]),
    );

    for (const puzzle of settlementPuzzles) expect(puzzle['kind']).toBe('poblado');
    for (const puzzle of mysteryPuzzles) expect(puzzle['kind']).toBe('misterio');
  });

  it('da a cada puzzle fijo al menos 2 opciones y exactamente 1 correcta', () => {
    const fixed = puzzles.filter((puzzle) => puzzle['mode'] === 'fijo');

    expect(fixed.length).toBeGreaterThan(0);

    for (const puzzle of fixed) {
      const options = asList(puzzle['options']);

      expect(options.length, `opciones de ${puzzle['id']}`).toBeGreaterThanOrEqual(2);
      expect(
        options.filter((option) => option['correct'] === true).length,
        `opción correcta de ${puzzle['id']}`,
      ).toBe(1);
    }
  });

  it('declara generador y parámetros en cada puzzle generado, y efectos en todos', () => {
    const generated = puzzles.filter((puzzle) => puzzle['mode'] === 'generado');

    expect(generated.length).toBeGreaterThan(0);

    for (const puzzle of generated) {
      expect(puzzle['generator'], `${puzzle['id']}.generator`).toBeTypeOf('string');
      expect((puzzle['params'] as Dict)['opciones'] as number).toBeGreaterThanOrEqual(2);
    }

    for (const puzzle of puzzles) {
      expect(puzzle['on_success'], `${puzzle['id']}.on_success`).toBeDefined();
      expect(puzzle['on_failure'], `${puzzle['id']}.on_failure`).toBeDefined();
    }
  });

  it('deja los efectos de poblado como Efecto_Global y los de misterio como instantáneos', () => {
    for (const puzzle of settlementPuzzles) {
      for (const outcome of ['on_success', 'on_failure']) {
        expect(
          (puzzle[outcome] as Dict)['global_effects'],
          `${puzzle['id']}.${outcome}.global_effects`,
        ).toBeDefined();
      }
    }

    for (const puzzle of mysteryPuzzles) {
      for (const outcome of ['on_success', 'on_failure']) {
        expect(
          (puzzle[outcome] as Dict)['instant'],
          `${puzzle['id']}.${outcome}.instant`,
        ).toBeDefined();
      }
    }
  });
});

describe('escenario (scenarios/valle_inicial.yaml)', () => {
  const map = scenario['map'] as Dict;
  const constraints = map['constraints'] as Dict;
  const missions = asList(scenario['missions']);

  it('describe un mapa válido con pesos y densidades referenciando datos existentes', () => {
    expect(scenario['id']).toBe('valle_inicial');
    expect(map['radius'] as number).toBeGreaterThanOrEqual(1);
    expect(constructionIds).toContain(map['city_construction_id']);

    for (const terrain of Object.keys(map['terrain_weights'] as Dict)) {
      expect(terrainIds, 'terrain_weights').toContain(terrain);
    }

    for (const [element, density] of Object.entries(map['element_density'] as Dict)) {
      expect(elementIds, 'element_density').toContain(element);
      expect(density as number).toBeGreaterThan(0);
    }
  });

  it('declara las restricciones de generación previstas', () => {
    for (const key of [
      'prados_adyacentes_a_ciudad_minimo',
      'porcentaje_prado_minimo',
      'montanas_minimas',
      'bosques_minimos',
      'amenazas_maximas',
      'distancia_minima_amenaza_humana',
      'nivel_amenaza_por_anillo',
      'intentos_maximos',
    ]) {
      expect(constraints[key], `constraints.${key}`).toBeTypeOf('number');
    }

    expect(constraints['intentos_maximos'] as number).toBeGreaterThanOrEqual(1);
  });

  it('declara recursos iniciales, objetivo principal y de 8 a 10 misiones únicas', () => {
    const starting = scenario['starting_resources'] as Dict;

    for (const resource of [
      'poblacion_libre',
      'poblacion_empleada',
      'comida',
      'materiales',
      'ciencia',
      'oro',
    ]) {
      expect(starting[resource], `starting_resources.${resource}`).toBeTypeOf('number');
    }

    const objective = scenario['main_objective'] as Dict;
    const condition = objective['condition'] as Dict;

    expect(condition['type']).toBeTypeOf('string');
    expect(condition['sustained_days'] as number).toBeGreaterThanOrEqual(1);

    expect(missions.length).toBeGreaterThanOrEqual(8);
    expect(missions.length).toBeLessThanOrEqual(10);
    expect(new Set(ids(missions)).size).toBe(missions.length);

    for (const mission of missions) {
      expect((mission['condition'] as Dict)['type'], `${mission['id']}.condition.type`).toBeTypeOf(
        'string',
      );
      expect(totalCost(mission['reward']), `${mission['id']}.reward`).toBeGreaterThan(0);
    }
  });

  it('usa condiciones de misión y objetivo de los tipos admitidos', () => {
    const allowed = new Set([
      'recurso_acumulado',
      'hexagonos_explorados',
      'construcciones_completadas',
      'tecnologias_investigadas',
    ]);
    const conditions = [
      (scenario['main_objective'] as Dict)['condition'] as Dict,
      ...missions.map((mission) => mission['condition'] as Dict),
    ];

    for (const condition of conditions) {
      expect(allowed, 'tipo de condición').toContain(condition['type']);

      if (condition['type'] === 'construcciones_completadas') {
        expect(constructionIds).toContain(condition['construction']);
      }

      if (condition['type'] === 'tecnologias_investigadas') {
        for (const tech of condition['technologies'] as string[]) {
          expect(technologyIds).toContain(tech);
        }
      }
    }
  });
});

describe('catálogo de textos (i18n/es.yaml)', () => {
  it('declara el idioma, el formato de números y las reglas de plural', () => {
    expect(I18N_FILE['locale']).toBe('es');
    expect(I18N_FILE['number_format']).toEqual({
      decimal_separator: ',',
      thousands_separator: '.',
    });
    expect(I18N_FILE['plural_rules']).toBeTypeOf('string');
    expect(Object.keys(strings).length).toBeGreaterThan(0);
  });

  it('contiene todas las claves declaradas en los ficheros de contenido', () => {
    const declared = new Set<string>();

    for (const file of [
      TERRAINS_FILE,
      ELEMENTS_FILE,
      CONSTRUCTIONS_FILE,
      TECHNOLOGIES_FILE,
      SETTLEMENTS_FILE,
      MYSTERIES_FILE,
      SCENARIO_FILE,
    ]) {
      collectTextKeys(file, declared);
    }

    expect(declared.size).toBeGreaterThan(0);

    const missing = [...declared].filter((key) => strings[key] === undefined).sort();

    expect(missing, 'claves declaradas sin texto en el catálogo de español').toEqual([]);
  });

  it('no deja ningún texto vacío', () => {
    const empty = Object.entries(strings)
      .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });
});
