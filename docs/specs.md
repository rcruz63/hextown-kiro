# Especificaciones para el juego Hextown

Hextown es un juego de estrategia por turnos con un mapa compuesto por hexágonos de diferentes tipos. La estética es retro de 8 bits con pequeñas animaciones en bucle.

El desarrollo se divide en dos fases:

- **Fase 1: el juego base.** Es el alcance de esta especificación.
- **Fase 2: la campaña.** Encadena partidas del juego base en un mapa global. Se especificará aparte (ver el último apartado).

## 0. Decisiones cerradas

| Tema | Decisión |
|---|---|
| Alcance de esta especificación | Solo Fase 1, el juego base |
| Plataforma | Web de escritorio, ratón y teclado |
| Stack | TypeScript + Vite, render en Canvas 2D, lógica de juego en módulos puros sin motor de terceros |
| Persistencia | localStorage, autoguardado al final de cada día más guardado manual |
| Idioma | Textos en español, externalizados y preparados para i18n |
| Balance | Todos los costes, tiempos, producciones y probabilidades viven en ficheros YAML, nunca embebidos en el código |
| Materiales | Un único recurso en Fase 1, con el esquema de conversión ya preparado para dividirlo en tipos más adelante |
| Bonus de combate | Solo globales, procedentes de tecnologías o efectos permanentes. No hay modificadores de combate por hexágono |
| Arte | Pixel art generado por código como placeholder, con la carga de sprites externos ya preparada para sustituirlo |
| Accesibilidad | Navegación completa por teclado. Sin paleta específica para daltonismo |
| Modo de juego | Un jugador |

## 1. Situación inicial

El juego arranca con un hexágono central que contiene la ciudad (town). Los 6 hexágonos que la rodean son visibles al detalle y, por generación, al menos uno es de tipo prado. El anillo siguiente es visible pero atenuado: se conoce el tipo de terreno pero no su contenido. Más allá no se intuye nada, es fondo negro continuo.

La civilización arranca en modo agrícola y de subsistencia: solo sabe levantar refugios y plantaciones. Todo lo demás, incluidas las defensas, hay que investigarlo.

### Estados de visibilidad

- **Oculto.** Fondo negro continuo. No se distingue ni la forma del hexágono.
- **Atenuado.** Se conoce el tipo de terreno, no el contenido. Es el único estado desde el que se puede lanzar una exploración.
- **Explorado.** Se ve el terreno, el elemento que contiene y las construcciones.

## 2. El mapa

- Hexágonos con la punta arriba (pointy-top).
- Generación procedural con semilla, para poder compartir y reproducir mapas.
- Tamaño por defecto: radio 8, unos 217 hexágonos. Configurable por escenario en YAML.
- El océano se genera en masas contiguas, no en casillas sueltas.

### Control de la generación

La generación se controla con dos bloques en YAML: **pesos** (la proporción esperada de cada terreno y la densidad de cada elemento) y **restricciones** (garantías que el mapa debe cumplir para que la partida sea difícil pero no imposible). Si una tirada no cumple las restricciones, se regenera.

Restricciones previstas:

- Al menos un prado entre los 6 hexágonos adyacentes a la ciudad.
- Un porcentaje mínimo de prado en el mapa completo.
- Un número mínimo de montañas y de bosques, para que la rama de Construcción tenga sentido.
- Un número máximo de amenazas iniciales.
- Distancia mínima de las amenazas humanas a la ciudad, para no ahogar el arranque.
- El **nivel de las amenazas escala con la distancia a la ciudad**: las cercanas son débiles y las del borde peligrosas, de forma que explorar lejos siga siendo arriesgado aunque la población haya crecido.

## 3. Tipos de terreno

| Terreno | Plantación | Casas | Particularidad |
|---|---|---|---|
| prado | Sí, producción completa | Sí | Único terreno con animales domésticos, salvo las cabras |
| tundra | Sí, modificador 0.5 | Sí | Admite cabras y lobos |
| desierto | No | Sí, con penalización de producción | Terreno hostil. Leones |
| no fértil | No | Sí | Terreno rocoso: bonus de producción a minas y fábricas. Osos |
| océano | No | No | Solo construcciones navales. Peces, ballenas y piratas |

La penalización de las casas en desierto y el bonus del terreno no fértil son datos en YAML, ajustables sin tocar código.

## 4. Elementos del hexágono y su explotación

Cada hexágono contiene como máximo un elemento.

**Los elementos no producen nada por sí mismos.** Solo las construcciones producen de forma pasiva. Un elemento se aprovecha de dos maneras:

- **Consumirlo una vez.** Una acción de recolección da recursos de golpe y el elemento desaparece.
- **Explotarlo de forma continua.** Se monta la construcción correspondiente, que produce mientras siga en pie.

### Montaña

Aparece en cualquier terreno excepto océano. No admite ninguna construcción salvo la mina, y no se puede recolectar.

- **Mina** (requiere Minería): materiales y oro por día. Bonus si el terreno es no fértil.

### Animales domésticos

Solo aparecen en prado, excepto las cabras que también aparecen en tundra.

| Animal | Terreno | Recolectar, una vez | Granja nivel 1, por día |
|---|---|---|---|
| Vacas | prado | 15 comida | 3 comida, 2 materiales |
| Gallinas | prado | 5 comida | 2 comida |
| Cabras | prado y tundra | 10 en prado, 6 en tundra | 3 comida en prado, 2 en tundra |
| Cerdos | prado | 12 comida | 2 comida, 1 material |

- Recolectar cuesta 1 día y algo de población, y elimina el animal.
- La **granja** requiere Ganadería y se construye sobre el animal, que pasa a ser la fuente de producción del edificio.

### Peces y ballenas

Solo en océano. Las dos acciones requieren Navegación costera: sin barcos no hay forma de aprovechar el mar.

| Elemento | Recolectar, una vez | Bote de pesca nivel 1, por día |
|---|---|---|
| Peces | 8 comida | 2 comida |
| Ballenas | 20 comida | 4 comida |

### Bosque

El bosque no produce nada por sí mismo.

- **Talar** (1 día): 10 materiales de una vez y libera la casilla.
- **Aserradero** (requiere Carpintería): se construye en una casilla vacía y produce **2 materiales por día por cada bosque adyacente**. Es la explotación del bosque, y por eso necesita al menos un bosque adyacente para poder construirse. Talar un bosque vecino reduce su producción.

### Poblado

Elemento permanente que no se puede eliminar. Presenta un puzzle cuya resolución determina si su efecto permanente es positivo o negativo. Ver el apartado de Poblados, misterios y puzzles.

### Misterio

Presenta un puzzle y proporciona ventajas o desventajas instantáneas.

### Amenazas

Animales peligrosos, bárbaros y piratas. Ver el apartado de Amenazas y combate.

## 5. Recursos

- **Población**
- **Comida**
- **Materiales**
- **Ciencia**
- **Oro**

### El modelo de población

La población se reparte en dos bolsas:

- **Población libre.** Es la moneda del juego y es también tu fuerza en combate. Crece con la ciudad y las casas.
- **Población empleada.** Los trabajadores fijos de cada edificio. Siguen vivos y siguen comiendo, pero no están disponibles para nada más, y en particular **no cuentan en combate**.

**Población total = libre + empleada.** Es la cifra que consume comida y la que miden los objetivos.

Hay dos formas de gastar población y no son equivalentes:

| Gasto | Efecto |
|---|---|
| Explorar, recolectar, combatir | **Consumo.** La población se pierde para siempre. Baja la libre y baja la total |
| Construir o mejorar un edificio | **Empleo.** Esos trabajadores quedan fijos en el edificio. Baja la libre, la total no cambia |

Consecuencia de diseño: industrializarse te debilita militarmente. Levantar una fábrica con 4 trabajadores te resta 4 puntos de fuerza en todos los combates mientras siga en pie. Demoler te los devuelve.

Si una amenaza destruye un edificio, su población empleada se pierde.

Otras reglas:

- Las enfermedades reducen la población: probabilidad diaria definida en YAML que escala con la población total.
- Algunas amenazas reducen la población de los hexágonos cercanos.
- Si la población total llega a 0, la partida se pierde.

### Comida

Al final de cada día se consume 1 de comida por cada 2 de población total. Si no hay comida suficiente, muere población.

### Ciencia

Al principio de la partida solo se obtiene cumpliendo misiones y resolviendo misterios: la civilización arranca en modo subsistencia. Los centros de estudio, disponibles a mitad de partida, automatizan su producción. El árbol tiene muchas más tecnologías de las que una partida puede pagar, así que elegir la rama es la decisión estratégica principal.

### Oro

Recurso de progresión tardía. No hace falta para nada en el arranque y solo lo piden las construcciones y las mejoras de nivel alto. Sus fuentes son las minas, las casas de nivel 2 y superiores, la ciudad mejorada, las fábricas de conversión y las recompensas de puzzles.

### Materiales

En Fase 1 es un único recurso. Las fábricas lo transforman en oro o en ciencia. El esquema de conversión en YAML está diseñado para admitir más adelante una división en tipos (madera del aserradero, mineral de la mina) sin rehacer nada, porque seguro que jugando surgen ideas y hay que facilitarlas.

### Almacenamiento

Sin límite de almacenamiento en Fase 1.

## 6. El tiempo

- La unidad de coste es el **día**. Todos los costes de tiempo se expresan en días y son ajustables en YAML.
- Cada día se divide en **5 fragmentos** con función puramente visual (un anillo que cambia de color, el progreso de una obra). No hay acciones que cuesten fracciones de día.
- Duración real: 6 segundos por día en velocidad normal, 3 segundos en avance rápido.
- Estados del tiempo: **parado**, **play** y **avance rápido**.
- Botón **avanzar al siguiente evento**: salta directamente al momento en que termina la próxima acción y deja el juego en pausa.
- Una acción pedida en el fragmento X termina en el fragmento X del día correspondiente a su coste. Empezar a media tarde retrasa el final a media tarde.
- La producción se calcula al final de cada día contando solo los edificios completados en ese momento. Un edificio terminado durante el día ya produce al final de ese mismo día.
- Paralelismo ilimitado mientras haya recursos y población libre para pagar las acciones. Excepción: una sola investigación a la vez.
- Pausa automática al ocurrir un evento: combate, misterio, poblado descubierto, amenaza que se expande, objetivo cumplido.

### Ejemplo de línea temporal

- **día n** (fragmentos 0..4)
    - fragmento 1: se pide la exploración de una casilla (coste 2 días)
    - fragmento 3: se pide la construcción de una casa (coste 1 día)
    - fin del día: se obtienen recursos
- **día n+1**
    - fragmento 3: se concluye la casa
    - fin del día: se obtienen recursos, ya incluyendo la casa
- **día n+2**
    - fragmento 1: se completa la exploración y se muestra el contenido de la casilla

## 7. Exploración

- Solo se pueden explorar casillas atenuadas, es decir adyacentes a una casilla ya explorada.
- El coste crece con la distancia a la ciudad:
    - `tiempo = 1 + floor(distancia_a_ciudad / 3)` días
    - `poblacion = distancia_a_ciudad`, en concepto de consumo: no vuelve
- La fórmula y sus constantes son ajustables en YAML sin tocar código. Hay tecnologías que reducen el coste en población.
- Al completarse se revela el terreno exacto y el elemento que contiene, y los hexágonos adyacentes pasan a estado atenuado.
- Explorar puede revelar misterios, poblados o amenazas.

## 8. Construcciones

Reglas generales:

- Una construcción por hexágono.
- La casilla debe estar libre. Si contiene algo eliminable (bosque, animal) hay que quitarlo antes, salvo en las construcciones que se montan sobre el propio elemento: granja sobre animal doméstico, mina sobre montaña, bote de pesca sobre peces.
- El coste en población son los trabajadores del edificio y queda empleado mientras el edificio exista.
- Las construcciones más avanzadas cuestan más días.

### Lista

| Construcción | Niveles | Produce | Requiere |
|---|---|---|---|
| Casa | 4 | Población, y oro desde el nivel 2 | Nivel 1 desde el día 1 |
| Plantación | 3 | Comida | Nivel 1 desde el día 1. Prado, o tundra al 0.5 |
| Granja | 2 | Comida y materiales según el animal | Ganadería, sobre animal doméstico |
| Bote de pesca | 2 | Comida | Navegación costera, sobre peces o ballenas |
| Mina | 2 | Materiales y oro | Minería, sobre montaña |
| Aserradero | 2 | 2 materiales por bosque adyacente | Carpintería, con bosque adyacente |
| Fábrica | 2 | Convierte recursos, ver abajo | Metalurgia |
| Centro de estudios | 4 | Ciencia | Rama Ciencia |
| Torre de defensa | 2 | Nada. Bloquea la expansión enemiga | Vigías, tecnología avanzada |
| Ciudad | 4 | Población, materiales y oro | Los niveles 1 a 3 sin tecnología, el 4 con Ciudadela |

### El centro de estudios

Es un solo edificio con cuatro niveles, que es la línea de investigación de la rama Ciencia: **monasterio**, **escuela**, **gremio** y **universidad**. Cada nivel produce más ciencia, emplea más eruditos y exige la tecnología correspondiente.

### Niveles y mejoras

Casi todo puede evolucionar: casas, plantaciones, granjas, minas, aserraderos, fábricas, centros de estudio, torres y la propia ciudad. La mejora es una acción sobre el edificio existente, no hay que demolerlo.

Reglas del sistema de niveles:

- Cada nivel superior exige **una tecnología concreta**, así que la progresión pasa por el árbol y obliga a elegir rama.
- Cada nivel emplea **más trabajadores**. La diferencia entre los trabajadores del nivel nuevo y los del actual tiene que estar disponible como población libre en el momento de pedir la mejora.
- El **nivel 2 cuesta materiales** además de trabajadores. Del **nivel 3 en adelante cuesta también oro**.
- Cada nivel tarda más días en completarse.
- El coste se paga al empezar: los trabajadores y los recursos se comprometen en el momento de pedir la mejora.
- Que el edificio **siga produciendo al nivel anterior mientras duran las obras es configurable** (`produce_durante_mejora`, activado por defecto, con posibilidad de sobrescribirlo por construcción). Es una palanca de dificultad: desactivarlo encarece mucho mejorar, porque al coste se le suma la producción perdida durante la obra.
- El número de niveles no está limitado por el código: es un dato más de cada construcción.

Regla de balance: el sobrecoste de subir de nivel debe amortizarse en **no menos de 10 días** de producción adicional. Mejorar tiene que ser una apuesta a medio plazo, nunca un beneficio inmediato. Es un reto organizativo: no da para mejorarlo todo, y cada trabajador que entra en un edificio es un punto menos de fuerza militar.

### Demoler

Se puede derribar un edificio. Cuesta 1 día, libera la casilla y **devuelve sus trabajadores a la población libre**. También se recupera **una parte de los materiales invertidos**, la mitad por defecto, ajustable en YAML. Sirve como válvula de escape: desmantelar una fábrica para reforzar un combate difícil es una jugada legítima.

### Modificadores de adyacencia de las casas

- Dos casas adyacentes producen población extra.
- Una casa adyacente a la ciudad produce más población y oro.
- Una casa adyacente a una amenaza produce menos población y oro.
- Una casa adyacente a una mina o una fábrica produce menos población.
- Una casa en desierto produce menos población.

### Fábricas: conversión de recursos

Las fábricas no extraen, **transforman**. Se definen con dos bloques: lo que consumen por día y lo que producen por día. Si un día no hay insumos suficientes, la fábrica no produce nada ese día (no hay producción parcial) y el registro de eventos lo avisa.

Ejemplo: una fábrica de herramientas consume 4 materiales por día y produce 3 de oro. Otra podría consumir materiales y producir ciencia.

El mecanismo es genérico y vive en YAML, así que sirve tanto ahora, con un único recurso Materiales, como si más adelante se divide en tipos.

### Torres de defensa

- **No están disponibles al principio.** La población inicial es agrícola; los arqueros son conocimiento avanzado. La torre de nivel 1 cuelga del tercer escalón de la rama Ejército.
- Son **infraestructura de bloqueo y nada más**. No dan ningún bonus de combate: su única función es impedir que los bárbaros y los piratas se expandan a las casillas de su radio. La de nivel 1 protege 1 casilla de distancia; la de nivel 2, 2 casillas.
- **No** impiden la reaparición de animales peligrosos.
- Emplean población: son los arqueros que quedan encerrados dentro, y por tanto dejan de contar como fuerza de combate. Levantar una torre es un coste militar a cambio de seguridad territorial.
- Solo tienen coste de construcción, sin mantenimiento.

### La ciudad

Los niveles 1 a 3 no exigen tecnología, solo recursos y población. El nivel 4 requiere la tecnología Ciudadela, al final de la rama Casas. La mejora a nivel 2 no pide oro, para no bloquear el arranque.

| Nivel | Producción por día | Requisitos para subir |
|---|---|---|
| 1 | 1 población, 2 materiales | — |
| 2 | 2 población, 3 materiales, 1 oro | 15 población total, 40 materiales |
| 3 | 3 población, 4 materiales, 2 oro | 30 población total, 100 materiales, 80 oro |
| 4 | 5 población, 6 materiales, 4 oro | Ciudadela, 50 población total, 200 materiales, 200 oro |

La ciudad es la única fuente de materiales del arranque, ya que las minas y los aserraderos requieren tecnología.

## 9. Tecnologías

Se investigan gastando Ciencia y tardan un número de días. Solo una investigación a la vez.

El árbol tiene forma de estrella con **5 ramas de 6 niveles**, 30 tecnologías en total. El **nodo central es solo el centro visual**, no se investiga y no cuesta nada. Dentro de cada rama las tecnologías son lineales: cada una depende de la anterior. Las cinco tecnologías raíz son investigables desde el día 1.

El coste en Ciencia crece con el nivel, de forma que una partida del juego base solo da para **cinco o seis tecnologías**. El árbol está dimensionado a propósito para la campaña: los niveles altos casi nunca se alcanzan en una partida suelta, pero lo aprendido se conserva de una a otra y en la Fase 2 los enemigos serán mejores y los retos mayores. En una partida del juego base lo esperable es profundizar en una o dos ramas según el objetivo: si la victoria pide población, se desarrollan Casas y Alimentación y se descuida Ejército.

Coste orientativo por nivel: 20, 45, 80, 130, 200 y 300 de Ciencia.

**Rama Casas** (población y oro)

1. Casas de adobe: casa de nivel 2
2. Pozos y saneamiento: reduce la probabilidad de enfermedad
3. Casas de piedra: casa de nivel 3
4. Urbanismo: mejora los bonus de adyacencia entre casas
5. Casas señoriales: casa de nivel 4
6. Ciudadela: ciudad de nivel 4

**Rama Alimentación** (comida)

1. Ganadería: granja de nivel 1 sobre animales domésticos
2. Regadío: plantación de nivel 2
3. Navegación costera: permite recolectar en el mar y construir el bote de pesca
4. Establos: granja de nivel 2
5. Conservación de alimentos: reduce el consumo de comida por habitante
6. Rotación de cultivos: plantación de nivel 3

**Rama Construcción** (materiales)

1. Minería: mina de nivel 1 sobre montaña
2. Carpintería: aserradero de nivel 1
3. Metalurgia: fábrica de nivel 1
4. Galerías profundas: mina de nivel 2
5. Ingeniería: aserradero y fábrica de nivel 2
6. Maquinaria: reduce un día todos los tiempos de construcción

**Rama Ejército** (defensa)

1. Caza: reduce el coste en población al combatir animales
2. Armas de bronce: +2 de fuerza en combate
3. Vigías: torre de defensa de nivel 1
4. Armas de hierro: +4 de fuerza en combate, sustituye al bronce
5. Fortificaciones: torre de defensa de nivel 2
6. Estrategia: reduce a la mitad el coste en población de los combates

**Rama Ciencia** (ciencia)

1. Escritura: centro de estudios de nivel 1, el monasterio
2. Enseñanza: nivel 2, la escuela
3. Gremios: nivel 3, el gremio
4. Método científico: aumenta un 25 % la ciencia de todos los centros
5. Academia: nivel 4, la universidad
6. Imprenta: reduce el coste en ciencia de todas las tecnologías

Los nombres, costes, tiempos, dependencias y desbloqueos son datos en YAML. El código no impone ni el número de ramas ni la profundidad, así que la campaña podrá alargar el árbol sin tocarlo.

## 10. Amenazas y combate

### Tipos de amenaza

| Tipo | Dónde | Efecto pasivo | Comportamiento |
|---|---|---|---|
| Animales peligrosos: osos (no fértil, tundra), jabalíes (prado), leones (desierto), lobos (prado, tundra) | Terreno sin montaña | Reducen población en radio 1 | No se expanden. Reaparecen si la casilla queda vacía |
| Bárbaros | Terreno | Reducen la producción en radio 1 | Se expanden. Suben de nivel lentamente |
| Piratas | Océano | Reducen la producción en radio 1 | Se expanden por el océano. Suben de nivel lentamente |

El nivel inicial de cada amenaza escala con su distancia a la ciudad.

### Reaparición de animales

Si se elimina un animal y la casilla queda vacía, puede volver a aparecer. La probabilidad diaria crece con los días transcurridos: `p(d) = d / dias_reaparicion`, siendo `d` los días desde que se limpió la casilla. Es muy baja al principio y certeza al alcanzar el límite. Construir en la casilla elimina la posibilidad.

### Expansión de bárbaros y piratas

Mismo modelo de probabilidad creciente: `p(d) = d / dias_expansion`. Al principio la ocupación es muy improbable y se vuelve casi segura hacia el día N, de forma que lo esperable es que ocupen una casilla y solo una en ese plazo.

- Ocupan preferentemente casillas vacías adyacentes.
- Si la casilla tiene una construcción, la destruyen y su población empleada se pierde, pero tardan más en ocuparla.
- No pueden expandirse a casillas protegidas por torres de defensa.
- No pueden ocupar la ciudad. Si están adyacentes a ella, le drenan producción.

### Resolución del combate

El combate se lanza desde el menú de interacción del hexágono que contiene la amenaza. No es automático.

```
fuerzaJugador = poblacion_libre + bonus_globales
fuerzaAmenaza = (coste_base_poblacion + nivel) * (1 - dano_acumulado)

tiradaJugador = fuerzaJugador x d6
tiradaAmenaza = fuerzaAmenaza x d6

victoria si tiradaJugador > tiradaAmenaza
el empate cuenta como derrota
```

Los bonus son siempre **globales**: vienen de tecnologías de la rama Ejército o de efectos permanentes de poblados. No existen modificadores de combate por hexágono, lo que mantiene la lógica y la interfaz simples.

Multiplicar la fuerza por el dado en lugar de sumarla hace que lo decisivo sea la **proporción** entre bandos y no la diferencia absoluta. Así ninguna ventaja convierte el combate en algo seguro.

Reglas de dado natural:

- **Pifia:** si el jugador saca un 1 natural y la amenaza un 6 natural, derrota automática.
- **Crítico:** si el jugador saca un 6 natural y la amenaza un 1 natural, victoria automática.
- La probabilidad de victoria queda siempre entre 2,8 % y 97,2 %.

| Proporción jugador : amenaza | Probabilidad de victoria |
|---|---|
| 1 : 3 | 8 % |
| 1 : 2 | 17 % |
| 1 : 1 | 42 % |
| 1,5 : 1 | 67 % |
| 2 : 1 | 75 % |
| 3 : 1 | 86 % |
| 4 : 1 | 92 % |
| 6 : 1 o más | 97 % (techo) |

Resultados:

- **Victoria.** La amenaza desaparece, el hexágono queda libre y se recibe la recompensa. Se pierde el coste base en población.
- **Derrota.** Se tira un segundo d6 para el daño infligido: `daño = tirada x 10 %`, entre 10 % y 60 %, nunca 100 %. El daño **persiste y se acumula** entre intentos, con un tope del 90 %. Se pierde el mismo coste base en población que en la victoria; el castigo por perder es que la amenaza sigue ahí.

El menú de interacción muestra la probabilidad estimada de victoria y el coste en población antes de atacar, para que el jugador pueda decidir si le conviene reforzarse antes, o incluso demoler algo para liberar trabajadores.

## 11. Objetivos y misiones

- Cada escenario define **un objetivo principal único y claro**, que puede exigir mantener una condición durante varios días. Por ejemplo: tener 25 de población total durante 3 días.
- El objetivo condiciona la estrategia y, con ella, la rama del árbol que interesa desarrollar.
- Cumplirlo termina la partida con éxito y otorga una recompensa permanente para el mapa de campaña de la Fase 2.
- Entre 8 y 10 **misiones intermedias** definidas en YAML, en escalones explícitos (por ejemplo alcanzar 10, 25 y 50 de población), que se cumplen una sola vez y recompensan sobre todo con Ciencia. Son la principal fuente de Ciencia temprana.
- **Única condición de derrota:** que la población total llegue a 0. No hay límite de días.

## 12. Poblados, misterios y puzzles

Los poblados y los misterios plantean **puzzles de lógica**. El jugador elige una respuesta entre varias: acertar da la recompensa, fallar aplica la penalización. En los poblados el efecto es permanente; en los misterios es instantáneo.

Los puzzles se definen en YAML con su enunciado, sus opciones, la respuesta correcta y los efectos de acierto y de fallo. Hay dos clases:

- **Fijos:** enunciado y opciones escritos a mano. Se sortean de una bolsa para que no salgan siempre los mismos.
- **Generados:** el enunciado se construye con la semilla de la partida (adivinar un número con pistas, secuencias numéricas, pesadas). Aportan rejugabilidad, que hará falta en la campaña.

### Poblados previstos para la Fase 1

**Los Guardianes del Vado.** Dos guardianes vigilan el paso del río. Uno siempre dice la verdad, el otro siempre miente, y no sabes quién es quién. Solo puedes hacer una pregunta a uno de ellos para averiguar qué sendero cruza. La respuesta correcta es la pregunta indirecta: "si le preguntara al otro guardián qué sendero es el correcto, ¿qué me diría?".

- Acierto: los guardianes se suman a tus filas, +1 de fuerza en todos los combates, permanente.
- Fallo: te cierran el paso, -1 de producción en los hexágonos adyacentes, permanente.

**El Gremio de Tejedores.** Tres tejedores hacen 3 mantas en 3 días. ¿Cuántos tejedores hacen falta para hacer 9 mantas en 9 días? La respuesta es 3, no 9.

- Acierto: abren ruta comercial, +2 de oro por día.
- Fallo: hay que mantenerlos, -1 de comida por día.

**El Pozo Seco.** Los aldeanos tienen dos cántaros, uno de 5 litros y otro de 3, y necesitan medir exactamente 4 litros para reabrir el pozo. Hay que elegir la secuencia de trasvases correcta.

- Acierto: comparten el acuífero, las plantaciones adyacentes producen +1 de comida.
- Fallo: el agua se contamina, la probabilidad diaria de enfermedad sube un 50 %.

### Misterios previstos para la Fase 1

**El Monolito de las Tres Cifras.** Puzzle generado con la semilla: adivinar un número de tres cifras a partir de pistas del tipo "una cifra correcta y bien colocada, otra correcta y mal colocada".

- Acierto: +40 de ciencia.
- Fallo: -3 de población.

**La Balanza del Mercader.** Ocho monedas, una es falsa y pesa menos. ¿Cuál es el número mínimo de pesadas en una balanza de dos platos que garantiza encontrarla? La respuesta es 2.

- Acierto: +50 de oro.
- Fallo: -20 de materiales.

**El Mapa Roto del Cartógrafo.** Puzzle espacial: dado un patrón incompleto de hexágonos, identificar la pieza que falta.

- Acierto: revela 6 hexágonos alrededor, que pasan a estado atenuado.
- Fallo: -1 de población y no se revela nada.

**El Granero Sellado.** Una sucesión grabada en la puerta: 2, 6, 12, 20, 30, ... ¿Qué número sigue? La respuesta es 42, el producto de dos números consecutivos.

- Acierto: +60 de comida.
- Fallo: el grano está podrido, -15 de comida.

## 13. Interfaz

### Información al pasar el ratón

Al situar el puntero sobre un hexágono aparece una ventana con el tipo de terreno, si está explorado, y en caso de estarlo su elemento, su construcción, su nivel y sus efectos. Para una casa muestra el desglose de producción: base según nivel, bonus por casa adyacente, bonus por ciudad adyacente, penalización por amenaza adyacente, penalización por mina o fábrica adyacente, penalización por desierto.

### Menú de interacción

Al pinchar en un hexágono aparece un menú cuyo contenido depende de la casilla:

- Prado con una vaca: no ofrece construir, ofrece recolectar y, con Ganadería, construir granja.
- Desierto vacío: ofrece construir, y el submenú no incluye plantación.
- Océano con peces: solo ofrece algo si se tiene Navegación costera.
- Bosque: ofrece talar. El aserradero se construye en una casilla vacía adyacente.
- Edificio propio: ofrece mejorar de nivel, con el coste y la nueva producción, y demoler.
- Casilla con amenaza: ofrece atacar, mostrando probabilidad de victoria y coste en población.
- Casilla atenuada: ofrece explorar, mostrando el coste en días y población.

### Barra de recursos

Muestra población libre y población total por separado, además de comida, materiales, ciencia y oro, con la variación prevista por día.

### Pantallas

Mapa, barra de recursos, panel de objetivos y misiones, árbol de tecnologías, registro de eventos, menú de construcción, ventana de puzzle, y menú principal con selección de escenario y semilla.

El árbol de tecnologías se dibuja como una estrella de cinco ramas y tiene que seguir siendo legible al crecer, porque la campaña lo alargará.

### Teclado

Flechas para moverse entre hexágonos, Enter abre el menú del hexágono, Espacio pausa y reanuda, 1 y 2 para velocidad normal y rápida, Esc cierra menús, Tab salta entre paneles.

## 14. Animaciones

Gráficos sencillos con pequeñas animaciones en bucle y pocas variaciones: las ventanas de las casas se encienden y se apagan, las fábricas echan humo, las vacas levantan y bajan la cabeza, el fuego se mueve. Los efectos positivos y negativos tienen reflejo visual. Cada nivel de un edificio tiene su propio aspecto. Los 5 fragmentos del día se aprovechan para animar el progreso de las obras: cimientos, muros a medio hacer, sin techo, terminada.

## 15. Formato de datos

Terrenos, elementos, construcciones, tecnologías, puzzles, misiones, escenarios y parámetros de generación se definen en YAML. Ampliar el juego con un elemento, una construcción, un nivel o una rama de tecnología nueva no debe requerir tocar código.

### Construcciones con niveles

`employs` es el total de trabajadores de ese nivel, no el incremento: al mejorar solo hay que aportar la diferencia.

```yaml
constructions:
  - id: "casa"
    name: "Casa"
    allowed_terrains: ["prado", "tundra", "desierto", "no_fertil"]
    terrain_modifiers:
      desierto: 0.5
    adjacency_modifiers:
      - target: "casa"
        effect: "poblacion"
        value: 1
      - target: "ciudad"
        effect: "poblacion"
        value: 1
      - target_type: "amenaza"
        effect: "poblacion"
        value: -1
      - target_type: "industria"
        effect: "poblacion"
        value: -1
    levels:
      - level: 1
        name: "Refugio"
        build_time: 1
        cost:
          comida: 10
        employs: 0
        requires_tech: []
        production_per_day:
          poblacion: 1
      - level: 2
        name: "Casa de adobe"
        build_time: 2
        cost:
          comida: 20
          materiales: 15
        employs: 1
        requires_tech: ["casas_adobe"]
        production_per_day:
          poblacion: 2
          oro: 1
      - level: 3
        name: "Casa de piedra"
        build_time: 4
        cost:
          comida: 30
          materiales: 40
          oro: 20
        employs: 2
        requires_tech: ["casas_piedra"]
        production_per_day:
          poblacion: 3
          oro: 2
      - level: 4
        name: "Casa señorial"
        build_time: 6
        cost:
          comida: 40
          materiales: 90
          oro: 60
        employs: 3
        requires_tech: ["casas_senoriales"]
        production_per_day:
          poblacion: 4
          oro: 4

  - id: "centro_estudios"
    name: "Centro de estudios"
    allowed_terrains: ["prado", "tundra", "desierto", "no_fertil"]
    levels:
      - level: 1
        name: "Monasterio"
        build_time: 3
        cost:
          materiales: 25
        employs: 2
        requires_tech: ["escritura"]
        production_per_day:
          ciencia: 2
      - level: 2
        name: "Escuela"
        build_time: 4
        cost:
          materiales: 50
          oro: 20
        employs: 4
        requires_tech: ["ensenanza"]
        production_per_day:
          ciencia: 4
      - level: 3
        name: "Gremio"
        build_time: 5
        cost:
          materiales: 90
          oro: 50
        employs: 6
        requires_tech: ["gremios"]
        production_per_day:
          ciencia: 7
      - level: 4
        name: "Universidad"
        build_time: 7
        cost:
          materiales: 150
          oro: 120
        employs: 9
        requires_tech: ["academia"]
        production_per_day:
          ciencia: 11

  - id: "aserradero"
    name: "Aserradero"
    allowed_terrains: ["prado", "tundra", "desierto", "no_fertil"]
    requires_adjacent_element: "bosque"   # al menos uno
    levels:
      - level: 1
        build_time: 3
        cost:
          materiales: 15
        employs: 2
        requires_tech: ["carpinteria"]
        production_per_adjacent:
          element: "bosque"
          materiales: 2
      - level: 2
        build_time: 5
        cost:
          materiales: 45
          oro: 20
        employs: 4
        requires_tech: ["ingenieria"]
        production_per_adjacent:
          element: "bosque"
          materiales: 4

  - id: "fabrica"
    name: "Fábrica de herramientas"
    description: "Transforma materiales en oro."
    allowed_terrains: ["prado", "tundra", "desierto", "no_fertil"]
    terrain_modifiers:
      no_fertil: 1.25
    levels:
      - level: 1
        build_time: 4
        cost:
          materiales: 40
        employs: 4
        requires_tech: ["metalurgia"]
        consumes_per_day:
          materiales: 4
        production_per_day:
          oro: 3
      - level: 2
        build_time: 6
        cost:
          materiales: 90
          oro: 40
        employs: 7
        requires_tech: ["ingenieria"]
        consumes_per_day:
          materiales: 7
        production_per_day:
          oro: 6
    # si un día faltan insumos, no produce nada ese día

  - id: "torre"
    name: "Torre de defensa"
    description: "Los arqueros que la guarnecen impiden la expansión enemiga. No aporta fuerza de combate."
    allowed_terrains: ["prado", "tundra", "desierto", "no_fertil"]
    levels:
      - level: 1
        name: "Torre de vigía"
        build_time: 3
        cost:
          materiales: 30
        employs: 2            # los arqueros encerrados dentro
        requires_tech: ["vigias"]
        production_per_day: {}
        blocks_expansion_radius: 1
      - level: 2
        name: "Fortaleza"
        build_time: 6
        cost:
          materiales: 80
          oro: 40
        employs: 4
        requires_tech: ["fortificaciones"]
        production_per_day: {}
        blocks_expansion_radius: 2
```

### Acciones genéricas

```yaml
actions:
  - id: "mejorar"
    name: "Mejorar de nivel"
    # coste, tiempo y trabajadores salen del nivel destino
    produce_durante_mejora: true        # configurable, sobrescribible por construcción
  - id: "demoler"
    name: "Demoler"
    time: 1
    returns_employed_population: 1.0    # los trabajadores vuelven todos
    returns_materials_ratio: 0.5        # se recupera la mitad de los materiales
```

### Elementos del mapa

```yaml
map_elements:
  - id: "vaca"
    name: "Rebaño de vacas"
    description: "Se puede recolectar una vez o explotar con una granja."
    allowed_terrains: ["prado"]
    production_per_day: {}      # los elementos no producen por sí mismos
    actions:
      - id: "recolectar"
        name: "Recolectar"
        time: 1
        cost:
          poblacion: 1          # consumo, no vuelve
        reward_instant:
          comida: 15
        consumes_element: true
      - id: "construir_granja"
        name: "Construir granja"
        time: 2
        requires_tech: ["ganaderia"]
        employs: 2
        transforms_into_construction: "granja"
        construction_production_per_day:
          comida: 3
          materiales: 2

  - id: "bosque"
    name: "Bosque"
    description: "Materia prima. Necesita un aserradero adyacente para producir."
    allowed_terrains: ["prado", "tundra", "no_fertil"]
    production_per_day: {}
    actions:
      - id: "talar"
        name: "Talar"
        time: 1
        cost:
          poblacion: 1
        reward_instant:
          materiales: 10
        consumes_element: true

  - id: "lobos"
    name: "Manada de lobos"
    description: "Animales peligrosos. Reducen la población cercana."
    type: "amenaza_animal"
    allowed_terrains: ["prado", "tundra"]
    level: 1
    passive_effects:
      - radius: 1
        effect: "poblacion"
        value: -1
    combat:
      coste_base_poblacion: 3
      reward_instant:
        materiales: 5
    respawn:
      dias_reaparicion: 12

  - id: "barbaros"
    name: "Campamento bárbaro"
    description: "Amenaza humana. Reduce la producción cercana y se expande."
    type: "amenaza_humana"
    allowed_terrains: ["prado", "tundra", "desierto", "no_fertil"]
    level: 1
    passive_effects:
      - radius: 1
        effect: "produccion"
        value: -1
    expansion:
      dias_expansion: 10
      dias_expansion_con_construccion: 20
      sube_nivel_cada: 20
    combat:
      coste_base_poblacion: 5
      reward_instant:
        oro: 10
```

### Tecnologías

Cada tecnología declara su rama y su nivel. Ni el número de ramas ni la profundidad están fijados en el código.

```yaml
technologies:
  - id: "ganaderia"
    name: "Ganadería"
    description: "Permite construir granjas sobre animales domésticos."
    branch: "alimentacion"
    tier: 1
    research_time: 3
    cost:
      ciencia: 20
    dependencies: []
    unlocks:
      constructions: ["granja:1"]

  - id: "regadio"
    name: "Regadío"
    description: "Permite mejorar las plantaciones a nivel 2."
    branch: "alimentacion"
    tier: 2
    research_time: 4
    cost:
      ciencia: 45
    dependencies: ["ganaderia"]
    unlocks:
      constructions: ["plantacion:2"]

  - id: "vigias"
    name: "Vigías"
    description: "Adiestra arqueros y permite levantar torres de vigía."
    branch: "ejercito"
    tier: 3
    research_time: 6
    cost:
      ciencia: 80
    dependencies: ["armas_bronce"]
    unlocks:
      constructions: ["torre:1"]

  - id: "armas_hierro"
    name: "Armas de hierro"
    description: "Mejora el armamento. Sustituye el bonus del bronce."
    branch: "ejercito"
    tier: 4
    research_time: 7
    cost:
      ciencia: 130
    dependencies: ["vigias"]
    global_effects:
      - effect: "combate"
        value: 4
        replaces: "armas_bronce"

  - id: "estrategia"
    name: "Estrategia"
    description: "Reduce a la mitad el coste en población de los combates."
    branch: "ejercito"
    tier: 6
    research_time: 10
    cost:
      ciencia: 300
    dependencies: ["fortificaciones"]
    global_effects:
      - effect: "coste_poblacion_combate"
        multiplier: 0.5
```

### Puzzles

```yaml
puzzles:
  - id: "poblado_guardianes"
    kind: "poblado"
    mode: "fijo"
    name: "Los Guardianes del Vado"
    text: >
      Dos guardianes vigilan el paso del río. Uno dice siempre la verdad y el
      otro miente siempre, pero no sabes quién es quién. Solo puedes hacer una
      pregunta a uno de ellos para descubrir qué sendero cruza el vado.
    options:
      - text: "¿Cuál es el sendero correcto?"
        correct: false
      - text: "Si le preguntara al otro guardián cuál es el sendero correcto, ¿qué me diría?"
        correct: true
      - text: "¿Eres tú el que dice la verdad?"
        correct: false
    on_success:
      global_effects:
        - effect: "combate"
          value: 1
    on_failure:
      permanent_effects:
        - radius: 1
          effect: "produccion"
          value: -1

  - id: "misterio_monolito"
    kind: "misterio"
    mode: "generado"
    generator: "adivina_numero"
    params:
      digitos: 3
      pistas: 3
      opciones: 4
    on_success:
      instant:
        ciencia: 40
    on_failure:
      instant:
        poblacion: -3
```

### Escenario y misiones

```yaml
scenario:
  id: "valle_inicial"
  name: "El valle inicial"
  map:
    radius: 8
    seed: 12345
    terrain_weights:
      prado: 30
      tundra: 20
      desierto: 15
      no_fertil: 15
      oceano: 20
    element_density:
      montana: 0.10
      bosque: 0.15
      animal_domestico: 0.08
      amenaza_animal: 0.10
      amenaza_humana: 0.03
      poblado: 0.02
      misterio: 0.03
    constraints:
      prados_adyacentes_a_ciudad_minimo: 1
      porcentaje_prado_minimo: 20
      montanas_minimas: 8
      bosques_minimos: 10
      amenazas_maximas: 14
      distancia_minima_amenaza_humana: 4
      nivel_amenaza_por_anillo: 0.5
  starting_resources:
    poblacion: 5
    comida: 30
    materiales: 10
    ciencia: 0
    oro: 0
  main_objective:
    description: "Mantener 25 de población durante 3 días."
    condition:
      resource: "poblacion_total"
      amount: 25
      sustained_days: 3
  missions:
    - id: "poblacion_10"
      description: "Alcanza 10 de población."
      condition:
        resource: "poblacion_total"
        amount: 10
      reward:
        ciencia: 20
    - id: "explorar_6"
      description: "Explora 6 hexágonos."
      condition:
        explored_hexes: 6
      reward:
        ciencia: 25
```

### Reglas globales

```yaml
rules:
  day:
    fragments: 5
    seconds_normal: 6
    seconds_fast: 3
  food:
    consumo_por_poblacion: 0.5
    poblacion_perdida_por_hambre: 1
  disease:
    probabilidad_base_diaria: 0.02
    incremento_por_poblacion: 0.001
  exploration:
    tiempo_base: 1
    dias_por_distancia: 3
    poblacion_por_distancia: 1
  combat:
    dado: 6
    dano_por_punto_dado: 0.1
    dano_maximo_acumulado: 0.9
  research:
    coste_por_nivel: [20, 45, 80, 130, 200, 300]
  upgrades:
    produce_durante_mejora: true        # valor por defecto de todas las construcciones
  demolition:
    time: 1
    returns_employed_population: 1.0
    returns_materials_ratio: 0.5
  balance:
    amortizacion_minima_dias: 10   # objetivo de diseño para las mejoras de nivel
```

## 16. Fase 2: la campaña

Fuera del alcance de esta especificación. Se recoge aquí para no perder el contexto, y porque explica por qué el árbol de tecnologías nace con seis niveles por rama.

- Modo de progresión a largo plazo que encadena múltiples partidas del juego base.
- El mapa global se divide en Regiones, y cada Región en Provincias.
- Cada Provincia es el mapa hexagonal de una partida del juego base, con condiciones iniciales fijas (por ejemplo terreno mayoritariamente desértico, alta presencia de montañas).
- Completar los objetivos de una Provincia otorga su control y genera recursos pasivos en el mapa de campaña.
- Para desbloquear nuevas Regiones hay que completar las Provincias adyacentes.
- **Las tecnologías investigadas se conservan de una partida a la siguiente.** Por eso el árbol es más profundo de lo que una sola partida puede recorrer: en la campaña los enemigos serán mejores y los retos mayores, pero se llega con lo aprendido.
- Las recompensas permanentes obtenidas al ganar partidas del juego base se aplican aquí.

## 17. Pendiente de decidir

- Si conviene que los edificios sigan produciendo durante las obras de mejora. Queda como interruptor en YAML, activado por defecto, para poder probarlo de las dos formas y decidir jugando.
- Valores concretos de balance, incluido el porcentaje de materiales que devuelve una demolición: son provisionales y se ajustarán jugando.
- División de Materiales en tipos (madera, mineral), aplazada más allá de la Fase 1.
- Si en la Fase 2 la profundidad de las ramas crece más allá de seis niveles.
