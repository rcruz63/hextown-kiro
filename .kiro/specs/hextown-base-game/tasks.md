# Plan de Implementación: Hextown Base Game

## Visión General

Implementación incremental del juego base Hextown en TypeScript + Vite con Canvas 2D. Se construye desde los cimientos (tipos, RNG, matemáticas hexagonales) hacia arriba, integrando cada capa antes de avanzar a la siguiente. Los tests basados en propiedades se escriben junto a cada módulo para detectar errores temprano.

## Tareas

- [x] 1. Inicialización del proyecto y tipos fundamentales
  - [x] 1.1 Crear estructura del proyecto con Vite + TypeScript
    - Inicializar proyecto con `npm create vite@latest` usando template TypeScript
    - Configurar `tsconfig.json` con strict mode
    - Instalar dependencias: `vitest`, `fast-check`, `@vitest/coverage-v8`, `js-yaml`, `@types/js-yaml`
    - Crear estructura de directorios: `src/core/`, `src/data/`, `src/render/`, `src/ui/`, `tests/unit/`, `tests/properties/`, `tests/integration/`, `data/`
    - Configurar `vitest.config.ts`
    - _Requisitos: 20.1, 20.7_

  - [x] 1.2 Definir tipos de coordenadas hexagonales y funciones de hex math
    - Implementar `AxialCoord`, `DIRECTIONS`, `hexDistance`, `hexNeighbors`, `hexRing`, `hexSpiral`, `hexToPixel`
    - Crear `src/core/hex-math.ts`
    - _Requisitos: 1.1, 2.9_

  - [x] 1.3 Implementar RNG determinista (Mulberry32 o xoshiro128**)
    - Crear `src/core/rng.ts` con interfaz `Rng` y tipo `RngState`
    - Métodos: `next()`, `nextInt(max)`, `getState()`, `setState(s)`
    - Derivación de subsemillas determinista
    - _Requisitos: 1.12, 5.19_

  - [x] 1.4 Definir tipos de estado del juego y modelos de datos
    - Crear `src/core/types.ts` con todas las interfaces: `GameState`, `HexCell`, `HexMap`, `Resources`, `Construction`, `MapElement`, `ThreatElement`, `ScheduledAction`, `TechState`, `GlobalEffect`, `PuzzleState`, `RespawnTracker`, etc.
    - Crear `src/core/result.ts` con tipo `Result<T, E>`
    - _Requisitos: 4.1, 4.18, 5.1_

  - [x] 1.5 Escribir tests de propiedades para hex math y RNG
    - **Propiedad 1: Determinismo del RNG** — dos ejecuciones con misma semilla producen misma secuencia
    - **Propiedad 10 (parcial): Determinismo de simulación** — base de RNG determinista
    - **Valida: Requisitos 1.12, 5.19**

- [x] 2. Capa de datos: cargador, validador y serializador YAML
  - [x] 2.1 Implementar el Cargador de Datos YAML
    - Crear `src/data/loader.ts`
    - Parsear ficheros YAML: terrains, elements, constructions, technologies, puzzles, scenarios, rules, i18n
    - Aplicar valores por defecto de reglas globales a campos opcionales ausentes
    - Interpretar campos de nombre/descripción como claves de catálogo i18n
    - Devolver `Result<GameData, GameError[]>` sin lanzar excepciones
    - _Requisitos: 20.1, 20.2, 20.3, 22.3_

  - [x] 2.2 Implementar el Validador de Datos
    - Crear `src/data/validator.ts`
    - Validar esquema de cada fichero
    - Validar referencias cruzadas entre terrenos, elementos, construcciones, tecnologías, puzzles y escenarios
    - Detectar identificadores duplicados entre ficheros
    - Verificar que el grafo de dependencias de tecnologías es acíclico
    - Verificar que cada clave i18n referenciada existe en el catálogo de español
    - Generar advertencias para balance (amortización mínima), misiones fuera de rango 8-10
    - Retornar `ValidationReport` con errores bloqueantes y advertencias
    - _Requisitos: 20.3, 20.4, 20.5, 20.6, 11.14, 7.14, 15.7, 22.4_

  - [x] 2.3 Implementar el Serializador de Datos
    - Crear `src/data/serializer.ts`
    - Escribir estructuras de datos válidas a formato YAML aceptado por el Cargador
    - _Requisitos: 20.8_

  - [x] 2.4 Crear ficheros de datos YAML para el escenario inicial
    - Crear `data/rules.yaml`, `data/terrains.yaml`, `data/elements.yaml`, `data/constructions.yaml`, `data/technologies.yaml`, `data/puzzles/settlements.yaml`, `data/puzzles/mysteries.yaml`, `data/scenarios/valle_inicial.yaml`, `data/i18n/es.yaml`
    - Incluir todo el contenido definido en las especificaciones
    - _Requisitos: 20.1, 16.15, 16.16_

  - [x] 2.5 Implementar el Gestor de Textos (i18n)
    - Crear `src/data/texts.ts`
    - Resolver claves a cadenas del idioma activo
    - Aplicar formato de números y forma plural del catálogo
    - Devolver la clave como fallback si no existe en el catálogo activo
    - _Requisitos: 22.1, 22.2, 22.5, 22.6, 22.7_

  - [x] 2.6 Escribir tests de propiedades para datos YAML e i18n
    - **Propiedad 35: Ida y vuelta de datos YAML** — cargar → serializar → cargar produce resultado equivalente
    - **Propiedad 36: Manejo robusto de YAML inválido** — errores informativos sin excepciones
    - **Propiedad 38: Completitud de catálogos de idioma** — claves del español presentes en otros catálogos
    - **Valida: Requisitos 20.9, 20.10, 20.11, 22.8**

- [x] 3. Checkpoint - Asegurar que los tests pasan
  - Ejecutar `vitest --run` y verificar que todos los tests de la capa de datos pasan, preguntar al usuario si surgen dudas.

- [x] 4. Generación procedural del mapa
  - [x] 4.1 Implementar el Generador de Mapa
    - Crear `src/core/map-generator.ts`
    - Algoritmo: crear hexágonos en espiral, asignar terreno central compatible con Ciudad, asignar terrenos por peso, colocar Ciudad nivel 1, colocar elementos en orden declarado respetando densidades y terrenos permitidos
    - Asignar niveles a amenazas según distancia: `1 + floor(D × nivel_amenaza_por_anillo)`
    - Inicializar Dano_Acumulado en 0, día de aparición en 1
    - Validar restricciones del escenario; regenerar con subsemilla si incumple
    - Abortar tras `intentos_maximos` devolviendo error con semilla y violaciones
    - Detectar restricciones no reconocidas y abortar con error
    - Retornar `GenerationResult`
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11_

  - [x] 4.2 Escribir tests de propiedades para el generador de mapa
    - **Propiedad 1: Determinismo del generador** — misma semilla y escenario → mapa idéntico
    - **Propiedad 2: Invariantes estructurales** — 0 o 1 elementos por hex, niveles de amenaza crecientes con distancia, restricciones cumplidas
    - **Valida: Requisitos 1.12, 1.13, 1.14, 1.15**

  - [x] 4.3 Documentar el estado actual y crear el README general
    - **Historia de usuario:** como desarrollador humano quiero modificar un aspecto del juego y necesito saber qué ficheros tocar, qué requisitos me constriñen, qué convenciones y nomenclatura seguir y cómo verificar que no he roto nada.
    - Crear `README.md`: qué es Hextown, requisitos previos (Node >= 20.11), `npm install`, `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`, mapa de directorios de primer nivel, aviso de que `data/` es la fuente de verdad del balance y que el código es genérico, y enlaces a la especificación y a las guías de `docs/`
    - Crear `docs/arquitectura.md`: tabla módulo → responsabilidad → requisitos que cumple → ficheros de test, con el estado de implementación de cada componente y las reglas de capas (`src/core/` sin DOM ni dependencias de `render/` ni `ui/`; `render/` lee el estado y nunca lo muta)
    - Crear `docs/convenciones.md`: idioma (identificadores en inglés, documentación, comentarios y nombres de test en español), uso literal de los términos del glosario del dominio, `Result<T, E>` frente a excepciones y cuándo se admite `RangeError`, forma de los `GameError` (código estable, mensaje legible, contexto con fichero y ruta), reglas de determinismo, convenciones de test (`.test.ts` / `.prop.ts`, mínimo 100 iteraciones, comentario tag de propiedad), trazabilidad de requisitos en el JSDoc de cabecera de cada módulo, y convención de commits y ramas
    - Crear `docs/modificar-el-juego.md`: recetas paso a paso, cada una con los ficheros que hay que tocar, los requisitos que la constriñen y el comando de verificación — ajustar balance, añadir un terreno, añadir un elemento, añadir una construcción con niveles, añadir una tecnología, añadir una restricción de generación de mapa (`CONSTRAINT_EVALUATORS`, `CONSTRAINT_PARAMETER_KEYS`, `CandidateStats`), añadir un puzzle y añadir un idioma
    - Documentar las restricciones duras: sin `Math.random` ni `Date.now` en `src/core/`, sin números de balance en el código, sin cadenas de interfaz literales (solo claves i18n), la capa de datos no lanza excepciones ante datos inválidos, y un campo YAML nuevo obliga a tocar cargador, validador y serializador
    - Crear `.kiro/steering/convenciones.md` y `.kiro/steering/arquitectura.md` con inclusión automática, referenciando los documentos de `docs/` mediante `#[[file:...]]` para no duplicar contenido, de modo que las convenciones obliguen también a las sesiones de Kiro y no se queden solo en la documentación humana
    - _Requisitos: 20.1, 20.7, 22.5 — la especificación no declara requisitos de documentación del repositorio; esta tarea hace utilizable la extensibilidad sin tocar código que prometen los Requisitos 20 y 22_

- [~] 5. Visibilidad y exploración
  - [x] 5.1 Implementar el Gestor de Visibilidad
    - Crear `src/core/visibility.ts`
    - Estados: oculto, atenuado, explorado
    - Inicialización: Ciudad + anillo 1 explorados, anillo 2 atenuado, resto oculto
    - Transiciones: oculto → atenuado, atenuado → explorado, sin retrocesos
    - `revealHex`: marcar explorado y atenuar vecinos ocultos
    - _Requisitos: 2.1, 2.2, 2.8, 2.9, 2.10, 2.11_

  - [x] 5.2 Implementar el Sistema de Exploración
    - Crear `src/core/exploration.ts`
    - Calcular tiempo: `tiempo_base + floor(D / dias_por_distancia)`
    - Calcular coste en población: `max(1, ceil(D × poblacion_por_distancia × efectos_globales))`
    - Validar: hex atenuado, población suficiente, no hay exploración en curso en ese hex
    - Programar acción con fragmento de finalización = fragmento de solicitud
    - Al completar: llamar a `revealHex`, revelar elemento, pausar si misterio/poblado/amenaza
    - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [ ] 5.3 Escribir tests de propiedades para visibilidad y exploración
    - **Propiedad 3: Invariantes de visibilidad** — atenuado tiene vecino explorado, oculto no adyacente a explorado, sin retrocesos
    - **Propiedad 4: Monotonía del coste de exploración** — D1 ≤ D2 → tiempo(D1) ≤ tiempo(D2) y coste(D1) ≤ coste(D2)
    - **Propiedad 5: Contabilidad de población — consumo** — PoblacionTotal post = pre - coste
    - **Valida: Requisitos 2.9, 2.10, 2.11, 3.11, 3.12, 3.13**

- [ ] 6. Gestión de recursos y modelo de población
  - [x] 6.1 Implementar el Gestor de Recursos
    - Crear `src/core/resources.ts`
    - Mantener: Poblacion_Libre, Poblacion_Empleada, comida, materiales, ciencia, oro
    - `canAfford(state, cost)`: verificar suficiencia
    - `applyCost(state, cost, 'consume')`: restar de Poblacion_Libre y Poblacion_Total
    - `applyCost(state, cost, 'employ')`: mover de Poblacion_Libre a Poblacion_Empleada, Poblacion_Total invariante
    - Consumo de comida: `ceil(Poblacion_Total × consumo_por_poblacion)`
    - Hambruna: si comida < consumo → fijar comida en 0, pérdida de población
    - Enfermedad: probabilidad diaria con efectos globales, pérdida de población
    - Producción de población al fin del día: sumar a Poblacion_Libre
    - Algoritmo de sacrificio de construcciones ante pérdida de población
    - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.15, 4.16, 4.17_

  - [ ] 6.2 Escribir tests de propiedades para recursos y población
    - **Propiedad 6: Invariante fundamental de población** — Poblacion_Total = Libre + Empleada, recursos ≥ 0
    - **Propiedad 7: Contabilidad de población — empleo** — construcción/mejora no cambia Poblacion_Total
    - **Propiedad 8: Pérdida de población con sacrificio** — Poblacion_Total resultante = max(0, anterior - P)
    - **Valida: Requisitos 4.18, 4.19, 4.20, 4.21**

- [ ] 7. Reloj de juego y programación de acciones
  - [x] 7.1 Implementar el Reloj de Juego
    - Crear `src/core/clock.ts`
    - Estados: parado, play, avance rápido
    - Dividir día en `rules.day.fragments` fragmentos
    - Conversión tiempo real → tiempo de juego según velocidad
    - `scheduleAction`: programar finalización en día d + C, fragmento f
    - `skipToNextEvent`: avanzar al próximo instante y pausar
    - Resolución de acciones simultáneas: orden lexicográfico (q, r), sin-hex al final
    - Pausa automática ante eventos (combate, misterio, poblado, expansión, misión, objetivo)
    - Aplicar `max(1, ceil(tiempo))` cuando efectos globales reducen tiempo
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17_

  - [ ] 7.2 Escribir tests de propiedades para el reloj y programación
    - **Propiedad 9: Programación preserva fragmento** — acción solicitada en fragmento f termina en fragmento f
    - **Propiedad 10: Determinismo de la simulación** — misma semilla + mismas acciones → mismo estado
    - **Propiedad 11: Independencia del orden de registro en producción** — resultado de Fin_De_Dia independiente del orden interno
    - **Valida: Requisitos 5.18, 5.19, 5.20**

- [ ] 8. Checkpoint - Asegurar que los tests pasan
  - Ejecutar `vitest --run` y verificar que todos los tests del núcleo de simulación pasan, preguntar al usuario si surgen dudas.

  - [ ] 8.1 Actualizar la documentación de la fase (visibilidad, exploración, recursos, reloj)
    - Añadir a `docs/arquitectura.md` el Gestor de Visibilidad, el Sistema de Exploración, el Gestor de Recursos y el Reloj de Juego, con sus requisitos y sus ficheros de test
    - Añadir a `docs/modificar-el-juego.md` las recetas de la fase: ajustar el coste y el tiempo de exploración, el consumo de comida y la probabilidad de enfermedad, y cambiar el número de fragmentos del día
    - Documentar el modelo de población (consumo frente a empleo) y el invariante `Poblacion_Total = Libre + Empleada`, que es la trampa más fácil de romper al añadir una acción nueva
    - Revisar que `docs/convenciones.md` recoge cualquier convención nueva introducida en la fase

- [ ] 9. Sistema de construcciones y niveles
  - [ ] 9.1 Implementar el Sistema de Construcción
    - Crear `src/core/construction.ts`
    - Validaciones: máximo 1 construcción por hex, terreno permitido, tecnología requerida, hex explorado, sin elemento bloqueante, aserradero necesita bosque adyacente
    - `build`: comprometer recursos y trabajadores (empleo), programar finalización
    - `canBuild`: devolver `ValidationResult`
    - Al completar: marcar productiva desde Fin_De_Dia de ese día
    - Ciudad: única, no demolible, niveles 1-3 sin tech, nivel 4 requiere Ciudadela
    - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.14, 6.15, 6.16_

  - [ ] 9.2 Implementar el Sistema de Niveles y Mejoras
    - Crear `src/core/upgrades.ts`
    - Mejora: nivel actual + 1, sin demolición previa, una mejora por construcción
    - Exigir tecnología del nivel destino
    - Trabajadores adicionales: employs(destino) - employs(actual)
    - Comprometer recursos y trabajadores al confirmar, programar finalización con efectos globales
    - `produce_durante_mejora`: producción nivel anterior o 0 según configuración
    - Cancelar mejora: devolver trabajadores y parte de recursos
    - _Requisitos: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13_

  - [ ] 9.3 Implementar demolición
    - Crear `src/core/demolition.ts`
    - Validar: no es la Ciudad, no tiene mejora en curso, no tiene demolición en curso
    - Programar finalización: `rules.demolition.time` días
    - Al completar: devolver trabajadores a Poblacion_Libre, devolver materiales parciales, restaurar elemento montado
    - Producción 0 mientras demolición en curso
    - Desactivar bloqueo de torre al demoler
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [ ] 9.4 Implementar cálculo de producción con modificadores
    - Crear `src/core/production.ts`
    - Fórmula: `max(0, floor(base × mod_terreno) + mod_adyacencia)`
    - Modificadores de adyacencia de casas: casa adyacente, Ciudad adyacente, amenaza, mina/fábrica, desierto
    - Aserradero: `production_per_adjacent.materiales × bosques_adyacentes` sin mod terreno
    - Torres: producción 0
    - Recalcular adyacencia cuando cambia contenido de hex vecino
    - _Requisitos: 6.10, 6.11, 6.12, 6.13, 9.9_

  - [ ] 9.5 Escribir tests de propiedades para construcciones, niveles y producción
    - **Propiedad 12: No-negatividad de producción** — producción ≥ 0 para cualquier configuración
    - **Propiedad 13: Monotonía de costes por nivel** — tiempo, coste y trabajadores crecientes
    - **Propiedad 14: Contabilidad de demolición** — Poblacion_Libre post = pre + T, Poblacion_Total invariante
    - **Propiedad 15: Producción del aserradero proporcional a bosques** — materiales = per_adjacent × N
    - **Valida: Requisitos 6.17, 6.18, 7.15, 8.10, 9.14**

- [ ] 10. Explotación de elementos y fábricas
  - [ ] 10.1 Implementar el Sistema de Explotación
    - Crear `src/core/exploitation.ts`
    - Elementos no producen por sí mismos
    - Recolectar: programar acción, comprometer población como consumo, al completar añadir recompensa y eliminar elemento
    - Talar bosque: recompensa en materiales, libera casilla
    - Montar granja sobre animal: requiere Ganadería, producción según animal y terreno
    - Montar mina sobre montaña: requiere Minería, bonus terreno no fértil
    - Montar bote de pesca: requiere Navegación costera
    - Recolectar peces/ballenas: requiere Navegación costera
    - Impedir construcción distinta de mina en montaña
    - Impedir recolección si hay construcción en el hex
    - _Requisitos: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.10, 9.11, 9.12, 9.13_

  - [ ] 10.2 Implementar el Sistema de Fábricas
    - Crear `src/core/factories.ts`
    - Leer `consumes_per_day` y `production_per_day` de cada nivel
    - Resolución en orden lexicográfico (q, r): una a una, todo-o-nada
    - Si no hay insumos suficientes → no produce, registra evento
    - Producción con modificador de terreno, consumo sin modificador
    - Fábricas excluidas del paso de producción general (producción 0 ahí)
    - _Requisitos: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ] 10.3 Escribir tests de propiedades para explotación y fábricas
    - **Propiedad 16: Recolección elimina elemento y aplica recompensa una sola vez**
    - **Propiedad 17: Completitud de datos de granjas** — producción ≥ 0 e idéntica en dos evaluaciones
    - **Propiedad 18: Fábricas — todo o nada** — consumo y producción completos o ambos nulos
    - **Propiedad 19: Determinismo del orden de fábricas** — resultado depende solo del orden (q,r)
    - **Valida: Requisitos 9.14, 9.15, 9.16, 10.7, 10.8, 10.9**

- [ ] 11. Árbol de tecnologías
  - [ ] 11.1 Implementar el Sistema de Investigación
    - Crear `src/core/research.ts`
    - Construir árbol desde datos: ramas, escalones, dependencias, coste, tiempo, desbloqueos
    - Admitir cualquier número de ramas y profundidad
    - `canResearch`: verificar dependencias investigadas, no hay investigación en curso
    - `startResearch`: comprometer ciencia con modificadores, programar finalización con modificadores
    - `completeResearch`: marcar investigada, activar desbloqueos y efectos globales
    - `replaces`: desactivar efectos de la tech reemplazada manteniendo dependencias
    - `cancelResearch`: devolver ciencia parcial, liberar slot
    - Máximo una investigación simultánea
    - _Requisitos: 11.1, 11.2, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12_

  - [ ] 11.2 Escribir tests de propiedades para tecnologías
    - **Propiedad 20: Clausura de dependencias** — tecnologías investigadas cerradas respecto a dependencias
    - **Propiedad 21: Contabilidad de costes de investigación** — coste total = suma costes con modificadores del momento de inicio
    - **Valida: Requisitos 11.15, 11.16**

- [ ] 12. Amenazas, combate y defensa
  - [ ] 12.1 Implementar el Sistema de Amenazas
    - Crear `src/core/threats.ts`
    - Efectos pasivos: reducción de población (animales) y producción (bárbaros/piratas) en radio
    - Reaparición de animales: probabilidad creciente `min(1, d / dias_reaparicion)`, cancelar si se construye
    - Expansión de bárbaros/piratas: probabilidad creciente, priorizar hex vacíos, respetar terreno (piratas solo océano)
    - Destruir construcción al expandirse sobre hex con edificio
    - Subida de nivel cada `sube_nivel_cada` días
    - No expandirse a hex protegidos por torres, Ciudad, ni hex con otra amenaza/poblado/misterio
    - _Requisitos: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14, 12.15, 12.16, 12.17, 12.18, 12.19_

  - [ ] 12.2 Implementar el Resolutor de Combate
    - Crear `src/core/combat.ts`
    - Fuerza del jugador: `max(1, Poblacion_Libre + efectos_globales_combate)`
    - Fuerza de amenaza: `max(1, ceil((coste_base + nivel) × (1 - Dano_Acumulado)))`
    - Tiradas de dado: `rng.nextInt(dado) + 1` para cada bando
    - Victoria si fuerzaJugador × tirada > fuerzaAmenaza × tirada
    - Pifia (1 vs 6) y Crítico (6 vs 1)
    - Victoria: eliminar amenaza, recompensa, coste en población
    - Derrota: tirada de daño, actualizar Dano_Acumulado (tope 0.9), coste en población
    - Calcular probabilidad de victoria para mostrar en UI
    - Validar que Poblacion_Libre ≥ costeCombate
    - _Requisitos: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13_

  - [ ] 12.3 Implementar el Sistema de Defensa (Torres)
    - Crear `src/core/defense.ts`
    - Bloqueo de expansión: unión de radios de todas las torres completadas
    - Torre en construcción no bloquea; torre con mejora en curso usa radio del nivel actual
    - Torres no afectan fuerza de combate
    - Torres no afectan reaparición de animales
    - Trabajadores de torres = Poblacion_Empleada, excluidos de combate
    - _Requisitos: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [ ] 12.4 Escribir tests de propiedades para amenazas, combate y defensa
    - **Propiedad 22: Probabilidades de amenazas acotadas** — reaparición y expansión en [0, 1]
    - **Propiedad 23: Hexágonos de expansión excluyen prohibidos** — Ciudad, torres, otra amenaza, poblado, misterio
    - **Propiedad 24: Probabilidad de victoria acotada** — en [1/dado², 1 - 1/dado²]
    - **Propiedad 25: Monotonía de probabilidad de victoria** — r1 ≤ r2 → p(r1) ≤ p(r2)
    - **Propiedad 26: Daño acumulado acotado** — en [0, dano_maximo_acumulado]
    - **Propiedad 27: Convergencia estadística del combate** — frecuencia difiere < 2pp de probabilidad teórica
    - **Propiedad 28: Torres no afectan fuerza de combate** — fuerza idéntica con/sin torre de 0 trabajadores
    - **Propiedad 29: Bloqueo de expansión = unión de radios de torres**
    - **Valida: Requisitos 12.20, 12.21, 13.14, 13.15, 13.16, 13.17, 14.9, 14.10**

- [ ] 13. Objetivos, misiones y puzzles
  - [ ] 13.1 Implementar el Sistema de Objetivos
    - Crear `src/core/objectives.ts`
    - Objetivo principal: condición + sustained_days, contador de días consecutivos
    - Reset del contador si condición no se cumple en un Fin_De_Dia
    - Victoria cuando contador alcanza sustained_days
    - Misiones intermedias: evaluar condiciones (recurso, hexes explorados, construcciones, techs), otorgar recompensa una vez
    - Derrota únicamente cuando Poblacion_Total = 0
    - Victoria tiene prioridad sobre derrota en el mismo Fin_De_Dia
    - Partida sin límite de días
    - Bloquear acciones cuando la partida ha terminado
    - _Requisitos: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.9, 15.10, 15.11, 15.12_

  - [ ] 13.2 Implementar el Sistema de Puzzles
    - Crear `src/core/puzzles.ts`
    - Sorteo de puzzles fijos sin reposición usando semilla
    - Generador `adivina_numero`: construir enunciado, opciones y respuesta a partir de semilla
    - Fallback a modo generado si bolsa de fijos se agota
    - Permutación de opciones por semilla + id del puzzle
    - Resolución: acierto → on_success, fallo → on_failure
    - Poblados: efecto permanente como Efecto_Global
    - Misterios: efecto instantáneo, eliminar elemento
    - Puzzle resuelto una sola vez, reapertura si se cierra sin elegir
    - Mapa Roto del Cartógrafo: atenuar 6 vecinos ocultos al acertar
    - _Requisitos: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.13, 16.14, 16.17_

  - [ ] 13.3 Escribir tests de propiedades para objetivos y puzzles
    - **Propiedad 30: Misiones otorgan recompensa como máximo una vez**
    - **Propiedad 31: Contador del objetivo acotado** — en [0, sustained_days]
    - **Propiedad 32: Invariantes de puzzles instanciados** — ≥ 2 opciones, exactamente 1 correcta, determinista
    - **Propiedad 33: Unicidad de solución de adivina_numero** — pistas admiten exactamente 1 solución
    - **Valida: Requisitos 15.14, 15.15, 16.18, 16.19, 16.20**

- [ ] 14. Checkpoint - Asegurar que los tests de lógica pasan
  - Ejecutar `vitest --run` y verificar que todos los tests de la capa de lógica de juego pasan, preguntar al usuario si surgen dudas.

  - [ ] 14.1 Actualizar la documentación de la fase (construcciones, explotación, tecnologías, amenazas, objetivos)
    - Añadir a `docs/arquitectura.md` construcciones, niveles, demolición, producción, explotación, fábricas, investigación, amenazas, combate, defensa, objetivos y puzzles
    - Completar en `docs/modificar-el-juego.md` las recetas de contenido, que son las que un diseñador va a usar a diario: nueva construcción con sus niveles y modificadores de terreno y adyacencia, nueva tecnología con dependencias y desbloqueos, nueva amenaza con su expansión y su combate, nuevo puzzle fijo y nuevo tipo de fábrica
    - Documentar la fórmula de producción y el orden en que se aplican modificador de terreno y modificadores de adyacencia, porque el orden cambia el resultado
    - Documentar cómo se declara un Efecto_Global y qué sistemas lo consultan
    - Revisar que `docs/convenciones.md` recoge cualquier convención nueva introducida en la fase

- [ ] 15. Núcleo de Simulación: integración de todos los sistemas
  - [ ] 15.1 Implementar el Nucleo de Simulación
    - Crear `src/core/simulation.ts`
    - `dispatch(state, action) → GameState`: validar y despachar a subsistema
    - `resolveEndOfDay(state) → GameState`: resolver los 12 pasos en orden fijo
    - `resolveInstant(state, instant) → GameState`: resolver acciones que terminan en un instante
    - Acciones soportadas: explorar, construir, mejorar, demoler, recolectar, talar, investigar, cancelar mejora, cancelar investigación, atacar, resolver puzzle
    - Rechazar acciones si partida terminada
    - Integrar todos los subsistemas en el orden correcto
    - _Requisitos: 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 15.12_

  - [ ] 15.2 Implementar el Registro de Eventos
    - Crear `src/core/events.ts`
    - Registrar eventos con día, fragmento y tipo
    - Tipos: exploración, construcción, mejora, demolición, combate, hambruna, enfermedad, expansión, misión, victoria, derrota, fábrica sin insumos, sacrificio, etc.
    - Almacenar en `GameState.eventLog`
    - _Requisitos: 3.7, 4.6, 4.9, 4.11, 10.3, 12.19_

  - [ ] 15.3 Escribir tests de integración para el bucle de juego completo
    - Test end-of-day: verificar orden fijo de 12 pasos con estado concreto del escenario valle_inicial
    - Test full-game-loop: simular 10 días con acciones programadas, verificar determinismo
    - Test edge cases: población 0 → derrota, victoria + derrota simultánea → victoria
    - _Requisitos: 5.11, 5.19, 15.11_

- [ ] 16. Sistema de persistencia
  - [ ] 16.1 Implementar el Sistema de Persistencia
    - Crear `src/data/persistence.ts`
    - `save(state, slot)`: serializar estado completo a localStorage
    - `load(slot, gameData)`: deserializar, validar versión de formato y de datos, verificar refs
    - `autoSave(state)`: escribir en clave `hextown:autosave` cada Fin_De_Dia
    - Incluir formatVersion, dataVersion, rngState, todo el estado
    - Rechazar carga si versión incompatible o refs faltantes
    - Si localStorage falla → mantener partida en memoria, mostrar error
    - _Requisitos: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7_

  - [ ] 16.2 Escribir tests de propiedades para persistencia
    - **Propiedad 37: Ida y vuelta de persistencia con continuidad de simulación** — guardar/cargar + simular = simular sin guardar
    - **Valida: Requisitos 21.8, 21.9**

- [ ] 17. Checkpoint - Asegurar que toda la lógica de juego funciona
  - Ejecutar `vitest --run` y verificar que todos los tests (unitarios, propiedades e integración) de la lógica pasan, preguntar al usuario si surgen dudas.

  - [ ] 17.1 Documentar el núcleo de simulación y la persistencia
    - Añadir a `docs/arquitectura.md` el Nucleo de Simulación, el Registro de Eventos y el Sistema de Persistencia
    - Documentar los 12 pasos del Fin_De_Dia en su orden fijo, indicando qué módulo resuelve cada paso y por qué el orden es parte del contrato
    - Documentar el ciclo de vida de una acción: solicitud, validación, compromiso de coste, programación, resolución en su instante
    - Añadir a `docs/modificar-el-juego.md` la receta de añadir un tipo de acción nueva y la de añadir un campo al estado guardado, con el efecto sobre `formatVersion`
    - Documentar la política de versiones del formato de guardado y cuándo un cambio invalida las partidas existentes

- [ ] 18. Motor de Render Canvas 2D
  - [ ] 18.1 Implementar el pipeline de renderizado
    - Crear `src/render/engine.ts`
    - View culling: calcular hexágonos visibles en viewport
    - Capas: terreno → elementos → construcciones → efectos → UI overlay
    - Hex oculto: fondo negro sin borde
    - Hex atenuado: terreno con opacidad reducida
    - Hex explorado: terreno completo + contenido
    - Dibujar aspecto distinto por nivel de construcción
    - Etapa de obra según fragmento actual de progreso
    - Indicador de efectos positivos/negativos
    - _Requisitos: 2.3, 19.4, 19.6, 19.7_

  - [ ] 18.2 Implementar pixel art generado por código
    - Crear `src/render/pixel-art.ts`
    - `PixelArtGenerator`: función por identificador + nivel + frame
    - Usar exclusivamente la paleta de `rules.render.paleta` (max 16 colores)
    - Animaciones en bucle ≤ 2 segundos por ciclo
    - Soporte para atlas de sprites como override (cargar `HTMLImageElement`)
    - Fallback a pixel art generado si atlas falla
    - _Requisitos: 19.1, 19.2, 19.3, 19.5, 19.8_

  - [ ] 18.3 Implementar conversión coordenadas y cámara
    - Crear `src/render/camera.ts`
    - `hexToPixel` pointy-top con size configurable
    - `pixelToHex`: conversión inversa para detección de click
    - Pan/zoom de cámara con ratón (arrastrar + rueda)
    - Mantener 30 FPS en mapa radio 8 con todos los hex explorados
    - _Requisitos: 19.9_

  - [ ] 18.4 Escribir tests de propiedades para render
    - **Propiedad 34: Determinismo del render** — misma semilla + id + nivel + frame → misma imagen
    - **Valida: Requisitos 19.10**

- [ ] 19. Interfaz de usuario
  - [ ] 19.1 Implementar el Sistema de Interfaz principal
    - Crear `src/ui/interface.ts`
    - Barra de recursos: Poblacion_Libre, Poblacion_Total, comida, materiales, ciencia, oro + variación prevista
    - Panel de objetivos y misiones: progreso objetivo principal, estado de cada misión
    - Registro de eventos: cronológico con día y fragmento
    - Controles de tiempo: parado, play, avance rápido, saltar al siguiente evento
    - Menú principal: selección de escenario y semilla
    - _Requisitos: 17.13, 17.14, 17.16, 17.17_

  - [ ] 19.2 Implementar tooltip y menú de interacción por hexágono
    - Crear `src/ui/hex-menu.ts`
    - Tooltip al hover: terreno, elemento, construcción, nivel, efectos
    - Desglose de producción de casas con cada modificador por separado
    - Menú al click: opciones según contenido del hex
    - Acciones deshabilitadas con motivo del requisito incumplido
    - Mostrar acción en curso con día y fragmento de finalización
    - Hex atenuado: ofrecer explorar con coste
    - Hex con amenaza: ofrecer atacar con probabilidad y coste
    - Hex con construcción: ofrecer mejorar (coste + producción destino) y demoler
    - Ciudad: ofrecer mejorar, omitir demoler
    - _Requisitos: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12_

  - [ ] 19.3 Implementar pantalla del árbol de tecnologías
    - Crear `src/ui/tech-tree.ts`
    - Dibujar como estrella de ramas radiales
    - Mostrar nombre, descripción, coste, tiempo, dependencias, estado (investigada/disponible/bloqueada)
    - Ampliación y desplazamiento
    - Nodo central visual sin acción
    - _Requisitos: 11.3, 11.13, 17.15_

  - [ ] 19.4 Implementar ventana de puzzle
    - Crear `src/ui/puzzle-window.ts`
    - Mostrar enunciado y opciones (permutadas)
    - Permitir elegir opción o cerrar sin resolver
    - Mostrar resultado (acierto/fallo) y efectos aplicados
    - _Requisitos: 16.5, 16.6, 16.14_

  - [ ] 19.5 Implementar pantalla de fin de partida
    - Crear `src/ui/game-end.ts`
    - Mostrar resultado (victoria/derrota), día de finalización, estado de cada misión
    - Permitir consultar mapa y registro de eventos
    - Opciones: volver al menú principal, nueva partida
    - _Requisitos: 15.13_

- [ ] 20. Control por teclado y accesibilidad
  - [ ] 20.1 Implementar el Controlador de Entrada
    - Crear `src/ui/input.ts`
    - Flechas: mover foco entre hexágonos (izq→W, der→E, arriba→NW, abajo→SW, Mayús+arriba→NE, Mayús+abajo→SE)
    - Enter: abrir menú del hexágono con foco
    - Espacio: alternar parado ↔ último estado activo
    - 1 y 2: play y avance rápido
    - Esc: cerrar menú/ventana con foco
    - Tab: mover foco entre paneles
    - Foco inicial en Ciudad al comenzar partida
    - Indicador visible del elemento con foco
    - _Requisitos: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9_

  - [ ] 20.2 Implementar accesibilidad básica
    - Distinguir estados por icono/texto además de color
    - Región aria-live para nuevas entradas del registro de eventos
    - Toda acción de ratón con equivalente de teclado
    - _Requisitos: 18.10, 18.11, 18.12_

- [ ] 21. Integración final y game loop
  - [ ] 21.1 Implementar el punto de entrada y game loop
    - Crear `src/main.ts`
    - Inicialización: cargar datos YAML → validar → mostrar menú principal
    - Selección de escenario y semilla → generar mapa → inicializar estado → iniciar render loop
    - Game loop: `requestAnimationFrame` → tick del reloj → render
    - Conectar input → dispatch → render
    - Autoguardado al Fin_De_Dia
    - Guardado/carga manual desde menú
    - _Requisitos: 5.3, 5.4, 5.6, 21.1, 21.2_

  - [ ] 21.2 Conectar todos los módulos de UI con el Nucleo de Simulación
    - Wiring: input controller → simulation core → render engine
    - Actualizar barra de recursos en cada cambio de estado
    - Actualizar panel de objetivos en cada Fin_De_Dia
    - Pausa automática ante eventos
    - Flujo de carga de partida guardada
    - _Requisitos: 5.9, 5.15, 15.6, 15.12, 17.13, 17.14, 21.4_

  - [ ] 21.3 Escribir tests de integración end-to-end
    - Test: iniciar partida → explorar → construir → avanzar días → verificar producción
    - Test: investigar tech → desbloquear construcción → construir → verificar
    - Test: combate → victoria/derrota → verificar estado
    - Test: guardar → cargar → continuar → verificar determinismo
    - _Requisitos: 5.19, 21.8, 21.9_

- [ ] 22. Checkpoint final - Asegurar que todo funciona
  - Ejecutar `vitest --run` y verificar que todos los tests pasan (unitarios, propiedades e integración). Ejecutar `npm run build` para verificar que no hay errores de compilación. Preguntar al usuario si surgen dudas.

  - [ ] 22.1 Cerrar la documentación de la Fase 1
    - Añadir a `docs/arquitectura.md` el Motor de Render, el Sistema de Interfaz y el Controlador de Entrada, con la separación entre lectura de estado y despacho de acciones
    - Añadir a `docs/modificar-el-juego.md` las recetas de presentación: sustituir el pixel art generado por un atlas de sprites, cambiar la paleta, y añadir un panel o una pantalla de interfaz
    - Documentar el mapa de teclas y la exigencia de que toda acción de ratón tenga equivalente de teclado, para que no se degrade al añadir interfaz
    - Completar el `README.md`: capturas, cómo jugar, y guía de contribución con la lista de comprobación previa a un commit (typecheck, tests, sin números de balance en el código, sin cadenas literales de interfaz)
    - Revisar que las recetas de `docs/modificar-el-juego.md` siguen siendo correctas ejecutando al menos una de contenido y otra de balance de principio a fin
    - _Requisitos: 18.12_

## Notas

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido.
- Cada tarea referencia requisitos específicos para trazabilidad.
- Los checkpoints garantizan validación incremental.
- Los tests de propiedades validan invariantes universales usando fast-check con mínimo 100 iteraciones.
- Los tests unitarios complementan con ejemplos concretos del escenario valle_inicial y edge cases.
- El código usa módulos puros (sin efectos secundarios) en la capa de lógica para facilitar el testing.
- El estado es inmutable: cada acción produce un nuevo `GameState`.
- Toda la configuración y contenido vive en YAML; el código es genérico.

### Política de documentación

Las tareas de documentación van colgadas de los checkpoints, así que no aparecen como tareas de primer nivel. Éste es su índice:

| Tarea | Cuándo | Qué documenta |
|---|---|---|
| 4.3 | Hecha | README, arquitectura, convenciones, recetas y steering iniciales |
| 8.1 | Checkpoint 8 | Visibilidad, exploración, recursos, reloj |
| 14.1 | Checkpoint 14 | Construcciones, explotación, fábricas, tecnologías, amenazas, combate, objetivos, puzzles |
| 17.1 | Checkpoint 17 | Núcleo de simulación, registro de eventos, persistencia |
| 22.1 | Checkpoint 22 | Render, interfaz, entrada, y cierre del README |

- La especificación (`requirements.md`, `design.md`, `tasks.md`) describe **qué** hay que construir y **por qué**. La documentación de `docs/` describe **dónde** está cada cosa y **cómo** modificarla sin romper nada. Son complementarias y ninguna sustituye a la otra.
- La documentación no se deja para el final: se paga al cerrar cada fase, cuando el contexto todavía está fresco.
- Entre un checkpoint y el siguiente, la responsabilidad es de cada tarea: la cabecera JSDoc del módulo y cualquier convención nueva se escriben **en el mismo commit que el código**, no se aplazan a la tarea de documentación de la fase. Las tareas 8.1, 14.1, 17.1 y 22.1 consolidan y revisan, no escriben desde cero.
- Los tres documentos de `docs/` tienen destinatarios distintos: `arquitectura.md` responde «en qué fichero se hace esto», `convenciones.md` responde «cómo se escribe aquí», y `modificar-el-juego.md` responde «qué toco para conseguir X».
- Las convenciones se publican por duplicado a propósito: en `docs/` para el desarrollador humano y en `.kiro/steering/` para las sesiones de Kiro, que solo aplican de forma automática lo que viva en steering. Los ficheros de steering referencian los de `docs/` con `#[[file:...]]` en lugar de copiar el contenido.
- Cada módulo mantiene su cabecera JSDoc con el algoritmo y los requisitos que cumple. Esa cabecera es la documentación de primera línea y va en el mismo commit que el código, no en la tarea de documentación de la fase.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "2.1", "2.4"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5"] },
    { "id": 4, "tasks": ["2.6"] },
    { "id": 5, "tasks": ["4.1", "5.1", "6.1", "7.1"] },
    { "id": 6, "tasks": ["4.2", "5.2", "6.2", "7.2"] },
    { "id": 7, "tasks": ["4.3", "5.3", "9.1", "9.4"] },
    { "id": 8, "tasks": ["9.2", "9.3", "10.1", "10.2"] },
    { "id": 9, "tasks": ["9.5", "10.3", "11.1"] },
    { "id": 10, "tasks": ["11.2", "12.1", "12.2"] },
    { "id": 11, "tasks": ["12.3", "13.1", "13.2"] },
    { "id": 12, "tasks": ["12.4", "13.3"] },
    { "id": 13, "tasks": ["15.1", "15.2"] },
    { "id": 14, "tasks": ["15.3", "16.1"] },
    { "id": 15, "tasks": ["16.2"] },
    { "id": 16, "tasks": ["18.1", "18.2", "18.3"] },
    { "id": 17, "tasks": ["18.4", "19.1", "19.3", "19.4", "19.5"] },
    { "id": 18, "tasks": ["19.2", "20.1", "20.2"] },
    { "id": 19, "tasks": ["21.1"] },
    { "id": 20, "tasks": ["21.2"] },
    { "id": 21, "tasks": ["21.3"] }
  ]
}
```

Las tareas de documentación de fase (`8.1`, `14.1`, `17.1`, `22.1`) no aparecen en el grafo porque, igual que los checkpoints de los que cuelgan, no son paralelizables: cierran la fase una vez sus tareas han terminado. La `4.3` sí figura, en la ola 7, porque documenta un estado ya alcanzado y puede escribirse en paralelo con el arranque de la fase siguiente.
