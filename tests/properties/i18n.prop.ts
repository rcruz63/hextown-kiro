/**
 * Tests de propiedades de los catálogos de idioma (tarea 2.6).
 *
 * El español es el idioma por defecto y la referencia de todo texto visible
 * (Requisitos 22.1, 22.2). Añadir un idioma no exige cambios en el código
 * (Requisito 22.6), así que la única forma de detectar un catálogo incompleto es
 * compararlo con el del idioma por defecto al validar los datos:
 *
 * - **Propiedad 38: Completitud de catálogos de idioma** — para cualquier clave
 *   presente en el catálogo de español, cualquier otro catálogo cargado declara
 *   esa misma clave o el Validador_De_Datos registra una advertencia que
 *   identifica la clave ausente.
 *
 * La advertencia no es bloqueante (Requisito 20.6): un idioma incompleto deja
 * jugar, con la clave a la vista en lugar del texto (Requisito 22.5).
 *
 * Los catálogos se generan y se cargan como ficheros YAML reales con el
 * Cargador_De_Datos, de modo que la propiedad se comprueba sobre el `GameData`
 * que el juego usaría de verdad.
 *
 * **Validates: Requirements 22.8**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dump } from 'js-yaml';
import { loadAll } from '../../src/data/loader.ts';
import type { DataSource, GameData } from '../../src/data/loader.ts';
import { validate } from '../../src/data/validator.ts';
import type { ValidationIssue } from '../../src/data/validator.ts';

/** Mínimo exigido por el diseño ("Configuración de tests de propiedades"). */
const RUNS = { numRuns: 1000 } as const;

/** Idioma por defecto de los datos generados (Requisito 22.2). */
const REFERENCE_LOCALE = 'es';

/** Código del diagnóstico del Requisito 22.8. */
const INCOMPLETE_CODE = 'incomplete_locale_catalog';

/**
 * Reglas globales válidas y completas: declaran el idioma por defecto y todos
 * los grupos que el validador exige. Así el informe no arrastra diagnósticos
 * ajenos a la propiedad y se puede comprobar que un catálogo incompleto no
 * produce ningún error bloqueante.
 */
const RULES: DataSource = {
  path: 'data/rules.yaml',
  content: `rules:
  data_version: "1.0.0"
  i18n:
    idioma_por_defecto: "${REFERENCE_LOCALE}"
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
`,
};

// ---------------------------------------------------------------------------
// Generadores
// ---------------------------------------------------------------------------

/** Palabra corta: segmento de una clave de catálogo. */
const arbWord = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(''));

/** Clave de catálogo i18n: segmentos separados por puntos. */
const arbI18nKey = fc
  .array(arbWord, { minLength: 2, maxLength: 3 })
  .map((parts) => parts.join('.'));

/** Texto de catálogo. */
const arbText = fc
  .array(fc.oneof(arbWord, fc.constantFrom('{count}', 'día', 'Ñu')), {
    minLength: 1,
    maxLength: 3,
  })
  .map((parts) => parts.join(' '));

/** Catálogo de un idioma tal como se declarará en su fichero YAML. */
interface Catalog {
  locale: string;
  /** Claves declaradas, con el texto de este idioma, en orden de declaración. */
  entries: Array<{ key: string; text: string }>;
}

/** Datos de la comprobación: catálogo de referencia y catálogos comparados. */
interface CatalogPlan {
  /** Catálogo del idioma por defecto: la referencia de la completitud. */
  reference: Catalog;
  /** Catálogos de los demás idiomas cargados. */
  others: Catalog[];
}

/** Idiomas candidatos, además del de referencia. */
const OTHER_LOCALES = ['en', 'gl', 'eu', 'ca'] as const;

/** Lo que se genera de un idioma distinto del de referencia. */
interface LocaleSeed {
  /** ¿Se carga el catálogo de este idioma? */
  loaded: boolean;
  /**
   * Máscara de las claves del español que este idioma declara, recorrida
   * cíclicamente. Así la partición entre claves declaradas y ausentes cubre
   * todo el espectro: catálogo vacío, incompleto y completo.
   */
  declares: boolean[];
  /** Claves que solo existen en este idioma. */
  extra: string[];
  /** Textos de este idioma, repartidos cíclicamente entre sus claves. */
  texts: string[];
}

const arbLocaleSeed: fc.Arbitrary<LocaleSeed> = fc.record({
  loaded: fc.boolean(),
  declares: fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
  extra: fc.uniqueArray(arbI18nKey, { maxLength: 2 }),
  texts: fc.array(arbText, { minLength: 1, maxLength: 4 }),
});

/**
 * Semilla del plan: un idioma por candidato y las claves del español. Ninguna
 * longitud depende de otro valor generado, así que el plan se construye con un
 * solo `map` y sin `chain`. Eso importa al reducir un contraejemplo: fast-check
 * no puede producir un plan que se contradiga a sí mismo, como un catálogo
 * declarado completo al que le falte una clave del español.
 */
const arbPlanSeed = fc.record({
  keys: fc.uniqueArray(arbI18nKey, { minLength: 1, maxLength: 8 }),
  referenceTexts: fc.array(arbText, { minLength: 1, maxLength: 4 }),
  en: arbLocaleSeed,
  gl: arbLocaleSeed,
  eu: arbLocaleSeed,
  ca: arbLocaleSeed,
});

/** Elemento de una lista no vacía, por posición cíclica. */
function cyclic<T>(items: T[], position: number, fallback: T): T {
  return items.length === 0 ? fallback : (items[position % items.length] ?? fallback);
}

/** Catálogo de un idioma a partir de sus claves y sus textos. */
function catalogOf(locale: string, keys: string[], texts: string[]): Catalog {
  return {
    locale,
    entries: keys.map((key, position) => ({ key, text: cyclic(texts, position, key) })),
  };
}

/**
 * Plan de catálogos: el español, completo por construcción, y los catálogos de
 * los idiomas cargados. Con `complete`, esos catálogos declaran todas las claves
 * del español; sin él, las que diga su máscara.
 *
 * Cada idioma trae su propio texto para la misma clave: la completitud compara
 * claves, nunca textos, y generarlos por separado lo comprueba.
 */
function arbCatalogPlan(complete: boolean): fc.Arbitrary<CatalogPlan> {
  return arbPlanSeed.map((seed) => {
    const seeds = OTHER_LOCALES.map((locale) => ({ locale, seed: seed[locale] }));
    // Al menos un idioma que comparar con el español; si la semilla no carga
    // ninguno, se toma el primero.
    const loaded = seeds.filter((entry) => entry.seed.loaded);
    const chosen = loaded.length > 0 ? loaded : seeds.slice(0, 1);

    return {
      reference: catalogOf(REFERENCE_LOCALE, seed.keys, seed.referenceTexts),
      others: chosen.map((entry) => {
        const declared = complete
          ? seed.keys
          : seed.keys.filter((_, position) => cyclic(entry.seed.declares, position, true));
        return catalogOf(entry.locale, [...declared, ...entry.seed.extra], entry.seed.texts);
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Construcción de los datos
// ---------------------------------------------------------------------------

/** Claves declaradas por un catálogo. */
function keysOf(catalog: Catalog): string[] {
  return catalog.entries.map((entry) => entry.key);
}

/** Emite un catálogo como fichero YAML. */
function catalogSource(catalog: Catalog): DataSource {
  const strings: Record<string, string> = {};
  for (const entry of catalog.entries) {
    strings[entry.key] = entry.text;
  }
  return {
    path: `data/i18n/${catalog.locale}.yaml`,
    content: dump(
      { locale: catalog.locale, plural_rules: 'spanish', strings },
      { lineWidth: -1, noRefs: true, sortKeys: false },
    ),
  };
}

/** Ficheros de datos del plan: las reglas y un catálogo por idioma. */
function sourcesOf(plan: CatalogPlan): DataSource[] {
  return [RULES, catalogSource(plan.reference), ...plan.others.map(catalogSource)];
}

/** Carga los ficheros y falla el test si el cargador devolvió errores. */
function expectLoaded(sources: DataSource[]): GameData {
  const result = loadAll(sources);
  if (!result.ok) {
    throw new Error(`carga fallida: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

/** Claves del español que un catálogo no declara. */
function missingKeysOf(plan: CatalogPlan, other: Catalog): string[] {
  const declared = new Set(keysOf(other));
  return keysOf(plan.reference).filter((key) => !declared.has(key));
}

/** Advertencias de completitud de catálogo, por idioma. */
function incompleteWarnings(warnings: ValidationIssue[], locale: string): ValidationIssue[] {
  return warnings.filter(
    (warning) => warning.code === INCOMPLETE_CODE && warning.context?.['locale'] === locale,
  );
}

// ---------------------------------------------------------------------------
// Propiedad 38
// ---------------------------------------------------------------------------

// Feature: hextown-base-game, Property 38: Completitud de catálogos de idioma
describe('Propiedad 38: completitud de los catálogos de idioma', () => {
  it('advierte de toda clave del español que otro catálogo no declara, y solo de esas', () => {
    // Requisito 22.8.
    fc.assert(
      fc.property(arbCatalogPlan(false), (plan) => {
        const report = validate(expectLoaded(sourcesOf(plan)));

        for (const other of plan.others) {
          const missing = missingKeysOf(plan, other);
          const reported = incompleteWarnings(report.warnings, other.locale).map((warning) =>
            String(warning.context?.['key']),
          );

          // Una advertencia por clave ausente, ninguna por clave declarada.
          expect([...reported].sort()).toEqual([...missing].sort());
        }
      }),
      RUNS,
    );
  });

  it('identifica la clave ausente, su idioma y su fichero', () => {
    // Requisito 22.8 y principio de errores informativos del diseño: la
    // advertencia lleva lo necesario para corregir el catálogo.
    fc.assert(
      fc.property(arbCatalogPlan(false), (plan) => {
        const report = validate(expectLoaded(sourcesOf(plan)));
        const warnings = report.warnings.filter((warning) => warning.code === INCOMPLETE_CODE);

        for (const warning of warnings) {
          const key = String(warning.context?.['key']);
          const locale = String(warning.context?.['locale']);

          expect(keysOf(plan.reference)).toContain(key);
          expect(warning.path).toBe(`strings.${key}`);
          expect(warning.file).toBe(`data/i18n/${locale}.yaml`);
          expect(warning.message).toContain(key);
          expect(warning.message).toContain(locale);
          expect(warning.context?.['reference']).toBe(REFERENCE_LOCALE);
        }

        // El catálogo de referencia nunca se compara consigo mismo.
        expect(incompleteWarnings(report.warnings, REFERENCE_LOCALE)).toEqual([]);
      }),
      RUNS,
    );
  });

  it('no advierte de nada cuando los demás catálogos declaran todas las claves', () => {
    // La otra rama de la propiedad: el catálogo declara la clave, no hay aviso
    // por él, ni siquiera cuando añade claves propias que el español no tiene.
    fc.assert(
      fc.property(arbCatalogPlan(true), (plan) => {
        const report = validate(expectLoaded(sourcesOf(plan)));

        expect(report.warnings.filter((warning) => warning.code === INCOMPLETE_CODE)).toEqual([]);
      }),
      RUNS,
    );
  });

  it('un catálogo incompleto no impide iniciar la partida', () => {
    // Requisito 20.6: la completitud de idiomas es advertencia, no error. Las
    // reglas y los catálogos generados son válidos, así que el informe no puede
    // traer ningún error bloqueante por muchas claves que falten.
    fc.assert(
      fc.property(arbCatalogPlan(false), (plan) => {
        const report = validate(expectLoaded(sourcesOf(plan)));

        expect(report.errors).toEqual([]);
        expect(report.isBlocking).toBe(false);
      }),
      RUNS,
    );
  });
});
