# REWA Bluetooth en Mandatín Oraciones

Adaptación del juego publicado en `oraciones.html`, conservando el ZIP original
(commit `427f5d93b3940d11a70d107b318964f1d81cb303`).
Respaldo: rama `backup/oraciones-before-rewa-20261122`.
No requiere instalar firmware nuevo: usa el protocolo REWA Juego de r54/r55.

## Jugar

1. Abrir la página en Google Chrome en el Mac y activar Bluetooth.
2. En REWA abrir Herramientas → Control de juegos. Cerrar/desconectar otra página
   que esté usando REWA: solo puede tener un cliente Bluetooth activo.
3. En la página pulsar Conectar REWA y elegir REWA Juego.
4. Pulsar Jugar, elegir una oración y pulsar Jugar con REWA.
5. Sujetar el dispositivo cómodamente y pulsar Centrar en la página.
6. Inclinar mueve el cursor. Un toque toma una palabra; otro sobre una casilla
   la suelta. Apuntar a Comprobar y tocar valida. También permite Siguiente.
7. Abrir Control REWA (engranaje) para invertir horizontal o verticalmente.
   Cada preferencia queda guardada en este navegador.

Cámara y mouse/táctil siguen disponibles. Se conserva el banco de oraciones
original en localStorage y la carga de Excel. No se envían datos al servidor.
El reloj se pausa al perder conexión/datos o al ocultar la pestaña.
Tras reconectar se descartan los toques anteriores y se vuelve a centrar.

## Arquitectura y pruebas

GitHub Actions descomprime el ZIP y aplica `rewa-overlay/`. Los otros juegos y
assets quedan sin cambios. La recepción BLE usa notificaciones del último
vector IMU, preservando los flancos de toque en una cola. El cursor avanza en
el mismo requestAnimationFrame del juego, con tiempo delta y zona muerta.
No pasa por Wi-Fi, servidor ni cámara.

`node --test tests/rewa-motion.test.mjs`

Prueba de integración en navegador con paquetes BLE simulados: tomar/soltar,
completar oración, siguiente misión, desconectar, pausa del reloj, reconectar y
suprimir toques retenidos. Pendiente validar sensaciones con hardware real.
La sesión de cámara original no se activa al elegir REWA.

## Volver

Revertir el commit de adaptación en main (git revert) restaura la publicación
anterior. La rama de respaldo conserva todo el repositorio anterior; el ZIP
original permanece sin modificar en main.
