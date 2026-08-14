# Convenciones: cómo se escribe código aquí

Las reglas que sigue el código existente. No son aspiracionales: se han extraído de los módulos ya escritos, y si escribes algo que las contradiga, chocará con el resto.

Para el mapa del código, [arquitectura.md](arquitectura.md). Para recetas de contenido, [modificar-el-juego.md](modificar-el-juego.md).

## Restricciones duras

Las que rompen el diseño si se incumplen. Todo lo demás en este documento es convención de estilo; esto no.

1. **Nada de `Math.random()`, `Date.now()`, `performance.now()` ni `crypto` en `src/core/`.** Toda aleatoriedad pasa por el `Rng` de `src/core/rng.ts`. Rompe el determinismo, que es la base de la persistencia, de los mapas compartibles y de los tests de propiedades.
2. **Ni un número de balance en el código.** Costes, tiempos, producciones, probabilidades y densidades salen de `data/`. Si te hace falta una constante nueva, va en `rules.yaml`, no en un `const` del módulo. Las constantes que sí van en código son estructurales: el primer día es 1, el primer fragmento es 0, el hexágono de la Ciudad es `(0, 0)`.
3. **Ninguna cadena de interfaz literal.** Todo texto visible es una clave del catálogo i18n resuelta por el Gestor_De_Textos.
4. **`src/core/` no importa DOM ni `src/render/` ni `src/ui/`.** `src/render/` lee el estado y nunca lo muta.
5. **La capa de datos no lanza excepciones ante datos inválidos.** Ni con YAML corrupto. Devuelve `Result` o acumula diagnósticos.
6. **Un campo YAML nuevo obliga a revisar cargador, validador y serializador.** El serializador lo conserva gratis porque escribe `raw`, pero si quieres que sea una propiedad tipada hay que añadirlo al cargador, y si quieres que se valide, al validador. La Propiedad 35 (ida y vuelta) falla si rompes el ciclo.
7. **No cambies `hexSpiral` ni el orden de `DIRECTIONS`.** El recorrido en espiral es el orden en que se consume el RNG: alterarlo cambia todos los mapas de todas las semillas. `DIRECTIONS` es además el contrato del control por teclado.
8. **No cambies el formato de `hexKey`** (`"q,r"`): es la clave de `HexMap.cells` y aparece en los guardados.

## Idioma

| Qué | Idioma |
|---|---|
| Identificadores de código (variables, funciones, tipos, ficheros) | Inglés |
| Comentarios y JSDoc | Español |
| Nombres de test (`describe`, `it`) | Español |
| Mensajes de error de dominio | Español |
| Documentación y mensajes de commit | Español |
| Claves i18n | Inglés estructural, contenido en el catálogo |

Excepción deliberada: los términos del glosario del dominio se usan **literalmente en español**, también en código, porque son el vocabulario compartido con la especificación. Así aparecen `Poblacion_Libre`, `Poblacion_Empleada`, `Poblacion_Total`, `Fin_De_Dia`, `Dano_Acumulado`, `Efecto_Global`, y los nombres de sistema como `Generador_De_Mapa` o `Gestor_De_Recursos`. En identificadores de TypeScript se traducen (`freePopulation`, `employedPopulation`); en comentarios y mensajes se escriben tal cual.

Las claves de YAML mezclan inglés y español porque el vocabulario del dominio manda: `allowed_terrains`, `build_time` y `requires_tech` en inglés, pero `intentos_maximos`, `nivel_amenaza_por_anillo` y `produce_durante_mejora` en español. No es un descuido: los campos estructurales van en inglés y los parámetros de balance del glosario, en español. Ante la duda, imita el fichero que estés tocando.

## Errores

Dos mecanismos, con una frontera clara.

**`Result<T, E>` para todo lo que pueda fallar por culpa de los datos o del jugador.** Es lo que usa la capa de datos entera y el generador de mapa. `src/core/result.ts` define `Result`, `ok`, `err` y `GameError`.

```ts
export interface GameError {
  code: string;                          // estable, para tests e i18n
  message: string;                       // legible, en español
  context?: Record<string, unknown>;     // fichero, ruta del campo, valor encontrado
}
```

Todo `GameError` y todo `ValidationIssue` llevan **código estable, mensaje legible y contexto con fichero y ruta del campo**. El requisito es explícito (20.4): el jugador tiene que ver qué fichero, qué campo y por qué se rechaza. Un mensaje sin ruta es un error a medias.

Se acumulan **todos** los diagnósticos antes de devolver, nunca se aborta en el primero: el objetivo es que quien corrige los datos vea de una vez todo lo que hay que arreglar.

**`RangeError` solo para errores de programación.** Un radio negativo en `hexRing`, un `max` fuera de rango en `nextInt`, un `RngState` con forma inválida. Son bugs del código que llama, no datos del jugador, y deben explotar cuanto antes.

Los códigos son estables por contrato: los tests dependen de ellos y se usan para resolver textos. Cambiar un `code` es un cambio incompatible. No hay enum que lo imponga, así que la disciplina es manual.

## Determinismo

Más allá de no usar `Math.random`:

- **Aritmética de 32 bits en el RNG** (`|0`, `>>>`, `Math.imul`) para que la secuencia sea idéntica en cualquier motor.
- **Orden de recorrido explícito.** Los recorridos del mapa siguen `hexSpiral`. Cuando varias acciones caen en el mismo instante se resuelven en orden lexicográfico de `(q, r)`, y las que no tienen hexágono, al final. Nunca dependas del orden de inserción de un `Map` ni del de `Object.keys`.
- **Subsemillas, no reutilización.** Para un sorteo independiente, `deriveSubSeed(seed, etiqueta)` o `forkRng(padre)`. No pases el mismo generador a dos subsistemas esperando independencia.
- **Nada de coma flotante en decisiones discretas** si se puede evitar. `pickTerrain` acumula pesos y compara, con una rama de respaldo para el caso en que el redondeo deje el sorteo en el extremo del último tramo.

## Estructura de un módulo

Los módulos existentes siguen todos la misma forma. Imítala:

```ts
/**
 * Nombre_Del_Sistema: qué hace en una frase (Requisito N).
 *
 * Por qué está escrito así: las decisiones de diseño que no se deducen
 * del código, con el requisito que las justifica.
 *
 * Algoritmo (design.md, «Apartado»):
 * 1. Paso (Requisito N.1).
 * 2. Paso (Requisito N.2).
 *
 * Reparto de responsabilidades: qué NO hace este módulo y quién lo hace.
 */
import { ... } from './otro-modulo.ts';   // extensión .ts explícita

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------
```

Detalles que importan:

- **La cabecera cita los requisitos.** Es la trazabilidad de primera línea y va en el mismo commit que el código, no en la tarea de documentación de la fase.
- **El apartado «Reparto de responsabilidades»** es lo que evita que dos módulos hagan lo mismo. `map-generator.ts` lo usa para dejar claro que no asigna visibilidad ni puzzles.
- **Extensión `.ts` explícita en los imports.** `tsconfig.json` tiene `allowImportingTsExtensions`.
- **Separadores de sección** con la línea de guiones a 78 columnas.
- **API pública arriba, internos abajo.** Lo que se exporta primero.
- Todo lo exportado lleva JSDoc. Los internos, cuando el nombre no baste.

## TypeScript

`strict` más las comprobaciones extra de `tsconfig.json`: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noImplicitOverride`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`.

`noUncheckedIndexedAccess` es el que más se nota: `array[i]` es `T | undefined`. Trátalo, no lo silencies con `!` salvo cuando el índice esté acotado por construcción justo al lado.

Convenciones de tipos:

- `interface` para formas de objeto, `type` para uniones y alias.
- Vocabularios cerrados como uniones de literales (`type TerrainType = 'prado' | ...`), no `string`. Da exhaustividad en los `switch` a cambio de que ampliarlos toque código.
- `readonly` en las constantes de módulo y en los parámetros que no se mutan.
- Sin `any`. `unknown` y estrecha con guardas como `isMapping`.
- Sin clases. Módulos con funciones y, cuando hace falta estado, un cierre que devuelve un objeto de funciones. Es lo que hacen `createRng` y `createTextManager`.

## Tests

| Tipo | Fichero | Contenido |
|---|---|---|
| Unitario | `tests/unit/<modulo>.test.ts` | Ejemplos concretos, casos límite, ramas de error |
| Propiedades | `tests/properties/<modulo>.prop.ts` | Invariantes cuantificadas con fast-check |
| Integración | `tests/integration/<flujo>.test.ts` | Bucle de juego completo |

`vitest.config.ts` recoge `tests/**/*.test.ts` y `tests/**/*.prop.ts`. Entorno `node` por defecto; un test que necesite DOM declara `// @vitest-environment jsdom` en su cabecera.

Para los tests de propiedades:

- **Mínimo 100 iteraciones**, `const RUNS = { numRuns: 100 } as const`.
- **Comentario tag** que enlaza con la propiedad del diseño, justo antes del `describe`:
  ```ts
  // Feature: hextown-base-game, Property 1: Determinismo del generador de mapa
  ```
- **Cabecera del fichero** con la lista de propiedades cubiertas y una línea `**Validates: Requirements 1.12, 1.13, ...**`.
- **Escribe un oráculo, no un espejo.** Si el test recalcula lo mismo que el código y de la misma forma, no comprueba nada. Reimplementa la comprobación de otra manera: donde el código hace una pasada única, el test filtra listas.
- **Cuidado con las propiedades vacías.** Si descartas casos con `fc.pre` o con un `return` temprano, cuenta cuántos casos llegaron a comprobarse y exige un mínimo al final del test. Si no, una propiedad puede pasar sin haber comprobado nada.
- **Nada de flaquear.** Una propiedad probabilística necesita margen: cuando el test dependa de que dos resultados difieran, dimensiona el número de muestras para que un falso positivo sea de probabilidad despreciable, y escribe el razonamiento en un comentario.

Cuando termines un test de propiedades, **rómpelo a propósito**: introduce una mutación en el código de producción y comprueba que la propiedad correcta falla. Un test verde que no caza nada es peor que ninguno, porque da confianza falsa. Después revierte la mutación con `git checkout`.

## Comentarios

Explican **por qué**, no qué. El qué ya está en el código.

```ts
// Mal: incrementa el contador de intentos.
// Bien: cada candidato consume una extracción del generador de la partida y
// trabaja sobre la subsemilla derivada de ella (Requisito 1.6).
```

Cuando una decisión venga de un requisito, cítalo entre paréntesis. Cuando una rama parezca inalcanzable, explica por qué existe. Cuando algo esté deliberadamente fuera del módulo, dilo y apunta a quién lo hace.

## Git

Conventional commits con el ámbito del módulo y el asunto en español:

```
test(core): tests de propiedades para el generador de mapa
feat(data): capa de datos YAML con cargador, validador, serializador e i18n
chore(spec): marcar tarea 3 como completada
```

Ámbitos en uso: `core`, `data`, `spec`. Tipos: `feat`, `test`, `chore`, `docs`.

El cuerpo del commit explica las decisiones que no se leen en el diff: por qué se eligió un enfoque, qué se descartó, qué se verificó y cómo. Los commits de este repo son largos a propósito.

Una rama por tarea, con el número: `feature/task-4-generacion-mapa`, `feature/task-4.3-documentacion`. Los cambios que solo tocan la especificación van en su propia rama.

## Cuando la realidad no cuadre con esto

Si te encuentras código que contradice este documento, hay dos posibilidades y conviene distinguirlas: o el documento está desactualizado, o el código tiene un bug. En ninguno de los dos casos la respuesta es imitar el código sin más.

Este documento se actualiza en las tareas de documentación de cada fase (4.3, 8.1, 14.1, 17.1, 22.1). Si introduces una convención nueva, añádela ahí en el mismo commit en que la introduces, no en la tarea de la fase: para entonces ya se te habrá olvidado por qué la tomaste.

Los desajustes conocidos entre lo que los datos declaran y lo que el código lee están anotados en [modificar-el-juego.md](modificar-el-juego.md), apartado «Trampas conocidas». Merece la pena leerlo antes de tocar `data/`.
