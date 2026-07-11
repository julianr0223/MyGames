# 🎮 STOP — Basta / Tutti Frutti multijugador

Juego de "Stop" (también llamado **Basta** o **Tutti Frutti**) para jugar en
grupo, **cada quien desde el navegador de su celular**. Un servidor ligero
corre en tu **homelab** y coordina en tiempo real las salas, jugadores, la
letra de cada ronda, el botón de **¡STOP!** y el puntaje.

No hace falta instalar ninguna app: los jugadores solo abren una URL.

---

## ¿Cómo se juega?

1. El **anfitrión** crea una sala y comparte el **código de 4 letras**.
2. Cada jugador entra desde su celular con ese código y su nombre.
3. El anfitrión ajusta las **categorías** (secciones), cantidad de rondas y
   el tiempo, y pulsa **Empezar**.
4. Cada ronda sale una **letra al azar**. Todos rellenan las categorías con
   palabras que empiecen con esa letra, lo más rápido posible.
5. El primero que termina aprieta **¡STOP!** → se cierra la ronda para todos
   (con un pequeño margen de gracia).
6. **Puntaje** por categoría:
   - `100` respuesta válida y **única**.
   - `50` respuesta válida pero **repetida** con otro jugador.
   - `0` vacía o que no empieza con la letra.
7. Se juegan varias rondas y gana quien acumule más puntos. 🏆

Las tildes no importan (Árbol = arbol) y las comparaciones ignoran mayúsculas.

---

## 🚀 Instalación en el homelab (Docker Compose — recomendado)

Requisitos: `docker` y `docker compose` en tu servidor del homelab.

```bash
# 1. Clona el repo (o copia la carpeta stop-game/ a tu homelab)
git clone <tu-repo> && cd MyGames/stop-game

# 2. Construye y levanta el contenedor
docker compose up -d --build

# 3. Verifica que quedó arriba
docker compose ps
curl http://localhost:3000/health   # -> {"ok":true,"rooms":0}
```

Eso es todo. El servidor queda escuchando en el puerto **3000**.

### Para que jueguen desde el celular

Los celulares deben poder llegar a tu homelab. Opciones:

- **Misma red WiFi (LAN):** los jugadores abren
  `http://IP_DE_TU_HOMELAB:3000` (ej. `http://192.168.1.50:3000`).
  Averigua la IP con `ip a` o `hostname -I`.
- **Reverse proxy con dominio/HTTPS** (Nginx Proxy Manager, Traefik, Caddy):
  apunta un subdominio a `stop-game:3000`. Ideal si ya tienes un stack de
  homelab. Ejemplo con Caddy:

  ```
  stop.midominio.com {
      reverse_proxy stop-game:3000
  }
  ```

- **Fuera de casa:** exponer con Cloudflare Tunnel, Tailscale o similar
  (recomendado sobre abrir puertos en el router).

> El juego usa **WebSockets** (Socket.IO). Si pones un reverse proxy,
> asegúrate de permitir el upgrade a WebSocket (Nginx Proxy Manager y Caddy
> lo hacen solos; en Nginx manual añade los headers `Upgrade`/`Connection`).

### Comandos útiles

```bash
docker compose logs -f        # ver logs en vivo
docker compose restart        # reiniciar
docker compose down           # detener y quitar
docker compose up -d --build  # aplicar cambios de código
```

### Cambiar el puerto

Edita el mapeo en `docker-compose.yml` (izquierda = puerto del host):

```yaml
ports:
  - "8080:3000"   # ahora se accede por http://IP:8080
```

---

## 🛠️ Ejecutar sin Docker (desarrollo)

```bash
cd server
npm install
npm start          # o: npm run dev  (recarga automática)
# abre http://localhost:3000
```

---

## 🧩 Estructura del proyecto

```
stop-game/
├── docker-compose.yml     # orquestación para el homelab
├── Dockerfile             # imagen del servidor
├── README.md
└── server/
    ├── package.json
    ├── server.js          # Express + Socket.IO: salas, rondas, coordinación
    ├── game.js            # lógica pura del juego (letras, validación, puntaje)
    └── public/            # frontend mobile-first (se sirve estático)
        ├── index.html
        ├── styles.css
        └── app.js
```

**Cómo coordina las "secciones":** el servidor mantiene en memoria cada sala
con sus jugadores, la letra de la ronda y las respuestas. Los celulares se
conectan por WebSocket; cuando alguien aprieta STOP el servidor sincroniza a
todos, recoge las respuestas, calcula el puntaje y difunde los resultados.
Como es estado en memoria, si reinicias el contenedor las partidas en curso
se pierden (las salas vacías también se limpian solas al minuto).

---

## ⚙️ Personalización

- **Categorías por defecto y pool de letras:** `server/game.js`
  (`DEFAULT_CATEGORIES`, `DEFAULT_LETTERS`, `DEFAULT_SETTINGS`).
  Por defecto se excluyen letras difíciles en español (K, Ñ, Q, W, X, Y, Z).
- **Categorías por partida:** el anfitrión las edita en la sala antes de
  empezar (una por línea), junto con el número de rondas y el tiempo.
- **Puntajes:** constantes al inicio de `server/game.js`.
