v0.2.8 — 22 de septiembre de 2026

Fixed:
-Borrosidad en Tema KaiyoAsking: Se rediseñó completamente el pentagrama de fondo utilizando vectores de alta definición nítidos y brillantes con los sellos leviatanes visibles, eliminando filtros de desenfoque excesivos que hacían que no se apreciara bien el tema.
-Contraste y Fondos Opacos en Tarjetas: Se eliminaron los fondos negros sólidos en tarjetas de inicio, modpacks e instancias que rompían la estética de los temas. Ahora cuentan con un diseño traslúcido de obsidiana con desenfoque de cristal (glassmorphism) que se adapta al color de cada tema.
-Avatar Genérico con Inicial: Se solucionó el problema en el tutorial y perfiles donde aparecía un círculo con la letra inicial en lugar del rostro del jugador. Ahora se muestra fielmente la cabeza de Minecraft en 3D con su capa de casco pixelada.
-Precisión en Errores y Cierres (Crash Codes): Detección precisa y captura de códigos de error de Java y Minecraft (como falta de memoria RAM o conflictos de mods), ofreciendo información clara en pantalla en lugar de cierres inesperados silenciosos.
-Estabilidad en Descargas: Corrección de cortes de conexión al descargar modpacks grandes desde Modrinth y CurseForge, integrando verificación de integridad y reanudación automática de archivos incompletos.
-Apertura y Cierre Abrupto de Novedades: Se suavizaron las transiciones de las ventanas flotantes con aceleración de hardware para eliminar saltos visuales repentinos.

Added:
-Rework Visual Completo del Launcher: Rediseño estético integral de toda la interfaz gráfica del launcher, modernizando la pantalla de inicio, el dock flotante, el carrusel de versiones, las tarjetas de modpacks, los botones de acción principal ('▶ JUGAR' y 'OBTENER'), paneles de perfiles y modales del sistema con una nueva estética premium basada en obsidiana pura, bordes de cristal pulido (glassmorphism), acabados translúcidos y armonización de iluminación neón en todos los temas.
-Asistente de Configuración Inicial y Tutorial: Nuevo asistente guiado de 5 pasos para nuevos usuarios (y reconfigurable desde Ajustes) que permite preconfigurar el tema visual, memoria RAM recomendada y conocer las funciones principales del launcher.
-Ventana Adaptativa en Vivo: La ventana del tutorial cambia dinámicamente de fondo, bordes y resplandor al seleccionar cualquier tema para visualizar el resultado en tiempo real.
-Tarjetas de Tema Oficiales: Integración de las tarjetas exactas de la sección de Ajustes dentro del tutorial, acompañadas de stickers oficiales de cada edición (KaiJuice, Bed_a / Papu, Snorlax, LionHeart y Linky Logo).
-Switch Interactivo ON/OFF para Discord RPC: Nuevo interruptor cibernético con indicador luminoso que muestra claramente si la presencia enriquecida en Discord está activa o inactiva.
-Presencia en Discord con Botones de la Comunidad: Ahora el Rich Presence de Discord incluye botones interactivos directos para entrar al servidor de Discord y visitar la web oficial del launcher.
-Animaciones Suaves y Cascada Escalonada: Nueva física de animación en la que los elementos y tarjetas aparecen de uno en uno con un suave desvanecimiento hacia arriba a 60-120 FPS.
-Optimización en el Lanzamiento del Juego: Reducción del tiempo de apertura de Minecraft a 1 clic desde el carrusel de versiones, con flags JVM avanzadas de recolección de basura (G1GC) para evitar tirones de rendimiento.
-Sistema de Cuentas y Seguridad: Soporte unificado de cuentas (Microsoft, Google y Offline) con almacenamiento seguro y aislado de credenciales y normalización de rutas en Windows.
-Sincronización Global v0.2.8: Actualización de la versión del sistema en todos los manifiestos (tauri.conf.json, package.json, Cargo.toml), pantalla de carga inicial (Splashscreen) y pie de página.
