---
inclusion: always
---

# Convenciones de Hextown

Reglas vinculantes del proyecto. El detalle completo, con ejemplos y justificación, está en `docs/convenciones.md`; aquí va lo que no se puede incumplir.

## Restricciones duras

1. **Nada de `Math.random()`, `Date.now()`, `performance.now()` ni `crypto` en `src/core/`.** Toda aleatoriedad pasa por el `Rng` de `src/core/rng.ts`. Para un sorteo independiente, `deriveSubSeed(seed, etiqueta)` o `forkRng(padre)`.
2. **Ni un número de balance en el código.** Costes, tiempos, producciones, probabilidades y densidades salen de `data/`. Una constante nueva de balance va en `data/rules.yaml`. Solo son admisibles en código las constantes estructurales: primer día 1, primer fragmento 0, hexágono de la Ciudad `(0, 0)`.
3. **Ninguna cadena de interfaz literal.** Todo texto visible es una clave i18n resuelta por el Gestor_De_Textos. En los datos se usan siempre `name_key`, `desc_key`, `text_key`, nunca los alias `name`, `desc`, `text`.
4. **`src/core/` no importa DOM ni `src/render/` ni `src/ui/`.** `src/render/` lee el estado y nunca lo muta.
5. **La capa de datos no lanza excepciones ante datos inválidos**, ni con YAML corrupto: devuelve `Result` y acumula todos los diagnósticos.
6. **No cambies `hexSpiral`, el orden de `DIRECTIONS` ni el formato de `hexKey`** (`"q,r"`). La espiral es el orden en que se consume el RNG: alterarla cambia todos los mapas de todas las semillas. `DIRECTIONS` es el contrato del control por teclado y `hexKey` aparece en los guardados.
7. **El estado es inmutable hacia fuera:** cada acción devuelve un `GameState` nuevo. Mutar una estructura local antes de devolverla sí es correcto.
8. **`Poblacion_Total` no se almacena**, es `freePopulation + employedPopulation`. Toda acción que gaste población debe preservar ese invariante o el modelo de consumo/empleo declarado.

## Idioma

Identificadores en inglés. Comentarios, JSDoc, nombres de test, mensajes de error, documentación y commits en español.

Los términos del glosario se usan literalmente en español en comentarios y mensajes: `Poblacion_Libre`, `Poblacion_Empleada`, `Poblacion_Total`, `Fin_De_Dia`, `Dano_Acumulado`, `Efecto_Global`, y los nombres de sistema (`Generador_De_Mapa`, `Gestor_De_Recursos`, `Nucleo_De_Simulacion`…). En identificadores TypeScript se traducen: `freePopulation`, `employedPopulation`.

En claves YAML, los campos estructurales van en inglés (`allowed_terrains`, `build_time`, `requires_tech`) y los parámetros de balance del glosario en español (`intentos_maximos`, `nivel_amenaza_por_anillo`, `produce_durante_mejora`). Ante la duda, imita el fichero que tocas.

## Errores

`Result<T, E>` para todo fallo achacable a los datos o al jugador. `RangeError` **solo** para errores de programación (radio negativo, `max` fuera de rango, estado de RNG mal formado).

Todo `GameError` y `ValidationIssue` lleva **código estable, mensaje legible en español y contexto con fichero y ruta del campo**. Se acumulan todos los diagnósticos antes de devolver; nunca se aborta en el primero. Los `code` son contrato: los tests dependen de ellos y sirven para resolver textos i18n.

## Cabecera de módulo

Todo módulo abre con un JSDoc que incluye: qué hace en una frase con el requisito entre paréntesis, las decisiones de diseño que no se deducen del código, el algoritmo paso a paso citando requisitos, y un apartado de reparto de responsabilidades que diga qué **no** hace el módulo y quién lo hace.

Esa cabecera va en el mismo commit que el código. Imports con extensión `.ts` explícita. Secciones separadas con líneas de guiones. API pública arriba, internos abajo.

## TypeScript

`strict` más `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`.

`interface` para formas de objeto, `type` para uniones. Vocabularios cerrados como uniones de literales, no `string`. Sin `any`: usa `unknown` y estrecha con guardas. Sin clases: módulos de funciones y, cuando haga falta estado, un cierre que devuelve un objeto de funciones, como `createRng` y `createTextManager`.

`noUncheckedIndexedAccess` hace que `array[i]` sea `T | undefined`. Trátalo; no lo silencies con `!` salvo cuando el índice esté acotado por construcción justo al lado.

## Tests

`tests/unit/*.test.ts` para ejemplos concretos y ramas de error. `tests/properties/*.prop.ts` para invariantes con fast-check.

Los tests de propiedades exigen: **mínimo 100 iteraciones** (`const RUNS = { numRuns: 100 } as const`), comentario tag antes del `describe` con la forma `// Feature: hextown-base-game, Property N: <nombre>`, y cabecera de fichero con la lista de propiedades y una línea `**Validates: Requirements ...**`.

Tres exigencias sobre el contenido:

- **Escribe un oráculo, no un espejo.** Si el test recalcula lo mismo que el código y de la misma forma, no comprueba nada. Reimplementa la comprobación de otra manera.
- **Cuenta los casos efectivos.** Si descartas casos con `fc.pre` o con un `return` temprano, lleva un contador y exige un mínimo al final: una propiedad puede pasar sin haber comprobado nada.
- **Verifica con mutaciones.** Al terminar un test de propiedades, rompe a propósito el código de producción y comprueba que falla la propiedad correcta. Revierte con `git checkout` después.

## Verificación antes de cerrar un cambio

`npm run typecheck && npm test`. El runner de tests **no** comprueba tipos: un fichero puede pasar los tests y no compilar.

## Git

Conventional commits en español con ámbito de módulo (`core`, `data`, `spec`) y tipos `feat`, `test`, `chore`, `docs`. El cuerpo explica las decisiones que no se leen en el diff: qué se eligió, qué se descartó, qué se verificó y cómo.

Una rama por tarea con su número (`feature/task-4-generacion-mapa`). Los cambios que solo tocan la especificación van en su propia rama.

## Documentación

Si introduces una convención nueva, añádela a `docs/convenciones.md` y a este fichero en el mismo commit en que la introduces, no en la tarea de documentación de la fase.

Las tareas 4.3, 8.1, 14.1, 17.1 y 22.1 mantienen al día `docs/arquitectura.md` y `docs/modificar-el-juego.md` al cerrar cada fase.

#[[file:docs/convenciones.md]]
