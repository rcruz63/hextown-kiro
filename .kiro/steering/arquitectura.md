---
inclusion: always
---

# Arquitectura de Hextown

Mapa del código y contratos entre módulos. El detalle completo está en `docs/arquitectura.md`; las recetas de modificación en `docs/modificar-el-juego.md`.

## Qué es el proyecto

Juego de estrategia por turnos para un jugador sobre mapa hexagonal procedural. TypeScript + Vite, Canvas 2D, lógica en módulos puros sin motor de terceros. Simulación **determinista desde una semilla**: la misma semilla y la misma secuencia de acciones producen el mismo estado.

Todo el contenido y el balance viven en YAML bajo `data/`; el código es genérico.

**El juego todavía no arranca.** `src/main.ts` es un andamio y `loadAll` no tiene llamadores en `src/`. El arranque lo escribe la tarea 21.1. La forma de verificar cambios hoy es la suite de tests.

## Capas

```
src/ui/ ───────┐
src/render/ ───┼──▶ src/core/ ──▶ src/data/
               └──▶ src/data/
```

`src/core/` es lógica pura testeable en Node: sin DOM, sin dependencias de `render/` ni `ui/`. `src/render/` lee el estado y nunca lo muta.

## Implementado

| Fichero | Responsabilidad | Requisitos |
|---|---|---|
| `src/core/hex-math.ts` | Coordenadas axiales, distancia, vecinos, anillos, espiral, hex→píxel | 1.1, 2.9 |
| `src/core/rng.ts` | RNG determinista xoshiro128\*\*, estado serializable, subsemillas | 1.12, 5.19 |
| `src/core/types.ts` | Tipos del estado de partida | 4.1, 4.18, 5.1 |
| `src/core/result.ts` | `Result<T, E>` y `GameError` | — |
| `src/core/map-generator.ts` | Generador_De_Mapa | 1.1–1.15 |
| `src/data/loader.ts` | Cargador_De_Datos | 20.1–20.3, 22.3 |
| `src/data/validator.ts` | Validador_De_Datos | 20.3–20.6, 22.4 |
| `src/data/serializer.ts` | Serializador_De_Datos | 20.8 |
| `src/data/texts.ts` | Gestor_De_Textos | 22.1–22.7 |

## Pendiente, con el fichero previsto

`visibility.ts` (5.1), `exploration.ts` (5.2), `resources.ts` (6.1), `clock.ts` (7.1), `construction.ts` (9.1), `upgrades.ts` (9.2), `demolition.ts` (9.3), `production.ts` (9.4), `exploitation.ts` (10.1), `factories.ts` (10.2), `research.ts` (11.1), `threats.ts` (12.1), `combat.ts` (12.2), `defense.ts` (12.3), `objectives.ts` (13.1), `puzzles.ts` (13.2), `simulation.ts` (15.1), `events.ts` (15.2) en `src/core/`; `persistence.ts` (16.1) en `src/data/`; `engine.ts`, `pixel-art.ts`, `camera.ts` (18.1–18.3) en `src/render/`; `interface.ts`, `hex-menu.ts`, `tech-tree.ts`, `puzzle-window.ts`, `game-end.ts` (19.1–19.5) e `input.ts` (20.1) en `src/ui/`.

Antes de crear uno de estos módulos, consulta su tarea en `.kiro/specs/hextown-base-game/tasks.md` y los requisitos que cita.

## Contratos que no se rompen

**`hexSpiral(centro, radio)`** es el orden canónico de recorrido del mapa y el orden en que se consume el RNG. **`DIRECTIONS`** fija los vecinos en orden E, NE, NW, W, SW, SE y es el contrato del control por teclado. **`hexKey`** produce `"q,r"`, es la clave de `HexMap.cells` y aparece en los guardados.

**Vocabularios cerrados** en `src/core/types.ts`, como uniones de literales:

```ts
type TerrainType     = 'prado' | 'tundra' | 'desierto' | 'no_fertil' | 'oceano';
type VisibilityState = 'hidden' | 'dimmed' | 'explored';
type ElementCategory = 'mountain' | 'forest' | 'domestic_animal' | 'fish' | 'whale'
                     | 'settlement' | 'mystery' | 'animal_threat' | 'human_threat';
```

Ampliarlos exige tocar `types.ts` **y** las listas espejo `TERRAIN_TYPES`, `ELEMENT_CATEGORIES` y `THREAT_CATEGORIES` de `map-generator.ts`, más la segunda `ELEMENT_CATEGORIES` de `resources.ts`. Es la única excepción relevante a «el contenido nuevo no toca código».

**`Poblacion_Total` no se almacena**: es `freePopulation + employedPopulation`.

**Acciones simultáneas** se resuelven en orden lexicográfico de `(q, r)`, y las que no tienen hexágono, al final. Nunca dependas del orden de inserción de un `Map` ni del de `Object.keys`.

## Capa de datos

Flujo: `DataSource[] → loadAll → GameData → validate → ValidationReport`. El cargador no toca disco; recibe `{ path, content }`. Ninguno lanza ante datos malos.

**El campo `raw`** de cada definición contiene el mapa YAML completo con defaults aplicados, incluidos los campos que el cargador no interpreta. De ahí sale que el contenido nuevo no toque código: el serializador escribe `raw` y el validador lee de `raw`. El mapeo YAML → TypeScript es **explícito campo por campo**, no automático: un campo nuevo no aparece como propiedad camelCase, solo en `raw`.

**Defaults** desde `rules.defaults.<categoría>`, con la categoría en plural. Solo rellenan campos `undefined`; un campo declarado vacío en YAML es `null`, no recibe default y acaba como `missing_field`.

**El validador** devuelve `{ errors, warnings, isBlocking }`. Los errores impiden arrancar, las advertencias no. Comprueba esquema, referencias cruzadas contra un índice de todo lo declarado, ids duplicados por categoría, aciclicidad del grafo de tecnologías, niveles consecutivos desde 1, y que toda clave `*_key` exista en el catálogo del idioma por defecto.

**El Gestor_De_Textos** ante una clave ausente devuelve **la clave misma** y avisa una vez por par idioma-clave. Nunca lanza y nunca cae a otro idioma.

## Generador de mapa

`generateMap(data, scenario, seed): GenerationResult`, función pura. Espiral desde el centro; terreno del centro del reparto restringido a los `allowed_terrains` de la Ciudad; Ciudad nivel 1 en `(0, 0)` sin elemento; elementos en el orden de `elements.yaml` con `min(redondeo(densidad × elegibles), libres)` instancias; restricciones del escenario con reintento por subsemilla hasta `intentos_maximos`.

Puntos de extensión: `CONSTRAINT_EVALUATORS` (una clave desconocida **aborta**, Requisito 1.9), `CONSTRAINT_PARAMETER_KEYS` y `CandidateStats`, que se mide en una sola pasada.

El mapa se entrega con **todos** los hexágonos en `hidden`: la visibilidad inicial la aplica el Gestor_De_Visibilidad (2.2) y los puzzles los asigna el Sistema_De_Puzzles (16.1).

## Trazabilidad

Cada módulo cita en su cabecera los requisitos que cumple. Cada tarea de `tasks.md` cita los suyos. Cada test de propiedades cita la propiedad del diseño y los requisitos que valida. Al escribir código nuevo, mantén las tres cadenas.

#[[file:docs/arquitectura.md]]
