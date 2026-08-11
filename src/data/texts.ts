/**
 * Gestor_De_Textos: resuelve claves de catálogo a los textos del idioma activo.
 *
 * Responsabilidades (Requisitos 22.1, 22.2, 22.5, 22.6, 22.7):
 *
 * - Resolver por clave de catálogo todo texto visible, incluidos los nombres y
 *   las descripciones que las definiciones de contenido declaran como claves
 *   (Requisito 22.1). El Cargador_De_Datos ya entrega los catálogos indexados
 *   por clave en `GameData.locales`.
 * - Usar el catálogo de español como idioma por defecto (Requisito 22.2): el
 *   idioma activo inicial es {@link DEFAULT_LOCALE} salvo que se indique otro.
 * - Devolver la clave solicitada cuando no existe en el catálogo activo y
 *   emitir una advertencia con esa clave para el Registro_De_Eventos
 *   (Requisito 22.5). Nunca lanza excepciones ni cae al texto de otro idioma:
 *   ver un identificador en pantalla delata la clave que falta.
 * - Incorporar cualquier idioma declarado en los datos sin cambios en el código
 *   (Requisito 22.6): el idioma activo se elige por su `locale` y las formas
 *   plurales desconocidas caen en la regla por defecto.
 * - Aplicar el formato de números y la forma plural declarados por el catálogo
 *   activo (Requisito 22.7), tanto al interpolar parámetros numéricos como al
 *   resolver variantes de plural.
 *
 * Interpolación: los textos del catálogo llevan sus parámetros entre llaves,
 * e.g. `event.famine: "Hambruna: faltan {missing} de comida…"`. Un parámetro no
 * aportado deja su marcador tal cual, de modo que el hueco sea visible en vez de
 * producir un texto truncado en silencio.
 */
import type { I18nCatalog, NumberFormat } from './loader.ts';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Idioma por defecto del juego (Requisito 22.2). */
export const DEFAULT_LOCALE = 'es';

/** Clave del catálogo con el texto de la advertencia por clave ausente. */
export const MISSING_TEXT_KEY_EVENT = 'event.missing_text_key';

/**
 * Formato numérico aplicado cuando el catálogo activo no declara
 * `number_format`: separador decimal `.` y sin separador de miles.
 */
const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  decimalSeparator: '.',
  thousandsSeparator: '',
};

/** Marcador de parámetro dentro de un texto del catálogo, e.g. `{missing}`. */
const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_.-]+)\}/g;

/** Separador con que se unen los parámetros que son listas, e.g. `{list}`. */
const LIST_SEPARATOR = ', ';

// ---------------------------------------------------------------------------
// Formas plurales
// ---------------------------------------------------------------------------

/** Formas plurales admitidas: singular (`one`) y plural (`other`). */
export type PluralCategory = 'one' | 'other';

/** Regla que asigna una forma plural a una cantidad. */
export type PluralRule = (count: number) => PluralCategory;

/**
 * Reglas plurales reconocidas por su identificador de catálogo
 * (`plural_rules: "spanish"`). Un identificador no reconocido no impide cargar
 * el idioma: se aplica {@link FALLBACK_PLURAL_RULE} (Requisito 22.6).
 */
const PLURAL_RULES = new Map<string, PluralRule>([
  // n == 1 ⇒ singular; en otro caso plural.
  ['spanish', (count) => (count === 1 ? 'one' : 'other')],
  ['english', (count) => (count === 1 ? 'one' : 'other')],
]);

/** Regla aplicada cuando el catálogo no declara `plural_rules` o no se reconoce. */
const FALLBACK_PLURAL_RULE: PluralRule = (count) => (count === 1 ? 'one' : 'other');

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Parámetros de interpolación de un texto, indexados por nombre de marcador. */
export type TextParams = Readonly<Record<string, unknown>>;

/**
 * Advertencia por clave ausente en el catálogo activo (Requisito 22.5). Lleva
 * ya la forma que necesita el Registro_De_Eventos: clave del mensaje y sus
 * parámetros de interpolación.
 */
export interface MissingTextKeyWarning {
  /** Clave solicitada que el catálogo activo no declara. */
  key: string;
  /** Idioma activo en el momento de la solicitud. */
  locale: string;
  /** Clave del catálogo con el texto de la advertencia. */
  messageKey: typeof MISSING_TEXT_KEY_EVENT;
  /** Parámetros de interpolación de la advertencia. */
  params: { key: string };
}

/** Opciones de creación del Gestor_De_Textos. */
export interface TextManagerOptions {
  /** Idioma activo inicial; por defecto {@link DEFAULT_LOCALE}. */
  locale?: string;
  /**
   * Receptor de las advertencias por clave ausente. El Registro_De_Eventos se
   * suscribe aquí para anotarlas (Requisito 22.5). Se notifica una vez por
   * clave e idioma: la interfaz resuelve los mismos textos en cada frame y
   * repetir la advertencia inundaría el registro.
   */
  onMissingKey?: (warning: MissingTextKeyWarning) => void;
}

/** Gestor_De_Textos. */
export interface TextManager {
  /** Idioma activo. */
  readonly locale: string;
  /** Idiomas disponibles, en el orden en que se cargaron. */
  readonly availableLocales: readonly string[];
  /**
   * Cambia el idioma activo. Devuelve `false` y conserva el idioma actual si el
   * idioma pedido no está entre los cargados (Requisito 22.6).
   */
  setLocale(locale: string): boolean;
  /** Indica si el catálogo activo declara la clave. */
  has(key: string): boolean;
  /**
   * Texto de la clave en el idioma activo, con sus parámetros interpolados.
   * Devuelve la propia clave si el catálogo activo no la declara
   * (Requisito 22.5).
   */
  text(key: string, params?: TextParams): string;
  /**
   * Texto de la clave en la forma plural que corresponde a `count` según el
   * catálogo activo (Requisito 22.7). Busca `<clave>.one` o `<clave>.other`
   * según la regla del catálogo y, si el catálogo no declara variantes, usa la
   * clave sin sufijo. `count` queda disponible como parámetro `{count}`, ya
   * formateado, salvo que `params` lo declare.
   */
  plural(key: string, count: number, params?: TextParams): string;
  /** Forma plural que corresponde a `count` en el catálogo activo. */
  pluralCategory(count: number): PluralCategory;
  /** Número con el formato declarado por el catálogo activo (Requisito 22.7). */
  formatNumber(value: number): string;
  /** Claves solicitadas y ausentes hasta ahora, en orden de solicitud. */
  missingKeys(): string[];
}

/**
 * Crea el Gestor_De_Textos sobre los catálogos cargados
 * (`GameData.locales`).
 *
 * No falla nunca: si el idioma pedido no está cargado, se trabaja con un
 * catálogo vacío de ese idioma y toda clave se resuelve como advertencia, de
 * modo que la interfaz sigue mostrando identificadores en vez de romperse.
 */
export function createTextManager(
  catalogs: readonly I18nCatalog[],
  options: TextManagerOptions = {},
): TextManager {
  const requestedLocale = options.locale ?? DEFAULT_LOCALE;
  const onMissingKey = options.onMissingKey;

  let active = findCatalog(catalogs, requestedLocale) ?? emptyCatalog(requestedLocale);
  const missing: string[] = [];
  const reported = new Set<string>();

  /** Anota la clave ausente y notifica una sola vez por clave e idioma. */
  function reportMissing(key: string): void {
    missing.push(key);
    const marker = `${active.locale}\u0000${key}`;
    if (reported.has(marker)) {
      return;
    }
    reported.add(marker);
    onMissingKey?.({
      key,
      locale: active.locale,
      messageKey: MISSING_TEXT_KEY_EVENT,
      params: { key },
    });
  }

  /** Resuelve una clave ya elegida, interpolando sus parámetros. */
  function render(key: string, params: TextParams | undefined): string {
    const template = active.strings.get(key);
    if (template === undefined) {
      return key;
    }
    return params === undefined
      ? template
      : interpolate(template, params, active.numberFormat);
  }

  function pluralCategory(count: number): PluralCategory {
    const declared = active.pluralRules;
    const rule =
      declared === undefined ? FALLBACK_PLURAL_RULE : PLURAL_RULES.get(declared) ?? FALLBACK_PLURAL_RULE;
    return rule(count);
  }

  return {
    get locale(): string {
      return active.locale;
    },
    get availableLocales(): readonly string[] {
      return catalogs.map((catalog) => catalog.locale);
    },

    setLocale(locale: string): boolean {
      const catalog = findCatalog(catalogs, locale);
      if (catalog === undefined) {
        return false;
      }
      active = catalog;
      return true;
    },

    has(key: string): boolean {
      return active.strings.has(key);
    },

    text(key: string, params?: TextParams): string {
      if (!active.strings.has(key)) {
        reportMissing(key);
        return key;
      }
      return render(key, params);
    },

    plural(key: string, count: number, params?: TextParams): string {
      const variantKey = `${key}.${pluralCategory(count)}`;
      // `count` como parámetro implícito; lo declarado prevalece.
      const merged: TextParams = { count, ...params };
      if (active.strings.has(variantKey)) {
        return render(variantKey, merged);
      }
      // El catálogo puede declarar una única forma, sin sufijo de plural.
      if (active.strings.has(key)) {
        return render(key, merged);
      }
      reportMissing(key);
      return key;
    },

    pluralCategory,

    formatNumber(value: number): string {
      return formatNumber(value, active.numberFormat);
    },

    missingKeys(): string[] {
      return [...missing];
    },
  };
}

// ---------------------------------------------------------------------------
// Formato de números
// ---------------------------------------------------------------------------

/**
 * Aplica el formato de números declarado por el catálogo: separador decimal y
 * separador de miles (Requisito 22.7). Los decimales se conservan tal cual: el
 * gestor formatea, no redondea.
 *
 * Los valores no finitos y los que JavaScript representa en notación
 * exponencial (|valor| ≥ 1e21) se devuelven sin agrupar: son magnitudes ajenas
 * al juego y agruparlas produciría un texto engañoso.
 */
function formatNumber(value: number, format: NumberFormat | undefined): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const { decimalSeparator, thousandsSeparator } = format ?? DEFAULT_NUMBER_FORMAT;
  const digits = Math.abs(value).toString();
  if (digits.includes('e')) {
    return String(value);
  }

  const [integerDigits = '', fractionDigits] = digits.split('.');
  const sign = value < 0 ? '-' : '';
  const integerPart = groupThousands(integerDigits, thousandsSeparator);
  return fractionDigits === undefined
    ? `${sign}${integerPart}`
    : `${sign}${integerPart}${decimalSeparator}${fractionDigits}`;
}

/** Agrupa los dígitos de tres en tres desde la derecha. */
function groupThousands(digits: string, separator: string): string {
  if (separator === '' || digits.length <= 3) {
    return digits;
  }
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return groups.join(separator);
}

// ---------------------------------------------------------------------------
// Interpolación
// ---------------------------------------------------------------------------

/**
 * Sustituye los marcadores `{nombre}` por sus parámetros. Los números se
 * formatean con el formato del catálogo activo y las listas se unen con
 * {@link LIST_SEPARATOR}. Un marcador sin parámetro se deja intacto.
 */
function interpolate(
  template: string,
  params: TextParams,
  format: NumberFormat | undefined,
): string {
  return template.replace(PLACEHOLDER_PATTERN, (marker: string, name: string) => {
    if (!Object.hasOwn(params, name)) {
      return marker;
    }
    const value = params[name];
    return value === undefined ? marker : formatValue(value, format);
  });
}

/** Representa un parámetro de interpolación como texto. */
function formatValue(value: unknown, format: NumberFormat | undefined): string {
  if (typeof value === 'number') {
    return formatNumber(value, format);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => formatValue(entry, format)).join(LIST_SEPARATOR);
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

/** Busca el catálogo de un idioma entre los cargados. */
function findCatalog(
  catalogs: readonly I18nCatalog[],
  locale: string,
): I18nCatalog | undefined {
  return catalogs.find((catalog) => catalog.locale === locale);
}

/** Catálogo vacío para un idioma no cargado: toda clave se resuelve a sí misma. */
function emptyCatalog(locale: string): I18nCatalog {
  return { locale, strings: new Map<string, string>(), sourceFiles: [] };
}
