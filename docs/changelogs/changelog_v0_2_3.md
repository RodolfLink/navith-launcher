# Changelog - Linky Launcher v0.2.3

## 🐛 Correcciones Críticas (Hotfixes)

### 1. Bucle de Redescarga de Mods Resuelto
- **Problema:** En cada reinicio del launcher o al presionar iniciar evento, se volvían a descargar todos los mods y configuraciones, ignorando las instalaciones previas.
- **Causa:** La estructura `Instance` en Rust (`lib.rs`) no incluía la propiedad `mods_url`, por lo que Rust descartaba `modsUrl` al guardar `instances.json`. Al reabrir la app, `modsUrl` regresaba como `undefined`, provocando que el comprobador de versiones detectara un cambio falso (`undefined !== modsUrl`).
- **Solución:** Se añadió `pub mods_url: Option<String>` a Rust y se implementó un parser de JSON seguro en TypeScript para manejar arreglos de mods provenientes de la API en Vercel.

### 2. Detección en Tiempo Real del Auto-Updater
- **Problema:** Algunos usuarios no recibían los avisos de actualización automática al publicar nuevas builds en GitHub.
- **Causa:** El CDN de GitHub (`raw.githubusercontent.com`) almacena en caché el archivo `update.json` por varios minutos, entregando respuestas obsoletas.
- **Solución:** Se integraron cabeceras HTTP `Cache-Control: no-cache, no-store` tanto en la verificación automática al iniciar como en la búsqueda manual desde Ajustes.

---

## 🏷️ Actualización de Versión Global
Se unificó la versión a `v0.2.3` en los siguientes archivos:
- `package.json` -> `"version": "0.2.3"`
- `src-tauri/tauri.conf.json` -> `"version": "0.2.3"`
- `src-tauri/Cargo.toml` -> `version = "0.2.3"`
- `src/App.tsx` -> `useState('0.2.3')`
