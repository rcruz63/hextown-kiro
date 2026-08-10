# Documento de Requisitos

## Introducción

Hextown es un juego de estrategia por turnos, para un jugador, sobre un mapa de hexágonos generado de forma procedural. El jugador parte de una ciudad central y una civilización de subsistencia, explora el mapa, construye, investiga tecnologías, se enfrenta a amenazas y persigue un objetivo principal definido por el escenario.

Este documento cubre exclusivamente la **Fase 1: el juego base**. La Fase 2 (campaña) queda fuera de alcance y se especificará en un documento aparte.

Decisiones de alcance que enmarcan estos requisitos:

- Plataforma: navegador de escritorio con ratón y teclado. No se especifica entrada táctil ni adaptación a pantallas de móvil.
- Stack: TypeScript + Vite, render en Canvas 2D, lógica de juego en módulos puros sin motor de terceros.
- Todos los costes, tiempos, producciones, probabilidades y contenidos viven en ficheros YAML, no embebidos en el código.
- Los niveles de dificultad no forman parte de esta iteración. Los requisitos exigen que los parámetros sean datos, lo que permite añadir dificultad más adelante sin rehacer el modelo.
- Persistencia local mediante localStorage. Textos en español externalizados y preparados para i18n.
- La agrupación del océano en masas contiguas es una preferencia estética, no un requisito verificable en la Fase 1.

Los criterios de aceptación marcados con **(propiedad)** están redactados como invariantes cuantificadas universalmente, pensados para verificarse con pruebas basadas en propiedades (property-based testing).

## Glosario

### Sistemas

- **Nucleo_De_Simulacion**: módulo que aplica acciones y avance de tiempo sobre el estado de partida de forma determinista.
- **Generador_De_Mapa**: módulo que construye el mapa hexagonal, sus terrenos, elementos y amenazas iniciales a partir de una semilla y un escenario.
- **Gestor_De_Visibilidad**: módulo que mantiene el estado de visibilidad de cada hexágono.
- **Sistema_De_Exploracion**: módulo que calcula y ejecuta las acciones de exploración.
- **Gestor_De_Recursos**: módulo que mantiene y modifica los recursos y la población.
- **Reloj_De_Juego**: módulo que controla días, fragmentos, velocidad y programación de acciones.
- **Sistema_De_Construccion**: módulo que valida y ejecuta construcción, mejora y demolición.
- **Sistema_De_Niveles**: parte del Sistema_De_Construccion que resuelve los niveles de cada construcción.
- **Sistema_De_Explotacion**: módulo que resuelve las acciones sobre elementos del hexágono (recolectar, talar, montar construcción sobre elemento).
- **Sistema_De_Fabricas**: módulo que resuelve la conversión diaria de recursos de las fábricas.
- **Sistema_De_Investigacion**: módulo que gestiona el árbol de tecnologías y la investigación en curso.
- **Sistema_De_Amenazas**: módulo que resuelve efectos pasivos, reaparición, expansión y subida de nivel de las amenazas.
- **Resolutor_De_Combate**: módulo que calcula probabilidades y resuelve los combates.
- **Sistema_De_Defensa**: parte del Sistema_De_Amenazas que aplica el bloqueo de expansión de las torres.
- **Sistema_De_Objetivos**: módulo que evalúa el objetivo principal, las misiones intermedias y las condiciones de fin de partida.
- **Sistema_De_Puzzles**: módulo que instancia, presenta y resuelve los puzzles de poblados y misterios.
- **Sistema_De_Interfaz**: capa de interfaz de usuario: barra de recursos, menús, paneles y ventanas.
- **Controlador_De_Entrada**: módulo que traduce ratón y teclado en acciones de interfaz.
- **Motor_De_Render**: módulo que dibuja el mapa y las animaciones en Canvas 2D.
- **Registro_De_Eventos**: componente que almacena y muestra los eventos ocurridos con su día y fragmento.
- **Cargador_De_Datos**: módulo que lee y parsea los ficheros YAML de contenido y reglas.
- **Validador_De_Datos**: módulo que comprueba esquema, referencias cruzadas y reglas de balance de los datos cargados.
- **Serializador_De_Datos**: módulo que escribe estructuras de datos del juego en YAML.
- **Sistema_De_Persistencia**: módulo que guarda y carga partidas en localStorage.
- **Gestor_De_Textos**: módulo que resuelve claves de texto a cadenas del idioma activo.

### Términos del dominio

- **Hexágono**: celda del mapa con orientación de punta arriba (pointy-top), identificada por coordenadas axiales `(q, r)`.
- **Distancia**: número de hexágonos del camino más corto entre dos hexágonos, medido en distancia hexagonal.
- **Terreno**: clasificación permanente de un hexágono: prado, tundra, desierto, no fértil u océano.
- **Elemento**: contenido natural de un hexágono, como máximo uno por hexágono: montaña, bosque, animal doméstico, peces, ballenas, poblado, misterio o amenaza.
- **Construcción**: edificio erigido por el jugador en un hexágono, con un nivel actual.
- **Nivel**: escalón de una construcción, con su coste, tiempo, trabajadores, tecnología requerida y producción.
- **Poblacion_Libre**: población disponible para acciones y única fuerza del jugador en combate.
- **Poblacion_Empleada**: población fija asignada a construcciones, no disponible para acciones ni para combate.
- **Poblacion_Total**: suma de Poblacion_Libre y Poblacion_Empleada.
- **Consumo de población**: gasto que reduce Poblacion_Libre y Poblacion_Total de forma permanente.
- **Empleo de población**: gasto que reduce Poblacion_Libre e incrementa Poblacion_Empleada, sin variar Poblacion_Total.
- **Dia**: unidad de coste temporal del juego.
- **Fragmento**: una de las subdivisiones visuales del día, `rules.day.fragments` por día.
- **Fin_De_Dia**: instante posterior al último fragmento de un día, en el que se resuelve la producción.
- **Amenaza**: elemento hostil; puede ser amenaza animal, bárbaros o piratas.
- **Dano_Acumulado**: fracción de fuerza perdida por una amenaza a causa de combates perdidos por el jugador.
- **Rama**: agrupación lineal de tecnologías del árbol.
- **Escalon (tier)**: posición de una tecnología dentro de su rama.
- **Escenario**: fichero de datos que define mapa, recursos iniciales, objetivo principal y misiones de una partida.
- **Semilla**: entero que determina todas las decisiones aleatorias de la partida.
- **Efecto_Global**: modificador aplicado a toda la partida, procedente de tecnologías o de efectos permanentes de poblados.

## Requisitos

### Requisito 1: Generación procedural del mapa

**Historia de usuario:** Como jugador, quiero que cada partida genere un mapa distinto a partir de una semilla, para poder rejugar y compartir mapas concretos.

#### Criterios de aceptación

1. CUANDO el jugador inicia una partida con un escenario y una semilla, EL Generador_De_Mapa DEBERÁ construir un mapa de hexágonos de punta arriba con radio igual a `scenario.map.radius`.
2. CUANDO el Generador_De_Mapa construye el mapa, EL Generador_De_Mapa DEBERÁ asignar al hexágono central un terreno incluido en `allowed_terrains` de la Ciudad, DEBERÁ situar en ese hexágono la Ciudad de nivel 1 y DEBERÁ dejar ese hexágono sin elemento.
3. CUANDO el Generador_De_Mapa asigna el terreno de un hexágono, EL Generador_De_Mapa DEBERÁ elegir el tipo de terreno con probabilidad proporcional al peso declarado en `scenario.map.terrain_weights`.
4. CUANDO el Generador_De_Mapa asigna elementos, EL Generador_De_Mapa DEBERÁ colocar de cada elemento un número de instancias igual a `min(redondeo(scenario.map.element_density del elemento × número de hexágonos cuyo terreno figura en allowed_terrains de ese elemento), número de hexágonos elegibles sin elemento en el momento de colocarlo)`, situando cada instancia en un hexágono sin elemento cuyo terreno figure en `allowed_terrains` de ese elemento, y DEBERÁ recorrer los elementos en el orden en que están declarados en los datos.
5. EL Generador_De_Mapa DEBERÁ entregar un mapa que cumpla toda restricción declarada en `scenario.map.constraints`. Las restricciones previstas para la Fase 1 son número mínimo de prados adyacentes a la Ciudad, porcentaje mínimo de prado, montañas mínimas, bosques mínimos, amenazas máximas y distancia mínima de las amenazas humanas a la Ciudad.
6. SI un mapa candidato incumple al menos una restricción, ENTONCES EL Generador_De_Mapa DEBERÁ descartar el mapa candidato y generar otro con la siguiente subsemilla derivada de forma determinista de la semilla de partida.
7. SI EL Generador_De_Mapa ha descartado `constraints.intentos_maximos` candidatos, contando el primero, sin obtener un mapa que cumpla las restricciones, ENTONCES EL Generador_De_Mapa DEBERÁ abortar el inicio de la partida sin dejar estado de partida ni autoguardado, EL Sistema_De_Interfaz DEBERÁ mostrar la semilla, el número de candidatos generados y las restricciones incumplidas por el último candidato, y EL Sistema_De_Interfaz DEBERÁ devolver al jugador al menú principal.
8. EL Validador_De_Datos DEBERÁ exigir que `constraints.intentos_maximos` sea mayor o igual que 1.
9. SI `scenario.map.constraints` contiene una clave de restricción que EL Generador_De_Mapa no puede evaluar, ENTONCES EL Generador_De_Mapa DEBERÁ abortar el inicio de la partida y EL Sistema_De_Interfaz DEBERÁ mostrar la clave no reconocida.
10. CUANDO el Generador_De_Mapa coloca una amenaza en un hexágono situado a distancia D de la Ciudad, EL Generador_De_Mapa DEBERÁ asignar a esa amenaza el nivel `1 + piso(D × constraints.nivel_amenaza_por_anillo)`.
11. CUANDO el Generador_De_Mapa coloca una amenaza, EL Generador_De_Mapa DEBERÁ inicializar su Dano_Acumulado en 0 y DEBERÁ fijar su día de aparición en el día 1.
12. PARA CUALQUIER escenario y semilla, dos ejecuciones del Generador_De_Mapa DEBERÁN producir mapas iguales en terreno, elemento, amenaza y nivel de amenaza de todos los hexágonos (propiedad).
13. PARA CUALQUIER mapa entregado por el Generador_De_Mapa, cada hexágono DEBERÁ contener 0 o 1 elementos (propiedad).
14. PARA CUALQUIER mapa entregado por el Generador_De_Mapa y cualquier par de amenazas del mismo tipo situadas a distancias D1 y D2 con D1 ≤ D2, el nivel de la amenaza a distancia D1 DEBERÁ ser menor o igual que el nivel de la amenaza a distancia D2 (propiedad).
15. PARA CUALQUIER mapa entregado por el Generador_De_Mapa, todas las restricciones de `scenario.map.constraints` DEBERÁN evaluarse como cumplidas (propiedad).

### Requisito 2: Estados de visibilidad

**Historia de usuario:** Como jugador, quiero que el mapa se descubra por capas, para que explorar tenga valor y el mapa desconocido resulte inquietante.

#### Criterios de aceptación

1. EL Gestor_De_Visibilidad DEBERÁ asignar a cada hexágono exactamente uno de estos tres estados: oculto, atenuado o explorado.
2. CUANDO comienza una partida, EL Gestor_De_Visibilidad DEBERÁ marcar como explorados el hexágono de la Ciudad y los hexágonos del mapa situados a distancia 1 de la Ciudad, como atenuados los hexágonos del mapa situados a distancia 2 de la Ciudad y como ocultos el resto de hexágonos del mapa.
3. MIENTRAS un hexágono está en estado oculto, EL Motor_De_Render DEBERÁ dibujar fondo negro continuo sin silueta de hexágono en la posición de ese hexágono.
4. MIENTRAS un hexágono está en estado atenuado, EL Sistema_De_Interfaz DEBERÁ mostrar el tipo de terreno de ese hexágono y DEBERÁ ocultar su elemento, su construcción y su amenaza.
5. MIENTRAS un hexágono está en estado explorado, EL Sistema_De_Interfaz DEBERÁ mostrar el terreno, el elemento, la amenaza con su nivel, la construcción y el nivel de la construcción de ese hexágono.
6. MIENTRAS un hexágono está en estado atenuado y no existe una exploración en curso sobre ese hexágono, EL Sistema_De_Interfaz DEBERÁ ofrecer la acción de explorar sobre ese hexágono.
7. SI el jugador solicita explorar un hexágono en estado oculto o explorado, ENTONCES EL Sistema_De_Exploracion DEBERÁ rechazar la solicitud y EL Sistema_De_Interfaz DEBERÁ indicar que solo se exploran hexágonos atenuados.
8. CUANDO un hexágono alcanza el estado explorado, EL Gestor_De_Visibilidad DEBERÁ conservar ese estado durante el resto de la partida.
9. PARA CUALQUIER estado de partida alcanzable, cada hexágono en estado atenuado DEBERÁ tener al menos un hexágono adyacente en estado explorado (propiedad).
10. PARA CUALQUIER secuencia de acciones aplicada al estado de partida, el estado de visibilidad de cada hexágono DEBERÁ cambiar únicamente mediante las transiciones oculto → atenuado y atenuado → explorado, sin transición oculto → explorado y sin ninguna transición hacia un estado anterior (propiedad).
11. PARA CUALQUIER estado de partida alcanzable, ningún hexágono en estado oculto DEBERÁ ser adyacente a un hexágono en estado explorado (propiedad).

### Requisito 3: Exploración

**Historia de usuario:** Como jugador, quiero explorar hexágonos pagando tiempo y población, para descubrir recursos y amenazas asumiendo un riesgo creciente con la distancia.

#### Criterios de aceptación

1. CUANDO el jugador solicita explorar un hexágono atenuado situado a distancia D de la Ciudad, EL Sistema_De_Exploracion DEBERÁ calcular el tiempo como `rules.exploration.tiempo_base + piso(D / rules.exploration.dias_por_distancia)` días.
2. CUANDO el jugador solicita explorar un hexágono atenuado situado a distancia D de la Ciudad, EL Sistema_De_Exploracion DEBERÁ calcular el coste como `max(1, techo(D × rules.exploration.poblacion_por_distancia × producto de los Efecto_Global de reducción de coste de exploración vigentes en ese instante))` unidades enteras de Poblacion_Libre.
3. CUANDO el jugador confirma una exploración, EL Gestor_De_Recursos DEBERÁ restar el coste calculado de la Poblacion_Libre en concepto de consumo, reduciendo también la Poblacion_Total.
4. SI la Poblacion_Libre es menor que el coste calculado, o SI el coste calculado es igual o mayor que la Poblacion_Total, ENTONCES EL Sistema_De_Exploracion DEBERÁ rechazar la exploración sin modificar ningún recurso y EL Sistema_De_Interfaz DEBERÁ mostrar el coste requerido, la Poblacion_Libre disponible y el motivo del rechazo.
5. SI el jugador solicita explorar un hexágono sobre el que ya existe una exploración en curso, ENTONCES EL Sistema_De_Exploracion DEBERÁ rechazar la solicitud sin comprometer población y EL Sistema_De_Interfaz DEBERÁ mostrar la acción de explorar deshabilitada indicando el día y el fragmento de finalización de la exploración en curso.
6. CUANDO una exploración se completa, EL Gestor_De_Visibilidad DEBERÁ marcar el hexágono explorado como explorado y DEBERÁ marcar como atenuados los hexágonos adyacentes que estén en estado oculto.
7. CUANDO una exploración se completa y el hexágono contiene un elemento, EL Sistema_De_Interfaz DEBERÁ revelar ese elemento y EL Registro_De_Eventos DEBERÁ añadir una entrada con el día, el fragmento y el elemento descubierto.
8. CUANDO una exploración revela un poblado, un misterio o una amenaza, EL Reloj_De_Juego DEBERÁ pasar al estado parado.
9. ANTES de que el jugador confirme una exploración, EL Sistema_De_Interfaz DEBERÁ mostrar el tiempo en días y el coste en población con los Efecto_Global vigentes ya aplicados, y esos valores DEBERÁN coincidir exactamente con el tiempo programado por el Reloj_De_Juego y con el coste restado por el Gestor_De_Recursos al confirmar.
10. CUANDO dos o más exploraciones concluyen en el mismo día y fragmento, EL Sistema_De_Exploracion DEBERÁ resolverlas en orden lexicográfico ascendente de coordenada axial `(q, r)` del hexágono explorado, EL Reloj_De_Juego DEBERÁ pasar al estado parado una sola vez y EL Sistema_De_Interfaz DEBERÁ presentar las ventanas de puzzle pendientes en ese mismo orden, una tras otra.
11. PARA CUALQUIER par de distancias D1 y D2 con D1 ≤ D2, el tiempo y el coste en población calculados por el Sistema_De_Exploracion DEBERÁN cumplir `tiempo(D1) ≤ tiempo(D2)` y `coste(D1) ≤ coste(D2)` (propiedad).
12. PARA CUALQUIER distancia D mayor o igual que 1, el tiempo calculado DEBERÁ ser mayor o igual que 1 día y el coste calculado DEBERÁ ser mayor o igual que 1 unidad de población (propiedad).
13. PARA CUALQUIER exploración aceptada, la Poblacion_Total inmediatamente después de confirmarla DEBERÁ ser igual a la Poblacion_Total inmediatamente anterior menos el coste calculado, y la finalización de esa exploración DEBERÁ dejar la Poblacion_Libre y la Poblacion_Total sin variación (propiedad).

### Requisito 4: Recursos y modelo de población

**Historia de usuario:** Como jugador, quiero que la población sea a la vez mano de obra, ejército y bocas que alimentar, para que cada decisión económica tenga coste militar.

#### Criterios de aceptación

1. EL Gestor_De_Recursos DEBERÁ mantener los recursos Poblacion_Libre, Poblacion_Empleada, comida, materiales, ciencia y oro, con los valores iniciales declarados en `scenario.starting_resources`.
2. CUANDO el jugador ejecuta una acción de exploración, recolección, tala o combate, EL Gestor_De_Recursos DEBERÁ aplicar el coste como consumo, restando de Poblacion_Libre y reduciendo Poblacion_Total en la misma cantidad.
3. CUANDO el jugador inicia una construcción o una mejora, EL Gestor_De_Recursos DEBERÁ aplicar el coste en trabajadores como empleo, restando de Poblacion_Libre y sumando la misma cantidad a Poblacion_Empleada.
4. EL Gestor_De_Recursos DEBERÁ excluir la Poblacion_Empleada del cálculo de la fuerza del jugador en combate.
5. CUANDO llega el Fin_De_Dia, EL Gestor_De_Recursos DEBERÁ restar de la comida `techo(Poblacion_Total × rules.food.consumo_por_poblacion)` unidades.
6. SI en el Fin_De_Dia la comida disponible es menor que el consumo calculado, ENTONCES EL Gestor_De_Recursos DEBERÁ fijar la comida en 0, DEBERÁ aplicar una pérdida de población igual a `min(Poblacion_Total, techo((consumo calculado - comida disponible) × rules.food.poblacion_perdida_por_hambre))` y EL Registro_De_Eventos DEBERÁ añadir una entrada de hambruna con el día, el fragmento, las unidades de comida faltantes y la población perdida.
7. CUANDO se aplica una pérdida de población, EL Gestor_De_Recursos DEBERÁ restarla en primer lugar de la Poblacion_Libre disponible y DEBERÁ cubrir la parte restante sacrificando construcciones de una en una, repitiendo el sacrificio hasta que la pérdida quede cubierta o hasta que no quede ninguna construcción sacrificable, eligiendo en cada iteración la primera candidata de este orden: construcción o mejora en curso de inicio más reciente, construcción completada distinta de la Ciudad y de las torres de defensa de finalización más reciente, y torre de defensa completada de finalización más reciente; resolviendo los empates de día y fragmento por orden lexicográfico ascendente de coordenada axial `(q, r)`.
8. EL Gestor_De_Recursos DEBERÁ excluir la Ciudad de las construcciones sacrificables, y SI no queda ninguna construcción sacrificable y la pérdida no está cubierta, ENTONCES EL Gestor_De_Recursos DEBERÁ fijar la Poblacion_Total en 0.
9. CUANDO el Gestor_De_Recursos sacrifica una construcción para cubrir una pérdida de población, EL Sistema_De_Construccion DEBERÁ dejar el hexágono sin construcción en el mismo fragmento, sin aplicar `rules.demolition.time` y sin devolver materiales, DEBERÁ restaurar el elemento sobre el que esa construcción estuviera montada, DEBERÁ cancelar la construcción o mejora en curso de ese hexágono manteniendo la construcción en su nivel actual cuando la obra cancelada sea una mejora, EL Gestor_De_Recursos DEBERÁ devolver a Poblacion_Libre los trabajadores de esa construcción no consumidos por la pérdida y EL Registro_De_Eventos DEBERÁ añadir una entrada con el día, el fragmento, el hexágono y la construcción sacrificada.
10. CUANDO llega el Fin_De_Dia, EL Gestor_De_Recursos DEBERÁ calcular la probabilidad de enfermedad como `rules.disease.probabilidad_base_diaria + rules.disease.incremento_por_poblacion × Poblacion_Total`, DEBERÁ aplicar sobre ese valor los Efecto_Global que modifican la probabilidad de enfermedad como factores multiplicativos, DEBERÁ acotar el resultado al intervalo de 0 a 1 ambos inclusive y DEBERÁ resolver la tirada de enfermedad con esa probabilidad.
11. CUANDO una tirada de enfermedad resulta positiva, EL Gestor_De_Recursos DEBERÁ reducir la población en `rules.disease.poblacion_perdida` unidades y EL Registro_De_Eventos DEBERÁ añadir una entrada de enfermedad.
12. CUANDO llega el Fin_De_Dia, EL Gestor_De_Recursos DEBERÁ sumar a la Poblacion_Libre la producción de población de las construcciones completadas, DEBERÁ incrementar la Poblacion_Total en la misma cantidad, DEBERÁ dejar la Poblacion_Empleada sin variar y DEBERÁ acumular la población sin límite superior.
13. EL Gestor_De_Recursos DEBERÁ incrementar la ciencia únicamente mediante recompensas de misiones, recompensas de puzzles, producción de centros de estudio y conversión de fábricas.
14. EL Gestor_De_Recursos DEBERÁ incrementar el oro únicamente mediante minas, casas de nivel 2 o superior, Ciudad de nivel 2 o superior, conversión de fábricas y recompensas de puzzles y misiones.
15. EL Gestor_De_Recursos DEBERÁ acumular comida, materiales, ciencia y oro sin límite superior.
16. SI el coste de una acción solicitada supera la cantidad disponible de cualquiera de los recursos exigidos, ENTONCES EL Nucleo_De_Simulacion DEBERÁ rechazar la acción y EL Sistema_De_Interfaz DEBERÁ mostrar el recurso deficitario, la cantidad requerida y la disponible.
17. CUANDO la Poblacion_Total alcanza 0, EL Sistema_De_Objetivos DEBERÁ terminar la partida con derrota.
18. PARA CUALQUIER estado de partida alcanzable, DEBERÁ cumplirse `Poblacion_Total = Poblacion_Libre + Poblacion_Empleada` (propiedad).
19. PARA CUALQUIER secuencia de acciones aceptadas por el Nucleo_De_Simulacion, todos los recursos DEBERÁN mantenerse mayores o iguales que 0 (propiedad).
20. PARA CUALQUIER construcción o mejora aceptada, la Poblacion_Total inmediatamente después de comprometer el coste DEBERÁ ser igual a la Poblacion_Total inmediatamente anterior (propiedad).
21. PARA CUALQUIER pérdida de población P aplicada en cualquier estado de partida alcanzable, la Poblacion_Total resultante DEBERÁ ser igual a `max(0, Poblacion_Total previa - P)` y la Poblacion_Empleada de cada construcción que permanezca en pie DEBERÁ ser igual a la previa (propiedad).

### Requisito 5: Tiempo, fragmentos y programación de acciones

**Historia de usuario:** Como jugador, quiero controlar el paso del tiempo y ver cuándo terminan mis acciones, para planificar varias cosas a la vez sin perder el hilo.

#### Criterios de aceptación

1. EL Reloj_De_Juego DEBERÁ dividir cada día en `rules.day.fragments` fragmentos de igual duración.
2. EL Reloj_De_Juego DEBERÁ mantener exactamente uno de estos estados: parado, play o avance rápido.
3. MIENTRAS el estado es play, EL Reloj_De_Juego DEBERÁ completar un día en `rules.day.seconds_normal` segundos de tiempo real.
4. MIENTRAS el estado es avance rápido, EL Reloj_De_Juego DEBERÁ completar un día en `rules.day.seconds_fast` segundos de tiempo real.
5. MIENTRAS el estado es parado, EL Reloj_De_Juego DEBERÁ mantener el día y el fragmento actuales y DEBERÁ dejar sin resolver la producción y los avances de acciones.
6. CUANDO comienza una partida, EL Reloj_De_Juego DEBERÁ fijar el día en 1, el fragmento en el primer fragmento del día y el estado en parado.
7. CUANDO el jugador solicita una acción de coste C días en el día d y el fragmento f, EL Reloj_De_Juego DEBERÁ programar la finalización de esa acción en el día `d + C`, fragmento f.
8. CUANDO dos o más acciones concluyen en el mismo día y el mismo fragmento, EL Nucleo_De_Simulacion DEBERÁ resolverlas todas antes de avanzar al siguiente fragmento, en orden lexicográfico ascendente de coordenada axial `(q, r)` del hexágono de cada acción, y DEBERÁ resolver después de todas ellas las acciones sin hexágono asociado.
9. CUANDO el jugador activa avanzar al siguiente evento, EL Reloj_De_Juego DEBERÁ avanzar hasta el primero de estos instantes en orden cronológico: el fragmento en que concluye una acción en curso, el fragmento de un evento programado o el Fin_De_Dia del día en curso; DEBERÁ resolver ese instante y DEBERÁ pasar al estado parado.
10. CUANDO llega el Fin_De_Dia, EL Gestor_De_Recursos DEBERÁ calcular la producción contando únicamente las construcciones completadas en ese instante, incluidas las completadas durante ese mismo día.
11. CUANDO llega el Fin_De_Dia, EL Nucleo_De_Simulacion DEBERÁ resolver los pasos en este orden fijo: producción de construcciones, conversión de fábricas, efectos pasivos de amenazas, consumo de comida, hambruna, tirada de enfermedad, reaparición de animales, expansión y subida de nivel de amenazas, evaluación de misiones y objetivo principal, comprobación de derrota y autoguardado.
12. EL Nucleo_De_Simulacion DEBERÁ permitir un número ilimitado de acciones simultáneas mientras existan recursos y Poblacion_Libre para comprometer su coste.
13. SI el jugador solicita una acción sobre un hexágono en el que ya existe una acción en curso, ENTONCES EL Nucleo_De_Simulacion DEBERÁ rechazar la solicitud, DEBERÁ dejar sin comprometer los recursos y la Poblacion_Libre, y EL Sistema_De_Interfaz DEBERÁ indicar la acción en curso y su día y fragmento de finalización.
14. SI existe una investigación en curso y el jugador solicita iniciar otra, ENTONCES EL Sistema_De_Investigacion DEBERÁ rechazar la solicitud y EL Sistema_De_Interfaz DEBERÁ indicar que solo se admite una investigación simultánea.
15. CUANDO ocurre un combate, un misterio descubierto, un poblado descubierto, una expansión de amenaza, una misión cumplida o el objetivo principal cumplido, EL Reloj_De_Juego DEBERÁ pasar al estado parado una vez resueltos todos los pasos pendientes del instante en curso, y DEBERÁ realizar una única transición a parado aunque varias de esas causas ocurran en el mismo día y fragmento.
16. EL Reloj_De_Juego DEBERÁ aceptar únicamente costes de tiempo expresados en días enteros mayores o iguales que 1.
17. SI un Efecto_Global reduce el tiempo de una acción a un valor no entero o inferior a 1 día, ENTONCES EL Reloj_De_Juego DEBERÁ aplicar `max(1, techo(tiempo))` días como tiempo de esa acción.
18. PARA CUALQUIER acción programada, el fragmento de finalización DEBERÁ ser igual al fragmento de solicitud (propiedad).
19. PARA CUALQUIER semilla y cualquier secuencia de acciones con sus días y fragmentos, dos ejecuciones del Nucleo_De_Simulacion DEBERÁN producir estados de partida idénticos (propiedad).
20. PARA CUALQUIER conjunto de construcciones existentes, el resultado del Fin_De_Dia DEBERÁ ser independiente del orden en que esas construcciones se registraron en el estado de partida (propiedad).

### Requisito 6: Construcciones

**Historia de usuario:** Como jugador, quiero construir edificios en los hexágonos explorados, para producir recursos de forma continuada.

#### Criterios de aceptación

1. EL Sistema_De_Construccion DEBERÁ admitir como máximo una construcción por hexágono, contando tanto las construcciones completadas como las construcciones en curso.
2. EL Sistema_De_Construccion DEBERÁ permitir una construcción en un hexágono únicamente cuando el terreno de ese hexágono figure en `allowed_terrains` de esa construcción.
3. EL Sistema_De_Construccion DEBERÁ permitir un nivel de una construcción únicamente cuando todas las tecnologías de `requires_tech` de ese nivel estén investigadas.
4. SI el hexágono contiene un elemento, incluidas las amenazas y los poblados, y la construcción solicitada no declara montarse sobre ese elemento (granja sobre animal doméstico, mina sobre montaña, bote de pesca sobre peces o ballenas), ENTONCES EL Sistema_De_Construccion DEBERÁ rechazar la construcción y EL Sistema_De_Interfaz DEBERÁ indicar el elemento que ocupa el hexágono y el requisito incumplido.
5. EL Sistema_De_Construccion DEBERÁ permitir construir un aserradero únicamente en un hexágono sin elemento que tenga al menos un bosque en un hexágono adyacente.
6. SI el jugador solicita construir en un hexágono en estado oculto o atenuado, ENTONCES EL Sistema_De_Construccion DEBERÁ rechazar la solicitud, DEBERÁ dejar sin modificar los recursos y la Poblacion_Libre, y EL Sistema_De_Interfaz DEBERÁ indicar que solo se construye en hexágonos explorados.
7. CUANDO el jugador confirma una construcción, EL Gestor_De_Recursos DEBERÁ comprometer en ese instante los recursos del nivel 1 y sus trabajadores en concepto de empleo, y EL Sistema_De_Construccion DEBERÁ programar la finalización de la construcción tantos días después como declare el tiempo del nivel 1 de esa construcción, con un mínimo de 1 día.
8. MIENTRAS una construcción, una mejora o una demolición está en curso en un hexágono, SI el jugador solicita otra construcción, otra mejora, otra demolición o una acción de explotación sobre ese mismo hexágono, ENTONCES EL Sistema_De_Construccion DEBERÁ rechazar la solicitud, DEBERÁ mantener la acción en curso sin cambios y EL Sistema_De_Interfaz DEBERÁ indicar la acción en curso y su día de finalización.
9. CUANDO una construcción se completa, EL Sistema_De_Construccion DEBERÁ marcarla como productiva a partir del Fin_De_Dia de ese mismo día.
10. EL Gestor_De_Recursos DEBERÁ calcular la producción diaria de una construcción como `max(0, piso(produccion_base_del_nivel × producto de los modificadores de terreno aplicables) + suma de los modificadores de adyacencia aplicables)`.
11. EL Gestor_De_Recursos DEBERÁ aplicar a las casas los modificadores de adyacencia declarados en datos: incremento de población por cada casa adyacente, incremento de población y oro por Ciudad adyacente, reducción por amenaza adyacente, reducción de población por mina o fábrica adyacente y reducción por terreno desierto.
12. CUANDO el contenido de un hexágono adyacente a una construcción cambia, EL Gestor_De_Recursos DEBERÁ recalcular los modificadores de adyacencia de esa construcción antes del siguiente Fin_De_Dia.
13. EL Gestor_De_Recursos DEBERÁ asignar producción 0 a las torres de defensa.
14. EL Sistema_De_Construccion DEBERÁ permitir subir la Ciudad a los niveles 2 y 3 sin exigir tecnología y DEBERÁ exigir la tecnología Ciudadela para el nivel 4.
15. EL Sistema_De_Construccion DEBERÁ exigir para cada nivel de la Ciudad los requisitos de Poblacion_Total, materiales y oro declarados en datos, sin exigir oro para el nivel 2.
16. EL Sistema_De_Construccion DEBERÁ mantener una única Ciudad en la partida, y SI el jugador solicita construir una Ciudad o demoler la Ciudad, ENTONCES EL Sistema_De_Construccion DEBERÁ rechazar la solicitud y EL Sistema_De_Interfaz DEBERÁ indicar que la Ciudad es única y no demolible.
17. PARA CUALQUIER construcción y cualquier configuración de vecindad y terreno, la producción diaria calculada de cada recurso DEBERÁ ser mayor o igual que 0 (propiedad).
18. PARA CUALQUIER estado de partida sin construcciones completadas, la producción diaria de todos los recursos DEBERÁ ser 0 (propiedad).

### Requisito 7: Sistema universal de niveles y mejoras

**Historia de usuario:** Como jugador, quiero mejorar mis edificios en el sitio, para concentrar producción a cambio de trabajadores, recursos y tiempo.

#### Criterios de aceptación

1. EL Sistema_De_Niveles DEBERÁ ofrecer la mejora como una acción sobre una construcción completada, con nivel destino igual al nivel actual más 1, sin exigir demolición previa, y DEBERÁ admitir como máximo una mejora en curso por construcción.
2. EL Sistema_De_Niveles DEBERÁ exigir para cada nivel destino las tecnologías declaradas en `requires_tech` de ese nivel.
3. CUANDO el jugador solicita una mejora, EL Sistema_De_Niveles DEBERÁ exigir como trabajadores adicionales la diferencia `employs(nivel destino) - employs(nivel actual)` y DEBERÁ exigir que esa diferencia esté disponible como Poblacion_Libre.
4. CUANDO el jugador confirma una mejora, EL Gestor_De_Recursos DEBERÁ comprometer en ese instante los recursos y los trabajadores adicionales del nivel destino, y EL Reloj_De_Juego DEBERÁ programar la finalización de la mejora en el día actual más el tiempo en días declarado para el nivel destino, tras aplicar los Efecto_Global de reducción de tiempo con un mínimo de 1 día.
5. EL Sistema_De_Niveles DEBERÁ exigir coste en materiales a partir del nivel 2 y coste en materiales y oro a partir del nivel 3, según los valores declarados en datos.
6. MIENTRAS una mejora está en curso y `produce_durante_mejora` está activado para esa construcción, EL Gestor_De_Recursos DEBERÁ calcular la producción de esa construcción con los valores del nivel anterior.
7. MIENTRAS una mejora está en curso y `produce_durante_mejora` está desactivado para esa construcción, EL Gestor_De_Recursos DEBERÁ asignar producción 0 a esa construcción.
8. EL Sistema_De_Niveles DEBERÁ tomar el valor de `produce_durante_mejora` de la construcción cuando la construcción lo declare y de `rules.upgrades.produce_durante_mejora` en caso contrario.
9. CUANDO una mejora se completa, EL Sistema_De_Niveles DEBERÁ fijar el nivel de la construcción en el nivel destino y EL Gestor_De_Recursos DEBERÁ calcular la producción con los valores del nivel destino en el Fin_De_Dia de ese mismo día.
10. EL Sistema_De_Niveles DEBERÁ admitir el número de niveles declarado en los datos de cada construcción, sin límite impuesto por el código.
11. CUANDO el jugador confirma cancelar una mejora en curso, EL Sistema_De_Niveles DEBERÁ anular la finalización programada de esa mejora y mantener el nivel de la construcción en su nivel de origen, EL Gestor_De_Recursos DEBERÁ devolver a Poblacion_Libre la totalidad de los trabajadores adicionales comprometidos manteniendo la Poblacion_Total, DEBERÁ devolver `piso(cantidad comprometida × rules.upgrades.devolucion_por_cancelacion)` de cada recurso comprometido en esa mejora, y EL Registro_De_Eventos DEBERÁ añadir una entrada con el día, el fragmento y el hexágono.
12. SI el jugador solicita demoler una construcción con una mejora en curso, ENTONCES EL Sistema_De_Construccion DEBERÁ rechazar la demolición y EL Sistema_De_Interfaz DEBERÁ indicar que la mejora en curso debe cancelarse antes de demoler.
13. SI una construcción con una mejora en curso deja de existir en su hexágono por ocupación de una amenaza humana o por sacrificio ante una pérdida de población, ENTONCES EL Sistema_De_Niveles DEBERÁ anular la finalización programada de esa mejora sin devolver los recursos comprometidos, EL Gestor_De_Recursos DEBERÁ contar los trabajadores adicionales comprometidos en la mejora como Poblacion_Empleada de esa construcción a efectos de esa eliminación, y EL Registro_De_Eventos DEBERÁ añadir una entrada indicando la construcción y el nivel destino perdido.
14. SI el incremento de producción diaria del nivel destino respecto al nivel actual es 0, o SI los días de amortización calculados como `techo(sobrecoste en materiales y oro del nivel destino / valor diario del incremento de producción, ponderando cada recurso con rules.balance.pesos_recurso)` son menores que `rules.balance.amortizacion_minima_dias`, ENTONCES EL Validador_De_Datos DEBERÁ registrar una advertencia identificando la construcción, el nivel y los días calculados.
15. PARA CUALQUIER construcción declarada en datos, el tiempo de construcción, el coste total y el número de trabajadores de cada nivel DEBERÁN ser mayores o iguales que los del nivel anterior (propiedad).
16. PARA CUALQUIER mejora aceptada, la Poblacion_Total inmediatamente después de comprometer el coste DEBERÁ ser igual a la Poblacion_Total inmediatamente anterior (propiedad).

### Requisito 8: Demolición

**Historia de usuario:** Como jugador, quiero demoler un edificio para recuperar trabajadores y parte de los materiales, y así reforzar un combate o cambiar de estrategia.

#### Criterios de aceptación

1. CUANDO el jugador confirma demoler una construcción completada distinta de la Ciudad en un hexágono sin construcción, mejora ni demolición en curso, EL Sistema_De_Construccion DEBERÁ programar la finalización de la demolición `rules.demolition.time` días después.
2. SI el jugador solicita demoler la Ciudad, ENTONCES EL Sistema_De_Construccion DEBERÁ rechazar la solicitud, DEBERÁ dejar el hexágono central con la Ciudad y su nivel actual sin cambios y EL Sistema_De_Interfaz DEBERÁ mostrar la acción de demoler deshabilitada indicando que la Ciudad no es demolible.
3. MIENTRAS una demolición está en curso en un hexágono, EL Sistema_De_Construccion DEBERÁ rechazar toda solicitud de cancelar esa demolición, de mejorar esa construcción y de volver a demolerla, y EL Sistema_De_Interfaz DEBERÁ mostrar esas acciones deshabilitadas junto con el día y el fragmento de finalización programados.
4. CUANDO una demolición se completa, EL Gestor_De_Recursos DEBERÁ devolver a Poblacion_Libre la totalidad de los trabajadores de esa construcción y DEBERÁ restar de Poblacion_Empleada esa misma cantidad, dejando la Poblacion_Total sin variación.
5. CUANDO una demolición se completa, EL Gestor_De_Recursos DEBERÁ devolver `piso(materiales invertidos acumulados en todos los niveles alcanzados × rules.demolition.returns_materials_ratio)` unidades de materiales.
6. CUANDO una demolición se completa, EL Sistema_De_Construccion DEBERÁ dejar el hexágono sin construcción y DEBERÁ restaurar el elemento sobre el que se montaba la construcción cuando la construcción se hubiera montado sobre un elemento.
7. CUANDO una demolición se completa y restaura un elemento, EL Sistema_De_Explotacion DEBERÁ restaurar ese elemento con el mismo tipo que tenía antes de montarse la construcción, DEBERÁ volver a ofrecer sobre él las mismas acciones de recolección y de construcción sujetas a sus tecnologías requeridas, y EL Gestor_De_Recursos DEBERÁ mantener los recursos sin variación por la restauración del elemento.
8. MIENTRAS una demolición está en curso, EL Gestor_De_Recursos DEBERÁ asignar producción 0 a esa construcción.
9. CUANDO una demolición de una torre de defensa se completa, EL Sistema_De_Defensa DEBERÁ dejar de bloquear la expansión de amenazas humanas en los hexágonos situados a distancia menor o igual que `blocks_expansion_radius` de esa torre, con efecto antes de la siguiente tirada de expansión del Fin_De_Dia.
10. PARA CUALQUIER demolición completada de una construcción con T trabajadores, la Poblacion_Libre posterior DEBERÁ ser igual a la anterior más T, la Poblacion_Empleada posterior DEBERÁ ser igual a la anterior menos T y la Poblacion_Total posterior DEBERÁ ser igual a la anterior (propiedad).

### Requisito 9: Explotación de elementos del hexágono

**Historia de usuario:** Como jugador, quiero elegir entre consumir un recurso natural de golpe o explotarlo con un edificio, para decidir entre el beneficio inmediato y la renta.

#### Criterios de aceptación

1. EL Gestor_De_Recursos DEBERÁ asignar producción diaria 0 a todos los elementos del mapa.
2. CUANDO el jugador confirma una acción de recolección sobre un elemento de un hexágono explorado, EL Sistema_De_Explotacion DEBERÁ programar su finalización `max(1, action.time)` días después y EL Gestor_De_Recursos DEBERÁ comprometer como consumo `max(1, coste en población declarado para esa acción)` unidades de Poblacion_Libre.
3. CUANDO una acción de recolección se completa, EL Gestor_De_Recursos DEBERÁ añadir la recompensa declarada en `reward_instant` y EL Sistema_De_Explotacion DEBERÁ eliminar el elemento del hexágono.
4. EL Sistema_De_Explotacion DEBERÁ permitir construir una granja sobre un animal doméstico únicamente cuando la tecnología Ganadería esté investigada y el terreno del hexágono figure en `allowed_terrains` de ese tipo de animal doméstico, y EL Gestor_De_Recursos DEBERÁ calcular su producción diaria como `max(0, piso(produccion_base_del_nivel de la granja para ese tipo de animal doméstico × modificador de terreno declarado para el terreno de ese hexágono))`, sin modificadores de adyacencia.
5. EL Sistema_De_Explotacion DEBERÁ permitir construir una mina únicamente sobre un hexágono con montaña y con la tecnología Minería investigada, y EL Gestor_De_Recursos DEBERÁ aplicar el modificador de terreno no fértil a la producción de la mina.
6. EL Sistema_De_Explotacion DEBERÁ permitir construir un bote de pesca únicamente sobre un hexágono con peces o ballenas y con la tecnología Navegación costera investigada.
7. EL Sistema_De_Explotacion DEBERÁ permitir recolectar peces o ballenas únicamente cuando la tecnología Navegación costera esté investigada.
8. CUANDO la acción de talar un bosque se completa, EL Gestor_De_Recursos DEBERÁ añadir los materiales declarados en `reward_instant` y EL Sistema_De_Explotacion DEBERÁ dejar el hexágono sin elemento.
9. EL Gestor_De_Recursos DEBERÁ calcular la producción de un aserradero como `production_per_adjacent.materiales × número de hexágonos adyacentes con bosque`, y EL Gestor_De_Recursos DEBERÁ calcular esa producción sin aplicar modificadores de terreno, como excepción intencionada a la fórmula general de producción de construcciones.
10. SI el último bosque adyacente a un aserradero desaparece, ENTONCES EL Gestor_De_Recursos DEBERÁ asignar producción 0 a ese aserradero, EL Sistema_De_Construccion DEBERÁ mantener la construcción en pie y EL Registro_De_Eventos DEBERÁ añadir una entrada de aviso.
11. EL Sistema_De_Explotacion DEBERÁ impedir cualquier construcción distinta de la mina en un hexágono con montaña y DEBERÁ impedir la recolección de la montaña.
12. SI el jugador solicita recolectar o talar un elemento sobre el que existe una construcción completada o una construcción, mejora o demolición en curso, ENTONCES EL Sistema_De_Explotacion DEBERÁ rechazar la solicitud y EL Sistema_De_Interfaz DEBERÁ indicar que la construcción debe demolerse antes de recolectar ese elemento.
13. SI el elemento sobre el que se monta una construcción completada deja de estar presente en su hexágono, ENTONCES EL Gestor_De_Recursos DEBERÁ asignar producción 0 a esa construcción, EL Sistema_De_Construccion DEBERÁ mantener la construcción en pie y EL Registro_De_Eventos DEBERÁ añadir una entrada de aviso indicando el hexágono y el elemento desaparecido.
14. PARA CUALQUIER configuración de bosques adyacentes, la producción de materiales de un aserradero DEBERÁ ser igual a `production_per_adjacent.materiales` multiplicado por el número de bosques adyacentes, con un máximo de 6 bosques adyacentes (propiedad).
15. PARA CUALQUIER acción de recolección completada, el elemento recolectado DEBERÁ dejar de estar presente en el hexágono y la recompensa DEBERÁ aplicarse exactamente una vez (propiedad).
16. PARA CUALQUIER tipo de animal doméstico, cualquier terreno de su `allowed_terrains` y cualquier nivel de granja, los datos DEBERÁN declarar exactamente un valor de producción y un modificador de terreno para ese par, la producción calculada DEBERÁ ser mayor o igual que 0 e idéntica en dos evaluaciones del mismo estado, y SI el par no está declarado, ENTONCES EL Validador_De_Datos DEBERÁ impedir el inicio de la partida (propiedad).

### Requisito 10: Fábricas de conversión

**Historia de usuario:** Como jugador, quiero transformar materiales en oro o ciencia, para convertir excedentes en progreso.

#### Criterios de aceptación

1. EL Sistema_De_Fabricas DEBERÁ leer de cada nivel de fábrica los bloques `consumes_per_day` y `production_per_day`.
2. MIENTRAS una fábrica está completada y no tiene una demolición en curso, CUANDO llega el Fin_De_Dia y el saldo de recursos resultante del paso de producción de construcciones de ese mismo día y de las conversiones de fábricas ya resueltas cubre íntegramente `consumes_per_day` del nivel vigente de esa fábrica, EL Sistema_De_Fabricas DEBERÁ restar ese consumo y sumar su producción sobre ese saldo antes de evaluar la siguiente fábrica.
3. SI en el Fin_De_Dia los recursos disponibles no cubren `consumes_per_day` de una fábrica, ENTONCES EL Sistema_De_Fabricas DEBERÁ dejar sin modificar los recursos de esa fábrica y EL Registro_De_Eventos DEBERÁ añadir una entrada indicando la fábrica y el recurso deficitario.
4. EL Sistema_De_Fabricas DEBERÁ resolver las fábricas de una en una en orden lexicográfico ascendente de `(q, r)` de su hexágono, primero por `q` y a igualdad de `q` por `r`, asignando los insumos por prioridad de ese orden, sin reparto parcial ni proporcional entre fábricas.
5. EL Gestor_De_Recursos DEBERÁ calcular la producción diaria de cada recurso de una fábrica como `max(0, piso(production_per_day × producto de los modificadores de terreno aplicables))` y DEBERÁ aplicar `consumes_per_day` sin modificadores de terreno, tanto en la comprobación de suficiencia como en el descuento.
6. CUANDO llega el Fin_De_Dia, EL Gestor_De_Recursos DEBERÁ asignar producción 0 a las fábricas en el paso de producción de construcciones, y EL Sistema_De_Fabricas DEBERÁ aplicar la producción de las fábricas exclusivamente en el paso de conversión de fábricas.
7. PARA CUALQUIER fábrica y cualquier estado de recursos, el consumo y la producción de esa fábrica en un día DEBERÁN ser ambos completos o ambos nulos (propiedad).
8. PARA CUALQUIER conjunto de fábricas y cualquier estado de recursos, los recursos resultantes del Fin_De_Dia DEBERÁN ser mayores o iguales que 0 (propiedad).
9. PARA CUALQUIER conjunto de fábricas y cualquier saldo de recursos insuficiente para todas ellas, el subconjunto de fábricas que completan su conversión en ese Fin_De_Dia DEBERÁ depender únicamente del orden lexicográfico de `(q, r)` y DEBERÁ ser independiente del orden en que las fábricas se registraron en el estado de partida (propiedad).

### Requisito 11: Árbol de tecnologías

**Historia de usuario:** Como jugador, quiero investigar tecnologías eligiendo rama, para especializar mi civilización según el objetivo del escenario.

#### Criterios de aceptación

1. EL Sistema_De_Investigacion DEBERÁ construir el árbol de tecnologías a partir de los datos, tomando de cada tecnología su rama, su escalón, sus dependencias, su coste, su tiempo y sus desbloqueos.
2. EL Sistema_De_Investigacion DEBERÁ admitir cualquier número de ramas y cualquier profundidad de rama declarados en los datos, sin límite impuesto por el código.
3. EL Sistema_De_Interfaz DEBERÁ dibujar el nodo central del árbol como elemento visual sin coste y sin acción de investigación asociada.
4. EL Sistema_De_Investigacion DEBERÁ permitir investigar una tecnología únicamente cuando todas sus dependencias estén investigadas.
5. EL Sistema_De_Investigacion DEBERÁ permitir investigar las tecnologías raíz de cada rama desde el día 1.
6. CUANDO el jugador confirma una investigación, EL Gestor_De_Recursos DEBERÁ comprometer en ese instante un coste en ciencia igual a `max(1, piso(coste declarado × producto de los Efecto_Global de reducción de coste de investigación vigentes))`.
7. CUANDO el jugador confirma una investigación, EL Reloj_De_Juego DEBERÁ programar su finalización `max(1, piso(tiempo declarado × producto de los Efecto_Global de reducción de tiempo de investigación vigentes))` días después, en el mismo fragmento de la solicitud.
8. CUANDO una investigación se completa, EL Sistema_De_Investigacion DEBERÁ marcar la tecnología como investigada, DEBERÁ activar sus desbloqueos de construcciones y niveles y DEBERÁ activar sus Efecto_Global.
9. CUANDO se completa una tecnología que declara `replaces` sobre otra tecnología, EL Sistema_De_Investigacion DEBERÁ aplicar el efecto de la tecnología nueva, DEBERÁ desactivar los Efecto_Global y los desbloqueos de la tecnología reemplazada, y DEBERÁ conservar la tecnología reemplazada como investigada a efectos de dependencias.
10. SI el nivel de una construcción existente deja de estar desbloqueado por el efecto `replaces` de una tecnología, ENTONCES EL Sistema_De_Niveles DEBERÁ mantener esa construcción en su nivel actual y con su producción, EL Sistema_De_Interfaz DEBERÁ limitar las mejoras ofrecidas a los niveles desbloqueados por el conjunto vigente de tecnologías y EL Registro_De_Eventos DEBERÁ añadir una entrada indicando la construcción y el nivel que deja de estar disponible.
11. EL Sistema_De_Investigacion DEBERÁ mantener como máximo una investigación en curso.
12. CUANDO el jugador confirma cancelar la investigación en curso, EL Sistema_De_Investigacion DEBERÁ descartar esa investigación, DEBERÁ devolver la tecnología al estado disponible, DEBERÁ liberar el hueco de investigación, EL Gestor_De_Recursos DEBERÁ devolver `piso(ciencia comprometida × rules.research.devolucion_ciencia_al_cancelar)` unidades de ciencia y EL Registro_De_Eventos DEBERÁ añadir una entrada con el día, el fragmento y la tecnología cancelada.
13. EL Sistema_De_Interfaz DEBERÁ mostrar para cada tecnología su nombre, su descripción, su coste en ciencia, su tiempo en días, sus dependencias y su estado: investigada, disponible o bloqueada.
14. EL Validador_De_Datos DEBERÁ comprobar que el grafo de dependencias de tecnologías es acíclico y que toda dependencia declarada corresponde a una tecnología existente.
15. PARA CUALQUIER estado de partida alcanzable, el conjunto de tecnologías investigadas DEBERÁ ser cerrado respecto a sus dependencias (propiedad).
16. PARA CUALQUIER secuencia de investigaciones completadas, el coste total en ciencia gastado DEBERÁ ser igual a la suma de los costes de las tecnologías investigadas tras aplicar los modificadores vigentes en el momento de iniciar cada investigación (propiedad).

### Requisito 12: Amenazas

**Historia de usuario:** Como jugador, quiero que el mapa hostil crezca si lo ignoro, para que expandirme y defenderme sea una tensión constante.

#### Criterios de aceptación

1. CUANDO llega el Fin_De_Dia, EL Sistema_De_Amenazas DEBERÁ aplicar los efectos pasivos declarados de cada amenaza a los hexágonos situados a distancia menor o igual que su radio declarado, con independencia del estado de visibilidad del hexágono de la amenaza y del estado de visibilidad de los hexágonos afectados.
2. CUANDO llega el Fin_De_Dia, EL Gestor_De_Recursos DEBERÁ aplicar en el paso de producción, como modificador aditivo sobre cada construcción situada dentro del radio de una amenaza bárbara o pirata, la reducción de producción declarada en el efecto pasivo de esa amenaza, sumando las reducciones de todas las amenazas cuyo radio incluya esa construcción.
3. CUANDO llega el Fin_De_Dia, después de la producción de construcciones y de la conversión de fábricas y antes del consumo de comida, EL Gestor_De_Recursos DEBERÁ aplicar como consumo la cantidad diaria declarada en el efecto pasivo de cada amenaza animal cuyo radio incluya al menos un hexágono con construcción del jugador, aplicando una sola reducción por amenaza y día con independencia del número de hexágonos afectados, resolviendo la insuficiencia de Poblacion_Libre conforme al criterio de sacrificio de construcciones del Requisito 4, y EL Registro_De_Eventos DEBERÁ añadir una entrada por cada reducción aplicada.
4. EL Sistema_De_Amenazas DEBERÁ mantener las amenazas animales en su hexágono, sin expansión.
5. MIENTRAS un hexágono permanece sin elemento y sin construcción tras eliminar una amenaza animal, CUANDO llega el Fin_De_Dia, EL Sistema_De_Amenazas DEBERÁ resolver una tirada de reaparición con probabilidad `min(1, d / respawn.dias_reaparicion)`, siendo d los días transcurridos desde la eliminación.
6. CUANDO una tirada de reaparición resulta positiva, EL Sistema_De_Amenazas DEBERÁ colocar en el hexágono una amenaza animal cuyo `allowed_terrains` incluya el terreno de ese hexágono.
7. CUANDO el Sistema_De_Amenazas crea una amenaza animal por reaparición en un hexágono situado a distancia D de la Ciudad, EL Sistema_De_Amenazas DEBERÁ asignarle el nivel `1 + piso(D × constraints.nivel_amenaza_por_anillo)` y Dano_Acumulado 0, y DEBERÁ elegir su tipo mediante sorteo determinista con la semilla de la partida entre las amenazas animales cuyo `allowed_terrains` incluya el terreno de ese hexágono.
8. CUANDO se completa una construcción en un hexágono con reaparición pendiente, EL Sistema_De_Amenazas DEBERÁ cancelar la reaparición en ese hexágono.
9. CUANDO llega el Fin_De_Dia, EL Sistema_De_Amenazas DEBERÁ resolver para cada amenaza humana una tirada de expansión con probabilidad `min(1, d / expansion.dias_expansion)` sobre hexágonos adyacentes admisibles sin construcción y con probabilidad `min(1, d / expansion.dias_expansion_con_construccion)` sobre hexágonos adyacentes admisibles con construcción, siendo d los días transcurridos desde su última expansión o desde su aparición, y siendo admisible todo hexágono adyacente que no contenga otra amenaza, ni un poblado, ni un misterio.
10. CUANDO una expansión ocupa un hexágono que contiene montaña, bosque, animal doméstico, peces o ballenas, EL Sistema_De_Amenazas DEBERÁ eliminar ese elemento.
11. EL Sistema_De_Amenazas DEBERÁ priorizar como destino de expansión los hexágonos adyacentes sin construcción.
12. EL Sistema_De_Amenazas DEBERÁ expandir los bárbaros únicamente a hexágonos de terreno distinto de océano y los piratas únicamente a hexágonos de océano.
13. CUANDO el Sistema_De_Amenazas crea una amenaza por expansión, EL Sistema_De_Amenazas DEBERÁ asignarle el tipo y el nivel de la amenaza de origen y Dano_Acumulado 0, y DEBERÁ iniciar en 0 sus contadores de días de expansión y de subida de nivel.
14. CUANDO una amenaza humana ocupa un hexágono con una construcción, EL Sistema_De_Construccion DEBERÁ eliminar esa construcción y EL Gestor_De_Recursos DEBERÁ restar los trabajadores de esa construcción tanto de la Poblacion_Empleada como de la Poblacion_Total, sin devolverlos a la Poblacion_Libre.
15. EL Sistema_De_Defensa DEBERÁ impedir la expansión de amenazas humanas a los hexágonos situados a una distancia menor o igual que `blocks_expansion_radius` de una torre de defensa completada.
16. EL Sistema_De_Amenazas DEBERÁ impedir la ocupación del hexágono de la Ciudad.
17. MIENTRAS una amenaza humana ocupa un hexágono adyacente a la Ciudad, EL Gestor_De_Recursos DEBERÁ aplicar a la producción de la Ciudad la reducción declarada en el efecto pasivo de esa amenaza.
18. CUANDO llega el Fin_De_Dia, EL Sistema_De_Amenazas DEBERÁ incrementar en 1 el nivel de cada amenaza humana cada `expansion.sube_nivel_cada` días transcurridos desde su aparición.
19. CUANDO una amenaza se expande, EL Registro_De_Eventos DEBERÁ añadir una entrada con el día, el fragmento y el hexágono ocupado, y EL Reloj_De_Juego DEBERÁ pasar al estado parado.
20. PARA CUALQUIER número de días transcurridos, las probabilidades de reaparición y de expansión calculadas DEBERÁN estar comprendidas entre 0 y 1, ambos inclusive (propiedad).
21. PARA CUALQUIER amenaza humana y cualquier estado de partida, el conjunto de hexágonos de expansión posibles DEBERÁ excluir el hexágono de la Ciudad, los hexágonos protegidos por torres y los hexágonos que contengan otra amenaza, un poblado o un misterio (propiedad).

### Requisito 13: Resolución del combate

**Historia de usuario:** Como jugador, quiero conocer mis probabilidades antes de atacar, para decidir si me refuerzo o si asumo el riesgo.

#### Criterios de aceptación

1. EL Resolutor_De_Combate DEBERÁ iniciar un combate únicamente cuando el jugador lo solicite desde el menú de interacción del hexágono que contiene la amenaza.
2. CUANDO el jugador confirma un ataque, EL Resolutor_De_Combate DEBERÁ resolver el combate en el mismo día y fragmento de la confirmación, sin programar coste en días, usando la Poblacion_Libre vigente en ese instante.
3. CUANDO se resuelve un combate, EL Resolutor_De_Combate DEBERÁ calcular `fuerzaJugador = max(1, Poblacion_Libre + suma de los Efecto_Global de combate)` y `fuerzaAmenaza = max(1, techo((coste_base_poblacion + nivel) × (1 - Dano_Acumulado)))`, ambas como enteros.
4. CUANDO se resuelve un combate, EL Resolutor_De_Combate DEBERÁ obtener una tirada de dado de `rules.combat.dado` caras para cada bando y DEBERÁ comparar `fuerzaJugador × tiradaJugador` con `fuerzaAmenaza × tiradaAmenaza`.
5. EL Resolutor_De_Combate DEBERÁ resolver como victoria del jugador únicamente los casos en que `fuerzaJugador × tiradaJugador` es mayor que `fuerzaAmenaza × tiradaAmenaza`.
6. SI la tirada del jugador es el valor mínimo del dado y la tirada de la amenaza es el valor máximo del dado, ENTONCES EL Resolutor_De_Combate DEBERÁ resolver el combate como derrota del jugador.
7. SI la tirada del jugador es el valor máximo del dado y la tirada de la amenaza es el valor mínimo del dado, ENTONCES EL Resolutor_De_Combate DEBERÁ resolver el combate como victoria del jugador.
8. CUANDO el jugador gana un combate, EL Sistema_De_Amenazas DEBERÁ eliminar la amenaza del hexágono y EL Gestor_De_Recursos DEBERÁ añadir la recompensa declarada en `combat.reward_instant`.
9. CUANDO el jugador pierde un combate, EL Resolutor_De_Combate DEBERÁ obtener una tirada adicional y DEBERÁ incrementar el Dano_Acumulado de la amenaza en `tirada × rules.combat.dano_por_punto_dado`, con un tope de `rules.combat.dano_maximo_acumulado`.
10. CUANDO se resuelve un combate, EL Gestor_De_Recursos DEBERÁ restar `costeCombate = max(1, techo(coste_base_poblacion de la amenaza × producto de los Efecto_Global de reducción de coste de combate))` unidades de Poblacion_Libre en concepto de consumo, reduciendo también la Poblacion_Total en la misma cantidad, tanto en victoria como en derrota.
11. EL Resolutor_De_Combate DEBERÁ aplicar exclusivamente Efecto_Global de combate, sin modificadores dependientes del hexágono.
12. CUANDO el Sistema_De_Interfaz ofrece la acción de atacar sobre un hexágono con amenaza, EL Sistema_De_Interfaz DEBERÁ mostrar el `costeCombate` y la probabilidad de victoria calculada como el cociente entre el número de pares `(tiradaJugador, tiradaAmenaza)` resueltos como victoria y el total `rules.combat.dado²`, expresada en puntos porcentuales con un decimal.
13. SI la Poblacion_Libre es menor que el `costeCombate`, ENTONCES EL Resolutor_De_Combate DEBERÁ rechazar el ataque y EL Sistema_De_Interfaz DEBERÁ mostrar el coste requerido y la Poblacion_Libre disponible.
14. PARA CUALQUIER par de fuerzas mayores que 0 y CUALQUIER `rules.combat.dado` mayor o igual que 2, la probabilidad de victoria calculada DEBERÁ estar comprendida entre `1 / rules.combat.dado²` y `1 - 1 / rules.combat.dado²`, ambos inclusive (propiedad).
15. PARA CUALQUIER par de proporciones de fuerza r1 y r2 con r1 ≤ r2, la probabilidad de victoria calculada DEBERÁ cumplir `p(r1) ≤ p(r2)` (propiedad).
16. PARA CUALQUIER secuencia de combates perdidos contra una misma amenaza, el Dano_Acumulado DEBERÁ mantenerse mayor o igual que 0 y menor o igual que `rules.combat.dano_maximo_acumulado` (propiedad).
17. PARA CUALQUIER par de fuerzas, la frecuencia de victorias observada en una muestra de 10.000 combates resueltos DEBERÁ diferir de la probabilidad estimada mostrada en menos de 2 puntos porcentuales (propiedad).
18. PARA CUALQUIER combate resuelto, la reducción de Poblacion_Libre DEBERÁ ser igual en victoria y en derrota para las mismas fuerzas y los mismos Efecto_Global (propiedad).

### Requisito 14: Torres de defensa

**Historia de usuario:** Como jugador, quiero levantar torres que frenen la expansión enemiga, aceptando que sus arqueros dejen de contar como fuerza de combate.

#### Criterios de aceptación

1. EL Sistema_De_Construccion DEBERÁ exigir la tecnología Vigías para la torre de nivel 1 y la tecnología Fortificaciones para la torre de nivel 2.
2. EL Sistema_De_Defensa DEBERÁ impedir que una amenaza humana ocupe por expansión cualquier hexágono destino situado a distancia menor o igual que el `blocks_expansion_radius` del nivel vigente de una torre completada, incluido el hexágono de la propia torre, también cuando `blocks_expansion_radius` sea 0.
3. MIENTRAS la construcción del nivel 1 de una torre está en curso, EL Sistema_De_Defensa DEBERÁ excluir esa torre del cálculo del bloqueo.
4. MIENTRAS una mejora de una torre completada está en curso, EL Sistema_De_Defensa DEBERÁ aplicar el `blocks_expansion_radius` del nivel origen de esa mejora.
5. EL Resolutor_De_Combate DEBERÁ calcular la fuerza del jugador sin considerar el número, el nivel ni la posición de las torres de defensa.
6. CUANDO se completa una torre de defensa, EL Gestor_De_Recursos DEBERÁ mantener sus trabajadores como Poblacion_Empleada y DEBERÁ excluirlos de la fuerza de combate.
7. EL Sistema_De_Amenazas DEBERÁ resolver la reaparición de amenazas animales sin considerar las torres de defensa.
8. EL Gestor_De_Recursos DEBERÁ aplicar a las torres de defensa coste de construcción y ningún coste de mantenimiento.
9. PARA CUALQUIER estado de partida, la fuerza de combate del jugador DEBERÁ ser idéntica antes y después de añadir una torre de defensa con 0 trabajadores (propiedad).
10. PARA CUALQUIER estado de partida alcanzable, el conjunto de hexágonos con expansión bloqueada DEBERÁ ser igual a la unión de los radios vigentes de todas las torres completadas, y un hexágono cubierto por dos o más torres DEBERÁ permanecer bloqueado mientras al menos una de ellas siga completada (propiedad).

### Requisito 15: Objetivos, misiones y fin de partida

**Historia de usuario:** Como jugador, quiero un objetivo principal claro y misiones intermedias, para tener rumbo y recompensas por el camino.

#### Criterios de aceptación

1. EL Sistema_De_Objetivos DEBERÁ tomar del escenario un único objetivo principal con su descripción, su condición y su `sustained_days`, aplicando `sustained_days` igual a 1 cuando la condición no lo declare.
2. MIENTRAS la condición del objetivo principal declara `sustained_days`, EL Sistema_De_Objetivos DEBERÁ contar los días consecutivos en que la condición se cumple en el Fin_De_Dia.
3. SI la condición del objetivo principal deja de cumplirse en un Fin_De_Dia, ENTONCES EL Sistema_De_Objetivos DEBERÁ reiniciar el contador de días consecutivos a 0.
4. CUANDO el contador de días consecutivos alcanza `sustained_days`, EL Sistema_De_Objetivos DEBERÁ terminar la partida con victoria, DEBERÁ registrar la recompensa permanente declarada y EL Reloj_De_Juego DEBERÁ pasar al estado parado.
5. EL Sistema_De_Objetivos DEBERÁ evaluar en cada Fin_De_Dia cada misión intermedia no completada comparando el valor observado de su condición con el umbral declarado, admitiendo únicamente condiciones de tipo cantidad acumulada de un recurso, número de hexágonos en estado explorado, número de construcciones completadas de un tipo con nivel mínimo o conjunto de tecnologías investigadas, y DEBERÁ otorgar exactamente una vez la recompensa de cada misión cuya condición se cumple.
6. CUANDO una misión se cumple, EL Sistema_De_Objetivos DEBERÁ marcarla como completada, EL Registro_De_Eventos DEBERÁ añadir una entrada y EL Reloj_De_Juego DEBERÁ pasar al estado parado.
7. EL Validador_De_Datos DEBERÁ registrar una advertencia cuando el número de misiones intermedias de un escenario esté fuera del rango de 8 a 10.
8. EL Sistema_De_Interfaz DEBERÁ mostrar en el panel de objetivos la descripción del objetivo principal, su progreso actual y el estado de cada misión intermedia.
9. EL Sistema_De_Objetivos DEBERÁ aplicar la derrota únicamente cuando la Poblacion_Total alcanza 0.
10. EL Sistema_De_Objetivos DEBERÁ permitir un número ilimitado de días de partida.
11. SI en el mismo Fin_De_Dia se cumplen la condición de victoria del objetivo principal y la Poblacion_Total llega a 0, ENTONCES EL Sistema_De_Objetivos DEBERÁ terminar la partida con victoria y DEBERÁ descartar la derrota de ese día.
12. MIENTRAS la partida está terminada con victoria o con derrota, EL Nucleo_De_Simulacion DEBERÁ rechazar toda acción del jugador que modifique el estado de partida y EL Reloj_De_Juego DEBERÁ mantenerse en estado parado.
13. MIENTRAS la partida está terminada, EL Sistema_De_Interfaz DEBERÁ mostrar el resultado, el día de finalización y el estado final de cada misión intermedia, y DEBERÁ ofrecer consultar el mapa y el Registro_De_Eventos, volver al menú principal e iniciar una partida nueva.
14. PARA CUALQUIER secuencia de días simulados, cada misión intermedia DEBERÁ otorgar su recompensa como máximo una vez (propiedad).
15. PARA CUALQUIER secuencia de días simulados, el contador de días consecutivos del objetivo principal DEBERÁ estar comprendido entre 0 y `sustained_days` (propiedad).

### Requisito 16: Poblados, misterios y puzzles de lógica

**Historia de usuario:** Como jugador, quiero resolver puzzles de lógica al descubrir poblados y misterios, para obtener ventajas si acierto y asumir consecuencias si fallo.

#### Criterios de aceptación

1. EL Sistema_De_Puzzles DEBERÁ tomar de los datos el enunciado, las opciones, la opción correcta y los efectos de acierto y de fallo de cada puzzle.
2. CUANDO comienza una partida, EL Sistema_De_Puzzles DEBERÁ seleccionar los puzzles fijos mediante un sorteo sin reposición sobre la bolsa de puzzles disponibles, usando la semilla de la partida.
3. CUANDO el Sistema_De_Puzzles instancia un puzzle de modo generado, EL Sistema_De_Puzzles DEBERÁ construir su enunciado, sus opciones y su respuesta correcta a partir de la semilla de la partida y de los parámetros declarados.
4. SI la bolsa de puzzles fijos compatibles se agota antes de asignar un puzzle a cada poblado y a cada misterio del mapa, ENTONCES EL Sistema_De_Puzzles DEBERÁ instanciar los pendientes en modo generado con subsemillas derivadas de forma determinista de la semilla de la partida, y SI ningún generador declarado admite ese tipo de elemento, EL Sistema_De_Puzzles DEBERÁ abortar el inicio de la partida y EL Sistema_De_Interfaz DEBERÁ mostrar los puzzles requeridos y los disponibles.
5. CUANDO el jugador explora un hexágono con poblado o con misterio, EL Sistema_De_Interfaz DEBERÁ abrir la ventana de puzzle y EL Reloj_De_Juego DEBERÁ pasar al estado parado.
6. CUANDO EL Sistema_De_Interfaz abre la ventana de un puzzle, EL Sistema_De_Puzzles DEBERÁ ordenar sus opciones aplicando una permutación derivada de la semilla de la partida y del identificador del puzzle, y DEBERÁ presentar ese mismo orden en cada reapertura de ese puzzle.
7. CUANDO el jugador elige la opción correcta de un puzzle, EL Sistema_De_Puzzles DEBERÁ aplicar los efectos declarados en `on_success`.
8. CUANDO el jugador elige una opción incorrecta de un puzzle, EL Sistema_De_Puzzles DEBERÁ aplicar los efectos declarados en `on_failure`, y SI un efecto dejaría un recurso por debajo de 0, EL Gestor_De_Recursos DEBERÁ fijar ese recurso en 0, DEBERÁ resolver las pérdidas de población conforme al criterio de sacrificio de construcciones del Requisito 4 y EL Registro_De_Eventos DEBERÁ añadir una entrada con el recurso y la cantidad no aplicada.
9. EL Sistema_De_Puzzles DEBERÁ registrar los efectos de un poblado como Efecto_Global vigente desde el fragmento de resolución de su puzzle hasta el fin de la partida, y DEBERÁ aplicar los efectos de un misterio como una modificación única de recursos en el fragmento de resolución.
10. EL Nucleo_De_Simulacion DEBERÁ acumular los Efecto_Global procedentes de poblados entre sí y con los procedentes de tecnologías sumando los modificadores aditivos y multiplicando los multiplicativos, sin que ninguno sustituya o descarte a otro.
11. EL Sistema_De_Puzzles DEBERÁ mantener el elemento poblado en su hexágono durante toda la partida y DEBERÁ impedir su eliminación y cualquier construcción sobre ese hexágono.
12. CUANDO el jugador resuelve el puzzle de un misterio, EL Sistema_De_Puzzles DEBERÁ eliminar el elemento misterio del hexágono.
13. EL Sistema_De_Puzzles DEBERÁ resolver cada puzzle una sola vez por partida.
14. SI el jugador cierra la ventana de puzzle sin elegir opción, ENTONCES EL Sistema_De_Puzzles DEBERÁ mantener el puzzle sin resolver y EL Sistema_De_Interfaz DEBERÁ permitir reabrirlo desde el menú de interacción de ese hexágono.
15. EL Sistema_De_Puzzles DEBERÁ incluir en el contenido de la Fase 1 los poblados Los Guardianes del Vado, El Gremio de Tejedores y El Pozo Seco, con los efectos de acierto y de fallo declarados en los datos.
16. EL Sistema_De_Puzzles DEBERÁ incluir en el contenido de la Fase 1 los misterios El Monolito de las Tres Cifras, La Balanza del Mercader, El Mapa Roto del Cartógrafo y El Granero Sellado, con los efectos de acierto y de fallo declarados en los datos.
17. CUANDO el jugador acierta el misterio El Mapa Roto del Cartógrafo, EL Gestor_De_Visibilidad DEBERÁ marcar como atenuados los 6 hexágonos adyacentes al hexágono del misterio que estén en estado oculto.
18. PARA CUALQUIER puzzle instanciado, el conjunto de opciones DEBERÁ contener al menos 2 opciones y exactamente 1 opción correcta (propiedad).
19. PARA CUALQUIER semilla, dos instanciaciones de un mismo puzzle generado DEBERÁN producir el mismo enunciado, las mismas opciones y la misma opción correcta (propiedad).
20. PARA CUALQUIER puzzle generado por el generador `adivina_numero`, el conjunto de pistas DEBERÁ admitir exactamente una solución compatible (propiedad).

### Requisito 17: Interfaz de usuario

**Historia de usuario:** Como jugador de escritorio, quiero ver de un vistazo el estado de cada hexágono y de mi economía, para tomar decisiones sin abrir manuales.

#### Criterios de aceptación

1. EL Sistema_De_Interfaz DEBERÁ funcionar con ratón y teclado en navegador de escritorio.
2. CUANDO el puntero se sitúa sobre un hexágono, EL Sistema_De_Interfaz DEBERÁ mostrar una ventana informativa con el tipo de terreno y el estado de visibilidad de ese hexágono.
3. CUANDO el puntero se sitúa sobre un hexágono explorado, EL Sistema_De_Interfaz DEBERÁ mostrar además su elemento, su construcción, el nivel de la construcción y los efectos activos sobre ese hexágono.
4. CUANDO el puntero se sitúa sobre una casa, EL Sistema_De_Interfaz DEBERÁ mostrar el desglose de producción con la producción base del nivel y cada modificador por separado: casa adyacente, Ciudad adyacente, amenaza adyacente, mina o fábrica adyacente y terreno desierto.
5. CUANDO el jugador pincha en un hexágono, EL Sistema_De_Interfaz DEBERÁ abrir un menú de interacción cuyas opciones correspondan al contenido de ese hexágono.
6. CUANDO el menú de interacción se abre sobre un hexágono con un elemento explotable, EL Sistema_De_Interfaz DEBERÁ ofrecer las acciones de recolección y de construcción declaradas para ese elemento.
7. CUANDO el menú de interacción se abre sobre un hexágono con una construcción del jugador distinta de la Ciudad y sin acción en curso, EL Sistema_De_Interfaz DEBERÁ ofrecer mejorar de nivel, mostrando el coste y la producción del nivel destino, y demoler.
8. CUANDO el menú de interacción se abre sobre el hexágono de la Ciudad, EL Sistema_De_Interfaz DEBERÁ ofrecer mejorar de nivel mostrando el coste y la producción del nivel destino, y DEBERÁ omitir la acción de demoler.
9. CUANDO el menú de interacción se abre sobre un hexágono con una amenaza, EL Sistema_De_Interfaz DEBERÁ ofrecer atacar, mostrando el `costeCombate` y la probabilidad de victoria calculados conforme al Requisito 13.
10. CUANDO el menú de interacción se abre sobre un hexágono atenuado, EL Sistema_De_Interfaz DEBERÁ ofrecer explorar, mostrando el coste en días y en población.
11. SI una acción del menú de interacción no cumple sus requisitos, ENTONCES EL Sistema_De_Interfaz DEBERÁ mostrar esa acción deshabilitada indicando el requisito incumplido.
12. SI el hexágono tiene una exploración, construcción, mejora o demolición en curso, ENTONCES EL Sistema_De_Interfaz DEBERÁ mostrar el tipo de acción en curso con su día y fragmento de finalización y DEBERÁ deshabilitar las demás acciones de ese hexágono indicando que existe una acción en curso.
13. EL Sistema_De_Interfaz DEBERÁ mostrar en la barra de recursos la Poblacion_Libre y la Poblacion_Total por separado, junto con comida, materiales, ciencia y oro, y la variación prevista de cada recurso para el Fin_De_Dia.
14. EL Sistema_De_Interfaz DEBERÁ proporcionar las pantallas de mapa, barra de recursos, panel de objetivos y misiones, árbol de tecnologías, registro de eventos, menú de construcción, ventana de puzzle y menú principal con selección de escenario y semilla.
15. EL Sistema_De_Interfaz DEBERÁ dibujar el árbol de tecnologías como una estrella de ramas radiales y DEBERÁ ofrecer ampliación y desplazamiento del árbol.
16. EL Registro_De_Eventos DEBERÁ mostrar los eventos en orden cronológico indicando el día y el fragmento de cada uno.
17. EL Sistema_De_Interfaz DEBERÁ mostrar el estado del tiempo actual y los controles de parado, play, avance rápido y avanzar al siguiente evento.

### Requisito 18: Control por teclado y accesibilidad

**Historia de usuario:** Como jugador que prefiere el teclado, quiero manejar toda la partida sin ratón, para jugar con comodidad.

#### Criterios de aceptación

1. CUANDO el jugador pulsa flecha izquierda o flecha derecha, EL Controlador_De_Entrada DEBERÁ mover el foco al hexágono adyacente al oeste o al este respectivamente; CUANDO pulsa flecha arriba o flecha abajo, al noroeste o al suroeste respectivamente; y CUANDO las pulsa junto con Mayús, al noreste o al sureste respectivamente.
2. SI no existe hexágono adyacente en la dirección solicitada, ENTONCES EL Controlador_De_Entrada DEBERÁ mantener el foco en el hexágono actual.
3. CUANDO comienza una partida, EL Controlador_De_Entrada DEBERÁ situar el foco en el hexágono de la Ciudad y EL Sistema_De_Interfaz DEBERÁ mostrar en él el indicador de foco.
4. CUANDO el jugador pulsa Enter con el foco en un hexágono, EL Controlador_De_Entrada DEBERÁ abrir el menú de interacción de ese hexágono.
5. CUANDO el jugador pulsa Espacio, EL Controlador_De_Entrada DEBERÁ alternar el estado del Reloj_De_Juego entre parado y el último estado de avance activo.
6. CUANDO el jugador pulsa la tecla 1, EL Controlador_De_Entrada DEBERÁ fijar el estado del Reloj_De_Juego en play, y CUANDO pulsa la tecla 2, DEBERÁ fijarlo en avance rápido.
7. CUANDO el jugador pulsa Esc, EL Controlador_De_Entrada DEBERÁ cerrar el menú o la ventana con foco.
8. CUANDO el jugador pulsa Tab, EL Controlador_De_Entrada DEBERÁ mover el foco al siguiente panel de la interfaz.
9. EL Sistema_De_Interfaz DEBERÁ mostrar un indicador visible del elemento con foco en todo momento.
10. EL Sistema_De_Interfaz DEBERÁ distinguir el estado de visibilidad, el tipo de terreno y el tipo de amenaza mediante icono o texto además del color.
11. EL Sistema_De_Interfaz DEBERÁ anunciar las nuevas entradas del Registro_De_Eventos en una región de texto accesible a lectores de pantalla.
12. PARA CUALQUIER acción disponible mediante ratón, EL Controlador_De_Entrada DEBERÁ ofrecer una secuencia de teclado equivalente (propiedad).

### Requisito 19: Render y animaciones

**Historia de usuario:** Como jugador, quiero un mapa con pixel art animado, para que la partida tenga vida sin depender de arte externo desde el primer día.

#### Criterios de aceptación

1. EL Motor_De_Render DEBERÁ dibujar terrenos, elementos y construcciones con pixel art generado por código, usando exclusivamente la paleta declarada en `rules.render.paleta` con un máximo de `rules.render.paleta_max_colores` colores, cuando no exista un atlas de sprites configurado.
2. DONDE exista un atlas de sprites configurado para un identificador de terreno, elemento o construcción, EL Motor_De_Render DEBERÁ dibujar el sprite del atlas en lugar del pixel art generado, sin cambios en la lógica de juego.
3. SI el atlas de sprites configurado para un identificador no se carga o no contiene ese identificador, ENTONCES EL Motor_De_Render DEBERÁ dibujar el pixel art generado de ese identificador y EL Registro_De_Eventos DEBERÁ registrar una advertencia con ese identificador.
4. EL Motor_De_Render DEBERÁ dibujar un aspecto distinto para cada nivel de cada construcción.
5. EL Motor_De_Render DEBERÁ animar en bucle los elementos y construcciones que declaren animación, con una duración de bucle menor o igual que 2 segundos.
6. MIENTRAS una construcción, mejora o demolición está en curso, EL Motor_De_Render DEBERÁ dibujar la etapa de obra correspondiente al fragmento actual del progreso de esa acción.
7. CUANDO se aplica un efecto positivo o negativo sobre un hexágono, EL Motor_De_Render DEBERÁ dibujar un indicador visual en ese hexágono durante al menos 1 fragmento.
8. MIENTRAS el Reloj_De_Juego está en estado parado, EL Motor_De_Render DEBERÁ mantener las animaciones decorativas en bucle y DEBERÁ congelar la etapa de obra de las acciones en curso.
9. EL Motor_De_Render DEBERÁ mantener al menos 30 imágenes por segundo en un mapa de radio 8 con todos los hexágonos explorados.
10. PARA CUALQUIER semilla, identificador de terreno, elemento o construcción, nivel y fragmento de animación, dos ejecuciones del Motor_De_Render DEBERÁN producir la misma imagen píxel a píxel (propiedad).

### Requisito 20: Datos en YAML y validación

**Historia de usuario:** Como diseñador del juego, quiero definir todo el contenido y el balance en YAML, para ampliar y ajustar el juego sin tocar código.

#### Criterios de aceptación

1. EL Cargador_De_Datos DEBERÁ leer de ficheros YAML los terrenos, los elementos, las construcciones con sus niveles, las tecnologías, los puzzles, las misiones, los escenarios, los parámetros de generación y las reglas globales.
2. EL Cargador_De_Datos DEBERÁ aplicar los valores por defecto declarados en las reglas globales a los campos opcionales ausentes en una definición.
3. CUANDO el juego arranca, EL Validador_De_Datos DEBERÁ comprobar el esquema de cada fichero de datos y las referencias cruzadas entre identificadores de terrenos, elementos, construcciones, tecnologías, puzzles y escenarios.
4. SI la validación de los ficheros de datos produce al menos un error de esquema, de referencia a un identificador inexistente o de identificador duplicado, ENTONCES EL Validador_De_Datos DEBERÁ impedir el inicio de la partida y EL Sistema_De_Interfaz DEBERÁ mostrar, para cada error, el fichero, la ruta del campo y el motivo del rechazo.
5. SI dos definiciones de la misma categoría (terreno, elemento, construcción, tecnología, puzzle, misión o escenario) declaran el mismo identificador, aunque estén en ficheros distintos, ENTONCES EL Validador_De_Datos DEBERÁ tratarlo como error bloqueante y EL Sistema_De_Interfaz DEBERÁ mostrar el identificador y todos los ficheros que lo declaran.
6. CUANDO la validación termina sin errores bloqueantes y con al menos una advertencia, EL Validador_De_Datos DEBERÁ permitir el inicio de la partida y EL Registro_De_Eventos DEBERÁ mostrar cada advertencia con su fichero y la ruta del campo.
7. EL Cargador_De_Datos DEBERÁ incorporar un elemento, una construcción, un nivel de construcción, una tecnología o una rama de tecnologías nuevos declarados en los datos sin requerir cambios en el código.
8. EL Serializador_De_Datos DEBERÁ escribir cualquier estructura de datos de contenido válida en YAML aceptado por el Cargador_De_Datos.
9. PARA CUALQUIER fichero de datos válido, el resultado de cargar, serializar y volver a cargar DEBERÁ ser equivalente al resultado de la primera carga (propiedad de ida y vuelta).
10. PARA CUALQUIER estructura de datos de contenido válida, el resultado de serializar, cargar y volver a serializar DEBERÁ ser idéntico al primer resultado de serialización (propiedad de ida y vuelta).
11. PARA CUALQUIER entrada YAML sintácticamente inválida o que incumpla el esquema, EL Cargador_De_Datos DEBERÁ devolver un error identificando la posición del problema, sin lanzar excepciones no controladas (propiedad de condiciones de error).

### Requisito 21: Persistencia de la partida

**Historia de usuario:** Como jugador, quiero que mi partida se guarde sola y poder guardarla a mano, para retomarla más tarde sin perder progreso.

#### Criterios de aceptación

1. MIENTRAS la partida no ha terminado con victoria ni con derrota, CUANDO llega el Fin_De_Dia, EL Sistema_De_Persistencia DEBERÁ escribir el estado de partida completo en localStorage como autoguardado, incluido el Fin_De_Dia en que la partida termina.
2. CUANDO el jugador solicita un guardado manual, EL Sistema_De_Persistencia DEBERÁ escribir el estado de partida completo en una ranura de guardado identificada, distinta de la del autoguardado.
3. EL Sistema_De_Persistencia DEBERÁ incluir en el estado guardado la versión de formato de guardado y el identificador de versión de los datos de contenido cargados, además del día, el fragmento, la semilla, el estado del generador de números aleatorios, el mapa, la visibilidad de cada hexágono, los recursos, las construcciones con su nivel y sus trabajadores, las acciones en curso con su fragmento de finalización, las tecnologías investigadas y la investigación en curso, las amenazas con su nivel y su Dano_Acumulado, las misiones completadas, los puzzles resueltos y el progreso del objetivo principal.
4. CUANDO el jugador carga un guardado, EL Sistema_De_Persistencia DEBERÁ restaurar el estado de partida completo y EL Reloj_De_Juego DEBERÁ quedar en estado parado.
5. SI el guardado seleccionado declara una versión de formato incompatible, ENTONCES EL Sistema_De_Persistencia DEBERÁ rechazar la carga y EL Sistema_De_Interfaz DEBERÁ mostrar la versión encontrada y la versión admitida.
6. SI el guardado seleccionado referencia un identificador de terreno, elemento, construcción, nivel de construcción, tecnología, puzzle o escenario ausente en los datos cargados por el Cargador_De_Datos, ENTONCES EL Sistema_De_Persistencia DEBERÁ rechazar la carga, DEBERÁ conservar la ranura de guardado sin modificar y EL Sistema_De_Interfaz DEBERÁ mostrar los identificadores ausentes.
7. SI la escritura en localStorage falla, ENTONCES EL Sistema_De_Persistencia DEBERÁ conservar la partida en memoria y EL Sistema_De_Interfaz DEBERÁ mostrar el motivo del fallo.
8. PARA CUALQUIER estado de partida alcanzable, el resultado de guardar y cargar DEBERÁ producir un estado equivalente al original en todos los campos persistidos (propiedad de ida y vuelta).
9. PARA CUALQUIER estado de partida alcanzable y cualquier secuencia de acciones posterior, simular esa secuencia tras un ciclo de guardado y carga DEBERÁ producir el mismo estado que simularla sin guardar ni cargar (propiedad).

### Requisito 22: Textos e internacionalización

**Historia de usuario:** Como jugador hispanohablante, quiero todos los textos en español, y como desarrollador quiero poder añadir idiomas sin tocar código.

#### Criterios de aceptación

1. EL Gestor_De_Textos DEBERÁ resolver mediante clave de catálogo todo texto visible, incluidos los nombres y las descripciones de terrenos, elementos, construcciones, niveles, tecnologías, puzzles, misiones y objetivos declarados en los ficheros YAML.
2. EL Gestor_De_Textos DEBERÁ usar el catálogo de español como idioma por defecto.
3. CUANDO el Cargador_De_Datos lee una definición de contenido, EL Cargador_De_Datos DEBERÁ interpretar sus campos de nombre y descripción como claves de catálogo y no como cadenas literales.
4. SI una clave de nombre o de descripción declarada en los datos no existe en el catálogo de español, ENTONCES EL Validador_De_Datos DEBERÁ impedir el inicio de la partida y EL Sistema_De_Interfaz DEBERÁ mostrar el fichero, la clave ausente y el motivo del rechazo.
5. SI una clave solicitada no existe en el catálogo activo, ENTONCES EL Gestor_De_Textos DEBERÁ devolver la clave solicitada y EL Registro_De_Eventos DEBERÁ registrar una advertencia con esa clave.
6. EL Gestor_De_Textos DEBERÁ incorporar un catálogo de un idioma nuevo declarado en los datos sin requerir cambios en el código.
7. EL Gestor_De_Textos DEBERÁ aplicar el formato de números y la forma plural declarados en el catálogo activo.
8. PARA CUALQUIER clave presente en el catálogo de español, el catálogo de cualquier otro idioma cargado DEBERÁ declarar esa misma clave o EL Validador_De_Datos DEBERÁ registrar una advertencia identificando la clave ausente (propiedad).
