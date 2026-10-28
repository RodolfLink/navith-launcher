v0.2.6 — 29 de agosto de 2026

Fixed:
-Incompatibilidad de Dependencias en Modpacks: Se solucionó el error de librerías faltantes al instalar modpacks de Modrinth (como Prominence II RPG). El launcher ahora detecta de forma automática dependencias exclusivas como FTB Quests, FTB Teams y FTB Library, descargándolas desde los servidores CDN oficiales y auto-reparando la carpeta de mods antes de iniciar el juego para evitar pantallas de fallo en Fabric.
-Extracción de Modpacks y Rutas con Espacios: Se corrigió un problema en la extracción y procesamiento de archivos comprimidos .mrpack y .zip en sistemas Windows cuando las rutas contenían caracteres especiales o espacios.
-Estabilidad y Descargas Concurrentes: Se optimizó el motor de descargas en segundo plano implementando reintentos automáticos y servidores de respaldo para evitar fallos de conexión al descargar archivos grandes de CurseForge y Modrinth.
-Detección de Capas y Modelo de Brazos en el Inicio: Se corrigió la carga del visor 3D del menú principal para que reconozca de inmediato si la skin del jugador es Slim (3px) o Classic (4px) y renderice correctamente la capa activa equipada sin necesidad de entrar previamente a la sección de skins.

Added:
-Catálogo Integrado de Addons: Nuevo explorador para buscar e instalar Mods, Shaders, Texturas (Resource Packs) y Datapacks de forma directa en cualquiera de tus instancias seleccionadas.
-Switch Dinámico Modrinth / CurseForge: Selector en la cabecera del catálogo de addons que permite alternar al instante entre las bibliotecas de Modrinth y CurseForge con adaptación de filtros y categorías en tiempo real.
-Instalación con Auto-Resolución de Dependencias: Sistema inteligente que descarga el archivo correspondiente en su carpeta adecuada (mods/, shaderpacks/, resourcepacks/, datapacks/) y resuelve automáticamente cualquier librería o dependencia obligatoria requerida por el addon.
-Ficha Completa de Proyecto y Versiones: Visualización detallada de cada mod o addon con descripciones formateadas, compatibilidad con la versión y cargador de tu instancia, notas de actualización y galería de imágenes con visor en pantalla completa.
-Galería de Capturas de Pantalla: Nueva sección dedicada para explorar y previsualizar en pantalla completa (Lightbox) todas las capturas tomadas dentro de tus partidas, con accesos directos para abrir la carpeta en el explorador de Windows.
-Sistema de Anuncios y Avisos en Vivo: Sincronización en tiempo real de noticias oficiales y comunicados comunitarios desde el servidor central mediante un modal interactivo con control de lectura.
-Modo Mantenimiento Centralizado: Detección automática del estado del servidor que informa al usuario cuando el servicio se encuentra en labores de mantenimiento o actualización.
-Caché Instantáneo de Skins y Capas: Implementación de almacenamiento local para mostrar tu skin, modelo y capa en el visor 3D del inicio desde el primer milisegundo al abrir el launcher, sincronizándose en segundo plano con los servidores de Mojang.
