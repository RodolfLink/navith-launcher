v0.2.7 — 11 de septiembre de 2026

Fixed:
-Modal de Explorador de Mods (Addons): Rediseño visual completo idéntico al modal de modpacks con tarjetas oscuras (.version-card-item), botones de instalación '▷ INSTALAR ESTA VERSIÓN', formato enriquecido de descripción y visor de capturas adaptativo.
-Apertura de Carpetas de Instancias en Windows: Se solucionó el problema donde hacer clic en el icono de carpeta abría 'Documentos' en vez de la carpeta de la instancia, gracias a la normalización de barras invertidas y verificación de existencia en disco antes de invocar Windows Explorer.
-Descarga e Instalación de Servidores: Se mantuvo el estado de instalación continuo durante la extracción de mods y aplicación de configuraciones, evitando que el botón vuelva prematuramente a 'Instalar'.

Added:
-Sincronización Global v0.2.7: Actualización de la versión del sistema en todos los manifiestos (tauri.conf.json, package.json, Cargo.toml), configuraciones y pantalla de carga (Splashscreen).
-Normalización automática de rutas de instancias locales en Windows.
