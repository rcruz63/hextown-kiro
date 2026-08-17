/**
 * Gestor_De_Visibilidad: asigna el estado de visibilidad inicial de cada
 * hexágono y aplica sus transiciones (Requisitos 2.1, 2.2, 2.8, 2.9, 2.10,
 * 2.11).
 *
 * Decisiones de diseño:
 *
 * - La API opera sobre `HexMap` y no sobre `GameState`, porque la visibilidad
 *   solo vive en `HexMap.cells`. Así el módulo sirve también al arranque, que
 *   inicializa el mapa recién generado antes de que exista un `GameState`. El
 *   diseño declaraba `revealHex(state, hex): GameState`; quien llama compone el
 *   estado nuevo con `{ ...state, map }`, que es una operación trivial.
 * - `revealHex` es el único punto de entrada de las transiciones de una partida
 *   en curso y exige que el hexágono esté atenuado. Por eso no se expone el
 *   `attenuateNeighbors` del diseño: atenuar los vecinos de un hexágono que no
 *   está explorado dejaría hexágonos atenuados sin ningún vecino explorado e
 *   incumpliría el Requisito 2.9.
 * - La visibilidad nunca retrocede: todo cambio pasa por `advance`, que descarta
 *   cualquier estado que no avance en el orden oculto < atenuado < explorado
 *   (Requisitos 2.8, 2.10).
 * - Las distancias 1 y 2 de la visibilidad inicial no son parámetros de balance:
 *   las fija el enunciado del Requisito 2.2, como el hexágono `(0, 0)` de la
 *   Ciudad fija el Requisito 1.2. No salen de `data/`.
 * - El hexágono de la Ciudad se recibe como argumento en lugar de importarse:
 *   este módulo no tiene por qué saber dónde está la Ciudad, y así no depende
 *   del Generador_De_Mapa.
 * - Las dos funciones tratan de forma distinta la coordenada que no pertenece
 *   al mapa, y es deliberado. `initializeVisibility` lanza `RangeError` porque
 *   la Ciudad la fija el Generador_De_Mapa en `(0, 0)` y siempre existe: que no
 *   esté solo puede ser un error de programación de quien compone el arranque.
 *   `revealHex` devuelve `Result` porque su hexágono llega de una acción
 *   programada que puede venir de un guardado, y la capa de datos no lanza.
 *
 * Algoritmo:
 *
 * 1. `initializeVisibility(mapa, ciudad)` recorre el mapa y da a cada hexágono
 *    exactamente un estado según su distancia a la Ciudad (Requisito 2.1):
 *    explorado a distancia 0 y 1, atenuado a distancia 2, oculto el resto
 *    (Requisito 2.2). Como el paso también va por `advance`, sobre el mapa recién
 *    generado —todo `hidden`— esos son los estados resultantes, y sobre un mapa
 *    ya avanzado ninguno retrocede. Los hexágonos que el mapa no contiene no
 *    existen y no reciben estado.
 * 2. `revealHex(mapa, hex)` (design.md, «ExplorarHex»):
 *    a. Rechaza el hexágono que no pertenece al mapa y el que no está atenuado,
 *       de modo que un hexágono explorado conserva su estado (Requisito 2.8) y
 *       no existe la transición oculto → explorado (Requisitos 2.7, 2.10).
 *    b. Marca el hexágono como explorado.
 *    c. Atenúa los vecinos del mapa que estén ocultos, en el orden de
 *       `DIRECTIONS`. Así ningún hexágono oculto queda adyacente a uno
 *       explorado (Requisito 2.11) y todo hexágono atenuado tiene al menos un
 *       vecino explorado (Requisito 2.9).
 *
 * Reparto de responsabilidades: aquí no se calcula el tiempo ni el coste de una
 * exploración, ni se valida la población, ni se programa nada en el reloj; eso
 * es del Sistema_De_Exploracion (Requisito 3), que llama a `revealHex` cuando la
 * exploración se completa (Requisito 3.6). Tampoco se decide qué se dibuja ni
 * qué se muestra en cada estado: eso es del Motor_De_Render (Requisito 2.3) y
 * del Sistema_De_Interfaz (Requisitos 2.4, 2.5, 2.6). La entrada del
 * Registro_De_Eventos por el elemento descubierto la escribe el
 * Sistema_De_Exploracion (Requisito 3.7).
 */
import { hexDistance, hexKey, hexNeighbors } from './hex-math.ts';
import type { AxialCoord } from './hex-math.ts';
import { err, ok } from './result.ts';
import type { GameError, Result } from './result.ts';
import type { HexCell, HexMap, VisibilityState } from './types.ts';

// ---------------------------------------------------------------------------
// Constantes de la visibilidad inicial (Requisito 2.2)
// ---------------------------------------------------------------------------

/** Distancia máxima a la Ciudad de los hexágonos explorados al empezar. */
const INITIAL_EXPLORED_DISTANCE = 1;

/** Distancia máxima a la Ciudad de los hexágonos atenuados al empezar. */
const INITIAL_DIMMED_DISTANCE = 2;

/**
 * Orden de los estados de visibilidad. Solo se admiten cambios que aumenten el
 * rango (Requisitos 2.8, 2.10).
 */
const VISIBILITY_RANK: Record<VisibilityState, number> = {
  hidden: 0,
  dimmed: 1,
  explored: 2,
};

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Estado de visibilidad de un hexágono, o `undefined` si el hexágono no
 * pertenece al mapa.
 */
export function getVisibility(map: HexMap, hex: AxialCoord): VisibilityState | undefined {
  return map.cells.get(hexKey(hex))?.visibility;
}

/**
 * Aplica la visibilidad inicial de la partida: la Ciudad y los hexágonos a
 * distancia 1 explorados, los que están a distancia 2 atenuados y el resto
 * ocultos (Requisito 2.2).
 *
 * Devuelve un mapa nuevo con las celdas que cambian sustituidas; el mapa
 * recibido no se toca. Como todo cambio pasa por `advance`, aplicarla dos veces
 * o sobre un mapa ya avanzado no retrocede ningún estado.
 *
 * @param map Mapa recién entregado por el Generador_De_Mapa, con todos los
 *   hexágonos en `hidden`.
 * @param city Hexágono de la Ciudad, centro del mapa (Requisito 1.2).
 * @throws RangeError Si `city` no es un hexágono del mapa: es un error de
 *   programación, no un dato del jugador.
 */
export function initializeVisibility(map: HexMap, city: AxialCoord): HexMap {
  const cityKey = hexKey(city);
  if (!map.cells.has(cityKey)) {
    throw new RangeError(
      `initializeVisibility: el hexágono ${cityKey} no pertenece al mapa`,
    );
  }

  const cells = new Map<string, HexCell>();
  for (const [key, cell] of map.cells) {
    cells.set(key, advance(cell, initialVisibility(hexDistance(city, cell.coord))));
  }
  return { ...map, cells };
}

/**
 * Marca un hexágono atenuado como explorado y atenúa sus vecinos ocultos
 * (Requisitos 2.9, 2.10, 2.11, 3.6).
 *
 * Devuelve un mapa nuevo; el mapa recibido no se toca. Rechaza el hexágono que
 * no está atenuado en lugar de ignorarlo, para que el Sistema_De_Exploracion
 * pueda informar del motivo (Requisito 2.7).
 *
 * Códigos de error, estables:
 *
 * - `only_dimmed_can_be_explored`: el hexágono está oculto o ya explorado. El
 *   Sistema_De_Interfaz lo resuelve con la clave
 *   `ui.error.only_dimmed_can_be_explored` del catálogo i18n (Requisito 2.7).
 * - `hex_outside_map`: la coordenada no pertenece al mapa. No es un rechazo que
 *   el jugador provoque, sino una incoherencia entre el mapa y la acción
 *   programada, y por eso no tiene clave de interfaz: solo sirve de
 *   diagnóstico.
 */
export function revealHex(map: HexMap, hex: AxialCoord): Result<HexMap> {
  const key = hexKey(hex);
  const cell = map.cells.get(key);
  if (cell === undefined) {
    return err(outsideMapError(hex));
  }
  if (cell.visibility !== 'dimmed') {
    return err(notDimmedError(hex, cell.visibility));
  }

  const cells = new Map(map.cells);
  cells.set(key, advance(cell, 'explored'));

  for (const neighbor of hexNeighbors(hex)) {
    const neighborKey = hexKey(neighbor);
    const neighborCell = cells.get(neighborKey);
    // Los vecinos fuera del mapa no existen y los ya atenuados o explorados no
    // cambian: solo se atenúa lo que está oculto (Requisito 2.11).
    if (neighborCell !== undefined && neighborCell.visibility === 'hidden') {
      cells.set(neighborKey, advance(neighborCell, 'dimmed'));
    }
  }

  return ok({ ...map, cells });
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

/** Estado inicial de un hexágono según su distancia a la Ciudad (Req. 2.2). */
function initialVisibility(distance: number): VisibilityState {
  if (distance <= INITIAL_EXPLORED_DISTANCE) {
    return 'explored';
  }
  if (distance <= INITIAL_DIMMED_DISTANCE) {
    return 'dimmed';
  }
  return 'hidden';
}

/**
 * Celda con el estado `to` si supone un avance, y la celda tal cual si no: la
 * visibilidad nunca retrocede (Requisitos 2.8, 2.10).
 *
 * El único salto de dos posiciones admisible es el de la visibilidad inicial,
 * que asigna estados en lugar de transicionarlos (Requisito 2.2); las
 * transiciones de una partida en curso pasan siempre por `revealHex`, que
 * avanza de una en una.
 */
function advance(cell: HexCell, to: VisibilityState): HexCell {
  return VISIBILITY_RANK[to] > VISIBILITY_RANK[cell.visibility]
    ? { ...cell, visibility: to }
    : cell;
}

/** Error de coordenada que no pertenece al mapa. */
function outsideMapError(hex: AxialCoord): GameError {
  return {
    code: 'hex_outside_map',
    message: `El hexágono (${String(hex.q)}, ${String(hex.r)}) no pertenece al mapa`,
    context: { hex: hexKey(hex) },
  };
}

/** Error de exploración sobre un hexágono que no está atenuado (Req. 2.7). */
function notDimmedError(hex: AxialCoord, visibility: VisibilityState): GameError {
  return {
    code: 'only_dimmed_can_be_explored',
    message:
      `El hexágono (${String(hex.q)}, ${String(hex.r)}) está en estado ${visibility}: ` +
      'solo se exploran hexágonos atenuados',
    context: { hex: hexKey(hex), visibility },
  };
}
