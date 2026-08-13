import { describe, expect, it, vi } from 'vitest';
// Ficheros de datos reales, importados como texto para no depender de `node:fs`.
import esCatalogYaml from '../../data/i18n/es.yaml?raw';
import rulesYaml from '../../data/rules.yaml?raw';
import { loadAll } from '../../src/data/loader.ts';
import type { I18nCatalog, NumberFormat } from '../../src/data/loader.ts';
import {
  DEFAULT_LOCALE,
  MISSING_TEXT_KEY_EVENT,
  createTextManager,
} from '../../src/data/texts.ts';
import type { MissingTextKeyWarning } from '../../src/data/texts.ts';

/** Formato numérico del español: coma decimal y punto de millares. */
const SPANISH_FORMAT: NumberFormat = { decimalSeparator: ',', thousandsSeparator: '.' };

/** Construye un catálogo en memoria, sin depender de los ficheros de `data/`. */
function makeCatalog(
  locale: string,
  strings: Record<string, string>,
  extra: { numberFormat?: NumberFormat; pluralRules?: string } = {},
): I18nCatalog {
  return {
    locale,
    strings: new Map(Object.entries(strings)),
    sourceFiles: [`data/i18n/${locale}.yaml`],
    ...extra,
  };
}

/** Catálogo de español mínimo con formato numérico y forma plural declarados. */
function spanishCatalog(): I18nCatalog {
  return makeCatalog(
    'es',
    {
      'terrain.prado.name': 'Prado',
      'ui.clock.day': 'Día {day}',
      'event.famine': 'Hambruna: faltan {missing} de comida y mueren {lost} habitantes.',
      'ui.tech.dependencies': 'Requiere: {list}',
      'ui.resources.food.one': '{count} de comida',
      'ui.resources.food.other': '{count} de comida',
      'ui.population.one': 'Queda {count} habitante',
      'ui.population.other': 'Quedan {count} habitantes',
      'ui.mission.pending': 'Pendiente',
    },
    { numberFormat: SPANISH_FORMAT, pluralRules: 'spanish' },
  );
}

describe('createTextManager: idioma activo', () => {
  it('usa el catálogo de español como idioma por defecto (22.2)', () => {
    const texts = createTextManager([makeCatalog('en', { 'ui.mission.pending': 'Pending' }), spanishCatalog()]);

    expect(texts.locale).toBe(DEFAULT_LOCALE);
    expect(texts.text('ui.mission.pending')).toBe('Pendiente');
  });

  it('resuelve las claves del idioma activo y expone los idiomas cargados (22.1)', () => {
    const texts = createTextManager([spanishCatalog(), makeCatalog('en', { 'terrain.prado.name': 'Meadow' })]);

    expect(texts.availableLocales).toEqual(['es', 'en']);
    expect(texts.has('terrain.prado.name')).toBe(true);
    expect(texts.text('terrain.prado.name')).toBe('Prado');
  });

  it('incorpora un idioma nuevo declarado en los datos sin cambios en el código (22.6)', () => {
    // El catálogo declara un identificador de forma plural no reconocido: debe
    // cargarse igualmente, aplicando la regla por defecto.
    const quenya = makeCatalog(
      'qya',
      { 'terrain.prado.name': 'Nandë', 'ui.population.one': '{count} atan', 'ui.population.other': '{count} atani' },
      { numberFormat: { decimalSeparator: '·', thousandsSeparator: ' ' }, pluralRules: 'quenya' },
    );
    const texts = createTextManager([spanishCatalog(), quenya]);

    expect(texts.setLocale('qya')).toBe(true);
    expect(texts.locale).toBe('qya');
    expect(texts.text('terrain.prado.name')).toBe('Nandë');
    expect(texts.formatNumber(12345.6)).toBe('12 345·6');
    expect(texts.plural('ui.population', 1)).toBe('1 atan');
    expect(texts.plural('ui.population', 4)).toBe('4 atani');
  });

  it('conserva el idioma activo si se pide uno que no está cargado', () => {
    const texts = createTextManager([spanishCatalog()]);

    expect(texts.setLocale('de')).toBe(false);
    expect(texts.locale).toBe('es');
    expect(texts.text('terrain.prado.name')).toBe('Prado');
  });

  it('trabaja con catálogo vacío si el idioma pedido no está cargado, sin lanzar', () => {
    const texts = createTextManager([spanishCatalog()], { locale: 'en' });

    expect(texts.locale).toBe('en');
    expect(texts.text('terrain.prado.name')).toBe('terrain.prado.name');
  });
});

describe('createTextManager: interpolación y formato de números (22.7)', () => {
  it('interpola parámetros y formatea los números con el formato del catálogo', () => {
    const texts = createTextManager([spanishCatalog()]);

    expect(texts.text('ui.clock.day', { day: 7 })).toBe('Día 7');
    expect(texts.text('event.famine', { missing: 1500, lost: 3 })).toBe(
      'Hambruna: faltan 1.500 de comida y mueren 3 habitantes.',
    );
  });

  it('une las listas de parámetros con coma', () => {
    const texts = createTextManager([spanishCatalog()]);

    expect(texts.text('ui.tech.dependencies', { list: ['Minería', 'Carpintería'] })).toBe(
      'Requiere: Minería, Carpintería',
    );
  });

  it('deja intacto el marcador de un parámetro no aportado', () => {
    const texts = createTextManager([spanishCatalog()]);

    expect(texts.text('event.famine', { missing: 2 })).toBe(
      'Hambruna: faltan 2 de comida y mueren {lost} habitantes.',
    );
    expect(texts.text('ui.clock.day')).toBe('Día {day}');
  });

  it('aplica separador decimal y de millares, y respeta el signo', () => {
    const texts = createTextManager([spanishCatalog()]);

    expect(texts.formatNumber(0)).toBe('0');
    expect(texts.formatNumber(999)).toBe('999');
    expect(texts.formatNumber(1000)).toBe('1.000');
    expect(texts.formatNumber(1234567)).toBe('1.234.567');
    expect(texts.formatNumber(1234.5)).toBe('1.234,5');
    expect(texts.formatNumber(-2500.25)).toBe('-2.500,25');
  });

  it('usa punto decimal y ningún separador de millares si el catálogo no declara formato', () => {
    const texts = createTextManager([makeCatalog('es', { 'ui.value': '{value}' })]);

    expect(texts.formatNumber(1234.5)).toBe('1234.5');
    expect(texts.text('ui.value', { value: 1234567 })).toBe('1234567');
  });

  it('devuelve los valores no finitos sin formatear', () => {
    const texts = createTextManager([spanishCatalog()]);

    expect(texts.formatNumber(Number.NaN)).toBe('NaN');
    expect(texts.formatNumber(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });
});

describe('createTextManager: forma plural del catálogo (22.7)', () => {
  it('elige singular para 1 y plural para el resto según la regla declarada', () => {
    const texts = createTextManager([spanishCatalog()]);

    expect(texts.pluralCategory(1)).toBe('one');
    expect(texts.pluralCategory(0)).toBe('other');
    expect(texts.pluralCategory(2)).toBe('other');
    expect(texts.plural('ui.population', 1)).toBe('Queda 1 habitante');
    expect(texts.plural('ui.population', 0)).toBe('Quedan 0 habitantes');
    expect(texts.plural('ui.population', 1500)).toBe('Quedan 1.500 habitantes');
  });

  it('permite sobrescribir el parámetro count', () => {
    const texts = createTextManager([spanishCatalog()]);

    expect(texts.plural('ui.population', 3, { count: 'unos cuantos' })).toBe(
      'Quedan unos cuantos habitantes',
    );
  });

  it('usa la clave sin sufijo cuando el catálogo declara una única forma', () => {
    const texts = createTextManager([
      makeCatalog('es', { 'ui.days': '{count} días' }, { pluralRules: 'spanish' }),
    ]);

    expect(texts.plural('ui.days', 1)).toBe('1 días');
  });
});

describe('createTextManager: clave ausente (22.5)', () => {
  it('devuelve la clave solicitada y registra una advertencia con esa clave', () => {
    const warnings: MissingTextKeyWarning[] = [];
    const texts = createTextManager([spanishCatalog()], {
      onMissingKey: (warning) => warnings.push(warning),
    });

    expect(texts.text('ui.button.explore')).toBe('ui.button.explore');
    expect(texts.missingKeys()).toEqual(['ui.button.explore']);
    expect(warnings).toEqual([
      {
        key: 'ui.button.explore',
        locale: 'es',
        messageKey: MISSING_TEXT_KEY_EVENT,
        params: { key: 'ui.button.explore' },
      },
    ]);
  });

  it('devuelve la clave base cuando falta también su forma plural', () => {
    const warnings: MissingTextKeyWarning[] = [];
    const texts = createTextManager([spanishCatalog()], {
      onMissingKey: (warning) => warnings.push(warning),
    });

    expect(texts.plural('ui.wolves', 2)).toBe('ui.wolves');
    expect(warnings.map((warning) => warning.key)).toEqual(['ui.wolves']);
  });

  it('no lanza ni interpola cuando la clave falta, aunque haya parámetros', () => {
    const texts = createTextManager([spanishCatalog()]);

    expect(() => texts.text('event.desconocido', { lost: 3 })).not.toThrow();
    expect(texts.text('event.desconocido', { lost: 3 })).toBe('event.desconocido');
  });

  it('notifica una sola vez por clave e idioma pero anota cada solicitud', () => {
    const onMissingKey = vi.fn();
    const texts = createTextManager([spanishCatalog(), makeCatalog('en', {})], { onMissingKey });

    texts.text('ui.button.explore');
    texts.text('ui.button.explore');
    texts.setLocale('en');
    texts.text('ui.button.explore');

    expect(onMissingKey).toHaveBeenCalledTimes(2);
    expect(onMissingKey.mock.calls.map((call) => (call[0] as MissingTextKeyWarning).locale)).toEqual([
      'es',
      'en',
    ]);
    expect(texts.missingKeys()).toHaveLength(3);
  });
});

describe('createTextManager sobre el catálogo real de español', () => {
  /** Carga `data/rules.yaml` y `data/i18n/es.yaml` con el Cargador_De_Datos. */
  function loadSpanishCatalog(): I18nCatalog {
    const result = loadAll([
      { path: 'data/rules.yaml', content: rulesYaml },
      { path: 'data/i18n/es.yaml', content: esCatalogYaml },
    ]);
    if (!result.ok) {
      throw new Error(result.error.map((error) => error.message).join('\n'));
    }
    const catalog = result.value.locales.find((entry) => entry.locale === 'es');
    if (catalog === undefined) {
      throw new Error('data/i18n/es.yaml no ha aportado el catálogo de español');
    }
    return catalog;
  }

  it('resuelve claves reales y aplica el formato declarado en el fichero', () => {
    const texts = createTextManager([loadSpanishCatalog()]);

    expect(texts.locale).toBe('es');
    expect(texts.text('terrain.prado.name')).toBe('Prado');
    expect(texts.text('ui.button.explore')).toBe('Explorar');
    expect(texts.text('event.famine', { missing: 1200, lost: 4 })).toBe(
      'Hambruna: faltan 1.200 de comida y mueren 4 habitantes.',
    );
    expect(texts.formatNumber(1234.5)).toBe('1.234,5');
    expect(texts.pluralCategory(1)).toBe('one');
    expect(texts.pluralCategory(2)).toBe('other');
  });

  it('devuelve la clave y avisa cuando el catálogo real no la declara', () => {
    const warnings: MissingTextKeyWarning[] = [];
    const texts = createTextManager([loadSpanishCatalog()], {
      onMissingKey: (warning) => warnings.push(warning),
    });

    expect(texts.text('ui.button.inexistente')).toBe('ui.button.inexistente');
    expect(warnings[0]?.messageKey).toBe(MISSING_TEXT_KEY_EVENT);
    // El texto de la advertencia sí existe en el catálogo real.
    expect(texts.text(MISSING_TEXT_KEY_EVENT, { key: 'ui.button.inexistente' })).toBe(
      'Falta la clave de texto ui.button.inexistente en el catálogo activo.',
    );
  });
});
