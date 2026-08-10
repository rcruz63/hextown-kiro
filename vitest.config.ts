import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los módulos de lógica son puros; los tests que necesiten DOM declararán
    // su entorno por fichero con `// @vitest-environment jsdom`.
    environment: 'node',
    // `.prop.ts` es la convención para los tests basados en propiedades
    // (ver "Organización de tests" en design.md).
    include: ['tests/**/*.test.ts', 'tests/**/*.prop.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.d.ts'],
    },
  },
});
