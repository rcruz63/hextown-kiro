# Hextown

Juego de estrategia por turnos para un jugador sobre un mapa hexagonal generado de forma procedural. Partes de una ciudad central y una civilización de subsistencia: exploras, construyes, investigas tecnologías, te enfrentas a amenazas y persigues el objetivo que declara el escenario.

TypeScript + Vite, render en Canvas 2D, lógica de juego en módulos puros sin motor de terceros. Estética pixel art generada por código. Textos en español, externalizados.

## Estado actual

**El juego todavía no es jugable.** `src/main.ts` es un andamio que solo pinta el lienzo en gris oscuro. Lo que está construido es la base:

| Fase | Estado |
|---|---|
| Tipos, matemáticas hexagonales, RNG determinista | Terminada |
| Capa de datos: cargador, validador, serializador, i18n | Terminada |
| Ficheros de contenido del escenario `valle_inicial` | Terminados |
| Generación procedural del mapa | Terminada |
| Visibilidad, exploración, recursos, reloj | Pendiente |
| Construcciones, tecnologías, amenazas, combate, objetivos | Pendiente |
| Núcleo de simulación, persistencia | Pendiente |
| Render, interfaz, control por teclado | Pendiente |

El plan completo, con el estado de cada tarea, está en [`.kiro/specs/hextown-base-game/tasks.md`](.kiro/specs/hextown-base-game/tasks.md).

Lo que sí puedes hacer hoy es ejecutar la suite de tests y generar mapas mediante `generateMap()`, que es una función pura y determinista.

## Puesta en marcha

Requiere Node 20.11 o superior.

```bash
npm install
npm test          # 251 tests en 14 ficheros, unos 6 segundos
npm run typecheck # TypeScript en strict mode, sin emitir
npm run dev       # servidor de desarrollo (hoy: un lienzo vacío)
```

| Comando | Qué hace |
|---|---|
| `npm test` | Tests unitarios y de propiedades, una sola pasada |
| `npm run test:watch` | Los mismos tests en modo vigilancia |
| `npm run test:coverage` | Cobertura sobre `src/`, informe en `coverage/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `tsc` y empaquetado de producción en `dist/` |
| `npm run preview` | Sirve lo empaquetado |

Antes de dar por bueno un cambio, `npm run typecheck && npm test`. El runner de tests **no** comprueba tipos, así que un fichero puede pasar los tests y no compilar.

## El balance vive en los datos, no en el código

Ésta es la decisión de diseño que más conviene entender antes de tocar nada: **todos** los costes, tiempos, producciones, probabilidades y contenidos viven en ficheros YAML bajo `data/`. El código es genérico y no contiene ni un número de balance.

```
data/
├── rules.yaml              Reglas globales y valores por defecto
├── terrains.yaml           Los 5 terrenos
├── elements.yaml           Contenido natural del hexágono (montañas, bosques, animales, amenazas…)
├── constructions.yaml      Construcciones con sus niveles y modificadores
├── technologies.yaml       Árbol de tecnologías: 5 ramas × 6 escalones
├── puzzles/                Puzzles de poblados y de misterios
├── scenarios/              Mapa, recursos iniciales, objetivo y misiones
└── i18n/es.yaml            Todos los textos visibles
```

Consecuencia práctica: ajustar el balance, añadir una construcción, una tecnología, un elemento o un idioma **no requiere tocar código**. Las recetas están en [`docs/modificar-el-juego.md`](docs/modificar-el-juego.md).

## Estructura del proyecto

```
src/core/     Lógica de juego pura: sin DOM, sin acceso a red, sin dependencias de render ni de interfaz
src/data/     Carga, validación, serialización de YAML y resolución de textos
src/render/   Motor de render Canvas 2D (pendiente)
src/ui/       Interfaz y control de entrada (pendiente)
tests/unit/         Tests unitarios con ejemplos concretos, *.test.ts
tests/properties/   Tests de propiedades con fast-check, *.prop.ts
tests/integration/  Tests del bucle de juego completo (pendiente)
```

## Documentación

Cuatro documentos con destinatarios distintos. Empieza por el que responda a tu pregunta:

| Si te preguntas… | Lee |
|---|---|
| ¿En qué fichero se hace esto? | [`docs/arquitectura.md`](docs/arquitectura.md) |
| ¿Cómo se escribe código aquí? ¿Qué no debo romper? | [`docs/convenciones.md`](docs/convenciones.md) |
| ¿Qué toco para conseguir X? | [`docs/modificar-el-juego.md`](docs/modificar-el-juego.md) |
| ¿Qué debe hacer el juego y por qué? | [`.kiro/specs/hextown-base-game/`](.kiro/specs/hextown-base-game/) |

La especificación son tres documentos: `requirements.md` (22 requisitos con criterios de aceptación numerados), `design.md` (arquitectura, algoritmos y las 38 propiedades de correctitud) y `tasks.md` (el plan de implementación). Cada módulo del código cita en su cabecera los requisitos que cumple, así que puedes ir del código al requisito y al revés.

[`docs/specs.md`](docs/specs.md) es la especificación original en prosa de la que nacieron los requisitos. Se conserva como referencia histórica; ante una discrepancia, manda `requirements.md`.

## Determinismo

Toda la simulación es determinista a partir de una semilla: la misma semilla y la misma secuencia de acciones producen exactamente el mismo estado. Esto permite compartir mapas, reproducir partidas y, sobre todo, verificar invariantes con tests de propiedades.

Se sostiene sobre tres reglas que **no** se pueden romper: toda aleatoriedad pasa por el RNG de `src/core/rng.ts`, los recorridos del mapa usan el orden canónico de `hexSpiral`, y en `src/core/` no hay `Math.random()` ni `Date.now()`. Los detalles, en [`docs/convenciones.md`](docs/convenciones.md).
