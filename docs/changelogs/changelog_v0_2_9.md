v0.2.9 — 16 de octubre de 2026

Fixed:
-Optimización Masiva de Rendimiento en Visores 3D: Implementación de detección de visibilidad con IntersectionObserver en el visor de skins y capas 3D. El renderizado y bucle de Three.js ahora se pausan y liberan automáticamente de la GPU cuando no están en pantalla o cuando la ventana pasa a segundo plano, reduciendo drásticamente el consumo de CPU y memoria.
-Resolución y Búsqueda de Skins de Jugadores: Nuevo comando backend nativo `lookup_minecraft_skin` con fallback inteligente que resuelve perfiles oficiales de Mojang y Ashcon, detectando correctamente el modelo (Classic/Slim) y evitando fallos al cambiar de aspecto.
-Escaneo Ultrarrápido de Addons Instalados: Nuevo inventario ligero en disco (`list_instance_addon_inventory`) que detecta insignias de mods, shaders y resource packs instalados al instante sin necesidad de descomprimir ni procesar metadatos pesados de cada archivo JAR.
-Corrección en Detección y Creación de Instalaciones: Eliminados cuellos de botella y errores al escanear, sincronizar perfiles y guardar directorios de instancias.

Added:
-Rediseño Completo del Asistente de Configuración Inicial (Tutorial): Renovación visual completa del modal de bienvenida con medidor dinámico de asignación de memoria RAM sobre el total detectado del equipo, presets rápidos e integración armoniosa de las tarjetas de temas.
-Visor de Skins y Capas 3D Totalmente Renovado: Controles interactivos mejorados, sincronización de animaciones fluidas (caminar, correr, volar, reposo), gestión de capas exteriores y vista estática optimizada para avatares y tarjetas.
-Rework Integral del Apartado de Ajustes y Temas: Armonización de contraste y paletas de colores neón/obsidiana en todos los temas del sistema, con compatibilidad visual perfeccionada en modales, barras laterales y fondos interactivos (GalaxyBackground).
-Nuevo Modal de Novedades y Anuncios (`AnnouncementModal`): Ventana flotante desacoplada y estilizada con temática reactiva a cada tema, navegación entre anuncios, soporte para formato enriquecido y cierre accesible.
-Reproductor de Música y Dropdown de Descargas Rediseñados: Nueva interfaz más limpia y responsiva para controlar música ambiente y monitorear descargas simultáneas en tiempo real.
-Sincronización Global v0.2.9: Actualización integral de manifiestos, pantalla de carga y componentes principales.
