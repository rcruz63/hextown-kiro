/**
 * Comprobación de humo del andamiaje del proyecto (tarea 1.1).
 *
 * Verifica que el runner de tests, la librería de property-based testing y el
 * parser de YAML están correctamente instalados y utilizables desde
 * TypeScript. Se sustituirá por tests reales de dominio a partir de la
 * tarea 1.2.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { load } from 'js-yaml';

describe('andamiaje del proyecto', () => {
  it('ejecuta tests escritos en TypeScript', () => {
    const suma = (a: number, b: number): number => a + b;

    expect(suma(2, 3)).toBe(5);
  });

  it('tiene fast-check operativo con 100 iteraciones', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
      { numRuns: 100 },
    );
  });

  it('tiene js-yaml operativo', () => {
    const parsed = load('id: prado\nnombre_key: terrain.prado.name\n');

    expect(parsed).toEqual({ id: 'prado', nombre_key: 'terrain.prado.name' });
  });
});
