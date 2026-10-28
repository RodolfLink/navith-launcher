use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, Metadata};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

const STATE_FILE: &str = ".navithlabs_server_content.json";
const MAX_ARCHIVE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_JAR_BYTES: u64 = 1024 * 1024 * 1024;
static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerContentManifest {
    pub format_version: u32,
    pub revision: u64,
    pub base_archive_url: Option<String>,
    pub config_archive_url: Option<String>,
    #[serde(default)]
    pub files: Vec<ServerContentFile>,
    #[serde(default)]
    pub excluded_files: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerContentFile {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub url: String,
    pub sha256: Option<String>,
    pub size: Option<u64>,
    #[serde(default = "enabled_default")]
    pub enabled: bool,
}

fn enabled_default() -> bool {
    true
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerContentResult {
    pub revision: u64,
    pub downloaded: usize,
    pub removed: usize,
    pub unchanged: usize,
    pub signature: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveState {
    url: String,
    cache_sha256: String,
    files: BTreeMap<String, String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnedFile {
    relative: String,
    owner: String,
    sha256: String,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledState {
    format_version: u32,
    revision: u64,
    signature: String,
    archives: BTreeMap<String, ArchiveState>,
    files: BTreeMap<String, OwnedFile>,
    excluded_files: BTreeSet<String>,
}

#[derive(Clone)]
struct Candidate {
    owned: OwnedFile,
    staged: Option<PathBuf>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentProgress {
    game_directory: String,
    progress: f64,
    message: String,
}

fn progress(app: &Option<tauri::AppHandle>, directory: &str, percent: f64, message: &str) {
    let Some(app) = app else {
        return;
    };
    let _ = app.emit(
        "server-content-progress",
        ContentProgress {
            game_directory: directory.to_string(),
            progress: percent,
            message: message.to_string(),
        },
    );
}

fn is_link(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    false
}

fn no_links(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if is_link(&metadata) => {
                return Err(format!("La ruta contiene un enlace: {}", current.display()))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn instance_root(raw: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(raw.trim());
    if !requested.is_absolute()
        || requested
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("La instancia necesita una carpeta absoluta y válida.".into());
    }
    if requested.parent().and_then(Path::parent).is_none() {
        return Err("No se puede usar la raíz del disco como instancia.".into());
    }
    no_links(&requested)?;
    fs::create_dir_all(&requested).map_err(|error| error.to_string())?;
    requested.canonicalize().map_err(|error| error.to_string())
}

fn safe_parts(raw: &str) -> Result<Vec<String>, String> {
    let replaced = raw.replace('\\', "/");
    if replaced.starts_with('/') || replaced.contains(':') {
        return Err(format!("Ruta no permitida dentro del paquete: {raw}"));
    }
    let mut parts = Vec::new();
    for part in replaced.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.as_bytes()[3].is_ascii_digit());
        if part == ".."
            || part.ends_with('.')
            || part.ends_with(' ')
            || part
                .chars()
                .any(|c| c.is_control() || "<>\"|?*".contains(c))
            || reserved
        {
            return Err(format!("Nombre de archivo no permitido: {raw}"));
        }
        parts.push(part.to_string());
    }
    if parts.is_empty() {
        return Err("El nombre de archivo está vacío.".into());
    }
    Ok(parts)
}

fn jar_name(raw: &str) -> Result<String, String> {
    let parts = safe_parts(raw)?;
    if parts.len() != 1 || !raw.to_ascii_lowercase().ends_with(".jar") {
        return Err(format!(
            "Usa únicamente el nombre exacto del archivo .jar: {raw}"
        ));
    }
    Ok(parts[0].clone())
}

fn content_root(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "mods"
            | "config"
            | "defaultconfigs"
            | "resourcepacks"
            | "shaderpacks"
            | "kubejs"
            | "scripts"
            | "global_packs"
            | "patchouli_books"
            | "fancymenu"
            | "customnpcs"
    )
}

fn protected_root(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "saves"
            | "world"
            | "worlds"
            | "screenshots"
            | "logs"
            | "crash-reports"
            | "versions"
            | "libraries"
            | "assets"
            | "backups"
    ) || name.starts_with(".linky") || name.starts_with(".navithlabs")
}

fn archive_relative(raw: &str, kind: &str) -> Result<Option<String>, String> {
    let mut parts = safe_parts(raw)?;
    if parts.iter().any(|part| protected_root(part)) {
        return Ok(None);
    }
    if let Some(index) = parts.iter().position(|part| content_root(part)) {
        parts.drain(0..index);
        parts[0] = parts[0].to_ascii_lowercase();
        return Ok(Some(parts.join("/")));
    }
    if parts
        .last()
        .map(|name| name.to_ascii_lowercase().ends_with(".jar"))
        .unwrap_or(false)
        && kind == "base"
    {
        return Ok(Some(format!("mods/{}", parts.last().unwrap())));
    }
    if kind == "config" {
        parts.insert(0, "config".into());
        return Ok(Some(parts.join("/")));
    }
    Ok(None)
}

fn managed_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let parts = safe_parts(relative)?;
    if parts.len() < 2 || !content_root(&parts[0]) || parts.iter().any(|part| protected_root(part))
    {
        return Err(format!("Ruta de contenido no permitida: {relative}"));
    }
    let target = root.join(parts.join("/"));
    if !target.starts_with(root) {
        return Err("El contenido sale de la instancia.".into());
    }
    no_links(&target)?;
    Ok(target)
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let length = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if length == 0 {
            break;
        }
        hasher.update(&buffer[..length]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn sha_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn valid_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "La URL de contenido no es válida.")?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return Err("Los archivos necesitan una URL HTTP o HTTPS.".into());
    }
    Ok(url.to_string())
}

async fn download(url: &str, destination: &Path, limit: u64) -> Result<(String, u64), String> {
    let checked_url = valid_url(url)?;
    let mut response = crate::HTTP_CLIENT
        .get(&checked_url)
        .timeout(std::time::Duration::from_secs(1200))
        .send()
        .await
        .map_err(|error| format!("No se pudo descargar el contenido: {error}"))?
        .error_for_status()
        .map_err(|error| format!("El servidor de archivos respondió con un error: {error}"))?;
    if response
        .content_length()
        .map(|size| size > limit)
        .unwrap_or(false)
    {
        return Err("El archivo supera el tamaño permitido.".into());
    }
    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    while let Some(bytes) = response.chunk().await.map_err(|error| error.to_string())? {
        size += bytes.len() as u64;
        if size > limit {
            return Err("El archivo supera el tamaño permitido.".into());
        }
        hasher.update(&bytes);
        file.write_all(&bytes)
            .await
            .map_err(|error| error.to_string())?;
    }
    file.sync_all().await.map_err(|error| error.to_string())?;
    if size == 0 {
        return Err("El servidor devolvió un archivo vacío.".into());
    }
    Ok((format!("{:x}", hasher.finalize()), size))
}

fn extract_archive(
    archive_path: &Path,
    destination: &Path,
    kind: &str,
) -> Result<BTreeMap<String, String>, String> {
    let file = File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "El paquete debe ser un ZIP válido. Convierte los archivos RAR a ZIP antes de publicarlos.".to_string())?;
    if archive.len() > 100_000 {
        return Err("El paquete contiene demasiados archivos.".into());
    }
    let mut expanded = 0_u64;
    let mut files = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for index in 0..archive.len() {
        let mut item = archive.by_index(index).map_err(|error| error.to_string())?;
        if item
            .unix_mode()
            .map(|mode| mode & 0o170000 == 0o120000)
            .unwrap_or(false)
        {
            return Err("El paquete contiene enlaces simbólicos.".into());
        }
        safe_parts(item.name())?;
        if item.is_dir() {
            continue;
        }
        expanded = expanded
            .checked_add(item.size())
            .ok_or("El paquete es demasiado grande.")?;
        if expanded > MAX_EXPANDED_BYTES {
            return Err("El paquete descomprimido es demasiado grande.".into());
        }
        let Some(relative) = archive_relative(item.name(), kind)? else {
            continue;
        };
        if !seen.insert(relative.to_ascii_lowercase()) {
            return Err(format!(
                "El paquete contiene dos archivos con la misma ruta: {relative}"
            ));
        }
        let target = managed_path(destination, &relative)?;
        fs::create_dir_all(target.parent().unwrap()).map_err(|error| error.to_string())?;
        let mut output = File::create(&target).map_err(|error| error.to_string())?;
        let expected_size = item.size();
        let copied = std::io::copy(
            &mut (&mut item).take(expected_size.saturating_add(1)),
            &mut output,
        )
        .map_err(|error| error.to_string())?;
        if copied > MAX_EXPANDED_BYTES || copied != expected_size {
            return Err("Un archivo del paquete tiene un tamaño incorrecto.".into());
        }
        output.sync_all().map_err(|error| error.to_string())?;
        files.insert(relative, hash_file(&target)?);
    }
    if files.is_empty() {
        return Err("El ZIP no contiene archivos de contenido compatibles. Incluye mods/, config/ o las carpetas del modpack.".into());
    }
    Ok(files)
}

fn excluded_jar(relative: &str, exclusions: &BTreeSet<String>) -> bool {
    relative.to_ascii_lowercase().starts_with("mods/")
        && relative
            .rsplit('/')
            .next()
            .map(|name| exclusions.contains(&name.to_ascii_lowercase()))
            .unwrap_or(false)
}

fn collect_excluded(
    directory: &Path,
    root: &Path,
    names: &BTreeSet<String>,
    found: &mut BTreeSet<String>,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    no_links(directory)?;
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if is_link(&metadata) {
            continue;
        }
        if metadata.is_dir() {
            collect_excluded(&entry.path(), root, names, found)?;
        } else if metadata.is_file()
            && names.contains(&entry.file_name().to_string_lossy().to_ascii_lowercase())
        {
            found.insert(
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|error| error.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}

struct StageGuard(PathBuf);
impl Drop for StageGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn apply_transaction(
    root: &Path,
    stage: &Path,
    writes: &BTreeMap<String, PathBuf>,
    removals: &BTreeSet<String>,
    state: &InstalledState,
) -> Result<(), String> {
    let backup = stage.join("backup");
    fs::create_dir_all(&backup).map_err(|error| error.to_string())?;
    let state_staged = stage.join("next-state.json");
    let mut file = File::create(&state_staged).map_err(|error| error.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    no_links(&root.join(STATE_FILE))?;
    let mut saved: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut installed: Vec<PathBuf> = Vec::new();
    let operation = (|| -> Result<(), String> {
        let mut affected: BTreeSet<String> = writes.keys().cloned().collect();
        affected.extend(removals.iter().cloned());
        for (index, relative) in affected.iter().enumerate() {
            let target = managed_path(root, relative)?;
            if target.exists() {
                if !target.is_file() {
                    return Err(format!("La ruta de contenido no es un archivo: {relative}"));
                }
                let saved_path = backup.join(index.to_string());
                fs::rename(&target, &saved_path).map_err(|error| format!("No se pudo actualizar {relative}. Cierra Minecraft e inténtalo otra vez: {error}"))?;
                saved.push((target, saved_path));
            }
        }
        for (relative, source) in writes {
            let target = managed_path(root, relative)?;
            fs::create_dir_all(target.parent().unwrap()).map_err(|error| error.to_string())?;
            no_links(&target)?;
            fs::rename(source, &target)
                .map_err(|error| format!("No se pudo instalar {relative}: {error}"))?;
            installed.push(target);
        }
        let state_target = root.join(STATE_FILE);
        if state_target.exists() {
            let previous = backup.join("previous-state.json");
            fs::rename(&state_target, &previous).map_err(|error| error.to_string())?;
            saved.push((state_target.clone(), previous));
        }
        fs::rename(&state_staged, &state_target).map_err(|error| error.to_string())?;
        installed.push(state_target);
        Ok(())
    })();
    if let Err(error) = operation {
        let mut rollback_errors = Vec::new();
        for target in installed.iter().rev() {
            if let Err(failure) = fs::remove_file(target) {
                rollback_errors.push(failure.to_string());
            }
        }
        for (target, previous) in saved.iter().rev() {
            if let Err(failure) = fs::rename(previous, target) {
                rollback_errors.push(failure.to_string());
            }
        }
        if !rollback_errors.is_empty() {
            return Err(format!(
                "{error}. No se pudo restaurar todo automáticamente; conserva {}: {}",
                stage.display(),
                rollback_errors.join("; ")
            ));
        }
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_server_content(
    app: tauri::AppHandle,
    game_directory: String,
    manifest: ServerContentManifest,
) -> Result<ServerContentResult, String> {
    synchronize(Some(app), game_directory, manifest).await
}

async fn synchronize(
    app: Option<tauri::AppHandle>,
    game_directory: String,
    manifest: ServerContentManifest,
) -> Result<ServerContentResult, String> {
    let _lock = SYNC_LOCK.lock().await;
    if manifest.format_version != 1 {
        return Err("El formato de contenido no es compatible. Actualiza el launcher.".into());
    }
    if manifest.files.len() > 10_000 || manifest.excluded_files.len() > 10_000 {
        return Err("El manifiesto contiene demasiados archivos.".into());
    }
    let root = instance_root(&game_directory)?;
    let stage = root.join(format!(".navithlabs_server_stage_{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage).map_err(|error| error.to_string())?;
    let mut stage_guard = StageGuard(stage.clone());
    let signature = sha_bytes(&serde_json::to_vec(&manifest).map_err(|error| error.to_string())?);
    let state_path = root.join(STATE_FILE);
    no_links(&state_path)?;
    let previous: InstalledState = if state_path.exists() {
        let state = serde_json::from_slice::<InstalledState>(&fs::read(&state_path).map_err(|error| error.to_string())?)
            .map_err(|_| "El registro de contenido de esta instancia está dañado. Conserva la carpeta antes de reinstalar.".to_string())?;
        if state.format_version != 1 {
            return Err("El registro de contenido usa una versión no compatible.".into());
        }
        state
    } else {
        InstalledState::default()
    };
    let mut exclusions = BTreeSet::new();
    for name in &manifest.excluded_files {
        exclusions.insert(jar_name(name)?.to_ascii_lowercase());
    }
    let mut ids = BTreeSet::new();
    let mut filenames = BTreeSet::new();
    for item in &manifest.files {
        let filename = jar_name(&item.filename)?;
        if item.id.trim().is_empty() || !ids.insert(item.id.clone()) {
            return Err("Cada mod necesita un identificador único.".into());
        }
        if !filenames.insert(filename.to_ascii_lowercase()) {
            return Err(format!("Hay dos mods con el mismo archivo: {filename}"));
        }
        if !item.enabled {
            exclusions.insert(filename.to_ascii_lowercase());
        } else {
            valid_url(&item.url)?;
            if let Some(hash) = &item.sha256 {
                if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                    return Err(format!("El SHA-256 de {} no es válido.", item.name));
                }
            }
        }
    }
    let mut archive_exclusions = exclusions.clone();
    for item in manifest.files.iter().filter(|file| file.enabled) {
        archive_exclusions.insert(item.filename.to_ascii_lowercase());
    }
    progress(
        &app,
        &game_directory,
        2.0,
        "Preparando el contenido del servidor",
    );
    let cache_dir = root.join(".navithlabs_server_cache");
    no_links(&cache_dir)?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    let mut next = InstalledState {
        format_version: 1,
        revision: manifest.revision,
        signature: signature.clone(),
        excluded_files: exclusions.clone(),
        ..Default::default()
    };
    let mut candidates: BTreeMap<String, Candidate> = BTreeMap::new();
    let mut downloaded = 0_usize;
    for (kind, raw_url) in [
        ("base", &manifest.base_archive_url),
        ("config", &manifest.config_archive_url),
    ] {
        let Some(raw_url) = raw_url.as_ref().filter(|url| !url.trim().is_empty()) else {
            continue;
        };
        let url = valid_url(raw_url)?;
        let old_archive = previous.archives.get(kind).filter(|old| old.url == url);
        let restore_needed = old_archive
            .map(|old| {
                old.files.iter().any(|(relative, expected_hash)| {
                    let key = relative.to_ascii_lowercase();
                    !excluded_jar(relative, &archive_exclusions)
                        && (!root.join(relative).is_file()
                            || previous
                                .files
                                .get(&key)
                                .map(|file| file.owner != kind)
                                .unwrap_or(false)
                            || (key.starts_with("mods/")
                                && previous
                                    .files
                                    .get(&key)
                                    .map(|file| file.owner == kind)
                                    .unwrap_or(false)
                                && hash_file(&root.join(relative))
                                    .map(|hash| hash != *expected_hash)
                                    .unwrap_or(true)))
                })
            })
            .unwrap_or(true);
        let restored_exclusion = previous
            .excluded_files
            .difference(&exclusions)
            .next()
            .is_some();
        let needs_extract = old_archive.is_none() || restore_needed || restored_exclusion;
        let extraction = stage.join(kind);
        let record = if needs_extract {
            progress(
                &app,
                &game_directory,
                if kind == "base" { 8.0 } else { 38.0 },
                if kind == "base" {
                    "Preparando el paquete del servidor"
                } else {
                    "Preparando la configuración"
                },
            );
            let cached = cache_dir.join(format!("{}.zip", sha_bytes(url.as_bytes())));
            no_links(&cached)?;
            let valid_cache = old_archive
                .and_then(|old| hash_file(&cached).ok().map(|hash| hash == old.cache_sha256))
                .unwrap_or(false);
            let cache_hash = if valid_cache {
                old_archive.unwrap().cache_sha256.clone()
            } else {
                let temporary = stage.join(format!("{kind}.download"));
                let (hash, _) = download(&url, &temporary, MAX_ARCHIVE_BYTES).await?;
                if cached.exists() {
                    fs::remove_file(&cached).map_err(|error| error.to_string())?;
                }
                fs::rename(&temporary, &cached).map_err(|error| error.to_string())?;
                downloaded += 1;
                hash
            };
            fs::create_dir_all(&extraction).map_err(|error| error.to_string())?;
            let archive_path = cached.clone();
            let output_path = extraction.clone();
            let archive_kind = kind.to_string();
            let files = tokio::task::spawn_blocking(move || {
                extract_archive(&archive_path, &output_path, &archive_kind)
            })
            .await
            .map_err(|error| error.to_string())??;
            ArchiveState {
                url: url.clone(),
                cache_sha256: cache_hash,
                files,
            }
        } else {
            old_archive.unwrap().clone()
        };
        for (relative, hash) in &record.files {
            managed_path(&root, relative)?;
            if excluded_jar(relative, &archive_exclusions) {
                continue;
            }
            candidates.insert(
                relative.to_ascii_lowercase(),
                Candidate {
                    owned: OwnedFile {
                        relative: relative.clone(),
                        owner: kind.into(),
                        sha256: hash.clone(),
                        url: Some(url.clone()),
                    },
                    staged: needs_extract.then(|| extraction.join(relative)),
                },
            );
        }
        next.archives.insert(kind.into(), record);
    }
    let enabled_count = manifest
        .files
        .iter()
        .filter(|file| file.enabled)
        .count()
        .max(1);
    for (index, item) in manifest
        .files
        .iter()
        .filter(|file| file.enabled)
        .enumerate()
    {
        let relative = format!("mods/{}", jar_name(&item.filename)?);
        let key = relative.to_ascii_lowercase();
        let owner = format!("file:{}", item.id);
        let target = managed_path(&root, &relative)?;
        let url = valid_url(&item.url)?;
        let old_file = previous
            .files
            .get(&key)
            .filter(|old| old.owner == owner && old.url.as_deref() == Some(url.as_str()));
        let expected = item.sha256.as_ref().map(|hash| hash.to_ascii_lowercase());
        let existing_hash = if target.is_file() {
            Some(hash_file(&target)?)
        } else {
            None
        };
        let valid_existing = old_file
            .map(|old| {
                existing_hash.as_ref() == Some(&old.sha256)
                    && expected
                        .as_ref()
                        .map(|hash| hash == &old.sha256)
                        .unwrap_or(previous.revision == manifest.revision)
                    && item
                        .size
                        .map(|size| {
                            fs::metadata(&target)
                                .map(|metadata| metadata.len() == size)
                                .unwrap_or(false)
                        })
                        .unwrap_or(true)
            })
            .unwrap_or(false);
        let (hash, staged) = if valid_existing {
            (existing_hash.unwrap(), None)
        } else {
            progress(
                &app,
                &game_directory,
                48.0 + 35.0 * index as f64 / enabled_count as f64,
                &format!("Descargando {}", item.name),
            );
            let temporary = stage.join(format!("mod-{index}.jar"));
            let (hash, size) = download(&url, &temporary, MAX_JAR_BYTES).await?;
            if expected
                .as_ref()
                .map(|expected| expected != &hash)
                .unwrap_or(false)
            {
                return Err(format!(
                    "La verificación SHA-256 falló para {}. No se modificó la instalación.",
                    item.name
                ));
            }
            if item.size.map(|expected| expected != size).unwrap_or(false) {
                return Err(format!(
                    "El tamaño de {} no coincide con el publicado.",
                    item.name
                ));
            }
            let jar = File::open(&temporary).map_err(|error| error.to_string())?;
            zip::ZipArchive::new(jar)
                .map_err(|_| format!("{} no es un archivo JAR válido.", item.name))?;
            downloaded += 1;
            (hash, Some(temporary))
        };
        candidates.insert(
            key,
            Candidate {
                owned: OwnedFile {
                    relative,
                    owner,
                    sha256: hash,
                    url: Some(url),
                },
                staged,
            },
        );
    }
    progress(
        &app,
        &game_directory,
        86.0,
        "Comprobando los cambios antes de instalarlos",
    );
    let mut writes = BTreeMap::new();
    let mut removals = BTreeSet::new();
    let mut unchanged = 0_usize;
    for (key, candidate) in candidates {
        let target = managed_path(&root, &candidate.owned.relative)?;
        let current_hash = if target.is_file() {
            Some(hash_file(&target)?)
        } else {
            None
        };
        let same = current_hash.as_ref() == Some(&candidate.owned.sha256);
        if target.exists() && !same && !previous.files.contains_key(&key) {
            return Err(format!("La instancia ya contiene un archivo personal llamado {}. Muévelo o renómbralo antes de actualizar el servidor.", candidate.owned.relative));
        }
        if same {
            unchanged += 1;
        } else if current_hash.is_some()
            && !key.starts_with("mods/")
            && previous
                .files
                .get(&key)
                .map(|old| {
                    old.owner == candidate.owned.owner
                        && old.sha256 == candidate.owned.sha256
                        && old.url == candidate.owned.url
                })
                .unwrap_or(false)
        {
            unchanged += 1;
        } else if let Some(staged) = candidate.staged {
            writes.insert(candidate.owned.relative.clone(), staged);
        } else {
            return Err(format!(
                "Falta {}. Vuelve a preparar el contenido del servidor.",
                candidate.owned.relative
            ));
        }
        next.files.insert(key, candidate.owned);
    }
    for (key, old) in &previous.files {
        if next.files.contains_key(key) {
            continue;
        }
        let target = managed_path(&root, &old.relative)?;
        if target.is_file() && hash_file(&target)? == old.sha256 {
            removals.insert(old.relative.clone());
        }
    }
    collect_excluded(&root.join("mods"), &root, &exclusions, &mut removals)?;
    removals.retain(|relative| !next.files.contains_key(&relative.to_ascii_lowercase()));
    let removed = removals.len();
    progress(
        &app,
        &game_directory,
        94.0,
        "Aplicando la actualización del servidor",
    );
    let root_for_apply = root.clone();
    let stage_for_apply = stage.clone();
    let apply_result = tokio::task::spawn_blocking(move || {
        apply_transaction(&root_for_apply, &stage_for_apply, &writes, &removals, &next)
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = apply_result {
        if error.contains("conserva ") {
            stage_guard.0 = PathBuf::new();
        }
        return Err(error);
    }
    progress(&app, &game_directory, 100.0, "Contenido del servidor listo");
    Ok(ServerContentResult {
        revision: manifest.revision,
        downloaded,
        removed,
        unchanged,
        signature,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            zip.start_file(*name, zip::write::FileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    struct FixtureServer {
        address: String,
        requests: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl FixtureServer {
        fn start(resources: BTreeMap<String, Vec<u8>>) -> Self {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = format!("http://{}", listener.local_addr().unwrap());
            listener.set_nonblocking(true).unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let requests = Arc::new(AtomicUsize::new(0));
            let worker_stop = stop.clone();
            let worker_requests = requests.clone();
            let thread = std::thread::spawn(move || {
                while !worker_stop.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((mut socket, _)) => {
                            socket
                                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                                .unwrap();
                            let mut request = [0_u8; 4096];
                            let length = socket.read(&mut request).unwrap();
                            let request = String::from_utf8_lossy(&request[..length]);
                            let path = request.split_whitespace().nth(1).unwrap_or("");
                            let bytes = resources.get(path).unwrap();
                            worker_requests.fetch_add(1, Ordering::SeqCst);
                            write!(socket, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len()).unwrap();
                            socket.write_all(bytes).unwrap();
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(std::time::Duration::from_millis(2))
                        }
                        Err(error) => panic!("{error}"),
                    }
                }
            });
            Self {
                address,
                requests,
                stop,
                thread: Some(thread),
            }
        }
    }

    impl Drop for FixtureServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(thread) = self.thread.take() {
                thread.join().unwrap();
            }
        }
    }

    #[test]
    fn refuses_escape_and_device_paths() {
        for path in [
            "../outside.jar",
            "mods/../../outside.jar",
            "C:/outside.jar",
            "/outside.jar",
            "mods/CON.jar",
            "mods/example.jar:stream",
        ] {
            assert!(safe_parts(path).is_err(), "{path}");
        }
        assert!(jar_name("mods/mod.jar").is_err());
        assert!(jar_name("valid-mod+1.2.jar").is_ok());
    }

    #[test]
    fn archive_paths_only_target_content() {
        assert_eq!(
            archive_relative("Server/overrides/mods/a.jar", "base").unwrap(),
            Some("mods/a.jar".into())
        );
        assert_eq!(
            archive_relative("a.jar", "base").unwrap(),
            Some("mods/a.jar".into())
        );
        assert_eq!(
            archive_relative("settings.toml", "config").unwrap(),
            Some("config/settings.toml".into())
        );
        assert_eq!(
            archive_relative("saves/world/level.dat", "base").unwrap(),
            None
        );
        assert_eq!(
            archive_relative(".navithlabs_server_content.json", "base").unwrap(),
            None
        );
        assert_eq!(archive_relative("launcher.exe", "base").unwrap(), None);
    }

    #[test]
    fn failed_apply_restores_original_and_keeps_old_manifest() {
        let root =
            std::env::temp_dir().join(format!("navithlabs-server-transaction-{}", uuid::Uuid::new_v4()));
        let stage = root.join("stage");
        fs::create_dir_all(root.join("mods")).unwrap();
        fs::create_dir_all(&stage).unwrap();
        fs::write(root.join("mods/old.jar"), b"previous bytes").unwrap();
        fs::write(root.join(STATE_FILE), b"previous manifest").unwrap();
        let writes = BTreeMap::from([("mods/old.jar".into(), stage.join("missing.jar"))]);
        assert!(apply_transaction(
            &root,
            &stage,
            &writes,
            &BTreeSet::new(),
            &InstalledState::default()
        )
        .is_err());
        assert_eq!(
            fs::read(root.join("mods/old.jar")).unwrap(),
            b"previous bytes"
        );
        assert_eq!(
            fs::read(root.join(STATE_FILE)).unwrap(),
            b"previous manifest"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn commit_only_changes_selected_files_and_preserves_personal_content() {
        let root =
            std::env::temp_dir().join(format!("navithlabs-server-owned-{}", uuid::Uuid::new_v4()));
        let stage = root.join("stage");
        fs::create_dir_all(root.join("mods")).unwrap();
        fs::create_dir_all(root.join("saves/personal-world")).unwrap();
        fs::create_dir_all(&stage).unwrap();
        fs::write(root.join("mods/remove.jar"), b"server old").unwrap();
        fs::write(root.join("mods/personal.jar"), b"personal mod").unwrap();
        fs::write(
            root.join("saves/personal-world/level.dat"),
            b"personal world",
        )
        .unwrap();
        fs::write(stage.join("new.jar"), b"server new").unwrap();
        let writes = BTreeMap::from([("mods/new.jar".into(), stage.join("new.jar"))]);
        let removals = BTreeSet::from(["mods/remove.jar".into()]);
        apply_transaction(
            &root,
            &stage,
            &writes,
            &removals,
            &InstalledState::default(),
        )
        .unwrap();
        assert!(!root.join("mods/remove.jar").exists());
        assert_eq!(fs::read(root.join("mods/new.jar")).unwrap(), b"server new");
        assert_eq!(
            fs::read(root.join("mods/personal.jar")).unwrap(),
            b"personal mod"
        );
        assert_eq!(
            fs::read(root.join("saves/personal-world/level.dat")).unwrap(),
            b"personal world"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn zip_extraction_does_not_install_worlds_or_allow_traversal() {
        let root = std::env::temp_dir().join(format!("navithlabs-server-zip-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let zip_path = root.join("package.zip");
        let mut archive = zip::ZipWriter::new(File::create(&zip_path).unwrap());
        archive
            .start_file("mods/server.jar", zip::write::FileOptions::default())
            .unwrap();
        archive.write_all(b"server mod").unwrap();
        archive
            .start_file("saves/world/level.dat", zip::write::FileOptions::default())
            .unwrap();
        archive.write_all(b"do not install").unwrap();
        archive.finish().unwrap();
        let output = root.join("output");
        fs::create_dir_all(&output).unwrap();
        let inventory = extract_archive(&zip_path, &output, "base").unwrap();
        assert_eq!(inventory.len(), 1);
        assert!(output.join("mods/server.jar").is_file());
        assert!(!output.join("saves").exists());
        let invalid_zip = root.join("traversal.zip");
        let mut archive = zip::ZipWriter::new(File::create(&invalid_zip).unwrap());
        archive
            .start_file("../escaped.jar", zip::write::FileOptions::default())
            .unwrap();
        archive.write_all(b"escape").unwrap();
        archive.finish().unwrap();
        assert!(extract_archive(&invalid_zip, &output, "base").is_err());
        assert!(!root.join("escaped.jar").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn lifecycle_restores_cached_package_and_rejects_bad_download_without_mutation() {
        let original = zip_bytes(&[("META-INF/MANIFEST.MF", b"original")]);
        let replacement = zip_bytes(&[("META-INF/MANIFEST.MF", b"replacement")]);
        let package = zip_bytes(&[
            ("mods/server.jar", &original),
            ("config/server.toml", b"server=true"),
        ]);
        let server = FixtureServer::start(BTreeMap::from([
            ("/base.zip".into(), package),
            ("/replacement.jar".into(), replacement.clone()),
        ]));
        let root =
            std::env::temp_dir().join(format!("navithlabs-server-lifecycle-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("mods")).unwrap();
        fs::create_dir_all(root.join("saves/my-world")).unwrap();
        fs::write(root.join("mods/personal.jar"), b"personal").unwrap();
        fs::write(root.join("saves/my-world/level.dat"), b"world").unwrap();
        let directory = root.to_string_lossy().to_string();
        let mut manifest = ServerContentManifest {
            format_version: 1,
            revision: 1,
            base_archive_url: Some(format!("{}/base.zip", server.address)),
            config_archive_url: None,
            files: Vec::new(),
            excluded_files: Vec::new(),
        };
        let installed = synchronize(None, directory.clone(), manifest.clone())
            .await
            .unwrap();
        assert_eq!(installed.downloaded, 1);
        assert_eq!(fs::read(root.join("mods/server.jar")).unwrap(), original);
        fs::write(root.join("config/server.toml"), b"personal-settings=true").unwrap();
        manifest.revision = 2;
        manifest.excluded_files = vec!["server.jar".into()];
        let excluded = synchronize(None, directory.clone(), manifest.clone())
            .await
            .unwrap();
        assert_eq!(excluded.downloaded, 0);
        assert!(!root.join("mods/server.jar").exists());
        manifest.revision = 3;
        manifest.excluded_files.clear();
        manifest.files.push(ServerContentFile {
            id: "replacement".into(),
            name: "Replacement".into(),
            filename: "server.jar".into(),
            url: format!("{}/replacement.jar", server.address),
            sha256: Some(sha_bytes(&replacement)),
            size: Some(replacement.len() as u64),
            enabled: true,
        });
        let replaced = synchronize(None, directory.clone(), manifest.clone())
            .await
            .unwrap();
        assert_eq!(replaced.downloaded, 1);
        assert_eq!(fs::read(root.join("mods/server.jar")).unwrap(), replacement);
        assert_eq!(
            fs::read(root.join("config/server.toml")).unwrap(),
            b"personal-settings=true"
        );
        manifest.revision = 4;
        manifest.files[0].enabled = false;
        synchronize(None, directory.clone(), manifest.clone())
            .await
            .unwrap();
        assert!(!root.join("mods/server.jar").exists());
        manifest.revision = 5;
        manifest.files.clear();
        let restored = synchronize(None, directory.clone(), manifest.clone())
            .await
            .unwrap();
        assert_eq!(restored.downloaded, 0);
        assert_eq!(fs::read(root.join("mods/server.jar")).unwrap(), original);
        manifest.revision = 6;
        manifest.files.push(ServerContentFile {
            id: "bad".into(),
            name: "Bad checksum".into(),
            filename: "server.jar".into(),
            url: format!("{}/replacement.jar", server.address),
            sha256: Some("0".repeat(64)),
            size: None,
            enabled: true,
        });
        assert!(synchronize(None, directory, manifest)
            .await
            .unwrap_err()
            .contains("SHA-256"));
        assert_eq!(fs::read(root.join("mods/server.jar")).unwrap(), original);
        let state: InstalledState =
            serde_json::from_slice(&fs::read(root.join(STATE_FILE)).unwrap()).unwrap();
        assert_eq!(state.revision, 5);
        assert_eq!(
            fs::read(root.join("mods/personal.jar")).unwrap(),
            b"personal"
        );
        assert_eq!(
            fs::read(root.join("saves/my-world/level.dat")).unwrap(),
            b"world"
        );
        assert_eq!(
            server.requests.load(Ordering::SeqCst),
            3,
            "ZIP should download only once"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
