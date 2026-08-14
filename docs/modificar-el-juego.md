# Modificar el juego: qué toco para conseguir X

Recetas paso a paso. Cada una dice qué ficheros tocar, qué requisitos la constriñen y cómo verificar el cambio.

Antes de empezar, dos cosas:

- Lee las [trampas conocidas](#trampas-conocidas) del final. Son cinco y todas te pueden costar media hora.
- **El juego todavía no arranca.** No hay código que cargue los datos: `loadAll` no tiene llamadores en `src/` y `src/main.ts` solo pinta el lienzo. Tu forma de comprobar que un cambio de datos es correcto es la suite de tests, no jugar.

## Verificación

Todas las recetas terminan igual:

```bash
npm run typecheck && npm test
```

Los tests que te van a hablar:

| Test | Qué te dice |
|---|---|
| `tests/unit/data-files.test.ts` | Tus ficheros reales cargan, y toda clave `*_key` existe en el catálogo español |
| `tests/unit/data-validator.test.ts` | El esquema y las referencias cruzadas |
| `tests/properties/data-roundtrip.prop.ts` | Cargar → serializar → cargar no pierde nada |
| `tests/unit/map-generator.test.ts` | El escenario `valle_inicial` sigue generando mapas que cumplen sus restricciones |

Los mensajes de error traen **fichero, ruta del campo y motivo**. `data/constructions.yaml: constructions[3].levels[1].employs no se declara y es obligatorio` es literalmente lo que vas a leer.

Advertencias frente a errores: los errores impiden arrancar la partida, las advertencias no. Si el validador te avisa de `upgrade_amortization_too_fast` es una opinión sobre tu balance, no un fallo.

**Línea base actual:** los ficheros de `data/` validan con **0 errores y 3 advertencias**, todas de balance de mejoras (`upgrade_amortization_too_fast` y `upgrade_without_production_gain`). Si tras tu cambio ves más advertencias que ésas, las has añadido tú.

---

## Ajustar el balance

Lo más habitual y lo más fácil. Todo número de balance vive en `data/`; no hay ni uno en el código.

| Qué quieres cambiar | Dónde |
|---|---|
| Consumo de comida, hambruna, enfermedad | `data/rules.yaml` → `food`, `disease` |
| Fragmentos del día, duración real de un día | `data/rules.yaml` → `day` |
| Coste y tiempo de explorar | `data/rules.yaml` → `exploration` |
| Dado de combate, daño acumulado | `data/rules.yaml` → `combat` |
| Devoluciones al cancelar, tiempo de demolición | `data/rules.yaml` → `upgrades`, `demolition` |
| Umbrales de las advertencias del validador | `data/rules.yaml` → `balance` |
| Paleta, tamaño de tesela, FPS objetivo | `data/rules.yaml` → `render` |
| Coste, tiempo, trabajadores o producción de un edificio | `data/constructions.yaml`, en el nivel concreto |
| Coste o duración de una tecnología | `data/technologies.yaml` |
| Cuántos elementos aparecen en el mapa | `data/scenarios/*.yaml` → `map.element_density` |
| Proporción de terrenos | `data/scenarios/*.yaml` → `map.terrain_weights` |

Algunos valores tienen rango obligatorio y el validador los rechaza fuera de él: `day.fragments >= 1`, `day.seconds_normal > 0`, `combat.dado >= 2`, `combat.dano_maximo_acumulado` en `[0, 1)`, `demolition.time >= 1`, `research.investigaciones_simultaneas >= 1`.

Si tocas `element_density` o `terrain_weights`, comprueba que el escenario sigue cumpliendo sus propias `constraints`: bajar la densidad de montañas por debajo de lo que exige `montanas_minimas` hará que el generador agote los 50 intentos y aborte la partida.

_Requisitos: 20.1, 20.2. Verificación: `npm test`._

---

## Añadir un elemento del mapa

Un elemento es el contenido natural de un hexágono: montaña, bosque, animal, pesca, poblado, misterio o amenaza. Como máximo uno por hexágono, y **los elementos no producen nada por sí mismos**: se aprovechan recolectándolos o montando encima la construcción que los explota.

**1. Declararlo en `data/elements.yaml`.** El orden de declaración importa: es el orden en que el Generador_De_Mapa los coloca, así que un elemento declarado antes se queda con los hexágonos buenos.

```yaml
  - id: "renos"
    name_key: "element.renos.name"
    desc_key: "element.renos.desc"
    category: "domestic_animal"        # vocabulario cerrado, ver abajo
    allowed_terrains: ["tundra"]
    production_per_day: {}             # siempre vacío: los elementos no producen
    actions:
      - id: "recolectar"
        name_key: "action.recolectar.name"
        time: 1
        cost:
          poblacion: 1                 # consumo: esa población no vuelve
        reward_instant:
          comida: 10
        consumes_element: true
```

`category` solo admite: `mountain`, `forest`, `domestic_animal`, `fish`, `whale`, `settlement`, `mystery`, `animal_threat`, `human_threat`. **Añadir una categoría nueva sí toca código**, ver la receta de más abajo.

Si es una amenaza, añade además `nivel_base`, `passive_effects`, `combat.coste_base_poblacion`, `combat.reward_instant` y, según el tipo, `respawn.dias_reaparicion` o `expansion`. Copia `lobos` para una animal y `barbaros` para una humana.

**2. Textos en `data/i18n/es.yaml`:** `element.renos.name` y `element.renos.desc`, más la clave de cada acción nueva.

**3. Densidad en el escenario**, `data/scenarios/valle_inicial.yaml` → `map.element_density`. **Sin esta entrada el elemento no aparece nunca en el mapa**, y no habrá ningún aviso: el generador solo coloca lo que el escenario declara con densidad mayor que 0.

**4. Si quieres explotarlo con una construcción**, añade su id a `mounts_on_elements` de esa construcción. Ojo: el validador entonces exige cobertura completa, ver la receta siguiente.

_Requisitos: 9.1, 1.4, 20.7, 22.1. Verificación: `npm test`._

---

## Añadir una construcción con niveles

**1. Declararla en `data/constructions.yaml`.** Los niveles se declaran **consecutivos desde 1, sin saltos**: el validador exige que `level` sea igual a la posición más uno, porque el Sistema_De_Niveles ofrece siempre la mejora al nivel actual más uno.

```yaml
  - id: "herreria"
    name_key: "construction.herreria.name"
    desc_key: "construction.herreria.desc"
    allowed_terrains: ["prado", "no_fertil"]
    tags: ["industria"]          # penaliza a las casas adyacentes (6.11)
    unique: false
    demolishable: true
    terrain_modifiers:           # multiplicativos sobre la producción base
      prado: 1.0
      no_fertil: 1.2
    levels:
      - level: 1
        name_key: "construction.herreria.level.1.name"
        build_time: 3
        cost:
          materiales: 20
        employs: 2               # TOTAL de trabajadores del nivel, no el incremento
        requires_tech: ["metalurgia"]
        production_per_day:
          materiales: 4
```

Campos obligatorios de cada nivel: `level`, `build_time` (≥ 1), `cost`, `employs` (≥ 0) y `requires_tech`, que puede ser lista vacía pero **tiene que estar**. `employs` es el total del nivel: al mejorar, el jugador solo aporta la diferencia.

**2. Textos en `data/i18n/es.yaml`:** `construction.herreria.name`, `.desc`, el `name_key` de cada nivel y el de **cada modificador de adyacencia** que declares.

**3. Si algún nivel se desbloquea por tecnología**, la tecnología lo declara en `data/technologies.yaml` → `unlocks.constructions: ["herreria:1"]`. El validador comprueba que la construcción y ese nivel concreto existan.

**4. Si se monta sobre elementos**, con `mounts_on_elements`, el validador exige cobertura completa y es estricto: una entrada en `terrain_modifiers_per_element` por cada elemento montado, una entrada por cada par (elemento, terreno) que ambos compartan, y si un nivel declara `production_per_element`, una entrada por elemento. Copia `granja` como plantilla.

Advertencias que puedes provocar, ninguna bloqueante: `level_progression_decreases` si el tiempo, el coste total o los trabajadores de un nivel bajan respecto al anterior; `upgrade_without_production_gain` si la mejora no aumenta la producción diaria; `upgrade_amortization_too_fast` si amortiza su sobrecoste en menos de `rules.balance.amortizacion_minima_dias`.

_Requisitos: 6.1–6.3, 7.1–7.3, 7.14, 7.15, 9.16, 20.7. Verificación: `npm test`._

---

## Añadir una tecnología

**1. Declararla en `data/technologies.yaml`:**

```yaml
  - id: "forja_avanzada"
    name_key: "technology.forja_avanzada.name"
    desc_key: "technology.forja_avanzada.desc"
    branch: "construccion"
    tier: 4
    research_time: 7
    cost: 130
    dependencies: ["metalurgia"]
    unlocks:
      constructions: ["herreria:2"]
```

Obligatorios: `name_key`, `branch`, `tier` (≥ 1), `cost` (≥ 0), `research_time` (≥ 1) y `dependencies`, que puede ser lista vacía pero tiene que estar. Una tecnología sin dependencias es investigable desde el día 1.

El grafo de dependencias **debe ser acíclico**: el validador lo recorre en profundidad y, si encuentra un ciclo, informa el camino completo (`a → b → a`). Depender de sí misma se reporta aparte como `self_dependency`.

`replaces` desactiva los efectos de la tecnología reemplazada manteniendo las dependencias. `cost` y `research_time` deberían seguir las series de `rules.research.coste_por_nivel` y `tiempo_por_nivel`, aunque nadie lo impone.

**2. Textos:** `technology.forja_avanzada.name` y `.desc`.

**3. Efectos globales**, si los tiene, en `unlocks` o en el bloque de efectos. El vocabulario de `effect` está documentado en la cabecera de `data/technologies.yaml`: `combate`, `coste_poblacion_combate`, `coste_poblacion_exploracion`, `coste_ciencia_investigacion`, `tiempo_investigacion`, `tiempo_construccion`, `probabilidad_enfermedad`, `consumo_comida`, `produccion`, `modificador_adyacencia`.

Ni el número de ramas ni la profundidad están fijados en el código, así que puedes añadir una rama entera. Pero si añades una rama nueva, declárala también en `technology_tree.branches`, y ten en cuenta que **ese bloque hoy no lo lee nadie** (ver trampas conocidas).

_Requisitos: 11.1, 11.2, 11.5, 11.9, 11.14, 20.7. Verificación: `npm test`._

---

## Añadir un puzzle

Los puzzles son de poblado o de misterio, y su `kind` tiene que coincidir con el `puzzle_kind` que declara algún elemento: hoy `poblado` y `misterio`.

En `data/puzzles/settlements.yaml` o `mysteries.yaml`:

```yaml
  - id: "poblado_molineros"
    kind: "poblado"
    mode: "fijo"
    name_key: "puzzle.poblado_molineros.name"
    text_key: "puzzle.poblado_molineros.text"
    options:
      - text_key: "puzzle.poblado_molineros.option.1.text"
        correct: false
      - text_key: "puzzle.poblado_molineros.option.2.text"
        correct: true
    on_success:
      message_key: "puzzle.poblado_molineros.success"
      global_effects:
        - effect: "produccion"
          value: 1
    on_failure:
      message_key: "puzzle.poblado_molineros.failure"
      global_effects:
        - effect: "consumo_comida"
          multiplier: 1.1
```

Reglas que el validador impone: **al menos 2 opciones y exactamente 1 con `correct: true`**. Un puzzle sin `options` tiene que declarar `generator`, el generador que construye las opciones desde la semilla.

Recuerda las claves de texto de **cada** opción, más `message_key` de éxito y de fallo. El validador recoge todo campo que acabe en `_key`, así que no se te va a escapar ninguna.

Diferencia de comportamiento: el efecto de un poblado es un Efecto_Global permanente y el poblado no desaparece; el de un misterio es instantáneo y el elemento se elimina.

_Requisitos: 16.2, 16.5, 16.9–16.12, 16.18. Verificación: `npm test`._

---

## Crear un escenario nuevo

Un fichero en `data/scenarios/`. Se reconoce por tener un bloque `map`, dentro de `scenario:` o en la raíz. Copia `valle_inicial.yaml` y ajusta.

Bloques obligatorios: `map` con `radius` (≥ 1), `terrain_weights` (sin pesos negativos y con suma mayor que 0) y `constraints` con `intentos_maximos` (≥ 1); `main_objective` con `desc_key` y `condition`; y `missions`, aunque sea lista vacía.

Las `constraints` que el generador sabe evaluar hoy son exactamente seis: `prados_adyacentes_a_ciudad_minimo`, `porcentaje_prado_minimo`, `montanas_minimas`, `bosques_minimos`, `amenazas_maximas` y `distancia_minima_amenaza_humana`. Más dos claves que no son restricciones sino parámetros: `intentos_maximos` y `nivel_amenaza_por_anillo`.

**Una clave de `constraints` que el generador no reconozca aborta la partida** indicando la clave. Es deliberado (Requisito 1.9): una restricción mal escrita no se ignora en silencio. Si necesitas una nueva, ver la receta siguiente.

Cuidado con pedir lo imposible: si las restricciones no se pueden cumplir con las densidades y pesos declarados, el generador agotará `intentos_maximos` y abortará devolviendo la semilla y las restricciones incumplidas. El rango recomendado es de 8 a 10 misiones; fuera de él sale una advertencia, no un error.

_Requisitos: 1.1–1.9, 15.1, 15.7, 20.1. Verificación: `npm test`._

---

## Añadir una restricción de generación de mapa

Ésta **sí toca código**, en `src/core/map-generator.ts`, y son cuatro sitios:

1. **`CandidateStats`** — añade el campo que vas a medir.
2. **`measure()`** — cálcúlalo. Es **una sola pasada** sobre las celdas para todas las restricciones; no añadas un recorrido aparte.
3. **`CONSTRAINT_EVALUATORS`** — añade la clave con su evaluador. Devuelve el valor medido cuando la restricción **se incumple** y `undefined` cuando se cumple. Ese es el contrato y es fácil confundirlo.
4. **`data/scenarios/*.yaml`** — declara la clave en `constraints`.

Si lo que añades es un parámetro del generador y no una restricción evaluable, va en `CONSTRAINT_PARAMETER_KEYS` en lugar de en los evaluadores.

Añade también el caso a `tests/unit/map-generator.test.ts` y, si la restricción tiene una invariante universal, a `tests/properties/map-generator.prop.ts`. El test de propiedades trae un oráculo independiente en `unmetConstraints()`: si añades una clave y no la añades ahí, el test lanza `el test no sabe evaluar la restricción X`, a propósito.

_Requisitos: 1.5, 1.9, 1.15. Verificación: `npm run typecheck && npm test`._

---

## Añadir un terreno o una categoría de elemento

La otra excepción a «el contenido no toca código», porque son uniones de literales de TypeScript y no cadenas libres.

**Para un terreno:**

1. `src/core/types.ts` → añade el literal a `TerrainType`.
2. `src/core/map-generator.ts` → añade el mismo literal a `TERRAIN_TYPES`. Si no, el generador rechazará el terreno con `no es un terreno conocido`.
3. `data/terrains.yaml` → la definición con `id`, `name_key`, `desc_key`.
4. `data/i18n/es.yaml` → `terrain.<id>.name` y `.desc`.
5. `data/scenarios/*.yaml` → un peso en `terrain_weights`, o el terreno no aparecerá.
6. **Revisa las construcciones**: cada una declara `terrain_modifiers` por terreno y `allowed_terrains`. Un terreno nuevo no entra solo en ninguna de las dos listas, así que ninguna construcción podrá levantarse ahí hasta que lo añadas.

**Para una categoría de elemento**, lo mismo con `ElementCategory` en `types.ts` y `ELEMENT_CATEGORIES` en `map-generator.ts`. Si la categoría es una amenaza, mira también `THREAT_CATEGORIES` en el mismo fichero: es la lista que decide qué elementos reciben nivel, `accumulatedDamage` y `appearedDay`.

_Requisitos: 20.7 (con la salvedad de los vocabularios cerrados). Verificación: `npm run typecheck && npm test`._

---

## Añadir un idioma

No toca código, salvo un caso.

1. **`data/i18n/<codigo>.yaml`** con `locale: "<codigo>"` y `strings:`. Opcionalmente `number_format` con `decimal_separator` y `thousands_separator`, y `plural_rules`.
2. **Traduce las claves.** Las que falten producen la advertencia `incomplete_locale_catalog`, una por clave: **no bloquean**, así que un idioma a medias deja jugar y las claves sin traducir se muestran como la clave literal. La comprobación es unidireccional: una clave que sobre en tu idioma y no exista en español no se reporta.
3. **`rules.i18n.idiomas`** — añade el código por coherencia, aunque hoy nadie lea ese campo.

Puedes repartir un idioma en varios ficheros: se fusionan por `locale`. Declarar dos veces la misma clave en el mismo idioma sí es error (`duplicate_i18n_key`).

**El caso que toca código:** `plural_rules` solo reconoce `"spanish"` y `"english"`, y ambos aplican la misma regla (`n == 1` es singular). Un identificador desconocido no falla, cae en la regla de respaldo. Si tu idioma necesita plurales de verdad distintos (polaco, árabe), hay que añadir la regla a `PLURAL_RULES` en `src/data/texts.ts`.

_Requisitos: 22.2, 22.6, 22.8, 20.7. Verificación: `npm test`._

---

## Trampas conocidas

Cinco desajustes reales entre lo que los datos parecen decir y lo que el código hace. Están aquí porque cuestan tiempo y ninguna produce un error claro.

### `name:` en lugar de `name_key:` falla en silencio

El cargador acepta `name` como alias de `name_key`, y `desc`, `description`, `description_key` como alias de `desc_key`. Si escribes `name: "Herrería"` pensando en un texto literal, el cargador lo interpreta como **clave de catálogo**, el validador no lo comprueba (solo revisa campos que acaban en `_key`) y en pantalla verás literalmente `Herrería` porque el gestor de textos devuelve la clave cuando no la encuentra.

**Usa siempre `name_key`, `desc_key`, `text_key` y `message_key`.** Es lo que hacen los 241 campos de clave que hay hoy en `data/`, sin una sola excepción.

### Un campo vacío no es un campo ausente

Los valores por defecto de `rules.defaults` solo rellenan campos cuyo valor es `undefined`. En YAML, `tags:` sin nada detrás parsea a `null`, y `null` no es `undefined`: no recibe el default, y después el validador lo rechaza como `missing_field`.

**Omite el campo** si quieres el valor por defecto. No lo declares vacío.

### `sustained_days` del objetivo principal no se lee donde crees

El cargador lo busca en `main_objective.sustained_days`, pero `valle_inicial` lo declara dentro de `main_objective.condition`. Resultado: `mainObjective.sustainedDays` vale 1, no los 3 que dice el fichero, y el 3 solo sobrevive dentro de `condition`.

Es un **bug real**, no una convención. Nadie lo detecta porque el validador solo comprueba que sea ≥ 1. Cuando se implemente el Sistema_De_Objetivos (tarea 13.1) habrá que decidir cuál de los dos sitios es el canónico y arreglar el otro. Si tocas el objetivo de un escenario, declara el valor en los dos sitios hasta entonces.

### `technology_tree` es dato inerte

`data/technologies.yaml` declara un bloque `technology_tree` con el nodo central y los nombres de las 5 ramas. **Nadie lo lee**: no está entre las claves que reconoce el cargador y ninguna prueba comprueba sus claves i18n, así que puedes escribir ahí una clave inexistente y nada se quejará. Lo consumirá la pantalla del árbol de tecnologías (tarea 19.3).

Lo mismo con `es_oceano` en `data/terrains.yaml`: sobrevive en `raw`, pero hoy ningún módulo lo consulta.

### El vocabulario de los comentarios del cargador está desfasado

El JSDoc de `PuzzleDef` en `src/data/loader.ts` dice que `kind` es `settlement`/`mystery` y `mode` es `fixed`/`generated`. Los datos usan `poblado`/`misterio` y `fijo`/`generado`, y nadie valida ese vocabulario. **Manda el dato**, el comentario está mal.

---

## Un cambio de datos que el código no puede ignorar

Resumen de cuándo tocar código, porque es la pregunta que más se repite:

| Cambio | ¿Toca código? |
|---|---|
| Cualquier número de balance | No |
| Elemento, construcción, nivel, tecnología, rama, puzzle, escenario, misión | No |
| Idioma nuevo | No, salvo regla plural nueva |
| Campo YAML nuevo que solo se lee desde `raw` | No |
| Campo YAML nuevo que quieres como propiedad tipada o validada | Sí: cargador y validador |
| Terreno o categoría de elemento nuevos | Sí: `types.ts` y `map-generator.ts` |
| Restricción de generación de mapa nueva | Sí: `map-generator.ts`, cuatro sitios |
| Regla plural de un idioma no latino | Sí: `texts.ts` |

La razón de las excepciones es siempre la misma: son vocabularios cerrados como uniones de literales de TypeScript, y ese cierre es lo que da exhaustividad en los `switch` del resto del código. Es un intercambio consciente: menos flexibilidad en datos a cambio de que el compilador cace los casos sin tratar.
