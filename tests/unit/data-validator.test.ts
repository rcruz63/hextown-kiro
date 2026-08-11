/**
 * Tests del Validador_De_Datos (tarea 2.2).
 *
 * Cubre los Requisitos 20.3 (esquema y referencias cruzadas), 20.4 (errores
 * bloqueantes con fichero, ruta y motivo), 20.5 (identificadores duplicados),
 * 20.6 (advertencias no bloqueantes), 11.14 (grafo de tecnologías acíclico),
 * 7.14 (advertencia de amortización), 15.7 (número de misiones) y 22.4 (claves
 * i18n existentes en el catálogo de español).
 *
 * Los tests se apoyan en un juego de datos mínimo y válido, del que cada caso
 * sustituye un único fichero, y en los ficheros reales de `data/`, que deben
 * validarse sin ningún error bloqueante.
 */
import { describe, expect, it } from 'vitest';
import { loadAll } from '../../src/data/loader.ts';
import type { DataSource, GameData } from '../../src/data/loader.ts';
import { validate } from '../../src/data/validator.ts';
import type { ValidationIssue, ValidationReport } from '../../src/data/validator.ts';

// ---------------------------------------------------------------------------
// Juego de datos mínimo y válido
// ---------------------------------------------------------------------------

const RULES_YAML = `
rules:
  data_version: "test"
  day:
    fragments: 5
    seconds_normal: 6
    seconds_fast: 3
    minimo_dias_accion: 1
  food:
    consumo_por_poblacion: 0.5
  disease:
    probabilidad_base_diaria: 0.02
  combat:
    dado: 6
    dano_maximo_acumulado: 0.9
  exploration:
    tiempo_base: 1
  upgrades:
    produce_durante_mejora: true
  demolition:
    time: 1
  research:
    investigaciones_simultaneas: 1
  balance:
    amortizacion_minima_dias: 10
    misiones_minimas: 1
    misiones_maximas: 3
    pesos_recurso:
      comida: 1
      materiales: 1
      poblacion: 3
      oro: 4
  i18n:
    idioma_por_defecto: "es"
`;

const TERRAINS_YAML = `
terrains:
  - id: prado
    name_key: terrain.prado.name
  - id: oceano
    name_key: terrain.oceano.name
`;

const ELEMENTS_YAML = `
elements:
  - id: bosque
    name_key: element.bosque.name
    category: forest
    allowed_terrains: [prado]
    actions:
      - id: talar
        name_key: action.talar.name
  - id: poblado
    name_key: element.poblado.name
    category: settlement
    allowed_terrains: [prado]
    puzzle_kind: poblado
`;

const CONSTRUCTIONS_YAML = `
constructions:
  - id: casa
    name_key: construction.casa.name
    allowed_terrains: [prado]
    tags: [industria]
    terrain_modifiers:
      prado: 1.0
    adjacency_modifiers:
      - id: casa_adyacente
        name_key: modifier.casa.casa_adyacente
        target_constructions: [casa]
        target_element_categories: [forest]
        target_tags: [industria]
        effect: poblacion
        value: 1
    levels:
      - level: 1
        name_key: construction.casa.level.1.name
        build_time: 1
        cost:
          materiales: 10
        employs: 0
        requires_tech: []
        production_per_day:
          poblacion: 1
      - level: 2
        name_key: construction.casa.level.2.name
        build_time: 2
        cost:
          materiales: 100
        employs: 1
        requires_tech: [t2]
        production_per_day:
          poblacion: 2
`;

const TECHNOLOGIES_YAML = `
technologies:
  - id: t1
    name_key: technology.t1.name
    branch: rama
    tier: 1
    cost: 20
    research_time: 3
    dependencies: []
    unlocks:
      actions: ["bosque:talar"]
  - id: t2
    name_key: technology.t2.name
    branch: rama
    tier: 2
    cost: 45
    research_time: 4
    dependencies: [t1]
    unlocks:
      constructions: ["casa:2"]
`;

const PUZZLES_YAML = `
puzzles:
  - id: p1
    kind: poblado
    mode: fijo
    name_key: puzzle.p1.name
    text_key: puzzle.p1.text
    options:
      - text_key: puzzle.p1.option.1.text
        correct: true
      - text_key: puzzle.p1.option.2.text
        correct: false
    on_success:
      message_key: puzzle.p1.success
      global_effects:
        - effect: produccion
          target_construction: casa
          target_modifier: casa_adyacente
          value: 1
    on_failure:
      message_key: puzzle.p1.failure
      global_effects:
        - effect: produccion
          target_element_categories: [forest]
          value: -1
`;

const SCENARIO_YAML = `
scenario:
  id: valle_test
  name_key: scenario.test.name
  map:
    radius: 3
    city_construction_id: casa
    terrain_weights:
      prado: 3
      oceano: 1
    element_density:
      bosque: 0.1
      poblado: 0.05
    constraints:
      intentos_maximos: 5
  starting_resources:
    comida: 30
  main_objective:
    desc_key: scenario.test.objective.desc
    condition:
      type: recurso_acumulado
      resource: poblacion_total
      amount: 25
  missions:
    - id: m1
      desc_key: mission.m1.desc
      condition:
        type: construcciones_completadas
        construction: casa
        min_level: 1
        amount: 3
`;

const I18N_YAML = `
locale: "es"
number_format:
  decimal_separator: ","
  thousands_separator: "."
plural_rules: "spanish"
strings:
  "terrain.prado.name": "Prado"
  "terrain.oceano.name": "Océano"
  "element.bosque.name": "Bosque"
  "element.poblado.name": "Poblado"
  "action.talar.name": "Talar"
  "construction.casa.name": "Casa"
  "construction.casa.level.1.name": "Refugio"
  "construction.casa.level.2.name": "Casa de adobe"
  "modifier.casa.casa_adyacente": "Casa adyacente"
  "technology.t1.name": "Primera"
  "technology.t2.name": "Segunda"
  "puzzle.p1.name": "Acertijo"
  "puzzle.p1.text": "Enunciado"
  "puzzle.p1.option.1.text": "Sí"
  "puzzle.p1.option.2.text": "No"
  "puzzle.p1.success": "Bien"
  "puzzle.p1.failure": "Mal"
  "scenario.test.name": "Valle de pruebas"
  "scenario.test.objective.desc": "Alcanzar 25 de población."
  "mission.m1.desc": "Construir 3 casas."
`;

/** Ficheros del juego de datos mínimo, indexados por ruta. */
const BASE_FILES: Record<string, string> = {
  'data/rules.yaml': RULES_YAML,
  'data/terrains.yaml': TERRAINS_YAML,
  'data/elements.yaml': ELEMENTS_YAML,
  'data/constructions.yaml': CONSTRUCTIONS_YAML,
  'data/technologies.yaml': TECHNOLOGIES_YAML,
  'data/puzzles/poblados.yaml': PUZZLES_YAML,
  'data/scenarios/valle_test.yaml': SCENARIO_YAML,
  'data/i18n/es.yaml': I18N_YAML,
};

/** Carga el juego de datos mínimo con los ficheros indicados sustituidos. */
function loadWith(overrides: Record<string, string> = {}): GameData {
  const files = { ...BASE_FILES, ...overrides };
  const sources: DataSource[] = Object.entries(files).map(([path, content]) => ({ path, content }));
  const result = loadAll(sources);
  if (!result.ok) {
    throw new Error(`carga fallida: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

/** Valida el juego de datos mínimo con los ficheros indicados sustituidos. */
function validateWith(overrides: Record<string, string> = {}): ValidationReport {
  return validate(loadWith(overrides));
}

/** Diagnósticos del código indicado, para no depender de los mensajes. */
function withCode(issues: ValidationIssue[], code: string): ValidationIssue[] {
  return issues.filter((issue) => issue.code === code);
}

/** Resumen legible de los diagnósticos, para los fallos de test. */
function summarize(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.code} @ ${issue.file}: ${issue.path}`).join('\n');
}

// ---------------------------------------------------------------------------
// Datos válidos
// ---------------------------------------------------------------------------

describe('validate: datos válidos', () => {
  it('no informa de nada sobre un juego de datos mínimo y coherente', () => {
    const report = validateWith();

    expect(summarize(report.errors)).toBe('');
    expect(summarize(report.warnings)).toBe('');
    expect(report.isBlocking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Esquema (Requisitos 20.3, 20.4)
// ---------------------------------------------------------------------------

describe('validate: esquema de cada fichero (Requisitos 20.3, 20.4)', () => {
  it('exige la clave i18n del nombre en cada categoría', () => {
    const report = validateWith({
      'data/terrains.yaml': `
terrains:
  - id: prado
  - id: oceano
    name_key: terrain.oceano.name
`,
    });

    const missing = withCode(report.errors, 'missing_field');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.file).toBe('data/terrains.yaml');
    expect(missing[0]?.path).toBe('terrains[0].name_key');
    expect(report.isBlocking).toBe(true);
  });

  it('exige category y allowed_terrains en los elementos', () => {
    const report = validateWith({
      'data/elements.yaml': `
elements:
  - id: bosque
    name_key: element.bosque.name
  - id: poblado
    name_key: element.poblado.name
    category: settlement
    allowed_terrains: []
    puzzle_kind: poblado
`,
    });

    const paths = withCode(report.errors, 'missing_field').map((issue) => issue.path);
    expect(paths).toContain('elements[0].category');
    expect(paths).toContain('elements[0].allowed_terrains');
    expect(withCode(report.errors, 'empty_field')[0]?.path).toBe('elements[1].allowed_terrains');
  });

  it('exige los campos de cada nivel de construcción', () => {
    const report = validateWith({
      'data/constructions.yaml': `
constructions:
  - id: casa
    name_key: construction.casa.name
    allowed_terrains: [prado]
    levels:
      - level: 1
        name_key: construction.casa.level.1.name
`,
    });

    const paths = withCode(report.errors, 'missing_field').map((issue) => issue.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'constructions[0].levels[0].build_time',
        'constructions[0].levels[0].cost',
        'constructions[0].levels[0].employs',
        'constructions[0].levels[0].requires_tech',
      ]),
    );
  });

  it('exige que los niveles se declaren consecutivos desde 1', () => {
    const report = validateWith({
      'data/constructions.yaml': CONSTRUCTIONS_YAML.replace('      - level: 2', '      - level: 3'),
    });

    const invalid = withCode(report.errors, 'invalid_level_number');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.path).toBe('constructions[0].levels[1].level');
    expect(invalid[0]?.context?.['expected']).toBe(2);
  });

  it('exige el bloque map con su radio, sus pesos y sus restricciones', () => {
    const report = validateWith({
      'data/scenarios/valle_test.yaml': `
scenario:
  id: valle_test
  name_key: scenario.test.name
  map:
    radius: 0
    terrain_weights:
      prado: 0
      oceano: 0
  main_objective:
    desc_key: scenario.test.objective.desc
    condition:
      type: recurso_acumulado
  missions:
    - id: m1
      desc_key: mission.m1.desc
      condition:
        type: hexagonos_explorados
`,
    });

    const invalid = withCode(report.errors, 'invalid_value').map((issue) => issue.path);
    expect(invalid).toContain('scenario.map.radius');
    expect(invalid).toContain('scenario.map.terrain_weights');
    expect(withCode(report.errors, 'missing_field').map((issue) => issue.path)).toContain(
      'scenario.map.constraints',
    );
  });

  it('exige constraints.intentos_maximos mayor o igual que 1 (Requisito 1.8)', () => {
    const report = validateWith({
      'data/scenarios/valle_test.yaml': SCENARIO_YAML.replace(
        'intentos_maximos: 5',
        'intentos_maximos: 0',
      ),
    });

    const invalid = withCode(report.errors, 'invalid_value');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.path).toBe('scenario.map.constraints.intentos_maximos');
  });

  it('exige los grupos de reglas globales y sus rangos', () => {
    const report = validateWith({
      'data/rules.yaml': RULES_YAML.replace('    dado: 6', '    dado: 1').replace(
        /  food:\n    consumo_por_poblacion: 0\.5\n/,
        '',
      ),
    });

    expect(withCode(report.errors, 'missing_rule_group')[0]?.path).toBe('food');
    expect(withCode(report.errors, 'invalid_rule')[0]?.path).toBe('combat.dado');
  });

  it('exige que un puzzle declare al menos 2 opciones y exactamente 1 correcta', () => {
    const report = validateWith({
      'data/puzzles/poblados.yaml': `
puzzles:
  - id: p1
    kind: poblado
    mode: fijo
    name_key: puzzle.p1.name
    text_key: puzzle.p1.text
    options:
      - text_key: puzzle.p1.option.1.text
        correct: true
      - text_key: puzzle.p1.option.2.text
        correct: true
  - id: p2
    kind: poblado
    mode: fijo
    name_key: puzzle.p1.name
    options:
      - text_key: puzzle.p1.option.1.text
        correct: true
`,
    });

    const invalid = withCode(report.errors, 'invalid_options');
    expect(invalid.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['puzzles[0].options', 'puzzles[1].options']),
    );
    expect(invalid.some((issue) => issue.reason.includes('exactamente 1 opción correcta'))).toBe(true);
    expect(invalid.some((issue) => issue.reason.includes('al menos 2 opciones'))).toBe(true);
  });

  it('exige que un puzzle sin opciones declare su generador', () => {
    const report = validateWith({
      'data/puzzles/poblados.yaml': `
puzzles:
  - id: p1
    kind: poblado
    mode: generado
    name_key: puzzle.p1.name
    text_key: puzzle.p1.text
`,
    });

    const missing = withCode(report.errors, 'missing_field');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.reason).toContain('options ni generator');
  });
});

// ---------------------------------------------------------------------------
// Referencias cruzadas (Requisito 20.3)
// ---------------------------------------------------------------------------

describe('validate: referencias cruzadas (Requisito 20.3)', () => {
  it('rechaza un terreno inexistente referenciado por un elemento', () => {
    const report = validateWith({
      'data/elements.yaml': ELEMENTS_YAML.replace('allowed_terrains: [prado]\n    actions', 'allowed_terrains: [pradera]\n    actions'),
    });

    const unknown = withCode(report.errors, 'unknown_reference');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.file).toBe('data/elements.yaml');
    expect(unknown[0]?.path).toBe('elements[0].allowed_terrains');
    expect(unknown[0]?.reason).toContain('terreno inexistente pradera');
    expect(report.isBlocking).toBe(true);
  });

  it('rechaza una tecnología inexistente exigida por un nivel', () => {
    const report = validateWith({
      'data/constructions.yaml': CONSTRUCTIONS_YAML.replace('requires_tech: [t2]', 'requires_tech: [t9]'),
    });

    const unknown = withCode(report.errors, 'unknown_reference');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.path).toBe('constructions[0].levels[1].requires_tech');
    expect(unknown[0]?.context?.['id']).toBe('t9');
  });

  it('rechaza un desbloqueo a un nivel de construcción inexistente', () => {
    const report = validateWith({
      'data/technologies.yaml': TECHNOLOGIES_YAML.replace('"casa:2"', '"casa:7"'),
    });

    const unknown = withCode(report.errors, 'unknown_reference');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.path).toBe('technologies[1].unlocks.constructions');
    expect(unknown[0]?.reason).toContain('casa:7');
  });

  it('rechaza un elemento y una construcción inexistentes en el escenario', () => {
    const report = validateWith({
      'data/scenarios/valle_test.yaml': SCENARIO_YAML.replace('bosque: 0.1', 'arboleda: 0.1').replace(
        'city_construction_id: casa',
        'city_construction_id: ciudad',
      ),
    });

    const paths = withCode(report.errors, 'unknown_reference').map((issue) => issue.path);
    expect(paths).toContain('scenario.map.element_density');
    expect(paths).toContain('scenario.map.city_construction_id');
  });

  it('rechaza un tipo de puzzle que ningún elemento admite', () => {
    const report = validateWith({
      'data/puzzles/poblados.yaml': PUZZLES_YAML.replace('kind: poblado', 'kind: aldea'),
    });

    const unknown = withCode(report.errors, 'unknown_reference');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.path).toBe('puzzles[0].kind');
  });

  it('rechaza un efecto de puzzle que apunta a un modificador inexistente', () => {
    const report = validateWith({
      'data/puzzles/poblados.yaml': PUZZLES_YAML.replace(
        'target_modifier: casa_adyacente',
        'target_modifier: casa_lejana',
      ),
    });

    const unknown = withCode(report.errors, 'unknown_reference');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.path).toBe('puzzles[0].on_success.global_effects[0].target_modifier');
  });

  it('exige declarar el par (elemento, terreno) de una construcción montada (Requisito 9.16)', () => {
    const report = validateWith({
      'data/constructions.yaml': `
constructions:
  - id: granja
    name_key: construction.casa.name
    allowed_terrains: [prado, oceano]
    mounts_on_elements: [bosque, poblado]
    terrain_modifiers_per_element:
      bosque:
        oceano: 1.0
    levels:
      - level: 1
        name_key: construction.casa.level.1.name
        build_time: 1
        cost:
          materiales: 10
        employs: 1
        requires_tech: []
        production_per_element:
          bosque:
            materiales: 2
`,
    });

    const missing = withCode(report.errors, 'missing_mounted_element').map((issue) => issue.path);
    // El par (bosque, prado) es posible y no está declarado; el elemento
    // poblado no declara ni modificador ni producción.
    expect(missing).toContain('constructions[0].terrain_modifiers_per_element.bosque.prado');
    expect(missing).toContain('constructions[0].terrain_modifiers_per_element.poblado');
    expect(missing).toContain('constructions[0].levels[0].production_per_element.poblado');
  });
});

// ---------------------------------------------------------------------------
// Identificadores duplicados (Requisito 20.5)
// ---------------------------------------------------------------------------

describe('validate: identificadores duplicados (Requisito 20.5)', () => {
  it('informa del identificador y de todos los ficheros que lo declaran', () => {
    const report = validateWith({
      'data/puzzles/mas-poblados.yaml': `
puzzles:
  - id: p1
    kind: poblado
    mode: fijo
    name_key: puzzle.p1.name
    options:
      - text_key: puzzle.p1.option.1.text
        correct: true
      - text_key: puzzle.p1.option.2.text
        correct: false
`,
    });

    const duplicates = withCode(report.errors, 'duplicate_id');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.context?.['id']).toBe('p1');
    expect(duplicates[0]?.context?.['files']).toEqual([
      'data/puzzles/poblados.yaml',
      'data/puzzles/mas-poblados.yaml',
    ]);
    expect(duplicates[0]?.reason).toContain('data/puzzles/mas-poblados.yaml');
    expect(report.isBlocking).toBe(true);
  });

  it('detecta el duplicado dentro de un mismo fichero y por categoría', () => {
    const report = validateWith({
      'data/terrains.yaml': `${TERRAINS_YAML}
  - id: prado
    name_key: terrain.prado.name
`,
    });

    const duplicates = withCode(report.errors, 'duplicate_id');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.context?.['category']).toBe('terreno');
    expect(duplicates[0]?.path).toBe('terrains[0]');
  });

  it('detecta misiones con el mismo identificador', () => {
    const report = validateWith({
      'data/scenarios/valle_test.yaml': `${SCENARIO_YAML}
    - id: m1
      desc_key: mission.m1.desc
      condition:
        type: hexagonos_explorados
        amount: 6
`,
    });

    const duplicates = withCode(report.errors, 'duplicate_id');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.context?.['category']).toBe('misión');
  });
});

// ---------------------------------------------------------------------------
// Grafo de tecnologías (Requisito 11.14)
// ---------------------------------------------------------------------------

describe('validate: grafo de tecnologías (Requisito 11.14)', () => {
  it('rechaza una dependencia a una tecnología inexistente', () => {
    const report = validateWith({
      'data/technologies.yaml': TECHNOLOGIES_YAML.replace('dependencies: [t1]', 'dependencies: [t0]'),
    });

    const unknown = withCode(report.errors, 'unknown_reference');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.path).toBe('technologies[1].dependencies');
    expect(unknown[0]?.reason).toContain('tecnología inexistente t0');
  });

  it('rechaza un ciclo e informa del camino completo', () => {
    const report = validateWith({
      'data/technologies.yaml': TECHNOLOGIES_YAML.replace('dependencies: []', 'dependencies: [t2]'),
    });

    const cycles = withCode(report.errors, 'technology_cycle');
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.context?.['cycle']).toEqual(['t1', 't2', 't1']);
    expect(cycles[0]?.reason).toContain('t1 → t2 → t1');
    expect(report.isBlocking).toBe(true);
  });

  it('rechaza una tecnología que depende de sí misma', () => {
    const report = validateWith({
      'data/technologies.yaml': TECHNOLOGIES_YAML.replace('dependencies: [t1]', 'dependencies: [t2]'),
    });

    expect(withCode(report.errors, 'self_dependency')).toHaveLength(1);
    expect(withCode(report.errors, 'technology_cycle')).toHaveLength(1);
  });

  it('acepta un árbol profundo sin ciclos', () => {
    const chain = Array.from({ length: 12 }, (_, index) => {
      const tier = index + 1;
      const dependencies = index === 0 ? '[]' : `[t${String(index)}]`;
      return `  - id: t${String(tier)}
    name_key: technology.t1.name
    branch: rama
    tier: ${String(tier)}
    cost: 10
    research_time: 1
    dependencies: ${dependencies}
`;
    }).join('');

    const report = validateWith({
      'data/technologies.yaml': `technologies:\n${chain}`,
      'data/constructions.yaml': CONSTRUCTIONS_YAML.replace('requires_tech: [t2]', 'requires_tech: [t3]'),
    });

    expect(withCode(report.errors, 'technology_cycle')).toHaveLength(0);
    expect(summarize(report.errors)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Claves i18n (Requisitos 22.4, 22.8)
// ---------------------------------------------------------------------------

describe('validate: claves i18n (Requisitos 22.4, 22.8)', () => {
  it('rechaza una clave de nombre ausente del catálogo de español', () => {
    const report = validateWith({
      'data/terrains.yaml': TERRAINS_YAML.replace(
        'name_key: terrain.prado.name',
        'name_key: terrain.pradera.name',
      ),
    });

    const missing = withCode(report.errors, 'missing_i18n_key');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.file).toBe('data/terrains.yaml');
    expect(missing[0]?.path).toBe('terrains[0].name_key');
    expect(missing[0]?.context?.['key']).toBe('terrain.pradera.name');
    expect(report.isBlocking).toBe(true);
  });

  it('comprueba también las claves de campos que el cargador no interpreta', () => {
    const report = validateWith({
      'data/puzzles/poblados.yaml': PUZZLES_YAML.replace(
        'message_key: puzzle.p1.success',
        'message_key: puzzle.p1.acierto',
      ),
    });

    const missing = withCode(report.errors, 'missing_i18n_key');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.path).toBe('puzzles[0].on_success.message_key');
  });

  it('rechaza la ausencia del catálogo del idioma por defecto', () => {
    const report = validateWith({
      'data/i18n/es.yaml': I18N_YAML.replace('locale: "es"', 'locale: "en"'),
    });

    expect(withCode(report.errors, 'missing_locale_catalog')).toHaveLength(1);
    expect(report.isBlocking).toBe(true);
  });

  it('advierte de las claves del español ausentes en otro idioma, sin bloquear', () => {
    const report = validateWith({
      'data/i18n/en.yaml': `
locale: "en"
strings:
  "terrain.prado.name": "Meadow"
`,
    });

    const incomplete = withCode(report.warnings, 'incomplete_locale_catalog');
    expect(incomplete.length).toBeGreaterThan(0);
    expect(incomplete.every((issue) => issue.file === 'data/i18n/en.yaml')).toBe(true);
    expect(incomplete.some((issue) => issue.context?.['key'] === 'terrain.oceano.name')).toBe(true);
    expect(report.isBlocking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Advertencias de balance (Requisitos 7.14, 7.15, 15.7, 20.6)
// ---------------------------------------------------------------------------

describe('validate: advertencias de balance (Requisitos 7.14, 15.7, 20.6)', () => {
  it('advierte cuando una mejora amortiza su sobrecoste demasiado rápido', () => {
    const report = validateWith({
      'data/constructions.yaml': CONSTRUCTIONS_YAML.replace('materiales: 100', 'materiales: 12'),
    });

    const warnings = withCode(report.warnings, 'upgrade_amortization_too_fast');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.file).toBe('data/constructions.yaml');
    expect(warnings[0]?.path).toBe('constructions[0].levels[1]');
    // Incremento diario: (2 - 1) de población × peso 3 = 3. Sobrecoste: 12
    // materiales × peso 1 ⇒ techo(12 / 3) = 4 días, menos de los 10 exigidos.
    expect(warnings[0]?.context?.['days']).toBe(4);
    expect(report.errors).toHaveLength(0);
    expect(report.isBlocking).toBe(false);
  });

  it('advierte cuando una mejora no aumenta la producción diaria', () => {
    const report = validateWith({
      'data/constructions.yaml': CONSTRUCTIONS_YAML.replace(
        `        production_per_day:
          poblacion: 2`,
        `        production_per_day:
          poblacion: 1`,
      ),
    });

    const warnings = withCode(report.warnings, 'upgrade_without_production_gain');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.context?.['level']).toBe(2);
    expect(report.isBlocking).toBe(false);
  });

  it('advierte cuando un nivel exige menos trabajadores que el anterior (Requisito 7.15)', () => {
    const report = validateWith({
      'data/constructions.yaml': CONSTRUCTIONS_YAML.replace('        employs: 0', '        employs: 4'),
    });

    const warnings = withCode(report.warnings, 'level_progression_decreases');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.path).toBe('constructions[0].levels[1].employs');
    expect(report.isBlocking).toBe(false);
  });

  it('advierte cuando el número de misiones sale del rango declarado (Requisito 15.7)', () => {
    const report = validateWith({
      'data/rules.yaml': RULES_YAML.replace('    misiones_minimas: 1', '    misiones_minimas: 2'),
    });

    const warnings = withCode(report.warnings, 'mission_count_out_of_range');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.context).toMatchObject({ count: 1, min: 2, max: 3 });
    expect(warnings[0]?.file).toBe('data/scenarios/valle_test.yaml');
    expect(warnings[0]?.path).toBe('scenario.missions');
    expect(report.isBlocking).toBe(false);
  });

  it('aplica el rango de 8 a 10 misiones cuando las reglas no lo declaran', () => {
    const report = validateWith({
      'data/rules.yaml': RULES_YAML.replace('    misiones_minimas: 1\n    misiones_maximas: 3\n', ''),
    });

    const warnings = withCode(report.warnings, 'mission_count_out_of_range');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.context).toMatchObject({ min: 8, max: 10 });
  });
});

// ---------------------------------------------------------------------------
// Ficheros reales de `data/`
// ---------------------------------------------------------------------------

/** Contenido en bruto de todos los ficheros de datos del juego. */
const REAL_YAML: Record<string, string> = import.meta.glob('../../data/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Los ficheros reales, con la ruta relativa al proyecto para los mensajes. */
function realSources(): DataSource[] {
  return Object.entries(REAL_YAML).map(([path, content]) => ({
    path: path.replace('../../', ''),
    content,
  }));
}

describe('validate: ficheros reales de data/', () => {
  const result = loadAll(realSources());
  if (!result.ok) {
    throw new Error(`los datos del juego no cargan: ${JSON.stringify(result.error, null, 2)}`);
  }
  const report = validate(result.value);

  it('carga los nueve ficheros de datos del juego', () => {
    expect(realSources()).toHaveLength(9);
  });

  it('valida el contenido publicado sin errores bloqueantes', () => {
    expect(summarize(report.errors)).toBe('');
    expect(report.isBlocking).toBe(false);
  });

  it('declara todas las claves i18n que el contenido referencia (Requisito 22.4)', () => {
    expect(withCode(report.errors, 'missing_i18n_key')).toHaveLength(0);
  });

  it('declara un árbol de tecnologías acíclico y completo (Requisito 11.14)', () => {
    expect(withCode(report.errors, 'technology_cycle')).toHaveLength(0);
    expect(withCode(report.errors, 'unknown_reference')).toHaveLength(0);
  });

  it('declara las 9 misiones del valle inicial dentro del rango de 8 a 10 (Requisito 15.7)', () => {
    expect(withCode(report.warnings, 'mission_count_out_of_range')).toHaveLength(0);
  });

  it('solo produce advertencias de balance, que no impiden iniciar la partida', () => {
    const balanceCodes = new Set([
      'upgrade_amortization_too_fast',
      'upgrade_without_production_gain',
    ]);

    expect(report.warnings.length).toBeGreaterThan(0);
    for (const warning of report.warnings) {
      expect(balanceCodes.has(warning.code), summarize([warning])).toBe(true);
      expect(warning.file).not.toBe('');
      expect(warning.path).not.toBe('');
    }
    expect(report.isBlocking).toBe(false);
  });
});
