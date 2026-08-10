/**
 * Punto de entrada de la aplicación.
 *
 * De momento solo verifica que el andamiaje de Vite + TypeScript funciona.
 * El arranque real (carga de datos, generación de mapa, bucle de render) se
 * implementa en tareas posteriores.
 */
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');

if (canvas === null) {
  throw new Error('No se ha encontrado el elemento canvas #game-canvas');
}

const ctx = canvas.getContext('2d');

if (ctx === null) {
  throw new Error('El navegador no soporta el contexto de render 2D');
}

ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#1b1b1f';
ctx.fillRect(0, 0, canvas.width, canvas.height);
