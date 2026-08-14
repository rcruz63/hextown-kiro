# Arquitectura: en qué fichero se hace cada cosa

Mapa del código de Hextown. Responde a «quiero cambiar X, dónde está». Para *cómo* escribir el cambio, ver [convenciones.md](convenciones.md); para recetas concretas de contenido, [modificar-el-juego.md](modificar-el-juego.md).

Los nombres en `Mayúsculas_Con_Guiones` son los sistemas del glosario de la especificación ([`requirements.md`](../.kiro/specs/hextown-base-game/requirements.md), apartado «Glosario»). Se usan tal cual en comentarios, mensajes y documentación para que el código y la especificación hablen el mismo idioma.

## Capas y su regla de dependencia

```
src/ui/  ──────┐
src/render/ ───┼──▶ src/core/ ──▶ src/data/
               │         (tipos y datos cargados)
               └──▶ src/data/
```

Tres reglas que no se rompen:

1. **`src/core/` no importa DOM ni `src/render/` ni `src/ui/`.** Es lógica pura y testeable en Node. `vitest.config.ts` usa `environment: 'node'` precisamente por esto; un test que necesite DOM declara `// @vitest-environment jsdom` en su cabecera.
2. **`src/render/` lee el estado y nunca lo muta.** El bucle de render es independiente del tick de simulación.
3. **El estado es inmutable hacia fuera**: cada acción produce un `GameState` nuevo. Construir una estructura mutándola en local antes de devolverla sí es correcto, y es lo que hace el generador de mapa.

## Estado de implementación

| Módulo | Fichero | Responsabilidad | Requisitos | Tests |
|---|---|---|---|---|
| — | `src/core/hex-math.ts` | Coordenadas axiales, distancia, vecinos, anillos, espiral, hex→píxel | 1.1, 2.9 | `unit/hex-math.test.ts`, `properties/hex-math.prop.ts` |
| — | `src/core/rng.ts` | RNG determinista xoshiro128\*\*, estado serializable, subsemillas | 1.12, 5.19 | `unit/rng.test.ts`, `properties/rng-determinism.prop.ts` |
| — | `src/core/types.ts` | Todos los tipos del estado de partida | 4.1, 4.18, 5.1 | — |
| — | `src/core/result.ts` | `Result<T, E>` y `GameError` | — | — |
| Cargador_De_Datos | `src/data/loader.ts` | Parsea YAML a `GameData`, aplica defaults | 20.1–20.3, 22.3 | `unit/data-loader.test.ts`, `properties/data-roundtrip.prop.ts` |
| Validador_De_Datos | `src/data/validator.ts` | Esquema, referencias cruzadas, ids duplicados, ciclos, claves i18n | 20.3–20.6, 22.4 | `unit/data-validator.test.ts` |
| Serializador_De_Datos | `src/data/serializer.ts` | Escribe `GameData` como YAML recargable | 20.8 | `unit/data-serializer.test.ts` |
| Gestor_De_Textos | `src/data/texts.ts` | Resuelve claves i18n, plural, formato numérico | 22.1–22.7 | `unit/i18n.test.ts`, `properties/i18n.prop.ts` |
| Generador_De_Mapa | `src/core/map-generator.ts` | Mapa inicial desde escenario y semilla | 1.1–1.15 | `unit/map-generator.test.ts`, `properties/map-generator.prop.ts` |
| — | `data/**/*.yaml` | Todo el contenido y el balance | 20.1 | `unit/data-files.test.ts` |

Pendientes, con el fichero previsto y la tarea que los crea (ver [`tasks.md`](../.kiro/specs/hextown-base-game/tasks.md)):

| Módulo | Fichero previsto | Tarea |
|---|---|---|
| Gestor_De_Visibilidad | `src/core/visibility.ts` | 5.1 |
| Sistema_De_Exploracion | `src/core/exploration.ts` | 5.2 |
| Gestor_De_Recursos | `src/core/resources.ts` | 6.1 |
| Reloj_De_Juego | `src/core/clock.ts` | 7.1 |
| Sistema_De_Construccion | `src/core/construction.ts` | 9.1 |
| Sistema_De_Niveles | `src/core/upgrades.ts` | 9.2 |
| — | `src/core/demolition.ts` | 9.3 |
| — | `src/core/production.ts` | 9.4 |
| Sistema_De_Explotacion | `src/core/exploitation.ts` | 10.1 |
| Sistema_De_Fabricas | `src/core/factories.ts` | 10.2 |
| Sistema_De_Investigacion | `src/core/research.ts` | 11.1 |
| Sistema_De_Amenazas | `src/core/threats.ts` | 12.1 |
| Resolutor_De_Combate | `src/core/combat.ts` | 12.2 |
| Sistema_De_Defensa | `src/core/defense.ts` | 12.3 |
| Sistema_De_Objetivos | `src/core/objectives.ts` | 13.1 |
| Sistema_De_Puzzles | `src/core/puzzles.ts` | 13.2 |
| Nucleo_De_Simulacion | `src/core/simulation.ts` | 15.1 |
| Registro_De_Eventos | `src/core/events.ts` | 15.2 |
| Sistema_De_Persistencia | `src/data/persistence.ts` | 16.1 |
| Motor_De_Render | `src/render/engine.ts`, `pixel-art.ts`, `camera.ts` | 18.1–18.3 |
| Sistema_De_Interfaz | `src/ui/interface.ts`, `hex-menu.ts`, `tech-tree.ts`, `puzzle-window.ts`, `game-end.ts` | 19.1–19.5 |
| Controlador_De_Entrada | `src/ui/input.ts` | 20.1 |

## Los cimientos

### `hex-math.ts` — el orden canónico del mapa

Coordenadas axiales `(q, r)` pointy-top; la tercera coordenada `s = -q - r` es implícita. `DIRECTIONS` fija el orden de los vecinos: E, NE, NW, W, SW, SE, y ese orden es contrato, no detalle: el Controlador_De_Entrada asocia cada flecha del teclado a una de esas direcciones.

`hexSpiral(centro, radio)` devuelve el disco completo recorrido en anillos desde el centro. **Es el orden en que se consume el RNG**, así que cambiarlo cambia todos los mapas generados para cualquier semilla. `hexKey({q, r})` produce `"q,r"` y es la clave de `HexMap.cells`, o sea que también es parte del contrato: el formato aparece en los guardados.

`hexRing` y `hexSpiral` lanzan `RangeError` con un radio que no sea entero no negativo. Es intencionado: un radio inválido es un error de programación, no un dato del jugador (ver [convenciones.md](convenciones.md), «Errores»).

### `rng.ts` — de dónde sale toda la aleatoriedad

xoshiro128\*\* sembrado con splitmix32. Toda la aritmética es de 32 bits (`|0`, `>>>`, `Math.imul`) para que la secuencia sea idéntica en cualquier motor de JavaScript: no intervienen dobles ni orden de coma flotante.

- `createRng(seed)` — cualquier entero finito; se trunca a 32 bits.
- `next()`, `nextInt(max)`, `nextUint32()` — `nextInt` lanza `RangeError` si `max` no es entero en `[1, 2^32]`.
- `getState()` / `setState()` / `createRngFromState()` — el estado son 4 palabras de 32 bits, directamente serializable a JSON; viaja en el guardado como `rngState`.
- `deriveSubSeed(seed, etiqueta)` — subsemilla pura a partir de semilla y etiqueta, para puzzles y sorteos independientes.
- `forkRng(padre)` — consume una extracción del padre y devuelve un generador hijo. Es lo que usa cada intento de generación de mapa.

### `types.ts` — el estado de partida

Contiene los tipos del estado completo. Los vocabularios cerrados a tener presentes:

```ts
type TerrainType     = 'prado' | 'tundra' | 'desierto' | 'no_fertil' | 'oceano';
type VisibilityState = 'hidden' | 'dimmed' | 'explored';
type ElementCategory = 'mountain' | 'forest' | 'domestic_animal' | 'fish' | 'whale'
                     | 'settlement' | 'mystery' | 'animal_threat' | 'human_threat';
```

**Añadir un terreno o una categoría de elemento sí exige tocar código**, porque son uniones de literales en TypeScript, no cadenas libres. Es la única excepción relevante a «el contenido nuevo no toca código». Ver la receta correspondiente en [modificar-el-juego.md](modificar-el-juego.md).

`Poblacion_Total` **no se almacena**: es `freePopulation + employedPopulation`. Ese invariante es la Propiedad 6 del diseño y la trampa más fácil de romper al añadir una acción que gaste población.

## La capa de datos

El flujo es `DataSource[] → loadAll → GameData → validate → ValidationReport`. El cargador no toca el disco: recibe `{ path, content }` ya leídos. Ninguno de los dos lanza excepciones ante datos malos; acumulan diagnósticos y los devuelven.

### Qué reconoce el cargador

Clasifica cada documento por sus claves de primer nivel:

| Clave de primer nivel | Se interpreta como |
|---|---|
| `terrains`, `elements`, `constructions`, `technologies`, `puzzles`, `scenarios` | Colección de contenido |
| `locale` o `strings` | Catálogo i18n |
| `rules`, o cualquier grupo de reglas en la raíz | Reglas globales |
| `scenario`, o un bloque `map` en la raíz | Escenario como documento único |

Un fichero puede declarar varias secciones. Si no declara ninguna reconocible: error `unrecognized_data_file`. Las colecciones admiten forma de lista (`- id: prado`) o de mapa (`prado: {...}`), y en la forma de mapa la clave actúa como `id` si la definición no lo declara. El serializador reconstruye la forma original leyéndola del `fieldPath`.

### El campo `raw` y por qué el contenido nuevo no toca código

Cada definición cargada lleva un campo `raw` con **el mapa YAML completo**, defaults ya aplicados, incluidos los campos que el cargador no interpreta a propiedades tipadas. De ahí salen dos propiedades del sistema:

- El serializador escribe `raw`, nunca los campos interpretados, así que un campo YAML nuevo sobrevive al ciclo carga → serialización sin tocar código (Requisito 20.7, verificado por la Propiedad 35).
- El validador lee de `raw` casi todo lo que comprueba, así que valida campos que el cargador nunca convirtió a propiedades.

El mapeo YAML → TypeScript es **explícito campo por campo**, no una conversión automática de snake_case. `allowed_terrains` se convierte en `allowedTerrains` porque está escrito a mano en el cargador. Un campo nuevo **no** aparece como propiedad camelCase: solo vive en `raw`, y así es como está pensado.

Campos que hoy solo existen en `raw`, no como propiedad tipada: `tags`, `unique`, `demolishable`, `terrain_modifiers`, `terrain_modifiers_per_element`, `adjacency_modifiers`, `mounts_on_elements`, `requires_adjacent_element`, `production_per_day`, `production_per_element`, `production_per_adjacent`, `consumes_per_day`, `blocks_expansion_radius`, `unlocks`, `on_success`, `on_failure`, `generator`, `reward`, `combat`, `respawn`, `expansion`, `passive_effects`, `puzzle_kind`, `actions`, y también `map.seed` y `map.city_construction_id`.

### Valores por defecto

`rules.defaults.<categoría>` rellena los campos **ausentes** de cada definición, donde la categoría es la clave de colección en plural (`elements`, `constructions`, …). Hay dos pseudocategorías: `construction_levels`, aplicada a cada nivel, y `missions`, a cada misión.

Solo rellena lo que vale `undefined`, nunca sobrescribe, y no hace fusión profunda: un `tags: ["x"]` declarado reemplaza el default, no se une con él.

**Cuidado:** en YAML, `tags:` sin valor parsea a `null`, y `null` no es `undefined`, así que **no** recibe el default y acabará como `missing_field`. Omitir el campo y declararlo vacío no son lo mismo.

### Qué comprueba el validador

`validate(data)` devuelve `{ errors, warnings, isBlocking }`, con `isBlocking = errors.length > 0`. Los `code` son valores estables por contrato: los tests dependen de ellos y sirven para resolver textos i18n. No hay enum que lo imponga, es una convención.

Errores bloqueantes: `duplicate_id`, `missing_rule_group`, `missing_rule`, `invalid_rule`, `missing_field`, `empty_field`, `invalid_value`, `invalid_level_number`, `unknown_reference`, `self_dependency`, `technology_cycle`, `missing_mounted_element`, `invalid_options`, `missing_locale_catalog`, `missing_i18n_key`.

Advertencias, que dejan jugar: `level_progression_decreases`, `upgrade_without_production_gain`, `upgrade_amortization_too_fast`, `mission_count_out_of_range`, `incomplete_locale_catalog`.

Referencias cruzadas que verifica, resueltas contra un índice de todo lo declarado: terrenos citados por elementos, construcciones, `terrain_modifiers` y `terrain_weights`; elementos citados por `mounts_on_elements`, `requires_adjacent_element`, `element_density` y condiciones; construcciones citadas por `adjacency_modifiers.target_constructions`, `unlocks.constructions` (con el nivel, `casa:2`), `city_construction_id` y condiciones; tecnologías citadas por `requires_tech`, `dependencies` y `replaces`; categorías y etiquetas contra los vocabularios que los propios datos declaran; y `puzzle.kind` contra los `puzzle_kind` que declaran los elementos.

Además: ids duplicados por categoría aunque estén en ficheros distintos, aciclicidad del grafo de tecnologías por DFS informando el camino del ciclo, niveles consecutivos desde 1, y que toda clave `*_key` de los datos exista en el catálogo del idioma por defecto.

Lo que **no** comprueba, para no esperar de más: el vocabulario de `mode` de puzzle, el de `condition.type`, el de `category` de elemento más allá de que exista, `desc_key` en terrenos/elementos/construcciones/tecnologías, ni las claves del catálogo declaradas y nunca usadas.

### Textos

Toda cadena visible se resuelve por clave. `createTextManager(catalogs, options)` devuelve el Gestor_De_Textos: `text(clave, params)`, `plural(clave, count, params)`, `formatNumber`, `setLocale`, `has`, `missingKeys`.

Ante una clave ausente **devuelve la clave misma** y notifica por `onMissingKey` una sola vez por par idioma-clave, con `messageKey: 'event.missing_text_key'`. Nunca lanza y nunca cae al texto de otro idioma. Efecto visible de una clave mal escrita: en pantalla aparece la clave literal.

Interpolación con `{nombre}`; un marcador sin parámetro se deja intacto. Los números se formatean con el `number_format` del catálogo y las listas se unen con `, `.

## Generación del mapa

`generateMap(data, scenario, seed): GenerationResult` es una función pura. El algoritmo, en `src/core/map-generator.ts`:

1. Hexágonos en espiral desde el centro, radio `scenario.map.radius`.
2. Terreno del centro sorteado del reparto **restringido** a los `allowed_terrains` de la Ciudad; el resto, del reparto completo, con probabilidad proporcional al peso.
3. Ciudad de nivel 1 en `(0, 0)`, sin elemento.
4. Elementos en el orden en que los declara `elements.yaml`, con `min(redondeo(densidad × elegibles), libres)` instancias cada uno.
5. Restricciones del escenario: si el candidato incumple alguna, se descarta y se repite con la siguiente subsemilla, hasta `intentos_maximos`.

Puntos de extensión y contratos a respetar:

- `CONSTRAINT_EVALUATORS` mapea cada clave de `constraints` a su evaluador. Una clave que no esté ni aquí ni en `CONSTRAINT_PARAMETER_KEYS` **aborta la generación** con `unknown_constraint`. Es deliberado (Requisito 1.9): una restricción mal escrita no se ignora en silencio.
- `CONSTRAINT_PARAMETER_KEYS` son las claves de `constraints` que no son restricciones sino parámetros del generador: `intentos_maximos` y `nivel_amenaza_por_anillo`.
- `CandidateStats` son las medidas que se toman del mapa en **una sola pasada** para evaluar todas las restricciones.
- El mapa se entrega con **todos** los hexágonos en `hidden`. La visibilidad inicial es responsabilidad del Gestor_De_Visibilidad (Requisito 2.2), y los puzzles no se asignan aquí sino en el Sistema_De_Puzzles (16.1).
- Las amenazas se crean con nivel `1 + piso(D × nivel_amenaza_por_anillo)`, `accumulatedDamage: 0` y `appearedDay: 1`.

## Tests

Dos tipos, con convención de nombre y de propósito distintos:

- **`tests/unit/*.test.ts`** — ejemplos concretos: el escenario `valle_inicial` con semillas fijas, casos límite y ramas de error.
- **`tests/properties/*.prop.ts`** — invariantes cuantificadas con fast-check, mínimo 100 iteraciones. Cada uno cita la propiedad del diseño con un comentario tag: `// Feature: hextown-base-game, Property N: ...`.

`tests/unit/data-files.test.ts` valida los ficheros reales de `data/`, y es el que falla si añades contenido con una clave i18n que no existe. Descubre los YAML con `import.meta.glob`, así que un fichero nuevo entra sin registrarlo en ningún sitio.

## Lo que todavía no existe y conviene saber

Tres cosas que la estructura sugiere pero que aún no están:

- **No hay arranque que cargue los datos.** `loadAll` no tiene ni un llamador en `src/`; el descubrimiento de los YAML por `import.meta.glob` vive solo en los tests. Lo escribe la tarea 21.1.
- **`technology_tree` en `data/technologies.yaml` es dato inerte.** Declara el nodo central y los nombres de las 5 ramas, pero **nadie lo lee**: no está entre las claves que reconoce el cargador y ninguna prueba comprueba sus claves i18n. Lo consumirá la pantalla del árbol (tarea 19.3).
- **`rules.i18n.idiomas` es declarativo.** Nadie lo lee. El idioma por defecto sale de `rules.i18n.idioma_por_defecto` y los idiomas disponibles, de los catálogos realmente cargados.
