# Notas de la Versión - Linky Launcher v0.2.5

## 🚀 Novedades y Reworks Principales

### 🌐 Rework Deluxe de Servidores
- **HUD de Especificaciones:** Versión, Loader (NeoForge/Forge/Fabric), Mods, Java y estado de IP.
- **Radar de Estado en Vivo:** Monitorización en tiempo real del estado del servidor, ping y conteo de jugadores.
- **Acceso 1-Clic:** Botón para copiar IP del servidor al portapapeles con feedback instantáneo.

### 📥 Gestor de Descargas y Extracción Universal
- **Descargas Fluidas en Chunks:** Descarga directa a disco con indicador de progreso real en MB y sin picos de RAM.
- **Soporte Universal RAR / ZIP:** Extracción tolerante a fallos para archivos RAR 5 (MediaFire) y ZIP mediante detección por Magic Bytes.
- **Pre-descarga Completa:** Java, client.jar, librerías Vanilla de Mojang y modloaders se descargan en segundo plano antes de habilitar el botón **JUGAR**.

### ⚡ Rendimiento y Optimización de Recursos
- **Ahorro de GPU en WebView2:** Optimización de búferes gráficos en el fondo 3D galáctico y auto-pausa inteligente al minimizar o desenfocar el launcher.
- **Flags de Optimización Windows:** Reducción de subprocesos y consumo de memoria base en Microsoft Edge WebView2.
- **Pausa Persistente de Música:** El reproductor integrado de YouTube se pausa de forma continua durante la partida y se reanuda automáticamente al salir o detectar un crash.

### 📄 Diagnóstico Avanzado
- **Visor de Logs en Crash:** Botón directo para inspeccionar `latest.log` de la instancia y botón de acceso a la carpeta de la instancia.
