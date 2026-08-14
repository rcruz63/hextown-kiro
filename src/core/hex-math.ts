/**
 * Matemáticas de coordenadas hexagonales.
 *
 * El mapa usa hexágonos de punta arriba (pointy-top) identificados por
 * coordenadas axiales `(q, r)`; la tercera coordenada cúbica `s = -q - r` es
 * implícita. Todas las funciones de este módulo son puras y deterministas: el
 * orden de los resultados depende únicamente de los argumentos, nunca del
 * estado de la partida ni del generador de números aleatorios.
 *
 * Requisitos: 1.1 (mapa de hexágonos de punta arriba con radio dado),
 * 2.9 (adyacencia de hexágonos para los invariantes de visibilidad).
 */

/** Coordenada axial pointy-top. La tercera coordenada `s = -q - r` es implícita. */
export interface AxialCoord {
  q: number;
  r: number;
}

/** Coordenada en píxeles del centro de un hexágono dentro del lienzo. */
export interface PixelCoord {
  x: number;
  y: number;
}

/**
 * Vectores de desplazamiento a los seis vecinos de un hexágono pointy-top,
 * en orden fijo: E, NE, NW, W, SW, SE.
 *
 * El orden es parte del contrato del módulo: `hexNeighbors` lo respeta y el
 * control por teclado asocia cada flecha a una de estas direcciones.
 */
export const DIRECTIONS = [
  { q: 1, r: 0 }, // E
  { q: 1, r: -1 }, // NE
  { q: 0, r: -1 }, // NW
  { q: -1, r: 0 }, // W
  { q: -1, r: 1 }, // SW
  { q: 0, r: 1 }, // SE
] as const satisfies readonly AxialCoord[];

/**
 * Direcciones de recorrido de un anillo, rotadas dos posiciones respecto a
 * `DIRECTIONS`.
 *
 * Para cualquier `k` se cumple `DIRECTIONS[k] + DIRECTIONS[k + 2] =
 * DIRECTIONS[k + 1]` (índices módulo 6). Por tanto, partiendo de la esquina
 * `centro + DIRECTIONS[k] × radio` y avanzando `radio` pasos en la dirección
 * `DIRECTIONS[k + 2]` se llega exactamente a la siguiente esquina del anillo.
 */
const WALK_DIRECTIONS: readonly AxialCoord[] = [
  ...DIRECTIONS.slice(2),
  ...DIRECTIONS.slice(0, 2),
];

/** Razón entre la anchura y el tamaño del hexágono pointy-top. */
const SQRT3 = Math.sqrt(3);

/** Suma de dos coordenadas axiales. */
function hexAdd(a: AxialCoord, b: AxialCoord): AxialCoord {
  return { q: a.q + b.q, r: a.r + b.r };
}

/** Producto de una coordenada axial por un escalar. */
function hexScale(a: AxialCoord, factor: number): AxialCoord {
  return { q: a.q * factor, r: a.r * factor };
}

/** Rechaza radios que no sean enteros no negativos (error de programación). */
function assertRadius(radius: number, fnName: string): void {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new RangeError(
      `${fnName}: el radio debe ser un entero mayor o igual que 0, recibido ${radius}`,
    );
  }
}

/**
 * Clave canónica de una coordenada, `` `${q},${r}` ``.
 *
 * Es el índice de `HexMap.cells` y la clave con la que el guardado referencia
 * cada hexágono, por lo que su formato es parte del contrato del mapa.
 */
export function hexKey(coord: AxialCoord): string {
  return `${String(coord.q)},${String(coord.r)}`;
}

/**
 * Distancia hexagonal entre dos celdas: número de hexágonos del camino más
 * corto que las une.
 */
export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  return (
    (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2
  );
}

/**
 * Los seis hexágonos adyacentes a `coord`, en el orden de `DIRECTIONS`
 * (E, NE, NW, W, SW, SE).
 *
 * No comprueba los límites del mapa: puede devolver coordenadas fuera del
 * radio del mapa, y es quien llama el responsable de filtrarlas.
 */
export function hexNeighbors(coord: AxialCoord): AxialCoord[] {
  return DIRECTIONS.map((direction) => hexAdd(coord, direction));
}

/**
 * Hexágonos situados exactamente a distancia `radius` de `center`.
 *
 * El anillo empieza en la esquina Este (`centro + E × radio`) y se recorre
 * pasando por las esquinas NE, NW, W, SW y SE, de forma que dos elementos
 * consecutivos del resultado siempre son adyacentes. Un radio 0 devuelve solo
 * el centro. Devuelve `6 × radius` hexágonos para `radius ≥ 1`.
 */
export function hexRing(center: AxialCoord, radius: number): AxialCoord[] {
  assertRadius(radius, 'hexRing');

  if (radius === 0) {
    return [{ q: center.q, r: center.r }];
  }

  const ring: AxialCoord[] = [];
  let hex = hexAdd(center, hexScale(DIRECTIONS[0], radius));

  for (const direction of WALK_DIRECTIONS) {
    for (let step = 0; step < radius; step += 1) {
      ring.push(hex);
      hex = hexAdd(hex, direction);
    }
  }

  return ring;
}

/**
 * Todos los hexágonos a distancia menor o igual que `radius` de `center`,
 * ordenados en espiral: primero el centro y después cada anillo completo de
 * radio creciente, en el orden que produce `hexRing`.
 *
 * Este orden es el recorrido canónico del mapa: el Generador_De_Mapa lo usa
 * para crear las celdas, de modo que la misma semilla produce siempre el mismo
 * mapa. Devuelve `1 + 3 × radius × (radius + 1)` hexágonos.
 */
export function hexSpiral(center: AxialCoord, radius: number): AxialCoord[] {
  assertRadius(radius, 'hexSpiral');

  const spiral: AxialCoord[] = [{ q: center.q, r: center.r }];

  for (let ringRadius = 1; ringRadius <= radius; ringRadius += 1) {
    spiral.push(...hexRing(center, ringRadius));
  }

  return spiral;
}

/**
 * Centro en píxeles de un hexágono pointy-top de tamaño `size`, siendo `size`
 * la distancia del centro a cualquier vértice (circunradio).
 *
 * El hexágono `(0, 0)` queda en el origen; la cámara aplica después su propio
 * desplazamiento y escala.
 */
export function hexToPixel(coord: AxialCoord, size: number): PixelCoord {
  return {
    x: size * (SQRT3 * coord.q + (SQRT3 / 2) * coord.r),
    y: size * (3 / 2) * coord.r,
  };
}
