/**
 * Tipo `Result` genérico y errores de dominio.
 *
 * Principio de diseño: ni el Cargador_De_Datos ni el Nucleo_De_Simulacion lanzan
 * excepciones al flujo superior. Toda operación que pueda fallar devuelve un
 * `Result` explícito que el llamante debe inspeccionar.
 */

/** Error de dominio con código estable, mensaje legible y contexto opcional. */
export interface GameError {
  /** Código estable para pruebas y para resolver textos i18n (e.g. "max_attempts"). */
  code: string;
  /** Mensaje legible con contexto suficiente para diagnosticar. */
  message: string;
  /** Datos adicionales del fallo (fichero, campo, valor esperado vs encontrado). */
  context?: Record<string, unknown>;
}

/** Resultado de una operación: valor en caso de éxito o error en caso de fallo. */
export type Result<T, E = GameError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Construye un resultado correcto. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** Construye un resultado erróneo. */
export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

/** Refina un `Result` a su rama correcta. */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

/** Refina un `Result` a su rama errónea. */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}
