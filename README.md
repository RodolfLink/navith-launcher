# NavithLabs Launcher

Launcher y portal de eventos privados de NavithLabs. La consola web y su API independientes viven en `navithlabs-web`; LauncherLinkyWeb solo se usó como referencia del formato de eventos y el flujo de códigos.

## Tecnología

- React 19, TypeScript y Vite 7
- Tauri 2 y Rust

## Experiencia actual

- Acceso con Microsoft, Discord, Google o nombre offline.
- Canje de códigos privados mediante la API propia de NavithLabs.
- Instalación de paquetes, configuraciones y mods del evento, con soporte Vanilla, Fabric, Forge, NeoForge y Quilt.
- Inicio de Minecraft con progreso y descarga de componentes bajo demanda.
- Ajuste de memoria y perfiles separados por evento.
- Ventanas personalizadas, transiciones ligeras y render animado con los PNG oficiales de navith.labs.

La interfaz no muestra onboarding ni tutoriales. Las funciones que dependían de pantallas del launcher anterior no están enlazadas en esta experiencia.

## Desarrollo

Instala Node.js, Rust y las dependencias de compilación de Tauri para tu plataforma. Desde la carpeta del proyecto:

```powershell
npm install
npm run dev
npm run build
npm run tauri dev
npm run tauri build
```

La API independiente de NavithLabs debe estar disponible en `http://127.0.0.1:8001` durante el desarrollo local. Para compilar una versión distribuible, define `VITE_NAVITHLABS_API_BASE_URL` con la URL pública del backend propio antes de `npm run tauri build`. El actualizador está apagado hasta que NavithLabs configure su clave pública, endpoint y artefactos firmados. Mantén `VITE_NAVITHLABS_UPDATER_ENABLED=false` hasta entonces.

## Portal web independiente

LinkyWeb no es el sitio de NavithLabs y no se modifica. La nueva consola se desarrolla en `navithlabs-web`; su API local usa SQLite propio en `navithlabs-web/backend/storage` y escucha en el puerto `8001`. En el servidor, el backend acepta `DATABASE_URL` para conectar con PostgreSQL/Neon; las tablas se inicializan automáticamente y su migración está en `navithlabs-web/database/migrations/0001_initial.sql`.

```powershell
cd navithlabs-web
& "C:\wamp64\bin\php\php8.2.29\php.exe" -S 127.0.0.1:8001 -t backend/public backend/public/index.php
npm run dev
```

Abre `http://127.0.0.1:5173`. En el primer acceso podrás crear el administrador de esta consola. El puerto `8000` pertenece al proyecto LinkyWeb de referencia y no forma parte del portal nuevo.
