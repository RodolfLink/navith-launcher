use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use sysinfo::System;
use tauri::{Emitter, Manager};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::mpsc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::io::Read;
use sha2::{Sha512, Digest};
use sha1::Sha1;
mod server_content;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const CURSEFORGE_API_KEY: &str = "$2a$10$wuAJuNZuted3NORVmpgUC.m8sI.pv1tOPKZyBgLFGjxFp/br0lZCC";
const CURSEFORGE_FILES_PAGE_SIZE: usize = 1_000;

#[derive(serde::Deserialize, Clone, Debug)]
pub struct DiscordButton {
    pub label: String,
    pub url: String,
}

enum DiscordMsg {
    Update {
        details: String,
        state: String,
        large_image: String,
        large_text: String,
        small_image: String,
        small_text: String,
        buttons: Option<Vec<DiscordButton>>,
        start_time: Option<i64>,
    },
    Clear,
}

struct DiscordHandle {
    sender: mpsc::Sender<DiscordMsg>,
    enabled: Arc<AtomicBool>,
}

lazy_static::lazy_static! {
    pub static ref HTTP_CLIENT: reqwest::Client = {
        let mut headers = reqwest::header::HeaderMap::new();
        let header = reqwest::header::HeaderValue::from_str("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36").unwrap();
        headers.insert(reqwest::header::USER_AGENT, header);
        reqwest::Client::builder()
            .tcp_keepalive(Some(std::time::Duration::from_secs(30)))
            .tcp_nodelay(true)
            .pool_max_idle_per_host(32)
            .pool_idle_timeout(Some(std::time::Duration::from_secs(90)))
            .connect_timeout(std::time::Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(10))
            .default_headers(headers)
            .build()
            .expect("Reqwest Client Building Failed")
    };
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub r#type: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forge_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fabric_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub neoforge_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quilt_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_width: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_height: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fullscreen: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ram: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jvm_arguments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launcher_visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub java_executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_java_check: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatibility: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_mods: Option<Vec<ExtraModItem>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed_mods: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_content_revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_content_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_icon: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtraModItem {
    pub id: Option<String>,
    pub name: Option<String>,
    pub filename: Option<String>,
    pub url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtraModsManifest {
    pub mods: Vec<ExtraModItem>,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    message: String,
    percentage: f32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LibraryRuleOs {
    pub name: Option<String>,
    pub arch: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LibraryRule {
    pub action: String,
    pub os: Option<LibraryRuleOs>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ArtifactDownload {
    pub path: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LibraryDownloads {
    pub artifact: Option<ArtifactDownload>,
    pub classifiers: Option<std::collections::HashMap<String, ArtifactDownload>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MinecraftLibrary {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub natives: Option<std::collections::HashMap<String, String>>,
    pub rules: Option<Vec<LibraryRule>>,
    pub url: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedArtifact {
    maven_key: String,
    path: String,
    url: String,
    is_native: bool,
}

fn is_library_active(lib: &MinecraftLibrary) -> bool {
    let mut result = false;
    if let Some(rules) = &lib.rules {
        if rules.is_empty() {
            result = true;
        } else {
            let sys_arch = std::env::consts::ARCH;
            for rule in rules {
                let mut applies = true;
                if let Some(os) = &rule.os {
                    if let Some(name) = &os.name {
                        if name != "windows" {
                            applies = false;
                        }
                    }
                    if let Some(arch) = &os.arch {
                        let arch_match = if sys_arch == "x86_64" {
                            arch == "x86_64" || arch == "amd64"
                        } else if sys_arch == "x86" {
                            arch == "x86" || arch == "i386"
                        } else if sys_arch == "aarch64" {
                            arch == "arm64" || arch == "aarch64"
                        } else {
                            arch == sys_arch
                        };
                        if !arch_match {
                            applies = false;
                        }
                    }
                }
                if applies {
                    if rule.action == "allow" {
                        result = true;
                    } else if rule.action == "disallow" {
                        result = false;
                    }
                }
            }
        }
    } else {
        result = true;
    }

    if !result {
        return false;
    }

    let parts: Vec<&str> = lib.name.split(':').collect();
    if parts.len() >= 4 {
        let classifier = parts[3];
        if classifier.starts_with("natives-windows") {
            let sys_arch = std::env::consts::ARCH;
            let is_x86_32 =
                classifier == "natives-windows-x86" || classifier == "natives-windows-x86-32";
            let is_arm64 = classifier == "natives-windows-arm64";

            if sys_arch == "x86_64" {
                if is_x86_32 || is_arm64 {
                    return false;
                }
            } else if sys_arch == "x86" {
                if !is_x86_32 {
                    return false;
                }
            } else if sys_arch == "aarch64" {
                if !is_arm64 {
                    return false;
                }
            }
        }
    }
    true
}

fn resolve_library(lib: &MinecraftLibrary) -> Vec<ResolvedArtifact> {
    let mut artifacts = Vec::new();
    let parts: Vec<&str> = lib.name.split(':').collect();
    let group = if !parts.is_empty() { parts[0] } else { "" };
    let artifact = if parts.len() >= 2 { parts[1] } else { "" };
    let version = if parts.len() >= 3 { parts[2] } else { "" };
    let explicit_classifier = if parts.len() >= 4 { parts[3] } else { "" };

    let base_url = lib
        .url
        .clone()
        .unwrap_or_else(|| "https://libraries.minecraft.net/".to_string());

    let format_path = |classifier: &str| -> String {
        let g = group.replace(".", "/");
        if classifier.is_empty() {
            format!(
                "{}/{}/{}/{}-{}.jar",
                g, artifact, version, artifact, version
            )
        } else {
            format!(
                "{}/{}/{}/{}-{}-{}.jar",
                g, artifact, version, artifact, version, classifier
            )
        }
    };

    if let Some(downloads) = &lib.downloads {
        if let Some(art) = &downloads.artifact {
            if !art.path.is_empty() {
                artifacts.push(ResolvedArtifact {
                    maven_key: format!("{}:{}:{}", group, artifact, explicit_classifier),
                    path: art.path.clone(),
                    url: if art.url.is_empty() {
                        format!("{}{}", base_url, art.path)
                    } else {
                        art.url.clone()
                    },
                    is_native: false,
                });
            }
        }

        if let Some(natives) = &lib.natives {
            if let Some(windows_key) = natives.get("windows") {
                let arch_str = match std::env::consts::ARCH {
                    "x86" => "32",
                    "aarch64" => "arm64",
                    _ => "64",
                };
                let native_classifier = windows_key.replace("${arch}", arch_str);

                if let Some(classifiers) = &downloads.classifiers {
                    if let Some(native_art) = classifiers.get(&native_classifier) {
                        if !native_art.path.is_empty() {
                            artifacts.push(ResolvedArtifact {
                                maven_key: format!("{}:{}:{}", group, artifact, native_classifier),
                                path: native_art.path.clone(),
                                url: if native_art.url.is_empty() {
                                    format!("{}{}", base_url, native_art.path)
                                } else {
                                    native_art.url.clone()
                                },
                                is_native: true,
                            });
                        }
                    }
                }
            }
        }
    } else {
        if let Some(natives) = &lib.natives {
            if let Some(windows_key) = natives.get("windows") {
                let arch_str = match std::env::consts::ARCH {
                    "x86" => "32",
                    "aarch64" => "arm64",
                    _ => "64",
                };
                let native_classifier = windows_key.replace("${arch}", arch_str);
                let path = format_path(&native_classifier);
                
                let mut full_url = base_url.clone();
                if !full_url.ends_with('/') { full_url.push('/'); }
                full_url.push_str(&path);

                artifacts.push(ResolvedArtifact {
                    maven_key: format!("{}:{}:{}", group, artifact, native_classifier),
                    path: path.clone(),
                    url: full_url,
                    is_native: true,
                });
            }
        } else {
            let path = format_path(explicit_classifier);
            
            let mut full_url = base_url.clone();
            if !full_url.ends_with('/') { full_url.push('/'); }
            full_url.push_str(&path);

            artifacts.push(ResolvedArtifact {
                maven_key: format!("{}:{}:{}", group, artifact, explicit_classifier),
                path: path.clone(),
                url: full_url,
                is_native: explicit_classifier.contains("natives"),
            });
        }
    }

    artifacts
}

#[tauri::command]
fn get_system_ram() -> u64 {
    let mut sys = System::new();
    sys.refresh_memory();
    let total_gb = sys.total_memory() / 1024 / 1024 / 1024;
    if total_gb == 0 {
        2
    } else {
        total_gb
    }
}

#[tauri::command]
async fn get_forge_versions(mc_version: String) -> Result<Vec<String>, String> {
    let url = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
    let resp = HTTP_CLIENT.get(url).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if mc_version.is_empty() {
        if let Some(obj) = json.as_object() {
            let mut versions: Vec<String> = obj.keys().cloned().collect();
            versions.sort_by(|a, b| {
                let parse =
                    |s: &str| -> Vec<u32> { s.split('.').filter_map(|n| n.parse().ok()).collect() };
                parse(b).cmp(&parse(a))
            });
            return Ok(versions);
        }
        return Ok(vec![]);
    } else {
        if let Some(builds) = json[&mc_version].as_array() {
            let mut result: Vec<String> = builds
                .iter()
                .filter_map(|b| b.as_str())
                .map(|s| s.split('-').last().unwrap_or(s).to_string())
                .collect();
            result.reverse();
            return Ok(result);
        }
        return Ok(vec![]);
    }
}

#[tauri::command]
async fn get_fabric_versions(mc_version: String) -> Result<Vec<String>, String> {
    let mut result = Vec::new();

    if mc_version.is_empty() {
        let urls = [
            "https://meta.fabricmc.net/v2/versions/game",
            "https://meta.legacyfabric.net/v2/versions/game",
        ];

        for url in urls {
            if let Ok(resp) = HTTP_CLIENT.get(url).send().await {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(versions) = json.as_array() {
                        for v in versions {
                            let is_stable =
                                v.get("stable").and_then(|s| s.as_bool()).unwrap_or(false);
                            if is_stable {
                                if let Some(ver) = v.get("version").and_then(|v| v.as_str()) {
                                    let lower = ver.to_lowercase();
                                    if ver.starts_with("1.")
                                        && !lower.contains("snapshot")
                                        && !lower.contains("pre")
                                        && !lower.contains("rc")
                                        && !lower.contains("beta")
                                        && !lower.contains("alpha")
                                        && !lower.contains("w")
                                    {
                                        if !result.contains(&ver.to_string()) {
                                            result.push(ver.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        result.sort_by(|a, b| {
            let parse = |s: &str| -> Vec<u32> { s.split('.').filter_map(|n| n.parse().ok()).collect() };
            parse(b).cmp(&parse(a))
        });
    } else {
        let urls = [
            format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}",
                mc_version
            ),
            format!(
                "https://meta.legacyfabric.net/v2/versions/loader/{}",
                mc_version
            ),
        ];

        for url in urls {
            if let Ok(resp) = HTTP_CLIENT.get(&url).send().await {
                if resp.status().is_success() {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        if let Some(versions) = json.as_array() {
                            for v in versions {
                                if let Some(loader) = v.get("loader") {
                                    if let Some(ver) =
                                        loader.get("version").and_then(|v| v.as_str())
                                    {
                                        if !result.contains(&ver.to_string()) {
                                            result.push(ver.to_string());
                                        }
                                    }
                                } else if let Some(ver) = v.get("version").and_then(|v| v.as_str())
                                {
                                    if !result.contains(&ver.to_string()) {
                                        result.push(ver.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(result)
}

#[tauri::command]
async fn get_quilt_versions(mc_version: String) -> Result<Vec<String>, String> {
    let mut result = Vec::new();

    if mc_version.is_empty() {
        let url = "https://meta.quiltmc.org/v3/versions/game";
        if let Ok(resp) = HTTP_CLIENT.get(url).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(versions) = json.as_array() {
                    for v in versions {
                        if let Some(ver) = v.get("version").and_then(|v| v.as_str()) {
                            let lower = ver.to_lowercase();
                            if ver.starts_with("1.") 
                                && !lower.contains("snapshot") 
                                && !lower.contains("pre") 
                                && !lower.contains("rc") 
                                && !lower.contains("beta") 
                                && !lower.contains("alpha") 
                            {
                                if !result.contains(&ver.to_string()) {
                                    result.push(ver.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        let url = format!("https://meta.quiltmc.org/v3/versions/loader/{}", mc_version);
        if let Ok(resp) = HTTP_CLIENT.get(&url).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(versions) = json.as_array() {
                        for v in versions {
                            if let Some(loader) = v.get("loader") {
                                if let Some(ver) = loader.get("version").and_then(|v| v.as_str()) {
                                    if !result.contains(&ver.to_string()) {
                                        result.push(ver.to_string());
                                    }
                                }
                            } else if let Some(ver) = v.get("version").and_then(|v| v.as_str()) {
                                if !result.contains(&ver.to_string()) {
                                    result.push(ver.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(result)
}

#[tauri::command]
async fn get_neoforge_versions(mc_version: String) -> Result<Vec<String>, String> {
    let url = "https://meta.prismlauncher.org/v1/net.neoforged/index.json";
    let resp = HTTP_CLIENT.get(url).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let versions = json
        .get("versions")
        .and_then(|v| v.as_array())
        .ok_or("Formato de índice inválido")?;

    let mut result = Vec::new();

    if mc_version.is_empty() {
        for v in versions {
            if let Some(reqs) = v.get("requires").and_then(|r| r.as_array()) {
                for req in reqs {
                    if req.get("uid").and_then(|u| u.as_str()) == Some("net.minecraft") {
                        if let Some(equals) = req.get("equals").and_then(|e| e.as_str()) {
                            let lower = equals.to_lowercase();
                            if equals.starts_with("1.") 
                                && !lower.contains("snapshot") 
                                && !lower.contains("pre") 
                                && !lower.contains("rc") 
                                && !lower.contains("beta") 
                                && !lower.contains("alpha") 
                            {
                                if !result.contains(&equals.to_string()) {
                                    result.push(equals.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
        result.sort_by(|a, b| {
            let parse =
                |s: &str| -> Vec<u32> { s.split('.').filter_map(|n| n.parse().ok()).collect() };
            parse(b).cmp(&parse(a))
        });
    } else {
        for v in versions {
            if let Some(reqs) = v.get("requires").and_then(|r| r.as_array()) {
                let mut matches_mc = false;
                for req in reqs {
                    if req.get("uid").and_then(|u| u.as_str()) == Some("net.minecraft") {
                        if let Some(equals) = req.get("equals").and_then(|e| e.as_str()) {
                            if equals == mc_version {
                                matches_mc = true;
                                break;
                            }
                        }
                    }
                }
                if matches_mc {
                    if let Some(version) = v.get("version").and_then(|v| v.as_str()) {
                        if !result.contains(&version.to_string()) {
                            result.push(version.to_string());
                        }
                    }
                }
            }
        }
        result.sort_by(|a, b| {
            let parse =
                |s: &str| -> Vec<u32> { s.split('.').filter_map(|n| n.parse().ok()).collect() };
            parse(b).cmp(&parse(a))
        });
    }

    Ok(result)
}

fn default_launcher_base_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".navithlabs")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(".navithlabs")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
            if !xdg_data.trim().is_empty() {
                return PathBuf::from(xdg_data).join(".navithlabs");
            }
        }
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".navithlabs")
    }
}

pub fn get_launcher_base_dir() -> PathBuf {
    let default_dir = default_launcher_base_dir();
    let settings_path = default_dir.join("launcher-settings.json");
    let configured_dir = fs::read_to_string(settings_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|settings| {
            settings
                .get("gameDirectory")
                .and_then(serde_json::Value::as_str)
                .map(PathBuf::from)
        })
        .filter(|path| path.is_absolute());
    configured_dir.unwrap_or(default_dir)
}

#[tauri::command]
fn set_launcher_base_dir(path: String) -> Result<String, String> {
    let default_dir = default_launcher_base_dir();
    let settings_path = default_dir.join("launcher-settings.json");
    let trimmed = path.trim();

    if trimmed.is_empty() {
        if settings_path.exists() {
            fs::remove_file(&settings_path)
                .map_err(|error| format!("No se pudo restaurar la carpeta predeterminada: {error}"))?;
        }
        return Ok(default_dir.to_string_lossy().to_string());
    }

    let selected_dir = PathBuf::from(trimmed);
    if !selected_dir.is_absolute() {
        return Err("Selecciona una ruta absoluta para la carpeta de instalación.".to_string());
    }

    fs::create_dir_all(&selected_dir)
        .map_err(|error| format!("No se pudo crear la carpeta seleccionada: {error}"))?;
    fs::create_dir_all(&default_dir)
        .map_err(|error| format!("No se pudo guardar la configuración del launcher: {error}"))?;
    let settings = serde_json::json!({ "gameDirectory": selected_dir.to_string_lossy() });
    fs::write(
        settings_path,
        serde_json::to_vec_pretty(&settings)
            .map_err(|error| format!("No se pudo preparar la configuración: {error}"))?,
    )
    .map_err(|error| format!("No se pudo guardar la carpeta seleccionada: {error}"))?;

    Ok(selected_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn get_default_game_directory() -> String {
    let path = get_launcher_base_dir();
    path.to_string_lossy().to_string()
}

#[tauri::command]
fn open_folder(path: String) {
    let clean_path = path.trim();
    if clean_path.is_empty() {
        return;
    }

    #[cfg(target_os = "windows")]
    {
        let win_path_str = clean_path.replace('/', "\\");
        let p = PathBuf::from(&win_path_str);

        let target_path = if p.is_file() {
            p.parent().unwrap_or(&p).to_path_buf()
        } else {
            if !p.exists() {
                let _ = fs::create_dir_all(&p);
            }
            p
        };

        let final_path = target_path.to_string_lossy().to_string();
        let _ = Command::new("explorer").arg(&final_path).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let p = PathBuf::from(clean_path);
        let target_path = if p.is_file() {
            p.parent().unwrap_or(&p).to_path_buf()
        } else {
            if !p.exists() {
                let _ = fs::create_dir_all(&p);
            }
            p
        };
        let _ = Command::new("open").arg(&target_path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let p = PathBuf::from(clean_path);
        let target_path = if p.is_file() {
            p.parent().unwrap_or(&p).to_path_buf()
        } else {
            if !p.exists() {
                let _ = fs::create_dir_all(&p);
            }
            p
        };
        let _ = Command::new("xdg-open").arg(&target_path).spawn();
    }
}

#[tauri::command]
fn get_instance_icon(game_directory: Option<String>) -> Option<String> {
    if let Some(dir) = game_directory {
        let icon_path = PathBuf::from(&dir).join("icon.png");
        if icon_path.exists() {
            if let Ok(data) = fs::read(icon_path) {
                use base64::{Engine as _, engine::general_purpose};
                return Some(format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(data)));
            }
        }
    }
    None
}

#[tauri::command]
fn update_presence(
    details: String, 
    state: String, 
    large_image: String, 
    large_text: String,
    small_image: String,
    small_text: String,
    buttons: Option<Vec<DiscordButton>>,
    start_time: Option<i64>,
    handle: tauri::State<'_, DiscordHandle>
) {
    handle.enabled.store(true, Ordering::Relaxed);
    let _ = handle.sender.send(DiscordMsg::Update {
        details,
        state,
        large_image,
        large_text,
        small_image,
        small_text,
        buttons,
        start_time,
    });
}

#[tauri::command]
fn clear_presence(handle: tauri::State<'_, DiscordHandle>) {
    handle.enabled.store(false, Ordering::Relaxed);
    let _ = handle.sender.send(DiscordMsg::Clear);
}

#[tauri::command]
async fn get_curseforge_files(mod_id: u64) -> Result<serde_json::Value, String> {
    let client = HTTP_CLIENT.clone();
    let files = fetch_all_curseforge_files(&client, mod_id).await?;

    Ok(serde_json::json!({
        "data": files,
        "pagination": {
            "totalCount": files.len(),
            "index": 0,
            "pageSize": CURSEFORGE_FILES_PAGE_SIZE,
        }
    }))
}

async fn fetch_all_curseforge_files(
    client: &reqwest::Client,
    mod_id: u64,
) -> Result<Vec<serde_json::Value>, String> {
    let mut files = Vec::new();
    let mut index = 0usize;

    loop {
        let url = format!("https://api.curseforge.com/v1/mods/{}/files", mod_id);
        let page_size = CURSEFORGE_FILES_PAGE_SIZE.to_string();
        let page_index = index.to_string();
        let response = client
            .get(&url)
            .header("x-api-key", CURSEFORGE_API_KEY)
            .header("Accept", "application/json")
            .query(&[("index", page_index.as_str()), ("pageSize", page_size.as_str())])
            .send()
            .await
            .map_err(|e| format!("No se pudo consultar los archivos de CurseForge: {}", e))?
            .error_for_status()
            .map_err(|e| format!("CurseForge rechazó la consulta de archivos: {}", e))?;

        let page: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Respuesta de archivos de CurseForge inválida: {}", e))?;
        let page_files = page["data"]
            .as_array()
            .ok_or_else(|| "CurseForge no devolvió una lista de archivos.".to_string())?;
        let received = page_files.len();
        files.extend(page_files.iter().cloned());

        let total = page["pagination"]["totalCount"]
            .as_u64()
            .map(|count| count as usize)
            .unwrap_or(files.len());

        if received == 0 || files.len() >= total {
            break;
        }

        index += received;
    }

    Ok(files)
}

#[allow(dead_code)]
async fn download_from_mirrors(
    client: &reqwest::Client,
    urls: &[String],
    expected_sha512: Option<&str>,
) -> Result<Vec<u8>, String> {
    let mut last_error = "sin respuesta de los servidores".to_string();

    for url in urls {
        for attempt in 1..=4 {
            match tokio::time::timeout(
                std::time::Duration::from_secs(45),
                client.get(url).send(),
            )
            .await
            {
                Ok(Ok(response)) if response.status().is_success() => match response.bytes().await {
                    Ok(bytes) if !bytes.is_empty() => {
                        if let Some(expected) = expected_sha512 {
                            let actual = format!("{:x}", Sha512::digest(&bytes));
                            if !actual.eq_ignore_ascii_case(expected) {
                                last_error = "la descarga no coincide con el hash SHA-512 declarado".to_string();
                                break;
                            }
                        }
                        return Ok(bytes.to_vec());
                    }
                    Ok(_) => last_error = "el servidor devolvió un archivo vacío".to_string(),
                    Err(error) => last_error = format!("no se pudo leer la descarga: {}", error),
                },
                Ok(Ok(response)) => {
                    last_error = format!("el servidor respondió HTTP {}", response.status());
                }
                Ok(Err(error)) => last_error = format!("error de red: {}", error),
                Err(_) => last_error = "la descarga agotó el tiempo de espera".to_string(),
            }

            tokio::time::sleep(std::time::Duration::from_millis(400 * attempt)).await;
        }
    }

    Err(last_error)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DetectedModInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub loader: String,
    pub source_path: String,
    pub suggested_file_name: String,
    pub size_mb: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstanceEnvironmentReport {
    pub environment_type: String,
    pub environment_name: String,
    pub has_standard_mods: bool,
    pub standard_mods_count: usize,
    pub external_mods_count: usize,
    pub detected_mods: Vec<DetectedModInfo>,
    pub details: String,
    pub requires_adaptation: bool,
}

fn inspect_jar_for_mod(jar_path: &std::path::Path) -> Option<DetectedModInfo> {
    let file = fs::File::open(jar_path).ok()?;
    let size_mb = (file.metadata().map(|m| m.len() as f64 / 1024.0 / 1024.0).unwrap_or(0.0) * 100.0).round() / 100.0;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    
    if let Ok(mut fabric_file) = zip.by_name("fabric.mod.json") {
        let mut content = String::new();
        if std::io::Read::read_to_string(&mut fabric_file, &mut content).is_ok() {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let id = json.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                let name = json.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
                let version = json.get("version").and_then(|v| v.as_str()).unwrap_or("1.0.0").to_string();
                
                let clean_name = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                let clean_ver = version.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                let suggested_file_name = format!("{}-{}.jar", clean_name, clean_ver);

                return Some(DetectedModInfo {
                    id,
                    name,
                    version,
                    loader: "Fabric".to_string(),
                    source_path: jar_path.to_string_lossy().to_string(),
                    suggested_file_name,
                    size_mb,
                });
            }
        }
    }

    if let Ok(mut neoforge_file) = zip.by_name("META-INF/neoforge.mods.toml") {
        let mut content = String::new();
        if std::io::Read::read_to_string(&mut neoforge_file, &mut content).is_ok() {
            let mut mod_id = String::new();
            let mut mod_name = String::new();
            let mut mod_version = String::new();

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("modId") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        if mod_id.is_empty() {
                            mod_id = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        }
                    }
                } else if trimmed.starts_with("displayName") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        if mod_name.is_empty() {
                            mod_name = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        }
                    }
                } else if trimmed.starts_with("version") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        if mod_version.is_empty() {
                            mod_version = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        }
                    }
                }
            }

            if !mod_id.is_empty() {
                if mod_name.is_empty() { mod_name = mod_id.clone(); }
                if mod_version.is_empty() || mod_version == "${file.jarVersion}" { mod_version = "1.0.0".to_string(); }
                
                let clean_name = mod_name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                let clean_ver = mod_version.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                let suggested_file_name = format!("{}-{}.jar", clean_name, clean_ver);

                return Some(DetectedModInfo {
                    id: mod_id,
                    name: mod_name,
                    version: mod_version,
                    loader: "NeoForge".to_string(),
                    source_path: jar_path.to_string_lossy().to_string(),
                    suggested_file_name,
                    size_mb,
                });
            }
        }
    }

    if let Ok(mut forge_file) = zip.by_name("META-INF/mods.toml") {
        let mut content = String::new();
        if std::io::Read::read_to_string(&mut forge_file, &mut content).is_ok() {
            let mut mod_id = String::new();
            let mut mod_name = String::new();
            let mut mod_version = String::new();

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("modId") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        if mod_id.is_empty() {
                            mod_id = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        }
                    }
                } else if trimmed.starts_with("displayName") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        if mod_name.is_empty() {
                            mod_name = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        }
                    }
                } else if trimmed.starts_with("version") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        if mod_version.is_empty() {
                            mod_version = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        }
                    }
                }
            }

            if !mod_id.is_empty() {
                if mod_name.is_empty() { mod_name = mod_id.clone(); }
                if mod_version.is_empty() || mod_version == "${file.jarVersion}" { mod_version = "1.0.0".to_string(); }
                
                let clean_name = mod_name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                let clean_ver = mod_version.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                let suggested_file_name = format!("{}-{}.jar", clean_name, clean_ver);

                return Some(DetectedModInfo {
                    id: mod_id,
                    name: mod_name,
                    version: mod_version,
                    loader: "Forge/NeoForge".to_string(),
                    source_path: jar_path.to_string_lossy().to_string(),
                    suggested_file_name,
                    size_mb,
                });
            }
        }
    }

    if let Ok(mut quilt_file) = zip.by_name("quilt.mod.json") {
        let mut content = String::new();
        if std::io::Read::read_to_string(&mut quilt_file, &mut content).is_ok() {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let quilt_loader = json.get("quilt_loader");
                let id = quilt_loader.and_then(|q| q.get("id")).and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                let metadata = quilt_loader.and_then(|q| q.get("metadata"));
                let name = metadata.and_then(|m| m.get("name")).and_then(|v| v.as_str()).unwrap_or(&id).to_string();
                let version = quilt_loader.and_then(|q| q.get("version")).and_then(|v| v.as_str()).unwrap_or("1.0.0").to_string();

                let clean_name = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                let clean_ver = version.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                let suggested_file_name = format!("{}-{}.jar", clean_name, clean_ver);

                return Some(DetectedModInfo {
                    id,
                    name,
                    version,
                    loader: "Quilt".to_string(),
                    source_path: jar_path.to_string_lossy().to_string(),
                    suggested_file_name,
                    size_mb,
                });
            }
        }
    }

    if let Ok(mut mcmod_file) = zip.by_name("mcmod.info") {
        let mut content = String::new();
        if std::io::Read::read_to_string(&mut mcmod_file, &mut content).is_ok() {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let first_mod = if json.is_array() {
                    json.as_array().and_then(|a| a.first()).cloned()
                } else {
                    json.get("modList").and_then(|l| l.as_array()).and_then(|a| a.first()).cloned()
                };
                if let Some(m) = first_mod {
                    let id = m.get("modid").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                    let name = m.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
                    let version = m.get("version").and_then(|v| v.as_str()).unwrap_or("1.0.0").to_string();
                    
                    let clean_name = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                    let clean_ver = version.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
                    let suggested_file_name = format!("{}-{}.jar", clean_name, clean_ver);

                    return Some(DetectedModInfo {
                        id,
                        name,
                        version,
                        loader: "Forge".to_string(),
                        source_path: jar_path.to_string_lossy().to_string(),
                        suggested_file_name,
                        size_mb,
                    });
                }
            }
        }
    }

    None
}

fn percent_encode_cf_name(input: &str) -> String {
    let mut encoded = String::new();
    for b in input.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(b as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", b));
            }
        }
    }
    encoded
}

fn deduplicate_instance_mods(mods_dir: &std::path::Path) {
    if !mods_dir.exists() { return; }
    let mut jars = Vec::new();
    if let Ok(entries) = fs::read_dir(mods_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.to_string_lossy().eq_ignore_ascii_case("jar") {
                        jars.push(path);
                    }
                }
            }
        }
    }

    let mut mod_map: std::collections::HashMap<String, Vec<(PathBuf, String, u64)>> = std::collections::HashMap::new();

    for jar_path in jars {
        if let Some(info) = inspect_jar_for_mod(&jar_path) {
            let file_size = fs::metadata(&jar_path).map(|m| m.len()).unwrap_or(0);
            let key = info.id.trim().to_lowercase();
            if !key.is_empty() && key != "unknown" {
                mod_map.entry(key).or_default().push((jar_path, info.version, file_size));
            }
        }
    }

    for (mod_id, mut files) in mod_map {
        if files.len() > 1 {
            files.sort_by(|a, b| {
                let parse_ver = |v: &str| -> Vec<u32> {
                    v.split(|c: char| !c.is_ascii_digit())
                        .filter_map(|s| s.parse::<u32>().ok())
                        .collect()
                };
                let va = parse_ver(&a.1);
                let vb = parse_ver(&b.1);
                vb.cmp(&va).then_with(|| b.2.cmp(&a.2))
            });

            for (path_to_remove, ver, _) in files.iter().skip(1) {
                eprintln!("Eliminando mod duplicado/antiguo para '{}': {:?} (v{})", mod_id, path_to_remove.file_name(), ver);
                let _ = fs::remove_file(path_to_remove);
            }
        }
    }
}

async fn process_curseforge_manifest_and_extract(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    manifest: &serde_json::Value,
    archive_bytes: &[u8],
    modpacks_dir: &PathBuf,
) -> Result<(), String> {
    let emit = |msg: &str, pct: f32| {
        let _ = app.emit("download-progress", ProgressPayload {
            message: msg.to_string(),
            percentage: pct,
        });
    };

    if let Some(files) = manifest["files"].as_array() {
        let mut file_id_to_project_id: std::collections::HashMap<u64, u64> = std::collections::HashMap::new();
        let mut file_ids = Vec::new();
        for file_info in files.iter() {
            if let Some(fid) = file_info["fileID"].as_u64() {
                file_ids.push(fid);
                if let Some(pid) = file_info["projectID"].as_u64() {
                    file_id_to_project_id.insert(fid, pid);
                }
            }
        }

        let mut all_files_map: std::collections::HashMap<u64, serde_json::Value> = std::collections::HashMap::new();
        emit("Obteniendo metadatos de mods en lote...", 25.0);

        for chunk in file_ids.chunks(50) {
            let body = serde_json::json!({ "fileIds": chunk });
            for attempt in 1..=3 {
                let f_res = client.post("https://api.curseforge.com/v1/mods/files")
                    .header("x-api-key", CURSEFORGE_API_KEY)
                    .json(&body)
                    .send()
                    .await;

                if let Ok(resp) = f_res {
                    if resp.status().is_success() {
                        if let Ok(f_json) = resp.json::<serde_json::Value>().await {
                            if let Some(data) = f_json["data"].as_array() {
                                for item in data {
                                    if let Some(fid) = item["id"].as_u64() {
                                        all_files_map.insert(fid, item.clone());
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(250 * attempt)).await;
            }
        }

        let missing_fids: Vec<u64> = file_ids.iter().filter(|fid| !all_files_map.contains_key(fid)).cloned().collect();
        if !missing_fids.is_empty() {
            emit(&format!("Recuperando metadatos individuales para {} componentes...", missing_fids.len()), 28.0);
            for fid in missing_fids {
                let pid_opt = file_id_to_project_id.get(&fid).cloned();
                let url = if let Some(pid) = pid_opt {
                    format!("https://api.curseforge.com/v1/mods/{}/files/{}", pid, fid)
                } else {
                    format!("https://api.curseforge.com/v1/mods/files/{}", fid)
                };

                if let Ok(resp) = client.get(&url).header("x-api-key", CURSEFORGE_API_KEY).send().await {
                    if resp.status().is_success() {
                        if let Ok(f_json) = resp.json::<serde_json::Value>().await {
                            if let Some(data) = f_json.get("data") {
                                if data.is_object() {
                                    all_files_map.insert(fid, data.clone());
                                }
                            }
                        }
                    }
                }
            }
        }

        let all_files_metadata: Vec<serde_json::Value> = all_files_map.into_values().collect();
        let total_files = all_files_metadata.len();
        emit(&format!("Descargando {} componentes de CurseForge...", total_files), 30.0);

        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(16));
        let completed_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

        let mut handles = Vec::new();

        for file_metadata in all_files_metadata {
            let file_name = file_metadata["fileName"].as_str().unwrap_or("file.jar").to_string();
            let file_id_opt = file_metadata["id"].as_u64();
            let mod_id_opt = file_metadata["modId"].as_u64();

            let mut download_candidates: Vec<String> = Vec::new();

            if let Some(url) = file_metadata["downloadUrl"].as_str() {
                if !url.trim().is_empty() {
                    download_candidates.push(url.to_string());
                }
            }

            if let Some(f_id) = file_id_opt {
                let p1 = f_id / 1000;
                let p2_raw = (f_id % 1000).to_string();
                let p2_pad = format!("{:03}", f_id % 1000);
                
                let encoded_name = percent_encode_cf_name(&file_name);
                let space_name = file_name.replace(' ', "%20");
                let raw_name = file_name.clone();

                for p2 in [&p2_raw, &p2_pad] {
                    for n in [&encoded_name, &space_name, &raw_name] {
                        download_candidates.push(format!("https://edge.forgecdn.net/files/{}/{}/{}", p1, p2, n));
                        download_candidates.push(format!("https://mediafilez.forgecdn.net/files/{}/{}/{}", p1, p2, n));
                    }
                }
            }

            if let (Some(m_id), Some(f_id)) = (mod_id_opt, file_id_opt) {
                download_candidates.push(format!("https://www.curseforge.com/api/v1/mods/{}/files/{}/download", m_id, f_id));
            }

            if let Some(hashes) = file_metadata["hashes"].as_array() {
                for hash_obj in hashes {
                    if hash_obj["algo"].as_u64() == Some(1) { // 1 = SHA1
                        if let Some(sha1_val) = hash_obj["value"].as_str() {
                            let mr_url = format!("https://api.modrinth.com/v2/version_file/{}?algorithm=sha1", sha1_val);
                            if let Ok(mr_res) = client.get(&mr_url).send().await {
                                if let Ok(mr_json) = mr_res.json::<serde_json::Value>().await {
                                    if let Some(files) = mr_json["files"].as_array() {
                                        if let Some(first_file) = files.first() {
                                            if let Some(url) = first_file["url"].as_str() {
                                                download_candidates.push(url.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            let sem = semaphore.clone();
            let client_c = client.clone();
            let completed_c = completed_count.clone();
            let app_c = app.clone();
            let m_dir = modpacks_dir.clone();
            let total = total_files;

            let handle = tokio::spawn(async move {
                let _permit = sem.acquire().await;
                let mut mod_bytes_opt = None;

                'candidates: for download_url in download_candidates {
                    for attempt in 1..=3 {
                        let req = if download_url.contains("api.curseforge.com") {
                            client_c.get(&download_url).header("x-api-key", CURSEFORGE_API_KEY)
                        } else {
                            client_c.get(&download_url)
                        };

                        if let Ok(Ok(resp)) = tokio::time::timeout(std::time::Duration::from_secs(35), req.send()).await {
                            if resp.status().is_success() {
                                if let Ok(bytes) = resp.bytes().await {
                                    if !bytes.is_empty() {
                                        mod_bytes_opt = Some(bytes);
                                        break 'candidates;
                                    }
                                }
                            }
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(200 * attempt)).await;
                    }
                }

                if let Some(mod_bytes) = mod_bytes_opt {
                    let fn_lower = file_name.to_lowercase();
                    let target_folder = if fn_lower.ends_with(".jar") {
                        "mods"
                    } else if fn_lower.ends_with(".zip") {
                        let reader = std::io::Cursor::new(&mod_bytes);
                        let mut is_shader_pack = false;
                        let mut is_mod = false;
                        if let Ok(mut archive) = zip::ZipArchive::new(reader) {
                            if archive.by_name("fabric.mod.json").is_ok()
                                || archive.by_name("META-INF/mods.toml").is_ok()
                                || archive.by_name("mcmod.info").is_ok()
                                || archive.by_name("quilt.mod.json").is_ok()
                                || archive.by_name("META-INF/neoforge.mods.toml").is_ok()
                            {
                                is_mod = true;
                            }
                            for j in 0..archive.len() {
                                if let Ok(f) = archive.by_index(j) {
                                    let n = f.name().to_lowercase();
                                    if n.contains("/shaders/") || n.starts_with("shaders/") {
                                        is_shader_pack = true;
                                        break;
                                    }
                                }
                            }
                        }
                        if is_mod { "mods" } else if is_shader_pack { "shaderpacks" } else { "resourcepacks" }
                    } else {
                        "mods"
                    };

                    let target_dir = m_dir.join(target_folder);
                    let _ = fs::create_dir_all(&target_dir);
                    let _ = fs::write(target_dir.join(&file_name), &mod_bytes);
                } else {
                    eprintln!("Advertencia: No se pudo descargar el archivo {}", file_name);
                }

                let curr = completed_c.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                let pct = 30.0 + (curr as f32 / total as f32) * 60.0;
                let _ = app_c.emit("download-progress", ProgressPayload {
                    message: format!("Descargando componentes ({}/{})...", curr, total),
                    percentage: pct,
                });
            });

            handles.push(handle);
        }

        for h in handles {
            let _ = h.await;
        }
    }

    emit("Extrayendo configuraciones, shaders y recursos...", 92.0);
    let overrides_folder_from_manifest = manifest["overrides"].as_str().unwrap_or("overrides");
    let overrides_folder_lower = overrides_folder_from_manifest.to_lowercase();

    if let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)) {
        for i in 0..archive.len() {
            if let Ok(mut file) = archive.by_index(i) {
                let full_name = file.name().to_string();
                let lower_name = full_name.to_lowercase();
                if lower_name == "manifest.json" || lower_name == "modrinth.index.json" { continue; }

                let mut clean_path_opt: Option<&str> = None;

                let slash_prefix = format!("{}/", overrides_folder_lower);
                let bslash_prefix = format!("{}\\", overrides_folder_lower);

                if lower_name.starts_with(&slash_prefix) {
                    clean_path_opt = Some(&full_name[slash_prefix.len()..]);
                } else if lower_name.starts_with(&bslash_prefix) {
                    clean_path_opt = Some(&full_name[bslash_prefix.len()..]);
                } else if lower_name.starts_with("overrides/") {
                    clean_path_opt = Some(&full_name["overrides/".len()..]);
                } else if lower_name.starts_with("overrides\\") {
                    clean_path_opt = Some(&full_name["overrides\\".len()..]);
                } else if lower_name.starts_with("client-overrides/") {
                    clean_path_opt = Some(&full_name["client-overrides/".len()..]);
                } else if lower_name.starts_with("client-overrides\\") {
                    clean_path_opt = Some(&full_name["client-overrides\\".len()..]);
                }

                if let Some(clean_path) = clean_path_opt {
                    if clean_path.is_empty() { continue; }
                    let dest_path = modpacks_dir.join(clean_path);

                    if file.is_dir() {
                        let _ = fs::create_dir_all(&dest_path);
                    } else {
                        if let Some(p) = dest_path.parent() {
                            let _ = fs::create_dir_all(p);
                        }
                        if let Ok(mut outfile) = fs::File::create(&dest_path) {
                            let _ = std::io::copy(&mut file, &mut outfile);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

async fn process_modrinth_index_and_extract(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    index: &serde_json::Value,
    archive_bytes: &[u8],
    modpacks_dir: &PathBuf,
) -> Result<(), String> {
    let emit = |msg: &str, pct: f32| {
        let _ = app.emit("download-progress", ProgressPayload {
            message: msg.to_string(),
            percentage: pct,
        });
    };

    if let Some(files) = index["files"].as_array() {
        let total_files = files.len();
        emit(&format!("Descargando {} archivos de mods en paralelo...", total_files), 25.0);

        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(16));
        let completed_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

        let mut handles = Vec::new();

        for file_info in files {
            let path_str = match file_info["path"].as_str() {
                Some(p) => p.to_string(),
                None => continue,
            };

            if let Some(env_client) = file_info["env"]["client"].as_str() {
                if env_client.eq_ignore_ascii_case("unsupported") {
                    continue;
                }
            }

            let download_urls: Vec<String> = file_info["downloads"]
                .as_array()
                .map(|urls| urls.iter().filter_map(|url| url.as_str().map(str::to_string)).collect())
                .unwrap_or_default();

            if download_urls.is_empty() {
                eprintln!("Advertencia: {} no declara URLs de descarga.", path_str);
                continue;
            }

            let expected_sha512 = file_info["hashes"]["sha512"].as_str().map(str::to_string);
            let expected_sha1 = file_info["hashes"]["sha1"].as_str().map(str::to_string);

            let target_path = modpacks_dir.join(&path_str);
            let sem = semaphore.clone();
            let client_c = client.clone();
            let completed_c = completed_count.clone();
            let app_c = app.clone();
            let total = total_files;

            let handle = tokio::spawn(async move {
                let _permit = sem.acquire().await;
                if let Some(parent) = target_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }

                let mut success = false;
                'mirrors: for download_url in &download_urls {
                    for attempt in 1..=5 {
                        let download_fut = client_c.get(download_url).send();
                        if let Ok(Ok(resp)) = tokio::time::timeout(std::time::Duration::from_secs(60), download_fut).await {
                            if resp.status().is_success() {
                                if let Ok(b) = resp.bytes().await {
                                    let f_bytes = b.to_vec();
                                    if !f_bytes.is_empty() {
                                        let mut valid = true;
                                        if let Some(expected512) = &expected_sha512 {
                                            let actual = format!("{:x}", Sha512::digest(&f_bytes));
                                            if !actual.eq_ignore_ascii_case(expected512) {
                                                eprintln!("Hash SHA-512 erróneo para {} (intento {}), reintentando...", path_str, attempt);
                                                valid = false;
                                            }
                                        } else if let Some(expected1) = &expected_sha1 {
                                            let actual = format!("{:x}", Sha1::digest(&f_bytes));
                                            if !actual.eq_ignore_ascii_case(expected1) {
                                                eprintln!("Hash SHA-1 erróneo para {} (intento {}), reintentando...", path_str, attempt);
                                                valid = false;
                                            }
                                        }

                                        if valid {
                                            if fs::write(&target_path, &f_bytes).is_ok() {
                                                success = true;
                                                break 'mirrors;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(300 * attempt)).await;
                    }
                }

                let curr = completed_c.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                let pct = 25.0 + (curr as f32 / total as f32) * 65.0;
                let _ = app_c.emit("download-progress", ProgressPayload {
                    message: format!("Descargando mods ({}/{})...", curr, total),
                    percentage: pct,
                });

                if !success {
                    eprintln!("ERROR CRÍTICO: No se pudo descargar el archivo {}", path_str);
                }
            });

            handles.push(handle);
        }

        for handle in handles {
            let _ = handle.await;
        }
    }

    emit("Extrayendo configuraciones, shaders y recursos...", 92.0);
    if let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)) {
        for i in 0..archive.len() {
            if let Ok(mut file) = archive.by_index(i) {
                let full_name = file.name().to_string();
                if full_name == "modrinth.index.json" { continue; }

                let clean_path = if full_name.starts_with("overrides/") {
                    &full_name["overrides/".len()..]
                } else if full_name.starts_with("overrides\\") {
                    &full_name["overrides\\".len()..]
                } else if full_name.starts_with("client-overrides/") {
                    &full_name["client-overrides/".len()..]
                } else if full_name.starts_with("client-overrides\\") {
                    &full_name["client-overrides\\".len()..]
                } else {
                    &full_name
                };

                if clean_path.is_empty() { continue; }
                let dest_path = modpacks_dir.join(clean_path);

                if file.is_dir() {
                    let _ = fs::create_dir_all(&dest_path);
                } else {
                    if let Some(p) = dest_path.parent() {
                        let _ = fs::create_dir_all(p);
                    }
                    if let Ok(mut outfile) = fs::File::create(&dest_path) {
                        let _ = std::io::copy(&mut file, &mut outfile);
                    }
                }
            }
        }
    }

    let mc_ver = index["dependencies"]["minecraft"].as_str().unwrap_or("1.20.1");
    ensure_instance_missing_dependencies(&modpacks_dir.join("mods"), mc_ver).await;

    Ok(())
}

async fn ensure_instance_missing_dependencies(mods_dir: &std::path::Path, mc_version: &str) {
    if !mods_dir.exists() { return; }

    let mut has_quests_fixes = false;
    let mut has_ftb_quests = false;
    let mut has_ftb_teams = false;
    let mut has_ftb_library = false;

    if let Ok(entries) = fs::read_dir(mods_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_lowercase();
            if fname.contains("quests_teams_fixes") {
                has_quests_fixes = true;
            }
            if fname.contains("ftb-quests") || fname.contains("ftbquests") {
                has_ftb_quests = true;
            }
            if fname.contains("ftb-teams") || fname.contains("ftbteams") {
                has_ftb_teams = true;
            }
            if fname.contains("ftb-library") || fname.contains("ftblibrary") {
                has_ftb_library = true;
            }
        }
    }

    if has_quests_fixes && mc_version == "1.20.1" {
        let ftb_downloads = [
            (!has_ftb_library, "ftb-library-fabric-2001.2.13.jar", "https://edge.forgecdn.net/files/8226/926/ftb-library-fabric-2001.2.13.jar"),
            (!has_ftb_teams, "ftb-teams-fabric-2001.3.2.jar", "https://edge.forgecdn.net/files/7499/808/ftb-teams-fabric-2001.3.2.jar"),
            (!has_ftb_quests, "ftb-quests-fabric-2001.4.22.jar", "https://edge.forgecdn.net/files/8078/537/ftb-quests-fabric-2001.4.22.jar"),
        ];

        for (needed, filename, url) in ftb_downloads {
            if needed {
                let target_path = mods_dir.join(filename);
                if !target_path.exists() {
                    eprintln!("Auto-resolviendo y descargando dependencia FTB faltante: {}", filename);
                    if let Ok(resp) = HTTP_CLIENT.get(url).send().await {
                        if resp.status().is_success() {
                            if let Ok(bytes) = resp.bytes().await {
                                let _ = fs::write(&target_path, bytes);
                            }
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
async fn precache_installation_components(
    app: tauri::AppHandle,
    version: String,
    loader_type: String,
    loader_version: Option<String>,
) -> Result<(), String> {
    precache_instance_environment(&app, &version, &loader_type, loader_version.as_deref()).await
}

fn read_cached_fabric_profile(path: &PathBuf) -> Option<serde_json::Value> {
    let contents = fs::read_to_string(path).ok()?;
    let profile = serde_json::from_str::<serde_json::Value>(&contents).ok()?;
    profile.get("inheritsFrom")?.as_str()?;
    profile.get("libraries")?.as_array()?;
    Some(profile)
}

async fn fetch_fabric_profile(
    minecraft_version: &str,
    loader_version: &str,
) -> Result<serde_json::Value, String> {
    let endpoints = [
        (
            "Fabric",
            format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
                minecraft_version, loader_version
            ),
        ),
        (
            "Legacy Fabric",
            format!(
                "https://meta.legacyfabric.net/v2/versions/loader/{}/{}/profile/json",
                minecraft_version, loader_version
            ),
        ),
    ];
    let mut last_error = "El servicio de metadatos no respondió.".to_string();

    for (service, url) in endpoints {
        for attempt in 0..2 {
            let response = match HTTP_CLIENT
                .get(&url)
                .header(reqwest::header::ACCEPT, "application/json")
                .send()
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    last_error = format!("{}: {}", service, error);
                    if attempt == 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
                        continue;
                    }
                    break;
                }
            };

            if response.status().is_success() {
                let body = response.text().await.map_err(|error| {
                    format!("No se pudo leer la respuesta de {}: {}", service, error)
                })?;
                let profile = serde_json::from_str::<serde_json::Value>(&body).map_err(|error| {
                    format!("{} devolvió un perfil inválido: {}", service, error)
                })?;
                if profile.get("inheritsFrom").and_then(|value| value.as_str()).is_some()
                    && profile.get("libraries").and_then(|value| value.as_array()).is_some()
                {
                    return Ok(profile);
                }
                last_error = format!("{} devolvió un perfil incompleto.", service);
                break;
            }

            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let detail = body.split_whitespace().take(24).collect::<Vec<_>>().join(" ");
            last_error = if detail.is_empty() {
                format!("{} respondió HTTP {}.", service, status)
            } else {
                format!("{} respondió HTTP {}: {}", service, status, detail)
            };

            let retryable = status.as_u16() == 400 || status.as_u16() == 429 || status.is_server_error();
            if attempt == 0 && retryable {
                tokio::time::sleep(std::time::Duration::from_millis(350)).await;
                continue;
            }
            break;
        }
    }

    Err(format!(
        "No se pudo preparar Fabric {} para Minecraft {}. {}",
        loader_version, minecraft_version, last_error
    ))
}

async fn precache_instance_environment(
    app: &tauri::AppHandle,
    mc_version: &str,
    loader_type: &str,
    loader_version: Option<&str>,
) -> Result<(), String> {
    let loader_version = loader_version.filter(|version| !version.trim().is_empty());
    if !loader_type.eq_ignore_ascii_case("Vanilla") && loader_version.is_none() {
        return Err(format!("Falta seleccionar una versión para {}", loader_type));
    }

    let mc_path = get_launcher_base_dir();

    let ver_parts: Vec<&str> = mc_version.split('.').collect();
    let is_v1 = ver_parts.first() == Some(&"1");
    let mut major = 1;
    let mut minor = 0;
    let mut patch = 0;
    if !ver_parts.is_empty() { major = ver_parts[0].parse().unwrap_or(1); }
    if ver_parts.len() >= 2 { minor = ver_parts[1].parse().unwrap_or(0); }
    if ver_parts.len() >= 3 { patch = ver_parts[2].parse().unwrap_or(0); }

    let java_major = if is_v1 {
        if (minor >= 20 && patch >= 5) || minor >= 21 { 21 }
        else if minor >= 17 { 17 }
        else { 8 }
    } else {
        if major >= 25 { 25 }
        else if major >= 21 { 21 }
        else if major >= 17 { 17 }
        else { 8 }
    };

    let mc_path_clone = mc_path.clone();
    let mc_version_str = mc_version.to_string();
    let app_clone = app.clone();

    let java_fut = ensure_java(app, &mc_path, java_major);
    let assets_and_libs_fut = async move {
        let version_manifest_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
        let response = HTTP_CLIENT.get(version_manifest_url).send().await.map_err(|e| e.to_string())?
            .error_for_status().map_err(|e| e.to_string())?;
        let manifest = response.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
        let versions = manifest["versions"].as_array().ok_or("El manifiesto de Minecraft no contiene versiones".to_string())?;
        let version_entry = versions.iter()
            .find(|entry| entry["id"].as_str() == Some(&mc_version_str))
            .ok_or_else(|| format!("No se encontró Minecraft {} en el manifiesto de Mojang", mc_version_str))?;
        let version_url = version_entry["url"].as_str().ok_or("La versión de Minecraft no tiene una URL de manifiesto válida".to_string())?;
        let version_response = HTTP_CLIENT.get(version_url).send().await.map_err(|e| e.to_string())?
            .error_for_status().map_err(|e| e.to_string())?;
        let version_json = version_response.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;

        let asset_index_url = version_json["assetIndex"]["url"].as_str().unwrap_or("");
        let asset_index_id = version_json["assetIndex"]["id"].as_str().unwrap_or("");
        if !asset_index_url.is_empty() {
            download_assets(&mc_path_clone, asset_index_url, asset_index_id, &app_clone).await?;
        }

        let client_url = version_json["downloads"]["client"]["url"].as_str()
            .ok_or_else(|| format!("Minecraft {} no contiene una descarga del cliente", mc_version_str))?;
        let client_jar_path = mc_path_clone.join("versions").join(&mc_version_str).join(format!("{}.jar", mc_version_str));
        let client_is_valid = client_jar_path.metadata().map(|metadata| metadata.len() > 0).unwrap_or(false);
        if !client_is_valid {
            if let Some(parent) = client_jar_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let client_response = HTTP_CLIENT.get(client_url).send().await.map_err(|e| e.to_string())?
                .error_for_status().map_err(|e| e.to_string())?;
            let client_bytes = client_response.bytes().await.map_err(|e| e.to_string())?;
            fs::write(&client_jar_path, client_bytes).map_err(|e| e.to_string())?;
        }

        if let Some(libs) = version_json["libraries"].as_array() {
            let mut download_items = Vec::new();
            for lib in libs {
                if let Some(artifact) = lib.get("downloads").and_then(|downloads| downloads.get("artifact")) {
                    if let (Some(url), Some(path_str)) = (artifact["url"].as_str(), artifact["path"].as_str()) {
                        let absolute_path = mc_path_clone.join("libraries").join(path_str);
                        if !absolute_path.exists() && !url.is_empty() {
                            let file_name = absolute_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                            download_items.push((absolute_path, url.to_string(), file_name));
                        }
                    }
                }
            }
            if !download_items.is_empty() {
                download_libraries_parallel(&app_clone, &download_items, 40.0, 85.0).await?;
            }
        }
        Ok::<(), String>(())
    };

    let (java_res, assets_res) = tokio::join!(java_fut, assets_and_libs_fut);
    let java_exec_path = java_res?;
    assets_res?;

    let l_type_lower = loader_type.to_lowercase();
    if let Some(l_ver) = loader_version {
            if l_type_lower.contains("forge") && !l_type_lower.contains("neoforge") {
                if find_forge_dir(&mc_path, mc_version, l_ver).is_none() {
                    install_forge(app, mc_version, l_ver, &mc_path, &java_exec_path).await?;
                }
            } else if l_type_lower.contains("neoforge") {
                if find_neoforge_dir(&mc_path, l_ver).is_none() {
                    install_neoforge(app, l_ver, &mc_path, &java_exec_path).await?;
                }
            } else if l_type_lower.contains("fabric") {
                let ver_id = format!("{}-fabric-{}", mc_version, l_ver);
                let ver_dir = mc_path.join("versions").join(&ver_id);
                fs::create_dir_all(&ver_dir).map_err(|e| e.to_string())?;
                let profile_path = ver_dir.join(format!("{}.json", ver_id));
                if read_cached_fabric_profile(&profile_path).is_none() {
                    let profile = fetch_fabric_profile(mc_version, l_ver).await?;
                    fs::write(&profile_path, profile.to_string()).map_err(|e| e.to_string())?;
                }
            } else if l_type_lower.contains("quilt") {
                let quilt_url = format!(
                    "https://meta.quiltmc.org/v3/versions/loader/{}/{}/profile/json",
                    mc_version, l_ver
                );
                let quilt_response = HTTP_CLIENT.get(&quilt_url).send().await
                    .map_err(|e| format!("No se pudo consultar Quilt: {}", e))?
                    .error_for_status().map_err(|e| format!("No se encontró Quilt {}: {}", l_ver, e))?;
                let quilt_profile = quilt_response.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
                let ver_id = format!("{}-quilt-{}", mc_version, l_ver);
                let ver_dir = mc_path.join("versions").join(&ver_id);
                fs::create_dir_all(&ver_dir).map_err(|e| e.to_string())?;
                fs::write(ver_dir.join(format!("{}.json", ver_id)), quilt_profile.to_string()).map_err(|e| e.to_string())?;
            }
    }

    Ok(())
}

#[tauri::command]
async fn install_modpack(
    app: tauri::AppHandle,
    name: String,
    url: String,
    icon_url: Option<String>,
) -> Result<Instance, String> {
    let emit = |msg: &str, pct: f32| {
        let _ = app.emit("download-progress", ProgressPayload {
            message: msg.to_string(),
            percentage: pct,
        });
    };

    emit(&format!("Iniciando instalación de {}...", name), 5.0);
    let client = HTTP_CLIENT.clone();

    let instance_id = uuid::Uuid::new_v4().to_string();
    let modpacks_dir = get_launcher_base_dir()
        .join("modpacks")
        .join(&instance_id);

    if modpacks_dir.exists() {
        let _ = fs::remove_dir_all(&modpacks_dir);
    }
    fs::create_dir_all(&modpacks_dir).map_err(|e| e.to_string())?;

    if let Some(i_url) = icon_url {
        emit("Descargando icono del modpack...", 7.0);
        if let Ok(i_resp) = client.get(&i_url).send().await {
            if let Ok(i_bytes) = i_resp.bytes().await {
                let _ = fs::write(modpacks_dir.join("icon.png"), i_bytes);
            }
        }
    }

    emit("Descargando paquete de modpack...", 10.0);
    let mut bytes = Vec::new();
    let mut download_success = false;

    for attempt in 1..=4 {
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                if let Ok(b) = resp.bytes().await {
                    bytes = b.to_vec();
                    download_success = true;
                    break;
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(300 * attempt)).await;
    }

    if !download_success || bytes.is_empty() {
        return Err("No se pudieron descargar los datos del modpack tras varios intentos. Revisa tu conexión a internet.".to_string());
    }

    let mrpack_path = modpacks_dir.join("modpack.mrpack");
    let _ = fs::write(&mrpack_path, &bytes);

    emit("Procesando paquete...", 20.0);
    let mut index_content = String::new();
    let mut manifest_content = String::new();
    let mut is_valid_mod = false;
    let mut is_mrpack = false;
    let mut is_curseforge = false;

    if let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())) {
        for i in 0..archive.len() {
            if let Ok(mut f) = archive.by_index(i) {
                let f_name_lower = f.name().to_lowercase();
                if f_name_lower.ends_with("modrinth.index.json") {
                    use std::io::Read;
                    let _ = f.read_to_string(&mut index_content);
                    is_mrpack = true;
                } else if f_name_lower.ends_with("manifest.json") {
                    use std::io::Read;
                    let _ = f.read_to_string(&mut manifest_content);
                    is_curseforge = true;
                } else if f_name_lower.ends_with("fabric.mod.json")
                    || f_name_lower.ends_with("quilt.mod.json")
                    || f_name_lower.ends_with("mcmod.info")
                    || f_name_lower.ends_with("mods.toml")
                {
                    is_valid_mod = true;
                }
            }
        }
    }

    if is_curseforge {
        let manifest: serde_json::Value = serde_json::from_str(&manifest_content)
            .map_err(|e| format!("Manifiesto CurseForge corrupto: {}", e))?;

        let mc_version = manifest["minecraft"]["version"].as_str().unwrap_or("1.20.1").to_string();
        let loaders = manifest["minecraft"]["modLoaders"].as_array();
        let mut loader_type = "Vanilla".to_string();
        let mut loader_version = None;

        if let Some(l_arr) = loaders {
            for l_val in l_arr {
                let l_id = l_val["id"].as_str().unwrap_or("");
                if l_id.starts_with("forge-") {
                    loader_type = "Forge".to_string();
                    loader_version = Some(l_id["forge-".len()..].to_string());
                } else if l_id.starts_with("neoforge-") {
                    loader_type = "NeoForge".to_string();
                    loader_version = Some(l_id["neoforge-".len()..].to_string());
                } else if l_id.starts_with("fabric-") {
                    loader_type = "Fabric".to_string();
                    loader_version = Some(l_id["fabric-".len()..].to_string());
                } else if l_id.starts_with("quilt-") {
                    loader_type = "Quilt".to_string();
                    loader_version = Some(l_id["quilt-".len()..].to_string());
                }
            }
        }

        let extract_fut = process_curseforge_manifest_and_extract(&app, &client, &manifest, &bytes, &modpacks_dir);
        let precache_fut = precache_instance_environment(&app, &mc_version, &loader_type, loader_version.as_deref());
        tokio::try_join!(extract_fut, precache_fut)?;

        emit("¡Instalación completada y lista para jugar!", 100.0);
        return Ok(Instance {
            id: instance_id,
            name,
            r#type: loader_type.clone(),
            version: mc_version,
            game_directory: Some(modpacks_dir.to_string_lossy().to_string()),
            fabric_version: if loader_type == "Fabric" { loader_version.clone() } else { None },
            forge_version: if loader_type == "Forge" { loader_version.clone() } else { None },
            neoforge_version: if loader_type == "NeoForge" { loader_version.clone() } else { None },
            quilt_version: if loader_type == "Quilt" { loader_version } else { None },
            ..Default::default()
        });
    }

    if is_mrpack {
        let index: serde_json::Value = serde_json::from_str(&index_content)
            .map_err(|e| format!("Índice corrupto: {}", e))?;

        let mc_version = index["dependencies"]["minecraft"].as_str().unwrap_or("1.21.1").to_string();
        let fabric_loader = index["dependencies"]["fabric-loader"].as_str().map(|s| s.to_string());
        let forge_loader = index["dependencies"]["forge"].as_str().map(|s| s.to_string());
        let neoforge_loader = index["dependencies"]["neoforge"].as_str().map(|s| s.to_string());
        let quilt_loader = index["dependencies"]["quilt-loader"].as_str().map(|s| s.to_string());

        let inst_type = if fabric_loader.is_some() { "Fabric".to_string() }
                       else if forge_loader.is_some() { "Forge".to_string() }
                       else if neoforge_loader.is_some() { "NeoForge".to_string() }
                       else if quilt_loader.is_some() { "Quilt".to_string() }
                       else { "Vanilla".to_string() };

        let loader_v = fabric_loader.as_deref().or(forge_loader.as_deref()).or(neoforge_loader.as_deref()).or(quilt_loader.as_deref());

        let extract_fut = process_modrinth_index_and_extract(&app, &client, &index, &bytes, &modpacks_dir);
        let precache_fut = precache_instance_environment(&app, &mc_version, &inst_type, loader_v);
        tokio::try_join!(extract_fut, precache_fut)?;

        emit("¡Instalación completada y lista para jugar!", 100.0);
        return Ok(Instance {
            id: instance_id,
            name,
            r#type: inst_type,
            version: mc_version,
            forge_version: forge_loader,
            fabric_version: fabric_loader,
            neoforge_version: neoforge_loader,
            quilt_version: quilt_loader,
            game_directory: Some(modpacks_dir.to_string_lossy().to_string()),
            ..Default::default()
        });
    }

    if is_valid_mod {
        emit("Instalando mod (.jar)...", 50.0);
        let mods_dir = modpacks_dir.join("mods");
        let _ = fs::create_dir_all(&mods_dir);

        let clean_filename = url.split('/').last().unwrap_or("mod.jar").split('?').next().unwrap_or("mod.jar");
        let jar_filename = if clean_filename.ends_with(".jar") || clean_filename.ends_with(".zip") {
            clean_filename.to_string()
        } else {
            format!("{}.jar", name.to_lowercase().replace(' ', "_"))
        };

        fs::write(mods_dir.join(&jar_filename), &bytes).map_err(|e| e.to_string())?;
        emit("¡Instalación completada con éxito!", 100.0);

        return Ok(Instance {
            id: instance_id,
            name,
            r#type: "Fabric".to_string(),
            version: "1.20.1".to_string(),
            game_directory: Some(modpacks_dir.to_string_lossy().to_string()),
            fabric_version: Some("0.15.11".to_string()),
            ..Default::default()
        });
    }

    Err("El archivo descargado no es un Modpack (.mrpack / .zip) válido ni un Mod (.jar) ejecutable.".to_string())
}

#[tauri::command]
async fn install_curseforge_modpack(
    app: tauri::AppHandle,
    name: String,
    url: String,
    icon_url: Option<String>,
) -> Result<Instance, String> {
    install_modpack(app, name, url, icon_url).await
}

#[tauri::command]
async fn import_local_modpack(
    app: tauri::AppHandle,
    name: String,
    file_path: String,
) -> Result<Instance, String> {
    let emit = |msg: &str, pct: f32| {
        let _ = app.emit("download-progress", ProgressPayload {
            message: msg.to_string(),
            percentage: pct,
        });
    };

    let client = HTTP_CLIENT.clone();
    emit(&format!("Iniciando importación local de {}...", name), 5.0);

    let instance_id = uuid::Uuid::new_v4().to_string();
    let modpacks_dir = get_launcher_base_dir()
        .join("modpacks")
        .join(&instance_id);
    fs::create_dir_all(&modpacks_dir).map_err(|e| e.to_string())?;

    let bytes = fs::read(&file_path).map_err(|e| format!("Error al leer el archivo local: {}", e))?;

    emit("Procesando archivo local...", 15.0);
    let mut index_content = String::new();
    let mut manifest_content = String::new();
    let mut is_mrpack = false;
    let mut is_curseforge = false;

    if let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())) {
        for i in 0..archive.len() {
            if let Ok(mut f) = archive.by_index(i) {
                let f_name_lower = f.name().to_lowercase();
                if f_name_lower.ends_with("modrinth.index.json") {
                    use std::io::Read;
                    let _ = f.read_to_string(&mut index_content);
                    is_mrpack = true;
                } else if f_name_lower.ends_with("manifest.json") {
                    use std::io::Read;
                    let _ = f.read_to_string(&mut manifest_content);
                    is_curseforge = true;
                }
            }
        }
    }

    if !is_mrpack && !is_curseforge {
        return Err("El archivo no es un modpack válido de CurseForge ni de Modrinth.".to_string());
    }

    if is_curseforge {
        let manifest: serde_json::Value = serde_json::from_str(&manifest_content)
            .map_err(|e| format!("Manifiesto CurseForge corrupto: {}", e))?;

        process_curseforge_manifest_and_extract(&app, &client, &manifest, &bytes, &modpacks_dir).await?;

        let mc_version = manifest["minecraft"]["version"].as_str().unwrap_or("1.20.1").to_string();
        let loaders = manifest["minecraft"]["modLoaders"].as_array();
        let mut loader_type = "Vanilla".to_string();
        let mut loader_version = None;

        if let Some(l_arr) = loaders {
            for l_val in l_arr {
                let l_id = l_val["id"].as_str().unwrap_or("");
                if l_id.starts_with("forge-") {
                    loader_type = "Forge".to_string();
                    loader_version = Some(l_id["forge-".len()..].to_string());
                } else if l_id.starts_with("neoforge-") {
                    loader_type = "NeoForge".to_string();
                    loader_version = Some(l_id["neoforge-".len()..].to_string());
                } else if l_id.starts_with("fabric-") {
                    loader_type = "Fabric".to_string();
                    loader_version = Some(l_id["fabric-".len()..].to_string());
                } else if l_id.starts_with("quilt-") {
                    loader_type = "Quilt".to_string();
                    loader_version = Some(l_id["quilt-".len()..].to_string());
                }
            }
        }

        emit("Verificando y asegurando Java y assets de Minecraft...", 85.0);
        let _ = precache_instance_environment(&app, &mc_version, &loader_type, loader_version.as_deref()).await;
        emit("¡Importación completada y lista para jugar!", 100.0);
        return Ok(Instance {
            id: instance_id,
            name,
            r#type: loader_type.clone(),
            version: mc_version,
            game_directory: Some(modpacks_dir.to_string_lossy().to_string()),
            fabric_version: if loader_type == "Fabric" { loader_version.clone() } else { None },
            forge_version: if loader_type == "Forge" { loader_version.clone() } else { None },
            neoforge_version: if loader_type == "NeoForge" { loader_version.clone() } else { None },
            quilt_version: if loader_type == "Quilt" { loader_version } else { None },
            ..Default::default()
        });
    }

    let index: serde_json::Value = serde_json::from_str(&index_content)
        .map_err(|e| format!("Índice corrupto: {}", e))?;

    process_modrinth_index_and_extract(&app, &client, &index, &bytes, &modpacks_dir).await?;

    let mc_version = index["dependencies"]["minecraft"].as_str().unwrap_or("1.21.1").to_string();
    let fabric_loader = index["dependencies"]["fabric-loader"].as_str().map(|s| s.to_string());
    let forge_loader = index["dependencies"]["forge"].as_str().map(|s| s.to_string());
    let neoforge_loader = index["dependencies"]["neoforge"].as_str().map(|s| s.to_string());
    let quilt_loader = index["dependencies"]["quilt-loader"].as_str().map(|s| s.to_string());

    let inst_type = if fabric_loader.is_some() { "Fabric".to_string() }
                   else if forge_loader.is_some() { "Forge".to_string() }
                   else if neoforge_loader.is_some() { "NeoForge".to_string() }
                   else if quilt_loader.is_some() { "Quilt".to_string() }
                   else { "Vanilla".to_string() };

    emit("Verificando y asegurando Java y assets de Minecraft...", 85.0);
        let _ = precache_instance_environment(&app, &mc_version, &inst_type, fabric_loader.as_deref().or(forge_loader.as_deref()).or(neoforge_loader.as_deref()).or(quilt_loader.as_deref())).await;
        emit("¡Importación completada y lista para jugar!", 100.0);
    Ok(Instance {
        id: instance_id,
        name,
        r#type: inst_type,
        version: mc_version,
        forge_version: forge_loader,
        fabric_version: fabric_loader,
        neoforge_version: neoforge_loader,
        quilt_version: quilt_loader,
        game_directory: Some(modpacks_dir.to_string_lossy().to_string()),
        ..Default::default()
    })
}

fn get_instances_file() -> PathBuf {
    let path = get_launcher_base_dir();
    fs::create_dir_all(&path).unwrap_or(());
    path.join("navithlabs_instances.json")
}

#[tauri::command]
fn get_instances() -> Vec<Instance> {
    let path = get_instances_file();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(instances) = serde_json::from_str::<Vec<Instance>>(&content) {
            let mut valid_instances = Vec::new();
            let mut changed = false;

            for inst in instances {
                let should_keep = match &inst.game_directory {
                    Some(dir) => {
                        let trimmed = dir.trim();
                        if trimmed.is_empty() {
                            true
                        } else {
                            let p = std::path::PathBuf::from(trimmed);
                            p.exists() && p.is_dir()
                        }
                    }
                    None => true,
                };

                if should_keep {
                    valid_instances.push(inst);
                } else {
                    changed = true;
                }
            }

            if changed {
                if let Ok(new_content) = serde_json::to_string_pretty(&valid_instances) {
                    let _ = fs::write(&path, new_content);
                }
            }

            return valid_instances;
        }
    }
    Vec::new()
}

#[tauri::command]
fn save_instances(instances: Vec<Instance>) -> Result<(), String> {
    let path = get_instances_file();

    for inst in &instances {
        if let Some(ref dir) = inst.game_directory {
            let trimmed = dir.trim();
            if !trimmed.is_empty() {
                let p = std::path::PathBuf::from(trimmed);
                let _ = fs::create_dir_all(&p);
            }
        }
    }

    let valid_instances: Vec<Instance> = instances
        .into_iter()
        .filter(|inst| {
            match &inst.game_directory {
                Some(dir) => {
                    let trimmed = dir.trim();
                    if trimmed.is_empty() {
                        true
                    } else {
                        let p = std::path::PathBuf::from(trimmed);
                        p.exists() && p.is_dir()
                    }
                }
                None => true,
            }
        })
        .collect();

    let content = serde_json::to_string_pretty(&valid_instances).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_minecraft_versions(version_type: String) -> Result<Vec<String>, String> {
    let url = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

    let response = HTTP_CLIENT.get(url).send().await;
    if response.is_err() {
        return Ok(vec!["1.21.1".to_string(), "1.20.4".to_string()]);
    }

    let text = response.unwrap().text().await.unwrap_or_default();
    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();

    let mut versions = Vec::new();
    if let Some(versions_array) = json["versions"].as_array() {
        for v in versions_array {
            if let Some(id) = v["id"].as_str() {
                if v["type"].as_str() == Some(&version_type) {
                    versions.push(id.to_string());
                }
            }
        }
    }
    Ok(versions)
}

fn extract_zip(zip_path: &PathBuf, extract_dir: &PathBuf) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let buffered = std::io::BufReader::with_capacity(128 * 1024, file);
    let mut archive = zip::ZipArchive::new(buffered).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => path.to_owned(),
            None => continue,
        };

        let out_abs = extract_dir.join(outpath);

        if (*file.name()).ends_with('/') {
            fs::create_dir_all(&out_abs).unwrap_or(());
        } else {
            if let Some(p) = out_abs.parent() {
                if !p.exists() {
                    fs::create_dir_all(&p).unwrap_or(());
                }
            }
            let outfile = fs::File::create(&out_abs).map_err(|e| e.to_string())?;
            let mut writer = std::io::BufWriter::with_capacity(128 * 1024, outfile);
            std::io::copy(&mut file, &mut writer).unwrap_or(0);
        }
    }
    Ok(())
}

fn extract_tar_gz(tar_gz_path: &PathBuf, extract_dir: &PathBuf) -> Result<(), String> {
    let file = fs::File::open(tar_gz_path).map_err(|e| e.to_string())?;
    let buffered = std::io::BufReader::with_capacity(128 * 1024, file);
    let gz = flate2::read::GzDecoder::new(buffered);
    let mut archive = tar::Archive::new(gz);
    archive.unpack(extract_dir).map_err(|e| e.to_string())?;
    Ok(())
}

fn find_java_exe(dir: &PathBuf) -> Option<PathBuf> {
    let is_match = |name: &str| -> bool {
        #[cfg(target_os = "windows")]
        {
            name.eq_ignore_ascii_case("java.exe")
        }
        #[cfg(not(target_os = "windows"))]
        {
            name == "java"
        }
    };

    if dir.is_file() {
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            if is_match(name) {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(meta) = fs::metadata(dir) {
                        let mut perms = meta.permissions();
                        perms.set_mode(0o755);
                        let _ = fs::set_permissions(dir, perms);
                    }
                }
                return Some(dir.clone());
            }
        }
    }
    if dir.is_dir() {
        #[cfg(target_os = "windows")]
        let direct_bin_java = dir.join("bin").join("java.exe");
        #[cfg(not(target_os = "windows"))]
        let direct_bin_java = dir.join("bin").join("java");

        if direct_bin_java.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = fs::metadata(&direct_bin_java) {
                    let mut perms = meta.permissions();
                    perms.set_mode(0o755);
                    let _ = fs::set_permissions(&direct_bin_java, perms);
                }
            }
            return Some(direct_bin_java);
        }

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    #[cfg(target_os = "windows")]
                    let nested_bin = p.join("bin").join("java.exe");
                    #[cfg(not(target_os = "windows"))]
                    let nested_bin = p.join("bin").join("java");

                    if nested_bin.is_file() {
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            if let Ok(meta) = fs::metadata(&nested_bin) {
                                let mut perms = meta.permissions();
                                perms.set_mode(0o755);
                                let _ = fs::set_permissions(&nested_bin, perms);
                            }
                        }
                        return Some(nested_bin);
                    }
                    if let Some(found) = find_java_exe(&p) {
                        return Some(found);
                    }
                } else if p.is_file() {
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        if is_match(name) {
                            #[cfg(unix)]
                            {
                                use std::os::unix::fs::PermissionsExt;
                                if let Ok(meta) = fs::metadata(&p) {
                                    let mut perms = meta.permissions();
                                    perms.set_mode(0o755);
                                    let _ = fs::set_permissions(&p, perms);
                                }
                            }
                            return Some(p);
                        }
                    }
                }
            }
        }
    }
    None
}

async fn ensure_java(
    app: &tauri::AppHandle,
    mc_path: &PathBuf,
    major_version: u32,
) -> Result<String, String> {
    let target_version = match major_version {
        1..=8 => 8,
        9..=17 => 17,
        18..=21 => 21,
        _ => 25,
    };

    let runtimes_dir = mc_path
        .join("runtimes")
        .join(format!("jre-{}", target_version));

    if runtimes_dir.exists() {
        if let Some(exe_path) = find_java_exe(&runtimes_dir) {
            return Ok(exe_path.to_string_lossy().to_string());
        }
        let _ = fs::remove_dir_all(&runtimes_dir);
    }

    let emit = |msg: &str, pct: f32| {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                message: msg.to_string(),
                percentage: pct,
            },
        );
    };

    emit(
        &format!(
            "Descargando Java {} (esto solo pasa una vez)...",
            target_version
        ),
        5.0,
    );
    fs::create_dir_all(&runtimes_dir).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let os_str = "windows";
    #[cfg(target_os = "macos")]
    let os_str = "mac";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let os_str = "linux";

    #[cfg(target_arch = "aarch64")]
    let arch_str = "aarch64";
    #[cfg(not(target_arch = "aarch64"))]
    let arch_str = "x64";

    let candidate_urls = [
        format!("https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jre/hotspot/normal/eclipse?project=jdk", target_version, os_str, arch_str),
        format!("https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jdk/hotspot/normal/eclipse?project=jdk", target_version, os_str, arch_str),
        format!("https://api.adoptium.net/v3/binary/latest/{}/ea/{}/{}/jre/hotspot/normal/eclipse?project=jdk", target_version, os_str, arch_str),
        format!("https://api.adoptium.net/v3/binary/latest/{}/ea/{}/{}/jdk/hotspot/normal/eclipse?project=jdk", target_version, os_str, arch_str),
    ];

    let mut response_bytes: Option<Vec<u8>> = None;
    for url in &candidate_urls {
        if let Ok(resp) = HTTP_CLIENT.get(url).header("Accept", "*/*").send().await {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    if !bytes.is_empty() {
                        response_bytes = Some(bytes.to_vec());
                        break;
                    }
                }
            }
        }
    }

    let bytes = response_bytes.ok_or_else(|| {
        format!("No se pudo descargar Java {} desde Adoptium.", target_version)
    })?;

    #[cfg(target_os = "windows")]
    let is_archive_zip = true;
    #[cfg(not(target_os = "windows"))]
    let is_archive_zip = bytes.len() >= 4 && &bytes[0..4] == b"PK\x03\x04";

    let archive_ext = if is_archive_zip { "zip" } else { "tar.gz" };
    let archive_path = mc_path
        .join("runtimes")
        .join(format!("jre-{}.{}", target_version, archive_ext));

    fs::write(&archive_path, &bytes).map_err(|e| e.to_string())?;

    emit(&format!("Instalando Java {}...", target_version), 15.0);
    if is_archive_zip {
        extract_zip(&archive_path, &runtimes_dir)?;
    } else {
        extract_tar_gz(&archive_path, &runtimes_dir)?;
    }

    let _ = fs::remove_file(&archive_path);

    if let Some(exe_path) = find_java_exe(&runtimes_dir) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(&exe_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(&exe_path, perms);
            }
        }
        Ok(exe_path.to_string_lossy().to_string())
    } else {
        Err("No se encontró el ejecutable de Java en el paquete descargado.".to_string())
    }
}

fn extract_natives(jar_path: &PathBuf, extract_dir: &PathBuf) -> Result<(), String> {
    let file = fs::File::open(jar_path).map_err(|e| e.to_string())?;
    let buffered = std::io::BufReader::with_capacity(64 * 1024, file);
    let mut archive = zip::ZipArchive::new(buffered).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => path.to_owned(),
            None => continue,
        };

        if outpath.extension().and_then(|e| e.to_str()) == Some("dll") {
            let extracted_path = extract_dir.join(outpath.file_name().unwrap());
            if !extracted_path.exists() {
                if let Ok(outfile) = fs::File::create(&extracted_path) {
                    let mut writer = std::io::BufWriter::with_capacity(64 * 1024, outfile);
                    std::io::copy(&mut file, &mut writer).unwrap_or(0);
                }
            }
        }
    }
    Ok(())
}

async fn download_assets(
    mc_path: &PathBuf,
    asset_index_url: &str,
    asset_index_id: &str,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    if asset_index_url.is_empty() {
        return Ok(());
    }

    let emit = |msg: &str, pct: f32| {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                message: msg.to_string(),
                percentage: pct,
            },
        );
    };

    let indexes_dir = mc_path.join("assets").join("indexes");
    let objects_dir = mc_path.join("assets").join("objects");
    fs::create_dir_all(&indexes_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&objects_dir).map_err(|e| e.to_string())?;

    let index_file_path = indexes_dir.join(format!("{}.json", asset_index_id));
    let verified_marker = indexes_dir.join(format!("{}.verified", asset_index_id));
    if index_file_path.exists()
        && fs::read_to_string(&verified_marker).map(|value| value.trim() == asset_index_id).unwrap_or(false)
    {
        return Ok(());
    }

    if !index_file_path.exists() {
        emit("Descargando índice de assets...", 85.0);
        let resp = HTTP_CLIENT.get(asset_index_url)
            .send()
            .await
            .map_err(|e| format!("Error al descargar asset index: {}", e))?
            .error_for_status()
            .map_err(|e| format!("Error HTTP al descargar asset index: {}", e))?;
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        fs::write(&index_file_path, bytes).map_err(|e| e.to_string())?;
    }

    let index_content = fs::read_to_string(&index_file_path).map_err(|e| e.to_string())?;
    let index_json: serde_json::Value =
        serde_json::from_str(&index_content).map_err(|e| e.to_string())?;

    let objects = index_json["objects"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let mut missing_objects = Vec::new();

    for (_key, obj) in objects.iter() {
        if let Some(hash) = obj["hash"].as_str() {
            if hash.len() > 2 {
                let prefix = &hash[0..2];
                let obj_dir = objects_dir.join(prefix);
                let obj_path = obj_dir.join(hash);

                let object_is_valid = obj_path.metadata().map(|metadata| metadata.len() > 0).unwrap_or(false);
                if !object_is_valid {
                    missing_objects.push((hash.to_string(), obj_path, obj_dir));
                }
            }
        }
    }

    if missing_objects.is_empty() {
        let _ = fs::write(&verified_marker, asset_index_id);
        return Ok(());
    }

    let total = missing_objects.len();
    emit(
        &format!("Descargando {} assets faltantes...", total),
        86.0,
    );

    let downloaded = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(36));
    let mut tasks = Vec::with_capacity(total);

    for (hash, obj_path, obj_dir) in missing_objects {
        let sem = sem.clone();
        let downloaded = downloaded.clone();
        let app_handle = app.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            let url = format!(
                "https://resources.download.minecraft.net/{}/{}",
                &hash[0..2],
                hash
            );
            let mut result: Result<(), String> = Err("No se pudo descargar el asset".to_string());
            for attempt in 0..3 {
                result = async {
                    let resp = HTTP_CLIENT.get(&url).send().await.map_err(|e| e.to_string())?
                        .error_for_status().map_err(|e| e.to_string())?;
                    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
                    let actual_hash = format!("{:x}", Sha1::digest(&bytes));
                    if actual_hash != hash {
                        return Err(format!("El asset {} no pasó la verificación SHA-1", hash));
                    }
                    fs::create_dir_all(&obj_dir).map_err(|e| e.to_string())?;
                    fs::write(&obj_path, bytes).map_err(|e| e.to_string())?;
                    Ok(())
                }.await;
                if result.is_ok() { break; }
                if attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
            }
            let curr = downloaded.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if curr % 40 == 0 || curr == total {
                let pct = 86.0 + ((curr as f32 / total as f32) * 11.0);
                let _ = app_handle.emit(
                    "download-progress",
                    ProgressPayload {
                        message: format!("Descargando assets ({}/{})...", curr, total),
                        percentage: pct,
                    },
                );
            }
            result
        }));
    }

    let mut first_error = None;
    for task in tasks {
        match task.await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => if first_error.is_none() { first_error = Some(error); },
            Err(error) => if first_error.is_none() { first_error = Some(error.to_string()); },
        }
    }
    if let Some(error) = first_error {
        return Err(error);
    }

    fs::write(&verified_marker, asset_index_id).map_err(|e| e.to_string())?;
    Ok(())
}

async fn download_libraries_parallel(
    app: &tauri::AppHandle,
    libraries: &[(PathBuf, String, String)], // (absolute_path, url, name)
    start_pct: f32,
    end_pct: f32,
) -> Result<(), String> {
    let missing: Vec<_> = libraries
        .iter()
        .filter(|(path, url, _)| !path.exists() && !url.is_empty())
        .cloned()
        .collect();

    if missing.is_empty() {
        return Ok(());
    }

    let total = missing.len();
    let downloaded = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(28));
    let mut tasks = Vec::with_capacity(total);

    for (abs_path, url, name) in missing {
        let sem = sem.clone();
        let downloaded = downloaded.clone();
        let app_handle = app.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            let mut result: Result<(), String> = Err(format!("No se pudo descargar {}", name));
            for attempt in 0..3 {
                result = async {
                    let response = HTTP_CLIENT.get(&url).send().await.map_err(|e| e.to_string())?
                        .error_for_status().map_err(|e| e.to_string())?;
                    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
                    if let Some(parent) = abs_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    fs::write(&abs_path, bytes).map_err(|e| e.to_string())?;
                    Ok(())
                }.await;
                if result.is_ok() { break; }
                if attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
            }
            let curr = downloaded.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if curr % 5 == 0 || curr == total {
                let pct = start_pct + ((curr as f32 / total as f32) * (end_pct - start_pct));
                let _ = app_handle.emit(
                    "download-progress",
                    ProgressPayload {
                        message: format!("Descargando librería ({}/{}): {}", curr, total, name),
                        percentage: pct,
                    },
                );
            }
            result
        }));
    }

    let mut first_error = None;
    for task in tasks {
        match task.await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => if first_error.is_none() { first_error = Some(error); },
            Err(error) => if first_error.is_none() { first_error = Some(error.to_string()); },
        }
    }
    if let Some(error) = first_error {
        return Err(error);
    }

    Ok(())
}
lazy_static::lazy_static! {
    static ref ACTIVE_CHILD_PID: std::sync::Mutex<Option<u32>> = std::sync::Mutex::new(None);
    static ref ACTIVE_CHILD_GAME_DIRECTORY: std::sync::Mutex<Option<PathBuf>> =
        std::sync::Mutex::new(None);
    static ref EXPECTED_MINECRAFT_EXITS: std::sync::Mutex<std::collections::HashSet<u32>> =
        std::sync::Mutex::new(std::collections::HashSet::new());
}

fn has_recent_minecraft_crash_report(game_directory: &std::path::Path, launched_at: std::time::SystemTime) -> bool {
    let crash_reports_dir = game_directory.join("crash-reports");
    fs::read_dir(crash_reports_dir)
        .map(|entries| {
            entries.flatten().any(|entry| {
                entry.path().extension().is_some_and(|extension| extension == "txt")
                    && entry
                        .metadata()
                        .and_then(|metadata| metadata.modified())
                        .is_ok_and(|modified| modified >= launched_at)
            })
        })
        .unwrap_or(false)
}

fn latest_log_indicates_clean_shutdown(
    game_directory: &std::path::Path,
    launched_at: std::time::SystemTime,
) -> bool {
    let latest_log = game_directory.join("logs").join("latest.log");
    let Ok(metadata) = fs::metadata(&latest_log) else {
        return false;
    };
    if !metadata.modified().is_ok_and(|modified| modified >= launched_at) {
        return false;
    }

    let Ok(mut file) = fs::File::open(latest_log) else {
        return false;
    };
    let start = metadata.len().saturating_sub(128 * 1024);
    if std::io::Seek::seek(&mut file, std::io::SeekFrom::Start(start)).is_err() {
        return false;
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return false;
    }
    let tail = String::from_utf8_lossy(&bytes);
    let lower_tail = tail.to_ascii_lowercase();

    let has_crash_marker = lower_tail.contains("game crashed")
        || lower_tail.contains("crash report saved")
        || lower_tail.contains("exception in thread");
    if has_crash_marker {
        return false;
    }

    tail.lines()
        .rev()
        .take(120)
        .any(|line| line.contains("Stopping!") || line.contains("Stopping Minecraft"))
}

fn restore_launcher_presence(window: &tauri::WebviewWindow) {
    let Some(handle) = window.app_handle().try_state::<DiscordHandle>() else {
        return;
    };
    if !handle.enabled.load(Ordering::Relaxed) {
        return;
    }
    let _ = handle.sender.send(DiscordMsg::Update {
        details: "En NavithLabs Launcher".to_string(),
        state: "Preparando un evento".to_string(),
        large_image: "navithlabs".to_string(),
        large_text: "NavithLabs Launcher".to_string(),
        small_image: "minecraft".to_string(),
        small_text: "Minecraft Java".to_string(),
        buttons: None,
        start_time: None,
    });
}

fn monitor_minecraft_process(
    mut child: std::process::Child,
    window: tauri::WebviewWindow,
    should_reopen: bool,
    game_directory: PathBuf,
    launched_at: std::time::SystemTime,
) {
    let pid = child.id();
    if let Ok(mut lock) = ACTIVE_CHILD_PID.lock() {
        *lock = Some(pid);
        if let Ok(mut game_directory_lock) = ACTIVE_CHILD_GAME_DIRECTORY.lock() {
            *game_directory_lock = Some(game_directory.clone());
        }
    }

    std::thread::spawn(move || {
        let status = child.wait();
        if matches!(&status, Ok(exit_status) if exit_status.success()) {
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
        let crash_report_exists = has_recent_minecraft_crash_report(&game_directory, launched_at);
        let normal_shutdown_logged = latest_log_indicates_clean_shutdown(&game_directory, launched_at);

        if let Ok(mut lock) = ACTIVE_CHILD_PID.lock() {
            if *lock == Some(pid) {
                *lock = None;
                if let Ok(mut game_directory_lock) = ACTIVE_CHILD_GAME_DIRECTORY.lock() {
                    *game_directory_lock = None;
                }
            }
        }
        let expected_exit = EXPECTED_MINECRAFT_EXITS
            .lock()
            .map(|mut exits| exits.remove(&pid))
            .unwrap_or(false);
        restore_launcher_presence(&window);
        if should_reopen {
            let _ = window.show();
            let _ = window.set_focus();
        }
        
        let _ = window.emit("minecraft-exit", ());

        match status {
            Ok(exit_status) => {
                if !expected_exit
                    && !exit_status.success()
                    && (crash_report_exists || !normal_shutdown_logged)
                {
                    let code = exit_status.code().unwrap_or(1);
                    println!("MINECRAFT CRASHED with code: {}", code);
                    let _ = window.emit("minecraft-crash", code);
                }
            }
            Err(e) => {
                println!("Error waiting for Minecraft process: {}", e);
                if !expected_exit {
                    let _ = window.emit("minecraft-crash", 1);
                }
            }
        }
    });
}

fn is_active_minecraft_process(pid: u32) -> bool {
    ACTIVE_CHILD_PID
        .lock()
        .map(|active_pid| *active_pid == Some(pid))
        .unwrap_or(false)
}

fn same_game_directory(left: &std::path::Path, right: &std::path::Path) -> bool {
    let normalized_left = fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let normalized_right = fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    let left_text = normalized_left.to_string_lossy().replace('/', "\\");
    let right_text = normalized_right.to_string_lossy().replace('/', "\\");

    #[cfg(windows)]
    {
        left_text.trim_end_matches('\\').eq_ignore_ascii_case(right_text.trim_end_matches('\\'))
    }
    #[cfg(not(windows))]
    {
        left_text.trim_end_matches('\\') == right_text.trim_end_matches('\\')
    }
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct MinecraftWindowRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(target_os = "windows")]
struct MinecraftWindowSearch {
    pid: u32,
    found: bool,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn find_visible_minecraft_window(
    hwnd: *mut std::ffi::c_void,
    state_ptr: isize,
) -> i32 {
    let state = unsafe { &mut *(state_ptr as *mut MinecraftWindowSearch) };
    let mut owner_pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut owner_pid);
    }

    if owner_pid != state.pid || unsafe { IsWindowVisible(hwnd) } == 0 {
        return 1;
    }

    let title_length = unsafe { GetWindowTextLengthW(hwnd) };
    let mut rect = MinecraftWindowRect {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let has_usable_size = unsafe { GetWindowRect(hwnd, &mut rect) } != 0
        && rect.right.saturating_sub(rect.left) >= 240
        && rect.bottom.saturating_sub(rect.top) >= 160;

    if title_length > 0 && has_usable_size {
        state.found = true;
        return 0;
    }
    1
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn EnumWindows(
        callback: Option<unsafe extern "system" fn(*mut std::ffi::c_void, isize) -> i32>,
        lparam: isize,
    ) -> i32;
    fn GetWindowThreadProcessId(hwnd: *mut std::ffi::c_void, process_id: *mut u32) -> u32;
    fn IsWindowVisible(hwnd: *mut std::ffi::c_void) -> i32;
    fn GetWindowTextLengthW(hwnd: *mut std::ffi::c_void) -> i32;
    fn GetWindowRect(hwnd: *mut std::ffi::c_void, rect: *mut MinecraftWindowRect) -> i32;
}

#[cfg(target_os = "windows")]
fn has_visible_minecraft_window(pid: u32) -> bool {
    let mut state = MinecraftWindowSearch { pid, found: false };
    unsafe {
        EnumWindows(
            Some(find_visible_minecraft_window),
            &mut state as *mut MinecraftWindowSearch as isize,
        );
    }
    state.found
}

async fn hide_launcher_when_minecraft_is_visible(window: tauri::WebviewWindow, pid: u32) {
    let started_at = std::time::Instant::now();
    let startup_timeout = std::time::Duration::from_secs(120);

    loop {
        if !is_active_minecraft_process(pid) {
            return;
        }

        #[cfg(target_os = "windows")]
        let game_window_ready = has_visible_minecraft_window(pid);

        #[cfg(not(target_os = "windows"))]
        let game_window_ready = started_at.elapsed() >= std::time::Duration::from_secs(2);

        if game_window_ready {
            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
            if !is_active_minecraft_process(pid) {
                return;
            }

            #[cfg(target_os = "windows")]
            if !has_visible_minecraft_window(pid) {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                continue;
            }

            let _ = window.hide();
            return;
        }

        if started_at.elapsed() >= startup_timeout {
            if is_active_minecraft_process(pid) {
                let _ = window.hide();
            }
            return;
        }

        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

#[tauri::command]
fn kill_active_game(game_directory: String) -> Result<(), String> {
    let active_pid = {
        let Ok(mut active_pid_lock) = ACTIVE_CHILD_PID.lock() else {
            return Ok(());
        };
        let Some(pid) = *active_pid_lock else {
            return Ok(());
        };

        let active_directory = ACTIVE_CHILD_GAME_DIRECTORY
            .lock()
            .ok()
            .and_then(|directory| directory.clone());
        let Some(active_directory) = active_directory else {
            return Ok(());
        };
        if !same_game_directory(&active_directory, &PathBuf::from(&game_directory)) {
            return Ok(());
        }

        if let Ok(mut expected_exits) = EXPECTED_MINECRAFT_EXITS.lock() {
            expected_exits.insert(pid);
        }
        *active_pid_lock = None;
        if let Ok(mut active_directory_lock) = ACTIVE_CHILD_GAME_DIRECTORY.lock() {
            *active_directory_lock = None;
        }
        Some(pid)
    };

    if let Some(pid) = active_pid {

        #[cfg(not(windows))]
        {
            let mut system = sysinfo::System::new_all();
            system.refresh_all();
            if let Some(process) = system.process(sysinfo::Pid::from_u32(pid)) {
                let _ = process.kill();
            }
        }

        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        }
    }
    Ok(())
}

#[tauri::command]
async fn launch_minecraft(
    app: tauri::AppHandle,
    version: String,
    forge_version: Option<String>,
    fabric_version: Option<String>,
    neoforge_version: Option<String>,
    quilt_version: Option<String>,
    username: String,
    uuid: Option<String>,
    access_token: Option<String>,
    ram: Option<String>,
    game_directory: Option<String>,
    resolution_width: Option<String>,
    resolution_height: Option<String>,
    fullscreen: Option<bool>,
    jvm_arguments: Option<String>,
    launcher_visibility: Option<String>,
    java_executable: Option<String>,
    _skip_java_check: Option<bool>,
) -> Result<String, String> {
    {
        let active_pid = ACTIVE_CHILD_PID
            .lock()
            .map_err(|_| "No se pudo comprobar si Minecraft sigue activo.".to_string())?;
        if active_pid.is_some() {
            return Err(
                "Minecraft todavía está terminando de cerrarse. Espera a que el launcher confirme el cierre antes de volver a iniciar."
                    .to_string(),
            );
        }
    }

    let mc_path = get_launcher_base_dir();

    let java_exec = java_executable.unwrap_or_else(|| "".to_string());

    let ver_parts: Vec<&str> = version.split('.').collect();
    let is_v1 = ver_parts.first() == Some(&"1");
    let mut major = 1;
    let mut minor = 0;
    let mut patch = 0;
    if !ver_parts.is_empty() {
        major = ver_parts[0].parse().unwrap_or(1);
    }
    if ver_parts.len() >= 2 {
        minor = ver_parts[1].parse().unwrap_or(0);
    }
    if ver_parts.len() >= 3 {
        patch = ver_parts[2].parse().unwrap_or(0);
    }

    let java_major = if is_v1 {
        if (minor >= 20 && patch >= 5) || minor >= 21 {
            21
        } else if minor >= 17 {
            17
        } else {
            8
        }
    } else {
        if major >= 25 {
            25
        } else if major >= 21 {
            21
        } else if major >= 17 {
            17
        } else {
            8
        }
    };

    let final_java_cmd = if !java_exec.trim().is_empty() {
        let clean = java_exec.trim().trim_matches('"').trim_matches('\'').to_string();
        let path = PathBuf::from(&clean);
        if path.is_dir() {
            find_java_exe(&path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or(clean)
        } else {
            clean
        }
    } else {
        match ensure_java(&app, &mc_path, java_major).await {
            Ok(p) => p,
            Err(e) => {
                println!("Error auto-downloading java: {}", e);
                "java".to_string()
            }
        }
    };

    if let Some(ref fv) = forge_version {
        let xmx = ram.clone().unwrap_or_else(|| "4".to_string());
        let clean = xmx
            .replace("GB", "")
            .replace("G", "")
            .replace(" ", "")
            .replace("AUTO(", "")
            .replace(")", "");
        let parsed_ram = clean.parse::<u64>().unwrap_or(4);
        let vis = launcher_visibility
            .clone()
            .unwrap_or_else(|| "keep_open".to_string());
        let gd = game_directory.clone();
        let rw = resolution_width
            .clone()
            .unwrap_or_else(|| "854".to_string());
        let rh = resolution_height
            .clone()
            .unwrap_or_else(|| "480".to_string());
        let fs = fullscreen.unwrap_or(false);
        let jvm = jvm_arguments.clone();
        return launch_forge(
            &app,
            &version,
            fv,
            false,
            &mc_path,
            &username,
            uuid.as_deref(),
            access_token.as_deref(),
            parsed_ram,
            jvm.as_deref(),
            gd.as_deref(),
            &rw,
            &rh,
            fs,
            &final_java_cmd,
            &vis,
        )
        .await;
    }

    if let Some(ref nfv) = neoforge_version {
        let xmx = ram.clone().unwrap_or_else(|| "4".to_string());
        let clean = xmx
            .replace("GB", "")
            .replace("G", "")
            .replace(" ", "")
            .replace("AUTO(", "")
            .replace(")", "");
        let parsed_ram = clean.parse::<u64>().unwrap_or(4);
        let vis = launcher_visibility
            .clone()
            .unwrap_or_else(|| "keep_open".to_string());
        let gd = game_directory.clone();
        let rw = resolution_width
            .clone()
            .unwrap_or_else(|| "854".to_string());
        let rh = resolution_height
            .clone()
            .unwrap_or_else(|| "480".to_string());
        let fs = fullscreen.unwrap_or(false);
        let jvm = jvm_arguments.clone();
        return launch_forge(
            &app,
            &version,
            nfv,
            true,
            &mc_path,
            &username,
            uuid.as_deref(),
            access_token.as_deref(),
            parsed_ram,
            jvm.as_deref(),
            gd.as_deref(),
            &rw,
            &rh,
            fs,
            &final_java_cmd,
            &vis,
        )
        .await;
    }

    if let Some(ref fab_v) = fabric_version {
        let xmx = ram.clone().unwrap_or_else(|| "4".to_string());
        let clean = xmx
            .replace("GB", "")
            .replace("G", "")
            .replace(" ", "")
            .replace("AUTO(", "")
            .replace(")", "");
        let parsed_ram = clean.parse::<u64>().unwrap_or(4);
        let vis = launcher_visibility
            .clone()
            .unwrap_or_else(|| "keep_open".to_string());
        let gd = game_directory.clone();
        let rw = resolution_width
            .clone()
            .unwrap_or_else(|| "854".to_string());
        let rh = resolution_height
            .clone()
            .unwrap_or_else(|| "480".to_string());
        let fs = fullscreen.unwrap_or(false);
        let jvm = jvm_arguments.clone();
        return launch_fabric(
            &app,
            &version,
            &fab_v,
            &mc_path,
            &username,
            uuid.as_deref(),
            access_token.as_deref(),
            parsed_ram,
            jvm.as_deref(),
            gd.as_deref(),
            &rw,
            &rh,
            fs,
            &final_java_cmd,
            &vis,
        )
        .await;
    }

    if let Some(ref quilt_v) = quilt_version {
        let xmx = ram.clone().unwrap_or_else(|| "4".to_string());
        let clean = xmx
            .replace("GB", "")
            .replace("G", "")
            .replace(" ", "")
            .replace("AUTO(", "")
            .replace(")", "");
        let parsed_ram = clean.parse::<u64>().unwrap_or(4);
        let vis = launcher_visibility
            .clone()
            .unwrap_or_else(|| "keep_open".to_string());
        let gd = game_directory.clone();
        let rw = resolution_width
            .clone()
            .unwrap_or_else(|| "854".to_string());
        let rh = resolution_height
            .clone()
            .unwrap_or_else(|| "480".to_string());
        let fs = fullscreen.unwrap_or(false);
        let jvm = jvm_arguments.clone();
        return launch_quilt(
            &app,
            &version,
            &quilt_v,
            &mc_path,
            &username,
            uuid.as_deref(),
            access_token.as_deref(),
            parsed_ram,
            jvm.as_deref(),
            gd.as_deref(),
            &rw,
            &rh,
            fs,
            &final_java_cmd,
            &vis,
        )
        .await;
    }

    let version_dir = mc_path.join("versions").join(&version);
    fs::create_dir_all(&version_dir).unwrap_or(());

    let json_path = version_dir.join(format!("{}.json", version));
    let jar_path = version_dir.join(format!("{}.jar", version));

    let emit_progress = |msg: &str, pct: f32| {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                message: msg.to_string(),
                percentage: pct,
            },
        );
    };

    if !json_path.exists() {
        emit_progress("Descargando manifiesto de la versión...", 5.0);
        let manifest_url = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
        let text = HTTP_CLIENT.get(manifest_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .unwrap_or_default();
        let manifest: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

        let mut version_url = None;
        if let Some(versions) = manifest["versions"].as_array() {
            for v in versions {
                if v["id"].as_str() == Some(&version) {
                    version_url = v["url"].as_str().map(|s| s.to_string());
                    break;
                }
            }
        }

        let v_url = version_url.ok_or(format!(
            "Versión {} no encontrada en los servidores de Mojang",
            version
        ))?;
        let v_json = HTTP_CLIENT.get(&v_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .unwrap_or_default();
        fs::write(&json_path, &v_json).map_err(|e| e.to_string())?;
    }

    let content = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if !jar_path.exists() {
        emit_progress(&format!("Descargando {}.jar...", version), 10.0);
        if let Some(client_url) = json
            .get("downloads")
            .and_then(|d| d.get("client"))
            .and_then(|c| c.get("url"))
            .and_then(|u| u.as_str())
        {
            let bytes = HTTP_CLIENT.get(client_url)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .bytes()
                .await
                .map_err(|e| e.to_string())?;
            fs::write(&jar_path, bytes).map_err(|e| e.to_string())?;
        }
    }

    let main_class = json["mainClass"]
        .as_str()
        .ok_or("No se encontró mainClass en el JSON")?;

    let mut classpath = Vec::new();
    let natives_dir = version_dir.join("natives");
    fs::create_dir_all(&natives_dir).unwrap_or(());

    let mut all_artifacts = Vec::new();

    if let Some(libs) = json["libraries"].as_array() {
        for lib in libs {
            let mut allow = true;
            if let Some(rules) = lib["rules"].as_array() {
                allow = false;
                for rule in rules {
                    let action = rule["action"].as_str().unwrap_or("");
                    if action == "allow" {
                        if let Some(os) = rule.get("os") {
                            if os["name"].as_str() == Some("windows") {
                                allow = true;
                            }
                        } else {
                            allow = true;
                        }
                    } else if action == "disallow" {
                        if let Some(os) = rule.get("os") {
                            if os["name"].as_str() == Some("windows") {
                                allow = false;
                            }
                        }
                    }
                }
            }
            if !allow {
                continue;
            }

            let name = lib["name"].as_str().unwrap_or("");

            if name.contains("natives-windows") {
                let arch = std::env::consts::ARCH;
                if arch == "x86_64" && (name.ends_with("x86") || name.ends_with("arm64") || name.ends_with("aarch64")) {
                    continue; // Saltar x86 y arm64 en sistemas de 64 bits
                }
                if arch == "aarch64" && !name.ends_with("arm64") && !name.ends_with("aarch64") {
                    continue; // Saltar x64 y x86 en sistemas ARM
                }
            }
            let parts: Vec<&str> = name.split(':').collect();
            let mut computed_path = String::new();
            if parts.len() >= 3 {
                let group = parts[0].replace(".", "/");
                let artifact_id = parts[1];
                let version = parts[2];
                computed_path = format!(
                    "{}/{}/{}/{}-{}.jar",
                    group, artifact_id, version, artifact_id, version
                );
            }

            let mut native_classifier = None;
            if let Some(natives) = lib.get("natives") {
                if let Some(windows_key) = natives.get("windows").and_then(|w| w.as_str()) {
                    native_classifier = Some(windows_key.replace("${arch}", "64"));
                }
            }

            let mut artifacts_to_process = Vec::new();

            if let Some(artifact) = lib.get("downloads").and_then(|d| d.get("artifact")) {
                artifacts_to_process.push((artifact.clone(), false, computed_path.clone()));
            }

            if let Some(key) = &native_classifier {
                if let Some(native_artifact) = lib
                    .get("downloads")
                    .and_then(|d| d.get("classifiers"))
                    .and_then(|c| c.get(key))
                {
                    let mut native_computed_path = computed_path.clone();
                    if parts.len() >= 3 {
                        let group = parts[0].replace(".", "/");
                        let artifact_id = parts[1];
                        let ver = parts[2];
                        native_computed_path = format!(
                            "{}/{}/{}/{}-{}-{}.jar",
                            group, artifact_id, ver, artifact_id, ver, key
                        );
                    }
                    artifacts_to_process.push((native_artifact.clone(), true, native_computed_path));
                }
            }

            let _is_forced_native = false;
            if parts.len() == 4 {
                let group = parts[0].replace(".", "/");
                let artifact_id = parts[1];
                let ver = parts[2];
                let classifier = parts[3];
                computed_path = format!(
                    "{}/{}/{}/{}-{}-{}.jar",
                    group, artifact_id, ver, artifact_id, ver, classifier
                );
                artifacts_to_process.clear();
                if let Some(artifact) = lib.get("downloads").and_then(|d| d.get("artifact")) {
                    artifacts_to_process.push((artifact.clone(), true, computed_path));
                }

                if name.starts_with("org.lwjgl") {
                    let base_computed_path = format!("{}/{}/{}/{}-{}.jar", group, artifact_id, ver, artifact_id, ver);
                    let base_url = format!("https://libraries.minecraft.net/{}", base_computed_path);
                    let mut base_artifact_map = serde_json::Map::new();
                    base_artifact_map.insert("url".to_string(), serde_json::Value::String(base_url));
                    base_artifact_map.insert("path".to_string(), serde_json::Value::String(base_computed_path.clone()));
                    artifacts_to_process.push((serde_json::Value::Object(base_artifact_map), false, base_computed_path));
                }
            }

            all_artifacts.extend(
                artifacts_to_process
                    .into_iter()
                    .map(|(art, is_nat, path)| (art, is_nat, path, name)),
            );
        }

        let mut download_items = Vec::new();
        let mut processed_items = Vec::new();

        for (artifact, is_native, path_fallback, name) in all_artifacts {
            let url = artifact.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string();
            let path_str = artifact
                .get("path")
                .and_then(|p| p.as_str())
                .unwrap_or(&path_fallback)
                .to_string();

            if !path_str.is_empty() {
                let absolute_path = mc_path.join("libraries").join(&path_str);
                if !absolute_path.exists() && !url.is_empty() {
                    let file_name = absolute_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    download_items.push((absolute_path.clone(), url, file_name));
                }
                processed_items.push((absolute_path, is_native, path_fallback, name));
            }
        }

        if !download_items.is_empty() {
            download_libraries_parallel(&app, &download_items, 20.0, 95.0).await?;
        }

        for (absolute_path, is_native, path_fallback, name) in processed_items {
            if absolute_path.exists() {
                if !is_native || path_fallback.matches("-").count() >= 3 {
                    classpath.push(absolute_path.to_string_lossy().to_string());
                }
                if is_native || name.contains("natives") {
                    let _ = extract_natives(&absolute_path, &natives_dir);
                }
            }
        }
    }

    emit_progress("Ensamblando juego...", 98.0);
    classpath.push(jar_path.to_string_lossy().to_string());
    let classpath_str = classpath.join(";");

    let xmx = ram.unwrap_or_else(|| "4".to_string());
    let clean_xmx = xmx
        .replace("GB", "")
        .replace("G", "")
        .replace(" ", "")
        .replace("AUTO(", "")
        .replace(")", "");
    let parsed_ram = clean_xmx.parse::<u64>().unwrap_or(4);
    let xmx_arg = format!("-Xmx{}G", parsed_ram);

    let final_game_dir = game_directory.unwrap_or_else(|| mc_path.to_string_lossy().to_string());

    let asset_index = json["assetIndex"]["id"].as_str().unwrap_or(&version);
    let asset_index_url = json["assetIndex"]["url"].as_str().unwrap_or("");

    download_assets(&mc_path, asset_index_url, asset_index, &app).await?;

    let res_w = resolution_width.unwrap_or_else(|| "854".to_string());
    let res_h = resolution_height.unwrap_or_else(|| "480".to_string());

    let default_jvm_args = "-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=16M";
    let jvm_args_str = jvm_arguments.unwrap_or_else(|| default_jvm_args.to_string());

    let mut final_args = Vec::new();

    final_args.push(xmx_arg.to_string());
    let xms_ram = (parsed_ram / 2).max(1).min(2);
    final_args.push(format!("-Xms{}G", xms_ram));
    final_args.push("-Djava.net.preferIPv4Stack=true".to_string());

    if !jvm_args_str.trim().is_empty() {
        for arg in jvm_args_str.split_whitespace() {
            final_args.push(arg.to_string());
        }
    }

    let (final_uuid, final_access_token, user_type) = if let (Some(u), Some(t)) = (&uuid, &access_token) {
        if !t.is_empty() && t != "0" {
            (u.clone(), t.clone(), "msa".to_string())
        } else {
            (generate_offline_uuid(&username), "0".to_string(), "offline".to_string())
        }
    } else {
        (generate_offline_uuid(&username), "0".to_string(), "offline".to_string())
    };

    if user_type == "offline" {
        final_args.push("-Dminecraft.api.auth.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.account.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.session.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.services.host=http://127.0.0.1:54321".to_string());
    }

    final_args.push("-Djava.library.path=".to_string() + &natives_dir.to_string_lossy());
    final_args.push("-cp".to_string());
    final_args.push(classpath_str);
    final_args.push(main_class.to_string());

    let assets_dir = mc_path.join("assets");
    fs::create_dir_all(&assets_dir).unwrap_or(());
    let build_game_args = |template: &str| -> String {
        template
            .replace("${auth_player_name}", &username)
            .replace("${version_name}", &version)
            .replace("${game_directory}", &final_game_dir)
            .replace(
                "${assets_root}",
                &mc_path.join("assets").to_string_lossy().to_string(),
            )
            .replace("${assets_index_name}", asset_index)
            .replace("${auth_uuid}", &final_uuid)
            .replace("${auth_access_token}", &final_access_token)
            .replace("${user_properties}", "{}")
            .replace("${user_type}", &user_type)
            .replace("${version_type}", "release")
            .replace("${resolution_width}", &res_w)
            .replace("${resolution_height}", &res_h)
            .replace("${clientid}", "")
            .replace("${auth_xuid}", "")
    };

    if let Some(minecraft_args) = json.get("minecraftArguments").and_then(|a| a.as_str()) {
        for arg in minecraft_args.split_whitespace() {
            final_args.push(build_game_args(arg));
        }
    } else if let Some(game_args) = json
        .get("arguments")
        .and_then(|a| a.get("game"))
        .and_then(|g| g.as_array())
    {
        for arg in game_args {
            if let Some(s) = arg.as_str() {
                final_args.push(build_game_args(s));
            }
        }
    } else {
        final_args.extend(vec![
            "--username".to_string(),
            username.clone(),
            "--version".to_string(),
            version.clone(),
            "--gameDir".to_string(),
            final_game_dir.clone(),
            "--assetsDir".to_string(),
            mc_path.join("assets").to_string_lossy().to_string(),
            "--assetIndex".to_string(),
            asset_index.to_string(),
            "--uuid".to_string(),
            final_uuid.to_string(),
            "--accessToken".to_string(),
            final_access_token.to_string(),
            "--userType".to_string(),
            user_type.to_string(),
            "--versionType".to_string(),
            "release".to_string(),
        ]);
    }

    if !final_args.iter().any(|arg| arg == "--userType") {
        final_args.push("--userType".to_string());
        final_args.push("mojang".to_string());
    }
    if !final_args.iter().any(|arg| arg == "--versionType") {
        final_args.push("--versionType".to_string());
        final_args.push("release".to_string());
    }

    if fullscreen.unwrap_or(false) {
        final_args.push("--fullscreen".to_string());
    } else {
        final_args.push("--width".to_string());
        final_args.push(res_w.clone());
        final_args.push("--height".to_string());
        final_args.push(res_h.clone());
    }

    let clean_game_dir = final_game_dir.trim().trim_matches('"').trim_matches('\'').to_string();
    let game_dir_buf = PathBuf::from(&clean_game_dir);
    let _ = fs::create_dir_all(&game_dir_buf);

    let clean_java = final_java_cmd.trim().trim_matches('"').trim_matches('\'').to_string();
    let actual_java = if PathBuf::from(&clean_java).is_dir() {
        find_java_exe(&PathBuf::from(&clean_java))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(clean_java)
    } else {
        clean_java
    };

    let mut cmd = Command::new(&actual_java);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    for arg in final_args {
        cmd.arg(arg);
    }
    cmd.current_dir(&game_dir_buf);

    println!("EJECUTANDO: {:?}", cmd);

    emit_progress("¡Todo listo! Iniciando...", 100.0);

    let visibility = launcher_visibility.unwrap_or_else(|| "keep_open".to_string());

    if let Some(main_window) = app.get_webview_window("main") {
        let launched_at = std::time::SystemTime::now();
        let child = cmd.spawn().map_err(|e| format!("Error al ejecutar Java: {}", e))?;
        
        if visibility == "close" {
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                std::process::exit(0);
            });
        } else if visibility == "hide_reopen" {
            let pid = child.id();
            monitor_minecraft_process(child, main_window.clone(), true, game_dir_buf.clone(), launched_at);
            hide_launcher_when_minecraft_is_visible(main_window, pid).await;
        } else {
            monitor_minecraft_process(child, main_window, false, game_dir_buf.clone(), launched_at);
        }
    } else {
        cmd.spawn().map_err(|e| format!("Error al ejecutar Java: {}", e))?;
    }

    Ok(format!("¡Iniciando Minecraft {}!", version))
}

fn find_neoforge_dir(mc_path: &PathBuf, neoforge_version: &str) -> Option<(PathBuf, String)> {
    let versions_dir = mc_path.join("versions");
    let candidates = [format!("neoforge-{}", neoforge_version)];
    for c in &candidates {
        let dir = versions_dir.join(c);
        if dir.join(format!("{}.json", c)).exists() {
            return Some((dir, c.clone()));
        }
    }
    if let Ok(entries) = fs::read_dir(&versions_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let n = p
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if n.to_lowercase().contains("neoforge") && n.contains(neoforge_version) {
                    if p.join(format!("{}.json", n)).exists() {
                        return Some((p, n));
                    }
                }
            }
        }
    }
    None
}

async fn install_neoforge(
    app: &tauri::AppHandle,
    neoforge_version: &str,
    mc_path: &PathBuf,
    java_exec: &str,
) -> Result<(), String> {
    let emit = |msg: &str, pct: f32| {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                message: msg.to_string(),
                percentage: pct,
            },
        );
    };
    let installer_url = format!(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
        neoforge_version, neoforge_version
    );
    let inst_dir = mc_path.join("neoforge_installers");
    fs::create_dir_all(&inst_dir).map_err(|e| e.to_string())?;
    let inst_path = inst_dir.join(format!("neoforge-{}-installer.jar", neoforge_version));

    if !inst_path.exists() {
        emit("Descargando instalador de NeoForge...", 5.0);
        let resp = HTTP_CLIENT
            .get(&installer_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!(
                "No se encontró NeoForge {} en los servidores.",
                neoforge_version
            ));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        fs::write(&inst_path, bytes).map_err(|e| e.to_string())?;
    }

    let profiles_path = mc_path.join("launcher_profiles.json");
    if !profiles_path.exists() {
        fs::write(&profiles_path, "{\"profiles\":{}}").unwrap_or(());
    }

    emit("Instalando NeoForge (puede tardar 1-3 minutos)...", 15.0);

    let clean_mc_path = PathBuf::from(mc_path.to_string_lossy().trim().trim_matches('"').trim_matches('\''));
    let _ = fs::create_dir_all(&clean_mc_path);

    let clean_java = java_exec.trim().trim_matches('"').trim_matches('\'').to_string();
    let actual_java = if PathBuf::from(&clean_java).is_dir() {
        find_java_exe(&PathBuf::from(&clean_java))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(clean_java)
    } else {
        clean_java
    };

    let mut cmd = std::process::Command::new(&actual_java);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let status = cmd
        .arg("-jar")
        .arg(&inst_path)
        .arg("--installClient")
        .arg(&clean_mc_path)
        .current_dir(&clean_mc_path)
        .status()
        .map_err(|e| format!("Error ejecutando instalador de NeoForge: {}", e))?;

    if !status.success() {
        return Err(format!("El instalador de NeoForge terminó con error (código {:?}). Asegúrate de tener Java instalado.", status.code()));
    }
    emit("NeoForge instalado.", 50.0);
    Ok(())
}

fn find_forge_dir(
    mc_path: &PathBuf,
    mc_version: &str,
    forge_version: &str,
) -> Option<(PathBuf, String)> {
    let versions_dir = mc_path.join("versions");
    let candidates = [
        format!("{}-forge-{}", mc_version, forge_version),
        format!("{}-Forge{}", mc_version, forge_version),
        format!("{}-forge{}", mc_version, forge_version),
    ];
    for c in &candidates {
        let dir = versions_dir.join(c);
        if dir.join(format!("{}.json", c)).exists() {
            return Some((dir, c.clone()));
        }
    }
    if let Ok(entries) = fs::read_dir(&versions_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let n = p
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if n.contains(mc_version)
                    && n.to_lowercase().contains("forge")
                    && n.contains(forge_version)
                {
                    if p.join(format!("{}.json", n)).exists() {
                        return Some((p, n));
                    }
                }
            }
        }
    }
    None
}

async fn install_forge(
    app: &tauri::AppHandle,
    mc_version: &str,
    forge_version: &str,
    mc_path: &PathBuf,
    java_exec: &str,
) -> Result<(), String> {
    let emit = |msg: &str, pct: f32| {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                message: msg.to_string(),
                percentage: pct,
            },
        );
    };
    let forge_full = format!("{}-{}", mc_version, forge_version);
    let installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}-installer.jar",
        forge_full, forge_full
    );
    let inst_dir = mc_path.join("forge_installers");
    fs::create_dir_all(&inst_dir).map_err(|e| e.to_string())?;
    let inst_path = inst_dir.join(format!("forge-{}-installer.jar", forge_full));

    if !inst_path.exists() {
        emit("Descargando instalador de Forge...", 5.0);
        let resp = HTTP_CLIENT
            .get(&installer_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!(
                "No se encontró Forge {}-{} en los servidores.",
                mc_version, forge_version
            ));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        fs::write(&inst_path, bytes).map_err(|e| e.to_string())?;
    }

    let profiles_path = mc_path.join("launcher_profiles.json");
    if !profiles_path.exists() {
        fs::write(&profiles_path, "{\"profiles\":{}}").unwrap_or(());
    }

    emit("Instalando Forge (puede tardar 1-3 minutos)...", 15.0);

    let clean_mc_path = PathBuf::from(mc_path.to_string_lossy().trim().trim_matches('"').trim_matches('\''));
    let _ = fs::create_dir_all(&clean_mc_path);

    let clean_java = java_exec.trim().trim_matches('"').trim_matches('\'').to_string();
    let actual_java = if PathBuf::from(&clean_java).is_dir() {
        find_java_exe(&PathBuf::from(&clean_java))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(clean_java)
    } else {
        clean_java
    };

    let mut cmd = std::process::Command::new(&actual_java);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let status = cmd
        .arg("-jar")
        .arg(&inst_path)
        .arg("--installClient")
        .arg(&clean_mc_path)
        .current_dir(&clean_mc_path)
        .status()
        .map_err(|e| format!("Error ejecutando instalador de Forge: {}", e))?;

    if !status.success() {
        return Err(format!("El instalador de Forge terminó con error (código {:?}). Asegúrate de tener Java instalado.", status.code()));
    }
    emit("Forge instalado.", 50.0);
    Ok(())
}

fn generate_offline_uuid(username: &str) -> String {
    let input = format!("OfflinePlayer:{}", username);
    let digest = md5::compute(input.as_bytes());
    let mut bytes = digest.0;
    bytes[6] &= 0x0f;
    bytes[6] |= 0x30;
    bytes[8] &= 0x3f;
    bytes[8] |= 0x80;
    uuid::Uuid::from_bytes(bytes).to_string()
}

#[allow(clippy::too_many_arguments)]
async fn launch_forge(
    app: &tauri::AppHandle,
    mc_version: &str,
    forge_version: &str,
    is_neoforge: bool,
    mc_path: &PathBuf,
    username: &str,
    uuid: Option<&str>,
    access_token: Option<&str>,
    ram_gb: u64,
    jvm_arguments: Option<&str>,
    game_directory: Option<&str>,
    res_w: &str,
    res_h: &str,
    fullscreen: bool,
    java_exec: &str,
    launcher_visibility: &str,
) -> Result<String, String> {
    let emit = |msg: &str, pct: f32| {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                message: msg.to_string(),
                percentage: pct,
            },
        );
    };

    let name = if is_neoforge { "NeoForge" } else { "Forge" };

    if is_neoforge {
        if find_neoforge_dir(mc_path, forge_version).is_none() {
            install_neoforge(app, forge_version, mc_path, java_exec).await?;
        }
    } else {
        if find_forge_dir(mc_path, mc_version, forge_version).is_none() {
            install_forge(app, mc_version, forge_version, mc_path, java_exec).await?;
        }
    }

    let (forge_dir, forge_id) = if is_neoforge {
        find_neoforge_dir(mc_path, forge_version).ok_or_else(|| {
            "NeoForge instalado pero no se encontró el perfil generado.".to_string()
        })?
    } else {
        find_forge_dir(mc_path, mc_version, forge_version)
            .ok_or_else(|| "Forge instalado pero no se encontró el perfil generado.".to_string())?
    };

    emit(&format!("Leyendo perfil de {}...", name), 55.0);

    let forge_json_str = fs::read_to_string(forge_dir.join(format!("{}.json", forge_id)))
        .map_err(|e| e.to_string())?;
    let forge_json: serde_json::Value =
        serde_json::from_str(&forge_json_str).map_err(|e| e.to_string())?;

    let vanilla_id = forge_json["inheritsFrom"]
        .as_str()
        .unwrap_or(mc_version)
        .to_string();
    let vanilla_dir = mc_path.join("versions").join(&vanilla_id);
    let vanilla_json_path = vanilla_dir.join(format!("{}.json", vanilla_id));

    if !vanilla_json_path.exists() {
        emit("Descargando manifiesto vanilla...", 58.0);
        let manifest: serde_json::Value =
            HTTP_CLIENT.get("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
        if let Some(vers) = manifest["versions"].as_array() {
            for v in vers {
                if v["id"].as_str() == Some(&vanilla_id) {
                    if let Some(vurl) = v["url"].as_str() {
                        let vjson = HTTP_CLIENT.get(vurl)
                            .send()
                            .await
                            .map_err(|e| e.to_string())?
                            .text()
                            .await
                            .unwrap_or_default();
                        fs::create_dir_all(&vanilla_dir).unwrap_or(());
                        fs::write(&vanilla_json_path, vjson).map_err(|e| e.to_string())?;
                    }
                    break;
                }
            }
        }
    }
    let vanilla_str = fs::read_to_string(&vanilla_json_path).unwrap_or_else(|_| "{}".to_string());
    let vanilla_json: serde_json::Value = serde_json::from_str(&vanilla_str).unwrap_or_default();

    let vanilla_jar = vanilla_dir.join(format!("{}.jar", vanilla_id));
    if !vanilla_jar.exists() {
        emit("Descargando Minecraft base...", 62.0);
        if let Some(url) = vanilla_json["downloads"]["client"]["url"].as_str() {
            let bytes = HTTP_CLIENT.get(url)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .bytes()
                .await
                .map_err(|e| e.to_string())?;
            fs::write(&vanilla_jar, bytes).map_err(|e| e.to_string())?;
        }
    }

    let mut all_libs: Vec<serde_json::Value> = vec![];
    if let Some(vlibs) = vanilla_json["libraries"].as_array() {
        all_libs.extend(vlibs.clone());
    }
    if let Some(flibs) = forge_json["libraries"].as_array() {
        all_libs.extend(flibs.clone());
    }

    let mut all_resolved_artifacts = Vec::new();
    let natives_dir = vanilla_dir.join("natives");
    fs::create_dir_all(&natives_dir).unwrap_or(());

    for val in &all_libs {
        if let Ok(lib) = serde_json::from_value::<MinecraftLibrary>(val.clone()) {
            if is_library_active(&lib) {
                all_resolved_artifacts.extend(resolve_library(&lib));
            }
        }
    }

    let mut artifact_map = std::collections::HashMap::new();
    let mut ordered_artifacts = Vec::new();

    let has_guava = all_resolved_artifacts
        .iter()
        .any(|a| a.maven_key.contains("guava"));

    for art in all_resolved_artifacts {
        if has_guava && art.maven_key.contains("listenablefuture") {
            continue;
        }

        if !artifact_map.contains_key(&art.maven_key) {
            ordered_artifacts.push(art.maven_key.clone());
        }
        artifact_map.insert(art.maven_key.clone(), art);
    }

    let mut deduplicated_libs = Vec::new();
    let mut seen_legacy_paths = std::collections::HashSet::new();

    let mut download_items = Vec::new();
    let mut resolved_items = Vec::new();

    for key in &ordered_artifacts {
        if let Some(art) = artifact_map.get(key) {
            let abs_path = mc_path.join("libraries").join(&art.path);
            if !abs_path.exists() && !art.url.is_empty() {
                let fname = abs_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                download_items.push((abs_path.clone(), art.url.clone(), fname));
            }
            resolved_items.push((abs_path, art.is_native));
        }
    }

    if !download_items.is_empty() {
        download_libraries_parallel(app, &download_items, 65.0, 90.0).await?;
    }

    for (abs_path, is_native) in resolved_items {
        if abs_path.exists() {
            if is_native {
                let _ = extract_natives(&abs_path, &natives_dir);
            }
            let path_str = abs_path.to_string_lossy().to_string();
            deduplicated_libs.push(path_str.clone());
            seen_legacy_paths.insert(path_str);
        }
    }

    if let Ok(entries) = fs::read_dir(&forge_dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("jar") {
                let n = p
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if n.contains("universal") || n.contains("client") {
                    let path_str = p.to_string_lossy().to_string();
                    if seen_legacy_paths.insert(path_str.clone()) {
                        deduplicated_libs.push(path_str);
                    }
                }
            }
        }
    }

    let libraries_str = deduplicated_libs.join(";");

    let has_forge_client = all_libs.iter().any(|l| {
        l["name"]
            .as_str()
            .unwrap_or("")
            .starts_with("net.minecraft:client:")
    });

    let full_classpath_str = if has_forge_client {
        libraries_str
    } else {
        let vanilla_jar_str = vanilla_jar.to_string_lossy().to_string();
        format!("{};{}", libraries_str, vanilla_jar_str)
    };

    let main_class = forge_json["mainClass"]
        .as_str()
        .or_else(|| vanilla_json["mainClass"].as_str())
        .unwrap_or("net.minecraft.client.main.Main");

    emit("Ensamblando Forge...", 93.0);

    let xmx_arg = format!("-Xmx{}G", ram_gb);
    let final_game_dir = game_directory
        .map(|s| s.to_string())
        .unwrap_or_else(|| mc_path.to_string_lossy().to_string());
    let asset_index = forge_json["assetIndex"]["id"]
        .as_str()
        .or_else(|| vanilla_json["assetIndex"]["id"].as_str())
        .unwrap_or(mc_version);

    let asset_index_url = forge_json["assetIndex"]["url"]
        .as_str()
        .or_else(|| vanilla_json["assetIndex"]["url"].as_str())
        .unwrap_or("");

    download_assets(&mc_path, asset_index_url, asset_index, &app).await?;

    let default_jvm = "-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=16M";
    let jvm_str = jvm_arguments.unwrap_or(default_jvm);

    let mut final_args: Vec<String> = vec![
        xmx_arg,
        format!("-Xms{}G", (ram_gb / 2).max(1).min(2)),
        "-Djava.net.preferIPv4Stack=true".to_string(),
    ];

    let process_arg_value = |val: &serde_json::Value| -> Vec<String> {
        match val {
            serde_json::Value::String(s) => vec![s.clone()],
            serde_json::Value::Array(arr) => arr
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect(),
            _ => vec![],
        }
    };

    if let Some(jvm_args) = forge_json["arguments"]["jvm"].as_array() {
        for arg in jvm_args {
            if let Some(s) = arg.as_str() {
                if s.contains("UseCompactObjectHeaders") {
                    continue;
                } // Unsupported on most JRE 21 builds
                let mut replaced = s
                    .replace("${classpath}", &full_classpath_str)
                    .replace("${version_name}", &forge_id)
                    .replace(
                        "${library_directory}",
                        &mc_path.join("libraries").to_string_lossy(),
                    )
                    .replace("${classpath_separator}", ";");

                if replaced.starts_with("-DignoreList=") {
                    let vanilla_jar_name = vanilla_jar
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy();
                    replaced = format!("{},{}", replaced, vanilla_jar_name);
                }

                final_args.push(replaced);
            } else if let Some(obj) = arg.as_object() {
                let mut ok = true;
                if let Some(rules) = obj.get("rules").and_then(|r| r.as_array()) {
                    ok = false;
                    for rule in rules {
                        if rule["action"].as_str() == Some("allow") {
                            if let Some(os) = rule.get("os") {
                                if os["name"].as_str() == Some("windows") {
                                    ok = true;
                                }
                            } else {
                                ok = true;
                            }
                        }
                    }
                }
                if ok {
                    if let Some(val) = obj.get("value") {
                        final_args.extend(process_arg_value(val));
                    }
                }
            }
        }
    }

    for a in jvm_str.split_whitespace() {
        if a.contains("UseCompactObjectHeaders") {
            continue;
        }
        final_args.push(a.to_string());
    }

    let natives_str = natives_dir.to_string_lossy().to_string();

    final_args.push(format!("-Djava.library.path={}", natives_str));
    final_args.push(format!("-Dorg.lwjgl.librarypath={}", natives_str));
    final_args.push(format!("-Djna.tmpdir={}", natives_str));
    final_args.push(format!(
        "-Dorg.lwjgl.system.SharedLibraryExtractPath={}",
        natives_str
    ));
    final_args.push(format!("-Dio.netty.native.workdir={}", natives_str));
    final_args.push("--enable-native-access=ALL-UNNAMED".to_string());
    final_args.push("-Dminecraft.launcher.brand=NavithLabsLauncher".to_string());
    final_args.push("-Dminecraft.launcher.version=1.0".to_string());

    let (final_uuid, final_access_token, user_type) = if let (Some(u), Some(t)) = (uuid, access_token) {
        if !t.is_empty() && t != "0" {
            (u.to_string(), t.to_string(), "msa".to_string())
        } else {
            (generate_offline_uuid(username), "0".to_string(), "offline".to_string())
        }
    } else {
        (generate_offline_uuid(username), "0".to_string(), "offline".to_string())
    };

    if user_type == "offline" {
        final_args.push("-Dminecraft.api.auth.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.account.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.session.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.services.host=http://127.0.0.1:54321".to_string());
    }

    final_args.push("-cp".to_string());
    final_args.push(full_classpath_str);
    final_args.push(main_class.to_string());

    let assets_dir = mc_path.join("assets");
    fs::create_dir_all(&assets_dir).unwrap_or(());
    let build_game_arg = |s: &str| -> String {
        s.replace("${auth_player_name}", username)
            .replace("${version_name}", &forge_id)
            .replace("${game_directory}", &final_game_dir)
            .replace(
                "${assets_root}",
                &mc_path.join("assets").to_string_lossy().to_string(),
            )
            .replace("${assets_index_name}", asset_index)
            .replace("${auth_uuid}", &final_uuid)
            .replace("${auth_access_token}", &final_access_token)
            .replace("${user_properties}", "{}")
            .replace("${user_type}", &user_type)
            .replace("${version_type}", "release")
            .replace("${resolution_width}", res_w)
            .replace("${resolution_height}", res_h)
            .replace("${clientid}", "")
            .replace("${auth_xuid}", "")
    };

    if let Some(mc_args) = forge_json["minecraftArguments"].as_str() {
        for a in mc_args.split_whitespace() {
            final_args.push(build_game_arg(a));
        }
    } else {
        if let Some(mc_args) = vanilla_json["minecraftArguments"].as_str() {
            for a in mc_args.split_whitespace() {
                final_args.push(build_game_arg(a));
            }
        } else if let Some(game_args) = vanilla_json["arguments"]["game"].as_array() {
            for arg in game_args {
                if let Some(s) = arg.as_str() {
                    final_args.push(build_game_arg(s));
                }
            }
        }

        if let Some(game_args) = forge_json["arguments"]["game"].as_array() {
            for arg in game_args {
                if let Some(s) = arg.as_str() {
                    final_args.push(build_game_arg(s));
                }
            }
        }
    }

    if !final_args.iter().any(|arg| arg == "--userType") {
        final_args.push("--userType".to_string());
        final_args.push("mojang".to_string());
    }
    if !final_args.iter().any(|arg| arg == "--versionType") {
        final_args.push("--versionType".to_string());
        final_args.push("release".to_string());
    }

    if fullscreen {
        final_args.push("--fullscreen".to_string());
    } else {
        final_args.push("--width".to_string());
        final_args.push(res_w.to_string());
        final_args.push("--height".to_string());
        final_args.push(res_h.to_string());
    }

    emit("¡Todo listo! Iniciando Forge...", 100.0);

    let clean_game_dir = final_game_dir.trim().trim_matches('"').trim_matches('\'').to_string();
    let game_dir_buf = PathBuf::from(&clean_game_dir);
    let _ = fs::create_dir_all(&game_dir_buf);

    let clean_java = java_exec.trim().trim_matches('"').trim_matches('\'').to_string();
    let actual_java = if PathBuf::from(&clean_java).is_dir() {
        find_java_exe(&PathBuf::from(&clean_java))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(clean_java)
    } else {
        clean_java
    };

    let mut cmd = std::process::Command::new(&actual_java);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    for a in &final_args {
        cmd.arg(a);
    }
    cmd.current_dir(&game_dir_buf);
    println!("FORGE CMD: {:?}", cmd);

    let visibility = launcher_visibility;

    if let Some(main_window) = app.get_webview_window("main") {
        let launched_at = std::time::SystemTime::now();
        let child = cmd.spawn().map_err(|e| format!("Error al ejecutar Java: {}", e))?;
        
        if visibility == "close" {
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                std::process::exit(0);
            });
        } else if visibility == "hide_reopen" {
            let pid = child.id();
            monitor_minecraft_process(child, main_window.clone(), true, game_dir_buf.clone(), launched_at);
            hide_launcher_when_minecraft_is_visible(main_window, pid).await;
        } else {
            monitor_minecraft_process(child, main_window, false, game_dir_buf.clone(), launched_at);
        }
    } else {
        cmd.spawn().map_err(|e| format!("Error al ejecutar Java: {}", e))?;
    }

    Ok(format!(
        "Iniciando {} {}!",
        if is_neoforge { "NeoForge" } else { "Forge" },
        forge_version
    ))
}

#[allow(clippy::too_many_arguments)]
async fn launch_fabric(
    app: &tauri::AppHandle,
    mc_version: &str,
    fabric_version: &str,
    mc_path: &PathBuf,
    username: &str,
    uuid: Option<&str>,
    access_token: Option<&str>,
    ram_gb: u64,
    jvm_arguments: Option<&str>,
    game_directory: Option<&str>,
    res_w: &str,
    res_h: &str,
    fullscreen: bool,
    java_exec: &str,
    launcher_visibility: &str,
) -> Result<String, String> {
    let emit = |msg: &str, pct: f32| {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                message: msg.to_string(),
                percentage: pct,
            },
        );
    };

    let final_game_dir = match game_directory {
        Some(dir) => dir.to_string(),
        None => mc_path.to_string_lossy().to_string(),
    };

    let clean_game_dir = final_game_dir.trim().trim_matches('"').trim_matches('\'').to_string();
    let game_dir_buf = PathBuf::from(&clean_game_dir);
    ensure_instance_missing_dependencies(&game_dir_buf.join("mods"), mc_version).await;

    let ver_dir = mc_path
        .join("versions")
        .join(format!("{}-fabric-{}", mc_version, fabric_version));
    fs::create_dir_all(&ver_dir).unwrap_or(());

    emit("Descargando perfil de Fabric...", 20.0);
    let profile_path = ver_dir.join(format!("{}-fabric-{}.json", mc_version, fabric_version));
    let fabric_json = match read_cached_fabric_profile(&profile_path) {
        Some(profile) => profile,
        None => {
            let profile = fetch_fabric_profile(mc_version, fabric_version).await?;
            fs::write(&profile_path, profile.to_string()).map_err(|error| error.to_string())?;
            profile
        }
    };

    let vanilla_id = fabric_json["inheritsFrom"]
        .as_str()
        .unwrap_or(mc_version)
        .to_string();

    let vanilla_dir = mc_path.join("versions").join(&vanilla_id);
    fs::create_dir_all(&vanilla_dir).unwrap_or(());
    let vanilla_json_path = vanilla_dir.join(format!("{}.json", vanilla_id));

    if !vanilla_json_path.exists() {
        emit("Descargando manifiesto Vanilla...", 25.0);
        let manifest_url = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
        let text = HTTP_CLIENT.get(manifest_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .unwrap_or_default();
        let manifest: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let mut v_url = None;
        if let Some(versions) = manifest["versions"].as_array() {
            for v in versions {
                if v["id"].as_str() == Some(&vanilla_id) {
                    v_url = v["url"].as_str().map(|s| s.to_string());
                    break;
                }
            }
        }
        if let Some(url) = v_url {
            let v_json = HTTP_CLIENT.get(&url)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .text()
                .await
                .unwrap_or_default();
            let _ = fs::write(&vanilla_json_path, &v_json);
        } else {
            return Err(format!("Versión base {} no encontrada", vanilla_id));
        }
    }

    let vanilla_content = fs::read_to_string(&vanilla_json_path).map_err(|e| e.to_string())?;
    let vanilla_json: serde_json::Value =
        serde_json::from_str(&vanilla_content).map_err(|e| e.to_string())?;

    let jar_path = vanilla_dir.join(format!("{}.jar", vanilla_id));
    if !jar_path.exists() {
        emit("Descargando Minecraft cliente...", 30.0);
        if let Some(client_url) = vanilla_json
            .get("downloads")
            .and_then(|d| d.get("client"))
            .and_then(|c| c.get("url"))
            .and_then(|u| u.as_str())
        {
            let bytes = HTTP_CLIENT.get(client_url)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .bytes()
                .await
                .map_err(|e| e.to_string())?;
            let _ = fs::write(&jar_path, bytes);
        }
    }

    let mut artifacts_map = std::collections::HashMap::new();
    let natives_dir = ver_dir.join("natives");
    fs::create_dir_all(&natives_dir).unwrap_or(());

    let mut add_to_map = |libs: &serde_json::Value| {
        if let Some(libs_array) = libs.as_array() {
            for lib_val in libs_array {
                if let Ok(lib) = serde_json::from_value::<MinecraftLibrary>(lib_val.clone()) {
                    if is_library_active(&lib) {
                        for art in resolve_library(&lib) {
                            let dedup_key = art.maven_key.clone();
                            
                            artifacts_map.insert(dedup_key, art);
                        }
                    }
                }
            }
        }
    };

    add_to_map(&vanilla_json["libraries"]);
    add_to_map(&fabric_json["libraries"]);

    let all_artifacts: Vec<ResolvedArtifact> = artifacts_map.into_values().collect();

    let mut classpath_entries = Vec::new();

    let mut download_items = Vec::new();
    let mut resolved_items = Vec::new();

    for art in all_artifacts {
        let absolute_path = mc_path.join("libraries").join(&art.path);
        if !absolute_path.exists() && !art.url.is_empty() {
            let fname = absolute_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            download_items.push((absolute_path.clone(), art.url.clone(), fname));
        }
        resolved_items.push((absolute_path, art.is_native, art.maven_key, art.url));
    }

    if !download_items.is_empty() {
        download_libraries_parallel(app, &download_items, 35.0, 85.0).await?;
    }

    for (absolute_path, is_native, maven_key, url) in resolved_items {
        if !is_native {
            classpath_entries.push(absolute_path.to_string_lossy().to_string());
        }
        if !absolute_path.exists() {
            if url.contains("fabricmc") || url.contains("forge") || url.contains("neoforge") {
                return Err(format!("Librería crítica no encontrada: {}. El juego no puede iniciar.", maven_key));
            }
        }

        if is_native && absolute_path.exists() {
            let _ = extract_natives(&absolute_path, &natives_dir);
        }
    }

    classpath_entries.push(jar_path.to_string_lossy().to_string());
    let full_classpath_str = classpath_entries.join(if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    });

    let asset_index = vanilla_json["assetIndex"]["id"]
        .as_str()
        .unwrap_or("legacy");
    let asset_index_url = vanilla_json["assetIndex"]["url"].as_str().unwrap_or("");
    emit("Verificando assets...", 85.0);
    let _ = download_assets(mc_path, asset_index_url, asset_index, app).await;

    emit("Preparando inicio de Fabric...", 95.0);

    let mut final_args = Vec::new();
    let (final_uuid, final_access_token, user_type) = if let (Some(u), Some(t)) = (uuid, access_token) {
        if !t.is_empty() && t != "0" {
            (u.to_string(), t.to_string(), "msa".to_string())
        } else {
            (generate_offline_uuid(username), "0".to_string(), "offline".to_string())
        }
    } else {
        (generate_offline_uuid(username), "0".to_string(), "offline".to_string())
    };

    let build_game_args = |template: &str| -> String {
        template
            .replace("${auth_player_name}", username)
            .replace("${version_name}", mc_version)
            .replace("${game_directory}", &final_game_dir)
            .replace(
                "${assets_root}",
                &mc_path.join("assets").to_string_lossy().to_string(),
            )
            .replace("${assets_index_name}", asset_index)
            .replace("${auth_uuid}", &final_uuid)
            .replace("${auth_access_token}", &final_access_token)
            .replace("${user_properties}", "{}")
            .replace("${user_type}", &user_type)
            .replace("${version_type}", "release")
            .replace("${resolution_width}", res_w)
            .replace("${resolution_height}", res_h)
            .replace("${clientid}", "")
            .replace("${auth_xuid}", "")
    };

    final_args.push(format!("-Xmx{}G", ram_gb));
    let xms_ram = (ram_gb / 2).max(1).min(2);
    final_args.push(format!("-Xms{}G", xms_ram));
    final_args.push("-Djava.net.preferIPv4Stack=true".to_string());
    if let Some(custom_jvm) = jvm_arguments {
        for arg in custom_jvm.split_whitespace() {
            final_args.push(arg.to_string());
        }
    } else {
        final_args.push("-XX:+UnlockExperimentalVMOptions".to_string());
        final_args.push("-XX:+UseG1GC".to_string());
        final_args.push("-XX:G1NewSizePercent=20".to_string());
        final_args.push("-XX:G1ReservePercent=20".to_string());
        final_args.push("-XX:MaxGCPauseMillis=50".to_string());
        final_args.push("-XX:G1HeapRegionSize=32M".to_string());
    }

    if let Some(jvm_array) = fabric_json
        .get("arguments")
        .and_then(|a| a.get("jvm"))
        .and_then(|j| j.as_array())
    {
        for arg in jvm_array {
            if let Some(s) = arg.as_str() {
                final_args.push(build_game_args(s));
            }
        }
    }

    final_args.push("--enable-native-access=ALL-UNNAMED".to_string());
    final_args.push("-Dsun.misc.unsafe.memory.access=allow".to_string());
    final_args.push("--add-opens=java.base/java.lang=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.lang.invoke=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.lang.reflect=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.io=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.net=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.nio=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.util=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.util.concurrent=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/sun.nio.ch=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/sun.misc=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/sun.security.action=ALL-UNNAMED".to_string());
    final_args.push("-Dminecraft.launcher.brand=NavithLabsLauncher".to_string());
    final_args.push("-Dminecraft.launcher.version=1.0".to_string());

    if user_type == "offline" {
        final_args.push("-Dminecraft.api.auth.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.account.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.session.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.services.host=http://127.0.0.1:54321".to_string());
    }

    final_args.push(format!("-Djava.library.path={}", natives_dir.display()));
    final_args.push("-cp".to_string());
    final_args.push(full_classpath_str);

    let main_class = fabric_json["mainClass"]
        .as_str()
        .unwrap_or("net.fabricmc.loader.impl.launch.knot.KnotClient");
    final_args.push(main_class.to_string());

    if let Some(game_args) = vanilla_json
        .get("arguments")
        .and_then(|a| a.get("game"))
        .and_then(|g| g.as_array())
    {
        for arg in game_args {
            if let Some(s) = arg.as_str() {
                final_args.push(build_game_args(s));
            }
        }
    } else if let Some(minecraft_args) = vanilla_json
        .get("minecraftArguments")
        .and_then(|a| a.as_str())
    {
        for arg in minecraft_args.split_whitespace() {
            final_args.push(build_game_args(arg));
        }
    }

    if let Some(game_args) = fabric_json
        .get("arguments")
        .and_then(|a| a.get("game"))
        .and_then(|g| g.as_array())
    {
        for arg in game_args {
            if let Some(s) = arg.as_str() {
                final_args.push(build_game_args(s));
            }
        }
    }

    if fullscreen {
        final_args.push("--fullscreen".to_string());
    } else {
        final_args.push("--width".to_string());
        final_args.push(res_w.to_string());
        final_args.push("--height".to_string());
        final_args.push(res_h.to_string());
    }

    emit("¡Lanzando Fabric!", 100.0);

    let clean_game_dir = final_game_dir.trim().trim_matches('"').trim_matches('\'').to_string();
    let game_dir_buf = PathBuf::from(&clean_game_dir);
    let _ = fs::create_dir_all(&game_dir_buf);

    let clean_java = java_exec.trim().trim_matches('"').trim_matches('\'').to_string();
    let actual_java = if PathBuf::from(&clean_java).is_dir() {
        find_java_exe(&PathBuf::from(&clean_java))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(clean_java)
    } else {
        clean_java
    };

    let mut cmd = std::process::Command::new(&actual_java);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    for a in &final_args {
        cmd.arg(a);
    }
    cmd.current_dir(&game_dir_buf);
    println!("FABRIC CMD: {:?}", cmd);

    if let Some(main_window) = app.get_webview_window("main") {
        let launched_at = std::time::SystemTime::now();
        let child = cmd.spawn().map_err(|e| format!("Error al ejecutar Java: {}", e))?;
        
        if launcher_visibility == "close" {
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                std::process::exit(0);
            });
        } else if launcher_visibility == "hide_reopen" {
            let pid = child.id();
            monitor_minecraft_process(child, main_window.clone(), true, game_dir_buf.clone(), launched_at);
            hide_launcher_when_minecraft_is_visible(main_window, pid).await;
        } else {
            monitor_minecraft_process(child, main_window, false, game_dir_buf.clone(), launched_at);
        }
    } else {
        cmd.spawn().map_err(|e| format!("Error al ejecutar Java: {}", e))?;
    }

    Ok(format!(
        "Iniciando Fabric {}-{}!",
        mc_version, fabric_version
    ))
}

#[allow(clippy::too_many_arguments)]
async fn launch_quilt(
    app: &tauri::AppHandle,
    mc_version: &str,
    quilt_version: &str,
    mc_path: &PathBuf,
    username: &str,
    uuid: Option<&str>,
    access_token: Option<&str>,
    ram_gb: u64,
    jvm_arguments: Option<&str>,
    game_directory: Option<&str>,
    res_w: &str,
    res_h: &str,
    fullscreen: bool,
    java_exec: &str,
    launcher_visibility: &str,
) -> Result<String, String> {
    let emit = |msg: &str, pct: f32| {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                message: msg.to_string(),
                percentage: pct,
            },
        );
    };

    let final_game_dir = match game_directory {
        Some(dir) => dir.to_string(),
        None => mc_path.to_string_lossy().to_string(),
    };

    let ver_dir = mc_path
        .join("versions")
        .join(format!("{}-quilt-{}", mc_version, quilt_version));
    fs::create_dir_all(&ver_dir).unwrap_or(());

    emit("Descargando perfil de Quilt...", 20.0);
    let quilt_url = format!(
        "https://meta.quiltmc.org/v3/versions/loader/{}/{}/profile/json",
        mc_version, quilt_version
    );
    let quilt_resp = HTTP_CLIENT.get(&quilt_url).send().await.map_err(|e| e.to_string())?;
    if !quilt_resp.status().is_success() {
        return Err(format!("Error: La versión de Quilt no se encontró o no es válida (HTTP {})", quilt_resp.status()));
    }

    let quilt_json_str = quilt_resp.text().await.map_err(|e| e.to_string())?;
    let quilt_json: serde_json::Value =
        serde_json::from_str(&quilt_json_str).map_err(|e| e.to_string())?;

    let vanilla_id = quilt_json["inheritsFrom"]
        .as_str()
        .unwrap_or(mc_version)
        .to_string();

    let vanilla_dir = mc_path.join("versions").join(&vanilla_id);
    fs::create_dir_all(&vanilla_dir).unwrap_or(());
    let vanilla_json_path = vanilla_dir.join(format!("{}.json", vanilla_id));

    if !vanilla_json_path.exists() {
        emit("Descargando manifiesto Vanilla...", 25.0);
        let manifest_url = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
        let text = HTTP_CLIENT.get(manifest_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .unwrap_or_default();
        let manifest: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let mut v_url = None;
        if let Some(versions) = manifest["versions"].as_array() {
            for v in versions {
                if v["id"].as_str() == Some(&vanilla_id) {
                    v_url = v["url"].as_str().map(|s| s.to_string());
                    break;
                }
            }
        }
        if let Some(url) = v_url {
            let v_text = HTTP_CLIENT.get(&url)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .text()
                .await
                .unwrap_or_default();
            let _ = fs::write(&vanilla_json_path, v_text);
        }
    }

    let vanilla_json_str = fs::read_to_string(&vanilla_json_path).unwrap_or_default();
    let vanilla_json: serde_json::Value =
        serde_json::from_str(&vanilla_json_str).unwrap_or_default();

    let jar_path = vanilla_dir.join(format!("{}.jar", vanilla_id));
    if !jar_path.exists() {
        emit("Descargando Minecraft cliente...", 30.0);
        if let Some(client_url) = vanilla_json
            .get("downloads")
            .and_then(|d| d.get("client"))
            .and_then(|c| c.get("url"))
            .and_then(|u| u.as_str())
        {
            let bytes = HTTP_CLIENT.get(client_url)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .bytes()
                .await
                .map_err(|e| e.to_string())?;
            let _ = fs::write(&jar_path, bytes);
        }
    }

    let mut all_artifacts = Vec::new();
    let natives_dir = ver_dir.join("natives");
    fs::create_dir_all(&natives_dir).unwrap_or(());

    if let Some(libs) = vanilla_json["libraries"].as_array() {
        for lib_val in libs {
            if let Ok(lib) = serde_json::from_value::<MinecraftLibrary>(lib_val.clone()) {
                if is_library_active(&lib) {
                    all_artifacts.extend(resolve_library(&lib));
                }
            }
        }
    }
    if let Some(libs) = quilt_json["libraries"].as_array() {
        for lib_val in libs {
            if let Ok(lib) = serde_json::from_value::<MinecraftLibrary>(lib_val.clone()) {
                if is_library_active(&lib) {
                    all_artifacts.extend(resolve_library(&lib));
                }
            }
        }
    }

    let mut classpath_entries = Vec::new();
    let mut download_items = Vec::new();
    let mut resolved_items = Vec::new();

    for art in all_artifacts {
        let absolute_path = mc_path.join("libraries").join(&art.path);
        if !absolute_path.exists() && !art.url.is_empty() {
            let fname = absolute_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            download_items.push((absolute_path.clone(), art.url.clone(), fname));
        }
        resolved_items.push((absolute_path, art.is_native));
    }

    if !download_items.is_empty() {
        download_libraries_parallel(app, &download_items, 35.0, 85.0).await?;
    }

    for (absolute_path, is_native) in resolved_items {
        if !is_native {
            classpath_entries.push(absolute_path.to_string_lossy().to_string());
        }
        if is_native && absolute_path.exists() {
            let _ = extract_natives(&absolute_path, &natives_dir);
        }
    }

    classpath_entries.push(jar_path.to_string_lossy().to_string());
    let full_classpath_str = classpath_entries.join(if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    });

    let asset_index = vanilla_json["assetIndex"]["id"]
        .as_str()
        .unwrap_or("legacy");
    let asset_index_url = vanilla_json["assetIndex"]["url"].as_str().unwrap_or("");
    emit("Verificando assets...", 85.0);
    let _ = download_assets(mc_path, asset_index_url, asset_index, app).await;

    emit("Preparando inicio de Quilt...", 95.0);

    let mut final_args = Vec::new();
    let (final_uuid, final_access_token, user_type) = if let (Some(u), Some(t)) = (uuid, access_token) {
        if !t.is_empty() && t != "0" {
            (u.to_string(), t.to_string(), "msa".to_string())
        } else {
            (generate_offline_uuid(username), "0".to_string(), "offline".to_string())
        }
    } else {
        (generate_offline_uuid(username), "0".to_string(), "offline".to_string())
    };

    let build_game_args = |template: &str| -> String {
        template
            .replace("${auth_player_name}", username)
            .replace("${version_name}", mc_version)
            .replace("${game_directory}", &final_game_dir)
            .replace(
                "${assets_root}",
                &mc_path.join("assets").to_string_lossy().to_string(),
            )
            .replace("${assets_index_name}", asset_index)
            .replace("${auth_uuid}", &final_uuid)
            .replace("${auth_access_token}", &final_access_token)
            .replace("${user_properties}", "{}")
            .replace("${user_type}", &user_type)
            .replace("${version_type}", "release")
            .replace("${resolution_width}", res_w)
            .replace("${resolution_height}", res_h)
            .replace("${clientid}", "")
            .replace("${auth_xuid}", "")
    };

    final_args.push(format!("-Xmx{}G", ram_gb));
    let xms_ram = (ram_gb / 2).max(1).min(2);
    final_args.push(format!("-Xms{}G", xms_ram));
    final_args.push("-Djava.net.preferIPv4Stack=true".to_string());
    if let Some(custom_jvm) = jvm_arguments {
        for arg in custom_jvm.split_whitespace() {
            final_args.push(arg.to_string());
        }
    } else {
        final_args.push("-XX:+UnlockExperimentalVMOptions".to_string());
        final_args.push("-XX:+UseG1GC".to_string());
        final_args.push("-XX:G1NewSizePercent=20".to_string());
        final_args.push("-XX:G1ReservePercent=20".to_string());
        final_args.push("-XX:MaxGCPauseMillis=50".to_string());
        final_args.push("-XX:G1HeapRegionSize=32M".to_string());
    }

    if let Some(jvm_array) = quilt_json
        .get("arguments")
        .and_then(|a| a.get("jvm"))
        .and_then(|j| j.as_array())
    {
        for arg in jvm_array {
            if let Some(s) = arg.as_str() {
                final_args.push(build_game_args(s));
            }
        }
    }

    final_args.push("--enable-native-access=ALL-UNNAMED".to_string());
    final_args.push("-Dsun.misc.unsafe.memory.access=allow".to_string());
    final_args.push("--add-opens=java.base/java.lang=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.lang.invoke=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.lang.reflect=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.io=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.net=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.nio=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.util=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.util.concurrent=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/sun.nio.ch=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/sun.misc=ALL-UNNAMED".to_string());
    final_args.push("--add-opens=java.base/sun.security.action=ALL-UNNAMED".to_string());
    final_args.push("-Dminecraft.launcher.brand=NavithLabsLauncher".to_string());
    final_args.push("-Dminecraft.launcher.version=1.0".to_string());

    if user_type == "offline" {
        final_args.push("-Dminecraft.api.auth.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.account.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.session.host=http://127.0.0.1:54321".to_string());
        final_args.push("-Dminecraft.api.services.host=http://127.0.0.1:54321".to_string());
    }

    final_args.push(format!("-Djava.library.path={}", natives_dir.display()));
    final_args.push("-cp".to_string());
    final_args.push(full_classpath_str);

    let main_class = quilt_json["mainClass"]
        .as_str()
        .unwrap_or("org.quiltmc.loader.impl.launch.knot.KnotClient");
    final_args.push(main_class.to_string());

    if let Some(game_args) = vanilla_json
        .get("arguments")
        .and_then(|a| a.get("game"))
        .and_then(|g| g.as_array())
    {
        for arg in game_args {
            if let Some(s) = arg.as_str() {
                final_args.push(build_game_args(s));
            }
        }
    } else if let Some(minecraft_args) = vanilla_json
        .get("minecraftArguments")
        .and_then(|a| a.as_str())
    {
        for arg in minecraft_args.split_whitespace() {
            final_args.push(build_game_args(arg));
        }
    }

    if let Some(game_args) = quilt_json
        .get("arguments")
        .and_then(|a| a.get("game"))
        .and_then(|g| g.as_array())
    {
        for arg in game_args {
            if let Some(s) = arg.as_str() {
                final_args.push(build_game_args(s));
            }
        }
    }

    if fullscreen {
        final_args.push("--fullscreen".to_string());
    } else {
        final_args.push("--width".to_string());
        final_args.push(res_w.to_string());
        final_args.push("--height".to_string());
        final_args.push(res_h.to_string());
    }

    emit("¡Lanzando Quilt!", 100.0);

    let clean_game_dir = final_game_dir.trim().trim_matches('"').trim_matches('\'').to_string();
    let game_dir_buf = PathBuf::from(&clean_game_dir);
    let _ = fs::create_dir_all(&game_dir_buf);

    let clean_java = java_exec.trim().trim_matches('"').trim_matches('\'').to_string();
    let actual_java = if PathBuf::from(&clean_java).is_dir() {
        find_java_exe(&PathBuf::from(&clean_java))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(clean_java)
    } else {
        clean_java
    };

    let mut cmd = std::process::Command::new(&actual_java);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    for a in &final_args {
        cmd.arg(a);
    }
    cmd.current_dir(&game_dir_buf);
    println!("QUILT CMD: {:?}", cmd);

    let visibility = launcher_visibility;

    if let Some(main_window) = app.get_webview_window("main") {
        let launched_at = std::time::SystemTime::now();
        let child = cmd.spawn().map_err(|e| format!("Error al ejecutar Java: {}", e))?;
        
        if visibility == "close" {
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                std::process::exit(0);
            });
        } else if visibility == "hide_reopen" {
            let pid = child.id();
            monitor_minecraft_process(child, main_window.clone(), true, game_dir_buf.clone(), launched_at);
            hide_launcher_when_minecraft_is_visible(main_window, pid).await;
        } else {
            monitor_minecraft_process(child, main_window, false, game_dir_buf.clone(), launched_at);
        }
    } else {
        cmd.spawn().map_err(|e| format!("Error al ejecutar Java: {}", e))?;
    }

    Ok(format!(
        "Iniciando Quilt {}-{}!",
        mc_version, quilt_version
    ))
}

fn read_auth_request(stream: &mut std::net::TcpStream) -> Result<String, String> {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
    let mut request = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 2048];

    loop {
        let read = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..read]);

        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if request.len() > 64 * 1024 {
            return Err("La respuesta de autenticación es demasiado grande.".to_string());
        }
    }

    String::from_utf8(request).map_err(|e| e.to_string())
}

fn send_auth_response(stream: &mut std::net::TcpStream, response: &str) -> Result<(), String> {
    stream.write_all(response.as_bytes()).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(|e| e.to_string())
}

fn auth_success_response(provider: &str) -> String {
    use base64::Engine as _;
    let logo_base64 = base64::engine::general_purpose::STANDARD.encode(include_bytes!("../../launcher-public/navithlabs-mark.png"));
    let page = r###"<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090b18"><meta name="referrer" content="no-referrer"><title>NavithLabs · Conexión lista</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Silkscreen:wght@400;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{display:grid;place-items:center;overflow:hidden;color:#f5f6fb;background:radial-gradient(ellipse at 50% 43%,rgba(74,72,144,.27),transparent 36%),radial-gradient(ellipse at 12% 100%,rgba(136,37,69,.13),transparent 35%),#090b18;font-family:Outfit,"Segoe UI",sans-serif}.grid{position:fixed;inset:0;opacity:.13;background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px);background-size:42px 42px;mask-image:radial-gradient(ellipse,black,transparent 78%)}.card{position:relative;width:min(630px,calc(100vw - 36px));padding:42px 46px 36px;border:1px solid rgba(197,202,233,.2);background:linear-gradient(145deg,rgba(21,24,44,.97),rgba(12,14,28,.97));box-shadow:0 28px 90px rgba(0,0,0,.48),0 0 60px rgba(89,79,167,.1);animation:arrive .65s cubic-bezier(.16,1,.3,1) both}.card:before{position:absolute;top:0;bottom:0;left:0;width:2px;background:linear-gradient(transparent,#ff4059,#ff8794,transparent);content:""}.orbit{position:absolute;top:-56px;right:24px;width:140px;height:140px;border:1px solid rgba(255,104,123,.18);border-radius:50%;box-shadow:0 0 0 15px rgba(255,64,89,.025),0 0 0 31px rgba(255,64,89,.015);animation:spin 22s linear infinite}.brand{position:relative;display:grid;place-items:center;width:82px;height:82px;margin-bottom:25px;border:1px solid rgba(255,104,123,.3);background:linear-gradient(145deg,rgba(255,64,89,.13),rgba(90,83,169,.12));box-shadow:0 0 36px rgba(255,64,89,.12);animation:glow 2.7s ease-in-out infinite}.brand img{width:68px;height:68px;object-fit:contain}.label{display:flex;align-items:center;gap:9px;color:#aeb4c9;font:10px 'Silkscreen',monospace;letter-spacing:.05em}.dot{width:7px;height:7px;border-radius:50%;background:#68d7a2;box-shadow:0 0 12px rgba(104,215,162,.7)}h1{margin:17px 0 12px;font-size:clamp(30px,5vw,46px);line-height:1.06;letter-spacing:-.055em;font-weight:650}h1 span{color:#ff687b}p{max-width:490px;margin:0;color:#aab0c3;font-size:16px;line-height:1.6}.provider{color:#f4cbd1}.footer{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:29px;padding-top:19px;border-top:1px solid rgba(196,202,229,.13);color:#717991;font:9px 'Silkscreen',monospace}.button{padding:11px 14px;color:#fff;background:#e83450;border:0;cursor:pointer;font:10px 'Silkscreen',monospace;transition:transform .2s,box-shadow .2s}.button:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(232,52,80,.25)}@keyframes arrive{from{opacity:0;transform:translateY(15px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes glow{50%{box-shadow:0 0 52px rgba(255,64,89,.23);transform:scale(1.035)}}@media(max-width:520px){.card{padding:32px 26px 25px}.orbit{right:-50px}.footer{align-items:flex-start;flex-direction:column}p{font-size:14px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
</style></head><body><div class="grid"></div><main class="card"><div class="orbit"></div><div class="brand"><img src="data:image/png;base64,__LOGO_BASE64__" alt="navith.labs" /></div><div class="label"><i class="dot"></i> ACCESO CONFIRMADO <span>/ NAVITH.LABS</span></div><h1>¡Conexión<br><span>exitosa!</span></h1><p>Tu inicio de sesión con <strong class="provider">__PROVIDER__</strong> fue confirmado. Ya puedes cerrar esta ventana y volver al launcher.</p><div class="footer"><span>REGRESA AL LAUNCHER PARA CONTINUAR</span><button class="button" onclick="window.close()">LISTO ↗</button></div></main></body></html>"###;
    let body = page
        .replace("__PROVIDER__", provider)
        .replace("__LOGO_BASE64__", &logo_base64);
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store, max-age=0\r\nPragma: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

#[tauri::command]
async fn start_discord_auth(app: tauri::AppHandle) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let listener = std::net::TcpListener::bind("127.0.0.1:3456").map_err(|e| e.to_string())?;
        let _ = app.emit("discord-auth-listening", ());
        let mut token = String::new();
        
        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let request = match read_auth_request(&mut stream) {
                        Ok(request) => request,
                        Err(_) => continue,
                    };

                    if request.contains("GET /cancel") {
                        let response = "HTTP/1.1 200 OK\r\n\r\n";
                        let _ = send_auth_response(&mut stream, response);
                        break;
                    }

                    if request.starts_with("GET /auth ") || request.starts_with("GET /auth#") {
                        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
                        <!DOCTYPE html><html>\
                        <head>\
                          <meta charset='utf-8'>\
                          <title>NavithLabs Launcher - Autenticación</title>\
                          <link href='https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&display=swap' rel='stylesheet'>\
                          <style>\
                            body { background: #0a0a0c; color: #fff; font-family: 'Orbitron', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; overflow: hidden; }\
                            h2 { font-size: 2.5rem; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px rgba(255,255,255,0.8), 0 0 20px rgba(255,255,255,0.4); margin-bottom: 10px; }\
                            p { font-size: 1.1rem; color: #aaa; font-family: sans-serif; }\
                            .neon-box { border: 2px solid rgba(255,255,255,0.2); padding: 40px; border-radius: 15px; background: rgba(0,0,0,0.6); box-shadow: 0 0 15px rgba(255,255,255,0.1), inset 0 0 20px rgba(0,0,0,0.8); }\
                          </style>\
                        </head>\
                        <body>\
                          <div class='neon-box'>\
                            <h2 id='title'>AUTENTICANDO...</h2>\
                            <p id='subtitle'>Conectando con Discord de forma segura</p>\
                          </div>\
                          <script>\
                          const hash = window.location.hash.substring(1);\
                          const params = new URLSearchParams(hash);\
                          const token = params.get('access_token');\
                          if (token) {\
                              window.location.href = '/callback?token=' + token;\
                          } else {\
                              document.getElementById('title').innerText = 'ERROR DE ACCESO';\
                              document.getElementById('subtitle').innerText = 'Autenticación cancelada o fallida. Puedes cerrar esta ventana.';\
                          }\
                          </script>\
                        </body></html>";
                        let _ = send_auth_response(&mut stream, response);
                    } else if request.starts_with("GET /callback?token=") {
                        let first_line = request.lines().next().unwrap_or("");
                        let parts: Vec<&str> = first_line.split(' ').collect();
                        if parts.len() > 1 {
                            let path = parts[1];
                            if let Some(t) = path.strip_prefix("/callback?token=") {
                                token = t.to_string();
                            }
                        }

                        let response = auth_success_response("Discord");
                        let _ = send_auth_response(&mut stream, &response);
                        break;
                    } else if request.starts_with("GET /favicon.ico") {
                        let response = "HTTP/1.1 404 NOT FOUND\r\n\r\n";
                        let _ = send_auth_response(&mut stream, response);
                    }
                }
                Err(_) => {}
            }
        }
        Ok(token)
    })
    .await
    .map_err(|e| format!("Tokio error: {}", e))?
}

#[tauri::command]
async fn start_google_auth(app: tauri::AppHandle) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let listener = std::net::TcpListener::bind("127.0.0.1:3456").map_err(|e| e.to_string())?;
        let _ = app.emit("google-auth-listening", ());
        let mut token = String::new();
        
        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let request = match read_auth_request(&mut stream) {
                        Ok(request) => request,
                        Err(_) => continue,
                    };

                    if request.contains("GET /cancel") {
                        let response = "HTTP/1.1 200 OK\r\n\r\n";
                        let _ = send_auth_response(&mut stream, response);
                        break;
                    }

                    if request.starts_with("GET /google-callback ") || request.starts_with("GET /google-callback#") || request.starts_with("GET /google-callback?") {
                        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
                        <!DOCTYPE html><html>\
                        <head>\
                          <meta charset='utf-8'>\
                          <title>NavithLabs Launcher - Autenticación con Google</title>\
                          <link href='https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&display=swap' rel='stylesheet'>\
                          <style>\
                            body { background: #0a0a0c; color: #fff; font-family: 'Orbitron', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; overflow: hidden; }\
                            h2 { font-size: 2.5rem; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px rgba(255,255,255,0.8), 0 0 20px rgba(255,255,255,0.4); margin-bottom: 10px; }\
                            p { font-size: 1.1rem; color: #aaa; font-family: sans-serif; }\
                            .neon-box { border: 2px solid rgba(255,255,255,0.2); padding: 40px; border-radius: 15px; background: rgba(0,0,0,0.6); box-shadow: 0 0 15px rgba(255,255,255,0.1), inset 0 0 20px rgba(0,0,0,0.8); }\
                          </style>\
                        </head>\
                        <body>\
                          <div class='neon-box'>\
                            <h2 id='title'>AUTENTICANDO...</h2>\
                            <p id='subtitle'>Conectando con Google de forma segura</p>\
                          </div>\
                          <script>\
                          const hash = window.location.hash.substring(1);\
                          const params = new URLSearchParams(hash);\
                          const token = params.get('access_token');\
                          if (token) {\
                              window.location.href = '/google-token?token=' + token;\
                          } else {\
                              document.getElementById('title').innerText = 'ERROR DE ACCESO';\
                              document.getElementById('subtitle').innerText = 'Autenticación cancelada o fallida. Puedes cerrar esta ventana.';\
                          }\
                          </script>\
                        </body></html>";
                        let _ = send_auth_response(&mut stream, response);
                    } else if request.starts_with("GET /google-token?token=") {
                        let first_line = request.lines().next().unwrap_or("");
                        let parts: Vec<&str> = first_line.split(' ').collect();
                        if parts.len() > 1 {
                            let path = parts[1];
                            if let Some(t) = path.strip_prefix("/google-token?token=") {
                                token = t.to_string();
                            }
                        }

                        let response = auth_success_response("Google");
                        let _ = send_auth_response(&mut stream, &response);
                        break;
                    } else if request.starts_with("GET /favicon.ico") {
                        let response = "HTTP/1.1 404 NOT FOUND\r\n\r\n";
                        let _ = send_auth_response(&mut stream, response);
                    }
                }
                Err(_) => {}
            }
        }
        Ok(token)
    })
    .await
    .map_err(|e| format!("Tokio error: {}", e))?
}

#[tauri::command]
async fn start_microsoft_auth(app: tauri::AppHandle) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let listener = std::net::TcpListener::bind("127.0.0.1:3456").map_err(|e| e.to_string())?;
        let _ = app.emit("microsoft-auth-listening", ());
        let mut code = String::new();
        
        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let request = match read_auth_request(&mut stream) {
                        Ok(request) => request,
                        Err(_) => continue,
                    };

                    if request.contains("GET /cancel") {
                        let response = "HTTP/1.1 200 OK\r\n\r\n";
                        let _ = send_auth_response(&mut stream, response);
                        break;
                    }

                    if request.starts_with("GET /?") || request.starts_with("GET / ") {
                        let first_line = request.lines().next().unwrap_or("");
                        let parts: Vec<&str> = first_line.split(' ').collect();
                        if parts.len() > 1 {
                            let path = parts[1];
                            if let Some(query) = path.split('?').nth(1) {
                                for param in query.split('&') {
                                    if let Some(c) = param.strip_prefix("code=") {
                                        code = c.to_string();
                                    }
                                }
                            }
                        }

                        let response = auth_success_response("Microsoft");
                        let _ = send_auth_response(&mut stream, &response);
                        break;
                    } else if request.starts_with("GET /favicon.ico") {
                        let response = "HTTP/1.1 404 NOT FOUND\r\n\r\n";
                        let _ = send_auth_response(&mut stream, response);
                    }
                }
                Err(_) => {}
            }
        }
        Ok(code)
    })
    .await
    .map_err(|e| format!("Tokio error: {}", e))?
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MicrosoftProfile {
    pub uuid: String,
    pub name: String,
    pub access_token: String,
    pub refresh_token: String, // Añadido para sesiones persistentes
}

#[tauri::command]
async fn exchange_microsoft_token(client_id: String, code: String) -> Result<MicrosoftProfile, String> {
    let client = reqwest::Client::new();
    
    fn url_decode(input: &str) -> String {
        let mut decoded = String::new();
        let mut chars = input.chars();
        while let Some(c) = chars.next() {
            if c == '%' {
                let mut hex = String::new();
                if let Some(h1) = chars.next() {
                    hex.push(h1);
                    if let Some(h2) = chars.next() {
                        hex.push(h2);
                        if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                            decoded.push(byte as char);
                            continue;
                        }
                    }
                }
            } else if c == '+' {
                decoded.push(' ');
                continue;
            }
            decoded.push(c);
        }
        decoded
    }
    
    let decoded_code = url_decode(&code);

    let token_res = client.post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("code", decoded_code.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", "http://localhost:3456/"),
            ("scope", "XboxLive.SignIn XboxLive.offline_access"),
        ])
        .send().await.map_err(|e| e.to_string())?;
    let token_status = token_res.status();
    let token_json: serde_json::Value = token_res.json().await.map_err(|e| e.to_string())?;
    if !token_status.is_success() {
        let detail = token_json["error_description"]
            .as_str()
            .or_else(|| token_json["error"].as_str())
            .unwrap_or("Microsoft rechazó el código de autorización.");
        return Err(format!("No se pudo completar el inicio de sesión con Microsoft: {}", detail));
    }
    
    let ms_token = token_json["access_token"].as_str().ok_or_else(|| format!("Failed to get Microsoft token: {}", token_json))?;
    let refresh_token = token_json["refresh_token"].as_str().unwrap_or("").to_string();

    let xbl_body = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={}", ms_token)
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });
    
    let xbl_res = client.post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&xbl_body)
        .send().await.map_err(|e| e.to_string())?;
    let xbl_json: serde_json::Value = xbl_res.json().await.map_err(|e| e.to_string())?;
    let xbl_token = xbl_json["Token"].as_str().ok_or_else(|| format!("Failed to get XBL token: {}", xbl_json))?;
    let xui_array = xbl_json["DisplayClaims"].get("xui").and_then(|x| x.as_array()).ok_or("No xui array")?;
    if xui_array.is_empty() { return Err("Empty xui array".to_string()); }
    let uhs = xui_array[0]["uhs"].as_str().ok_or("Failed to get UHS")?;

    let xsts_body = serde_json::json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [xbl_token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });
    
    let xsts_res = client.post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&xsts_body)
        .send().await.map_err(|e| e.to_string())?;
    
    if !xsts_res.status().is_success() {
        return Err("XSTS authentication failed. It's possible this account doesn't have an Xbox profile or is a child account.".to_string());
    }

    let xsts_json: serde_json::Value = xsts_res.json().await.map_err(|e| e.to_string())?;
    let xsts_token = xsts_json["Token"].as_str().ok_or_else(|| format!("Failed to get XSTS token: {}", xsts_json))?;

    let mc_body = serde_json::json!({
        "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token)
    });
    
    let mc_res = client.post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&mc_body)
        .send().await.map_err(|e| e.to_string())?;
    let mc_json: serde_json::Value = mc_res.json().await.map_err(|e| e.to_string())?;
    let mc_access_token = mc_json["access_token"].as_str().ok_or_else(|| format!("Failed to get Minecraft access token: {}", mc_json))?;

    let profile_res = client.get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", mc_access_token))
        .send().await.map_err(|e| e.to_string())?;
    
    if !profile_res.status().is_success() {
        return Err("Failed to fetch Minecraft profile. Make sure this account owns Minecraft Java Edition.".to_string());
    }

    let profile_json: serde_json::Value = profile_res.json().await.map_err(|e| e.to_string())?;
    
    let uuid = profile_json["id"].as_str().ok_or("User does not own Minecraft")?;
    let name = profile_json["name"].as_str().ok_or("User does not have a Minecraft name")?;

    Ok(MicrosoftProfile {
        uuid: uuid.to_string(),
        name: name.to_string(),
        access_token: mc_access_token.to_string(),
        refresh_token,
    })
}

#[tauri::command]
async fn refresh_microsoft_token(client_id: String, refresh_token: String) -> Result<MicrosoftProfile, String> {
    let client = reqwest::Client::new();
    
    let token_res = client.post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
            ("scope", "XboxLive.SignIn XboxLive.offline_access"),
        ])
        .send().await.map_err(|e| e.to_string())?;
    
    let token_json: serde_json::Value = token_res.json().await.map_err(|e| e.to_string())?;
    let ms_token = token_json["access_token"].as_str().ok_or_else(|| format!("Failed to refresh Microsoft token: {}", token_json))?;
    let new_refresh_token = token_json["refresh_token"].as_str().unwrap_or(&refresh_token).to_string();

    let xbl_body = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={}", ms_token)
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });
    
    let xbl_res = client.post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&xbl_body)
        .send().await.map_err(|e| e.to_string())?;
    let xbl_json: serde_json::Value = xbl_res.json().await.map_err(|e| e.to_string())?;
    let xbl_token = xbl_json["Token"].as_str().ok_or_else(|| format!("Failed to get XBL token: {}", xbl_json))?;
    let xui_array = xbl_json["DisplayClaims"].get("xui").and_then(|x| x.as_array()).ok_or("No xui array")?;
    let uhs = xui_array[0]["uhs"].as_str().ok_or("Failed to get UHS")?;

    let xsts_body = serde_json::json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [xbl_token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });
    
    let xsts_res = client.post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&xsts_body)
        .send().await.map_err(|e| e.to_string())?;
    let xsts_json: serde_json::Value = xsts_res.json().await.map_err(|e| e.to_string())?;
    let xsts_token = xsts_json["Token"].as_str().ok_or_else(|| format!("Failed to get XSTS token: {}", xsts_json))?;

    let mc_body = serde_json::json!({
        "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token)
    });
    
    let mc_res = client.post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&mc_body)
        .send().await.map_err(|e| e.to_string())?;
    let mc_json: serde_json::Value = mc_res.json().await.map_err(|e| e.to_string())?;
    let mc_access_token = mc_json["access_token"].as_str().ok_or_else(|| format!("Failed to get Minecraft access token: {}", mc_json))?;

    let profile_res = client.get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", mc_access_token))
        .send().await.map_err(|e| e.to_string())?;
    let profile_json: serde_json::Value = profile_res.json().await.map_err(|e| e.to_string())?;
    let uuid = profile_json["id"].as_str().ok_or("User does not own Minecraft")?;
    let name = profile_json["name"].as_str().ok_or("User does not have a Minecraft name")?;

    Ok(MicrosoftProfile {
        uuid: uuid.to_string(),
        name: name.to_string(),
        access_token: mc_access_token.to_string(),
        refresh_token: new_refresh_token,
    })
}

#[tauri::command]
async fn close_splashscreen(window: tauri::Window) {
    if let Some(splashscreen) = window.get_webview_window("splashscreen") {
        splashscreen.close().unwrap();
    }
    if let Some(main_window) = window.get_webview_window("main") {
        main_window.maximize().unwrap_or_default();
        main_window.show().unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_err() {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--disable-features=Translate,InterestFeedContentSuggestions,CalculateNativeWinOcclusion --renderer-process-limit=4"
            );
        }
    }

    let (tx, rx) = mpsc::channel::<DiscordMsg>();
    let discord_presence_enabled = Arc::new(AtomicBool::new(false));
    
    thread::spawn(move || {
        let mut client = match DiscordIpcClient::new("1564855095902994462") {
            Ok(c) => c,
            Err(_) => return,
        };

        if client.connect().is_err() {
            loop {
                thread::sleep(std::time::Duration::from_secs(15));
                if client.connect().is_ok() { break; }
            }
        }

        let mut session_start = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let mut was_in_game = false;

        while let Ok(msg) = rx.recv() {
            match msg {
                DiscordMsg::Update { details, state, large_image, large_text, small_image, small_text, buttons, start_time } => {
                    let mut assets = activity::Assets::new()
                        .large_image(&large_image)
                        .large_text(&large_text);
                    
                    if !small_image.is_empty() {
                        assets = assets.small_image(&small_image).small_text(&small_text);
                    }

                    let act_buttons: Vec<activity::Button> = match &buttons {
                        Some(custom) if !custom.is_empty() => {
                            custom.iter().take(2).map(|b| activity::Button::new(&b.label, &b.url)).collect()
                        },
                        _ => Vec::new()
                    };

                    let is_in_game = details.starts_with("Jugando ");
                    if is_in_game != was_in_game {
                        session_start = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as i64;
                        was_in_game = is_in_game;
                    }

                    let timestamp = start_time.unwrap_or(session_start);

                    let res = client.set_activity(activity::Activity::new()
                        .details(&details)
                        .state(&state)
                        .assets(assets)
                        .buttons(act_buttons)
                        .timestamps(activity::Timestamps::new().start(timestamp))
                    );

                    if res.is_err() {
                        let _ = client.reconnect();
                    }
                }
                DiscordMsg::Clear => {
                    let _ = client.clear_activity();
                    was_in_game = false;
                    session_start = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64;
                }
            }
        }
    });

#[tauri::command]
async fn get_minecraft_profile(token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client.get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", token))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CACHE_CONTROL, "no-cache, no-store, max-age=0")
        .header(reqwest::header::PRAGMA, "no-cache")
        .send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Failed to get profile: {}", err_text));
    }
    
    let profile: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(profile)
}

#[tauri::command]
async fn lookup_minecraft_skin(username: String) -> Result<serde_json::Value, String> {
    use base64::Engine as _;

    let username = username.trim();
    if username.is_empty()
        || username.len() > 16
        || !username
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || character == b'_')
    {
        return Err("INVALID_USERNAME".to_string());
    }

    let mut lookup_error = "PROFILE_SERVICE_UNAVAILABLE";
    if let Ok(response) = HTTP_CLIENT
        .get(format!(
            "https://api.mojang.com/users/profiles/minecraft/{username}"
        ))
        .send()
        .await
    {
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::NO_CONTENT {
            lookup_error = "PLAYER_NOT_FOUND";
        } else if status.is_success() {
            if let Ok(profile) = response.json::<serde_json::Value>().await {
                let uuid = profile.get("id").and_then(|value| value.as_str());
                let profile_name = profile
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or(username);
                if let Some(uuid) = uuid {
                    if let Ok(texture_response) = HTTP_CLIENT
                        .get(format!(
                            "https://sessionserver.mojang.com/session/minecraft/profile/{uuid}"
                        ))
                        .send()
                        .await
                    {
                        if texture_response.status().is_success() {
                            if let Ok(texture_profile) =
                                texture_response.json::<serde_json::Value>().await
                            {
                                let encoded_textures = texture_profile
                                    .get("properties")
                                    .and_then(|value| value.as_array())
                                    .and_then(|properties| {
                                        properties.iter().find_map(|property| {
                                            (property.get("name").and_then(|value| value.as_str())
                                                == Some("textures"))
                                            .then(|| {
                                                property
                                                    .get("value")
                                                    .and_then(|value| value.as_str())
                                            })
                                            .flatten()
                                        })
                                    });

                                if let Some(encoded_textures) = encoded_textures {
                                    if let Ok(decoded) = base64::engine::general_purpose::STANDARD
                                        .decode(encoded_textures)
                                    {
                                        if let Ok(textures) =
                                            serde_json::from_slice::<serde_json::Value>(&decoded)
                                        {
                                            let skin = textures
                                                .get("textures")
                                                .and_then(|value| value.get("SKIN"));
                                            if let Some(skin_url) = skin
                                                .and_then(|value| value.get("url"))
                                                .and_then(|value| value.as_str())
                                            {
                                                let model = skin
                                                    .and_then(|value| value.get("metadata"))
                                                    .and_then(|value| value.get("model"))
                                                    .and_then(|value| value.as_str())
                                                    .unwrap_or("classic");
                                                return Ok(serde_json::json!({
                                                    "username": profile_name,
                                                    "skinUrl": skin_url,
                                                    "model": if model == "slim" { "slim" } else { "classic" }
                                                }));
                                            }
                                            lookup_error = "PROFILE_NO_SKIN";
                                        }
                                    }
                                } else {
                                    lookup_error = "PROFILE_NO_SKIN";
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(response) = HTTP_CLIENT
        .get(format!("https://api.ashcon.app/mojang/v2/user/{username}"))
        .send()
        .await
    {
        let status = response.status();
        if status.is_success() {
            if let Ok(profile) = response.json::<serde_json::Value>().await {
                let textures = profile.get("textures");
                let skin = textures.and_then(|value| value.get("skin"));
                if let Some(skin_url) = skin
                    .and_then(|value| value.get("url"))
                    .and_then(|value| value.as_str())
                {
                    let profile_name = profile
                        .get("username")
                        .and_then(|value| value.as_str())
                        .unwrap_or(username);
                    let model = textures
                        .and_then(|value| value.get("slim"))
                        .and_then(|value| value.as_bool())
                        .or_else(|| {
                            skin.and_then(|value| value.get("slim"))
                                .and_then(|value| value.as_bool())
                        })
                        .unwrap_or(false);
                    return Ok(serde_json::json!({
                        "username": profile_name,
                        "skinUrl": skin_url,
                        "model": if model { "slim" } else { "classic" }
                    }));
                }
                lookup_error = "PROFILE_NO_SKIN";
            }
        } else if (status == reqwest::StatusCode::NOT_FOUND
            || status == reqwest::StatusCode::NO_CONTENT)
            && lookup_error == "PROFILE_SERVICE_UNAVAILABLE"
        {
            lookup_error = "PLAYER_NOT_FOUND";
        }
    }

    Err(lookup_error.to_string())
}

#[tauri::command]
async fn upload_minecraft_skin(token: String, file_path: String, variant: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let file_bytes = std::fs::read(&file_path).map_err(|e| format!("Failed to read skin file: {}", e))?;
    
    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name("skin.png")
        .mime_str("image/png").map_err(|e| e.to_string())?;
    
    let form = reqwest::multipart::Form::new()
        .text("variant", variant)
        .part("file", part);
    
    let res = client.post("https://api.minecraftservices.com/minecraft/profile/skins")
        .header("Authorization", format!("Bearer {}", token))
        .multipart(form)
        .send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Failed to upload skin: {}", err_text));
    }
    
    Ok(())
}

#[tauri::command]
async fn set_minecraft_cape(token: String, cape_id: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "capeId": cape_id });
    
    let res = client.put("https://api.minecraftservices.com/minecraft/profile/capes/active")
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Error al activar capa: {}", err_text));
    }
    
    Ok(())
}

#[tauri::command]
async fn hide_minecraft_cape(token: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    
    let res = client.delete("https://api.minecraftservices.com/minecraft/profile/capes/active")
        .header("Authorization", format!("Bearer {}", token))
        .send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Error al quitar capa: {}", err_text));
    }
    
    Ok(())
}

#[tauri::command]
async fn set_minecraft_skin_url(token: String, url: String, variant: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    
    let skin_res = client.get(&url).send().await.map_err(|e| format!("Error al descargar skin: {}", e))?;
    let skin_bytes = skin_res.bytes().await.map_err(|e| format!("Error al leer bytes de la skin: {}", e))?;
    
    let part = reqwest::multipart::Part::bytes(skin_bytes.to_vec())
        .file_name("skin.png")
        .mime_str("image/png").map_err(|e| e.to_string())?;
    
    let form = reqwest::multipart::Form::new()
        .text("variant", variant)
        .part("file", part);
    
    let res = client.post("https://api.minecraftservices.com/minecraft/profile/skins")
        .header("Authorization", format!("Bearer {}", token))
        .multipart(form)
        .send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Error API Minecraft ({}): {}", status, err_text));
    }
    
    Ok(())
}

#[tauri::command]
async fn search_modrinth(query: String, offset: u32, limit: u32, facets: Option<String>) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .user_agent("NavithLabsLauncher/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    
    let url = "https://api.modrinth.com/v2/search";
    let limit_str = limit.to_string();
    let offset_str = offset.to_string();
    let actual_facets = facets.unwrap_or_else(|| "[[\"project_type:modpack\"]]".to_string());
    
    let resp = client.get(url)
        .query(&[
            ("query", query.as_str()),
            ("facets", actual_facets.as_str()),
            ("limit", limit_str.as_str()),
            ("offset", offset_str.as_str()),
        ])
        .send().await.map_err(|e| e.to_string())?;
    
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn search_curseforge(
    query: String, 
    index: u32, 
    limit: u32, 
    game_version: Option<String>, 
    mod_loader_type: Option<u32>,
    category_id: Option<u32>,
    class_id: Option<u32>,
    sort_field: Option<u32>,
    sort_order: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .user_agent("NavithLabsLauncher/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    
    let url = "https://api.curseforge.com/v1/mods/search";
    let index_str = index.to_string();
    let limit_str = limit.to_string();
    let class_id_str = class_id.unwrap_or(4471).to_string();
    let sort_field_str = sort_field.unwrap_or(2).to_string();
    let sort_order_str = sort_order.unwrap_or_else(|| "desc".to_string());
    
    let mut query_params = vec![
        ("gameId", "432".to_string()),
        ("classId", class_id_str),
        ("searchFilter", query),
        ("index", index_str),
        ("pageSize", limit_str),
        ("sortField", sort_field_str),
        ("sortOrder", sort_order_str),
    ];

    if let Some(gv) = game_version {
        if !gv.is_empty() {
            query_params.push(("gameVersion", gv));
        }
    }

    if let Some(mlt) = mod_loader_type {
        if mlt > 0 {
            query_params.push(("modLoaderType", mlt.to_string()));
        }
    }

    if let Some(cid) = category_id {
        if cid > 0 {
            query_params.push(("categoryId", cid.to_string()));
        }
    }

    let resp = client.get(url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .query(&query_params)
        .send().await.map_err(|e| e.to_string())?;
    
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn get_modrinth_project_versions(project_id: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .user_agent("NavithLabsLauncher/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct InstalledAddonResult {
    pub main_file: String,
    pub dependencies: Vec<String>,
    pub total_files_installed: usize,
}

async fn download_modrinth_file_direct(
    client: &reqwest::Client,
    target_dir: &std::path::Path,
    ver: &serde_json::Value,
    downloaded_files: &mut Vec<String>,
) -> Result<(), String> {
    let files = ver.get("files").and_then(|f| f.as_array()).ok_or("No hay archivos disponibles en esta versión")?;
    let primary_file = files.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
        .or_else(|| files.first())
        .ok_or("No se encontró el archivo primario de descarga")?;

    let file_url = primary_file.get("url").and_then(|u| u.as_str()).ok_or("URL de descarga no encontrada")?;
    let file_name = primary_file.get("filename").and_then(|n| n.as_str()).unwrap_or("addon_file.jar");

    let dest_path = target_dir.join(file_name);
    if dest_path.exists() {
        if let Ok(meta) = std::fs::metadata(&dest_path) {
            if meta.len() > 0 {
                if !downloaded_files.contains(&file_name.to_string()) {
                    downloaded_files.push(file_name.to_string());
                }
                return Ok(());
            }
        }
    }

    let file_resp = client.get(file_url).send().await.map_err(|e| format!("Error descargando {file_name}: {e}"))?;
    let bytes = file_resp.bytes().await.map_err(|e| format!("Error leyendo datos de {file_name}: {e}"))?;

    std::fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
    std::fs::write(&dest_path, &bytes).map_err(|e| format!("Error guardando {file_name}: {e}"))?;

    if !downloaded_files.contains(&file_name.to_string()) {
        downloaded_files.push(file_name.to_string());
    }

    Ok(())
}

async fn process_modrinth_version_recursive(
    client: &reqwest::Client,
    target_dir: &std::path::Path,
    ver: &serde_json::Value,
    mc_version: &str,
    loader: &str,
    addon_type: &str,
    installed_projects: &mut std::collections::HashSet<String>,
    downloaded_files: &mut Vec<String>,
) -> Result<(), String> {
    if let Some(deps) = ver.get("dependencies").and_then(|d| d.as_array()) {
        for dep in deps {
            let dep_type = dep.get("dependency_type").and_then(|t| t.as_str()).unwrap_or("");
            if dep_type == "required" {
                if let Some(proj_id) = dep.get("project_id").and_then(|p| p.as_str()) {
                    if !installed_projects.contains(proj_id) {
                        let _ = Box::pin(resolve_and_download_modrinth_version(
                            client,
                            target_dir,
                            proj_id,
                            mc_version,
                            loader,
                            "mod",
                            installed_projects,
                            downloaded_files,
                        )).await;
                    }
                } else if let Some(ver_id) = dep.get("version_id").and_then(|v| v.as_str()) {
                    let ver_url = format!("https://api.modrinth.com/v2/version/{}", ver_id);
                    if let Ok(v_resp) = client.get(&ver_url).send().await {
                        if v_resp.status().is_success() {
                            if let Ok(v_json) = v_resp.json::<serde_json::Value>().await {
                                let _ = Box::pin(download_modrinth_file_direct(client, target_dir, &v_json, downloaded_files)).await;
                            }
                        }
                    }
                }
            }
        }
    }

    download_modrinth_file_direct(client, target_dir, ver, downloaded_files).await
}

async fn resolve_and_download_modrinth_version(
    client: &reqwest::Client,
    target_dir: &std::path::Path,
    project_id_or_slug: &str,
    mc_version: &str,
    loader: &str,
    addon_type: &str,
    installed_projects: &mut std::collections::HashSet<String>,
    downloaded_files: &mut Vec<String>,
) -> Result<(), String> {
    if installed_projects.contains(project_id_or_slug) {
        return Ok(());
    }
    installed_projects.insert(project_id_or_slug.to_string());

    let mut query_params: Vec<(&str, String)> = Vec::new();
    if !loader.eq_ignore_ascii_case("vanilla") && !loader.is_empty() && addon_type == "mod" {
        query_params.push(("loaders", format!("[\"{}\"]", loader.to_lowercase())));
    }
    if !mc_version.is_empty() && addon_type != "shader" {
        query_params.push(("game_versions", format!("[\"{}\"]", mc_version)));
    }

    let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id_or_slug);
    let mut req = client.get(&url);
    for (k, v) in &query_params {
        req = req.query(&[(*k, v)]);
    }

    let resp = req.send().await.map_err(|e| format!("Error conectando con Modrinth ({project_id_or_slug}): {e}"))?;
    if resp.status().is_success() {
        let versions: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
        if !versions.is_empty() {
            return Box::pin(process_modrinth_version_recursive(client, target_dir, &versions[0], mc_version, loader, addon_type, installed_projects, downloaded_files)).await;
        }
    }

    let fallback_url = format!("https://api.modrinth.com/v2/project/{}/version", project_id_or_slug);
    let fb_resp = client.get(&fallback_url).send().await.map_err(|e| format!("Error conectando con Modrinth fallback ({project_id_or_slug}): {e}"))?;
    if fb_resp.status().is_success() {
        let fb_versions: Vec<serde_json::Value> = fb_resp.json().await.map_err(|e| e.to_string())?;
        if !fb_versions.is_empty() {
            return Box::pin(process_modrinth_version_recursive(client, target_dir, &fb_versions[0], mc_version, loader, addon_type, installed_projects, downloaded_files)).await;
        }
    }

    Err(format!("No se encontró ninguna versión compatible de {project_id_or_slug} para {loader} {mc_version}"))
}

#[tauri::command]
pub async fn install_modrinth_addon_with_dependencies(
    game_directory: String,
    project_id_or_slug: String,
    version_id: Option<String>,
    mc_version: Option<String>,
    minecraft_version: Option<String>,
    loader: Option<String>,
    addon_type: Option<String>,
    old_file_name: Option<String>,
    old_files_to_remove: Option<Vec<String>>,
) -> Result<InstalledAddonResult, String> {
    let client = reqwest::Client::builder()
        .user_agent("NavithLabsLauncher/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let effective_mc_ver = mc_version.or(minecraft_version).unwrap_or_else(|| "1.21.1".to_string());
    let effective_loader = loader.unwrap_or_else(|| "fabric".to_string());
    let effective_type = addon_type.unwrap_or_else(|| "mod".to_string());

    let base_path = std::path::PathBuf::from(&game_directory);
    let subfolder = match effective_type.as_str() {
        "shader" | "shaderpack" => "shaderpacks",
        "resourcepack" => "resourcepacks",
        _ => "mods",
    };
    let target_dir = base_path.join(subfolder);
    if !target_dir.exists() {
        let _ = std::fs::create_dir_all(&target_dir);
    }

    let mut installed_projects = std::collections::HashSet::new();
    let mut downloaded_files = Vec::new();

    if let Some(vid) = version_id.filter(|v| !v.trim().is_empty()) {
        let url = format!("https://api.modrinth.com/v2/version/{}", vid);
        let resp = client.get(&url).send().await.map_err(|e| format!("Error buscando versión {vid}: {e}"))?;
        if resp.status().is_success() {
            let ver_json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            installed_projects.insert(project_id_or_slug.clone());
            process_modrinth_version_recursive(
                &client,
                &target_dir,
                &ver_json,
                &effective_mc_ver,
                &effective_loader,
                &effective_type,
                &mut installed_projects,
                &mut downloaded_files,
            ).await?;
        } else {
            return Err(format!("No se encontró la versión solicitada ({vid}) en Modrinth"));
        }
    } else {
        resolve_and_download_modrinth_version(
            &client,
            &target_dir,
            &project_id_or_slug,
            &effective_mc_ver,
            &effective_loader,
            &effective_type,
            &mut installed_projects,
            &mut downloaded_files,
        ).await?;
    }

    let main_file = downloaded_files.last().cloned().unwrap_or_default();

    if let Some(old_fn) = old_file_name {
        if !old_fn.trim().is_empty() && old_fn != main_file {
            let old_p = target_dir.join(&old_fn);
            if old_p.exists() {
                let _ = std::fs::remove_file(old_p);
            }
        }
    }

    if let Some(old_list) = old_files_to_remove {
        for old_fn in old_list {
            if !old_fn.trim().is_empty() && old_fn != main_file {
                let old_p = target_dir.join(&old_fn);
                if old_p.exists() {
                    let _ = std::fs::remove_file(old_p);
                }
            }
        }
    }

    let dependencies = if downloaded_files.len() > 1 {
        downloaded_files[..downloaded_files.len() - 1].to_vec()
    } else {
        Vec::new()
    };
    let total_files_installed = downloaded_files.len();

    Ok(InstalledAddonResult {
        main_file,
        dependencies,
        total_files_installed,
    })
}

async fn download_curseforge_file_bytes(
    client: &reqwest::Client,
    file_metadata: &serde_json::Value,
) -> Result<Vec<u8>, String> {
    let file_name = file_metadata["fileName"].as_str().unwrap_or("file.jar").to_string();
    let file_id_opt = file_metadata["id"].as_u64();
    let mod_id_opt = file_metadata["modId"].as_u64();

    let mut download_candidates: Vec<String> = Vec::new();

    if let Some(url) = file_metadata["downloadUrl"].as_str() {
        if !url.trim().is_empty() {
            download_candidates.push(url.to_string());
        }
    }

    if let Some(f_id) = file_id_opt {
        let p1 = f_id / 1000;
        let p2_raw = (f_id % 1000).to_string();
        let p2_pad = format!("{:03}", f_id % 1000);
        
        let encoded_name = percent_encode_cf_name(&file_name);
        let space_name = file_name.replace(' ', "%20");
        let raw_name = file_name.clone();

        for p2 in [&p2_raw, &p2_pad] {
            for n in [&encoded_name, &space_name, &raw_name] {
                download_candidates.push(format!("https://edge.forgecdn.net/files/{}/{}/{}", p1, p2, n));
                download_candidates.push(format!("https://mediafilez.forgecdn.net/files/{}/{}/{}", p1, p2, n));
            }
        }
    }

    if let (Some(m_id), Some(f_id)) = (mod_id_opt, file_id_opt) {
        download_candidates.push(format!("https://www.curseforge.com/api/v1/mods/{}/files/{}/download", m_id, f_id));
    }

    if let Some(hashes) = file_metadata["hashes"].as_array() {
        for hash_obj in hashes {
            if hash_obj["algo"].as_u64() == Some(1) { // 1 = SHA1
                if let Some(sha1_val) = hash_obj["value"].as_str() {
                    let mr_url = format!("https://api.modrinth.com/v2/version_file/{}?algorithm=sha1", sha1_val);
                    if let Ok(mr_res) = client.get(&mr_url).send().await {
                        if let Ok(mr_json) = mr_res.json::<serde_json::Value>().await {
                            if let Some(files) = mr_json["files"].as_array() {
                                if let Some(first_file) = files.first() {
                                    if let Some(url) = first_file["url"].as_str() {
                                        download_candidates.push(url.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    for download_url in download_candidates {
        for attempt in 1..=3 {
            let req = if download_url.contains("api.curseforge.com") {
                client.get(&download_url).header("x-api-key", CURSEFORGE_API_KEY)
            } else {
                client.get(&download_url)
            };

            if let Ok(Ok(resp)) = tokio::time::timeout(std::time::Duration::from_secs(35), req.send()).await {
                if resp.status().is_success() {
                    if let Ok(bytes) = resp.bytes().await {
                        if !bytes.is_empty() {
                            return Ok(bytes.to_vec());
                        }
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(150 * attempt)).await;
        }
    }

    Err(format!("No se pudo descargar el archivo {}", file_name))
}

async fn process_curseforge_addon_recursive(
    client: &reqwest::Client,
    target_dir: &std::path::Path,
    file_metadata: &serde_json::Value,
    mc_version: &str,
    loader: &str,
    addon_type: &str,
    installed_addons: &mut std::collections::HashSet<u64>,
    downloaded_files: &mut Vec<String>,
) -> Result<(), String> {
    if let Some(deps) = file_metadata.get("dependencies").and_then(|d| d.as_array()) {
        for dep in deps {
            let relation_type = dep.get("relationType").and_then(|r| r.as_u64()).unwrap_or(0);
            if relation_type == 3 {
                if let Some(dep_mod_id) = dep.get("modId").and_then(|m| m.as_u64()) {
                    if !installed_addons.contains(&dep_mod_id) {
                        let _ = Box::pin(resolve_and_download_curseforge_addon(
                            client,
                            target_dir,
                            dep_mod_id,
                            None,
                            mc_version,
                            loader,
                            "mod",
                            installed_addons,
                            downloaded_files,
                        )).await;
                    }
                }
            }
        }
    }

    let file_name = file_metadata.get("fileName").and_then(|n| n.as_str()).unwrap_or("addon.jar").to_string();
    let dest_path = target_dir.join(&file_name);

    if !dest_path.exists() || dest_path.metadata().map(|m| m.len() == 0).unwrap_or(true) {
        let bytes = download_curseforge_file_bytes(client, file_metadata).await?;
        std::fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
        std::fs::write(&dest_path, &bytes).map_err(|e| format!("Error guardando {file_name}: {e}"))?;
    }

    if !downloaded_files.contains(&file_name) {
        downloaded_files.push(file_name);
    }

    Ok(())
}

async fn resolve_and_download_curseforge_addon(
    client: &reqwest::Client,
    target_dir: &std::path::Path,
    addon_id: u64,
    file_id: Option<u64>,
    mc_version: &str,
    loader: &str,
    addon_type: &str,
    installed_addons: &mut std::collections::HashSet<u64>,
    downloaded_files: &mut Vec<String>,
) -> Result<(), String> {
    if installed_addons.contains(&addon_id) {
        return Ok(());
    }
    installed_addons.insert(addon_id);

    if let Some(fid) = file_id {
        let url = format!("https://api.curseforge.com/v1/mods/{}/files/{}", addon_id, fid);
        let resp = client.get(&url)
            .header("x-api-key", CURSEFORGE_API_KEY)
            .header("Accept", "application/json")
            .send().await.map_err(|e| format!("Error buscando archivo {fid} de CurseForge: {e}"))?;

        if resp.status().is_success() {
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            if let Some(data) = json.get("data") {
                return Box::pin(process_curseforge_addon_recursive(
                    client,
                    target_dir,
                    data,
                    mc_version,
                    loader,
                    addon_type,
                    installed_addons,
                    downloaded_files,
                )).await;
            }
        }
    }

    let mod_loader_type = match loader.to_lowercase().as_str() {
        l if l.contains("neoforge") => 6,
        l if l.contains("forge") => 1,
        l if l.contains("fabric") => 4,
        l if l.contains("quilt") => 5,
        _ => 0,
    };

    let url = format!("https://api.curseforge.com/v1/mods/{}/files", addon_id);
    let mut req = client.get(&url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .query(&[("pageSize", "50")]);

    if !mc_version.is_empty() && addon_type != "shader" {
        req = req.query(&[("gameVersion", mc_version)]);
    }
    if mod_loader_type > 0 && addon_type == "mod" {
        req = req.query(&[("modLoaderType", &mod_loader_type.to_string())]);
    }

    let resp = req.send().await.map_err(|e| format!("Error conectando con CurseForge ({addon_id}): {e}"))?;
    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
            if let Some(first_file) = data.first() {
                return Box::pin(process_curseforge_addon_recursive(
                    client,
                    target_dir,
                    first_file,
                    mc_version,
                    loader,
                    addon_type,
                    installed_addons,
                    downloaded_files,
                )).await;
            }
        }
    }

    let fb_url = format!("https://api.curseforge.com/v1/mods/{}/files?pageSize=50", addon_id);
    let fb_resp = client.get(&fb_url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .send().await.map_err(|e| format!("Error conectando con CurseForge fallback ({addon_id}): {e}"))?;
    if fb_resp.status().is_success() {
        let json: serde_json::Value = fb_resp.json().await.map_err(|e| e.to_string())?;
        if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
            if let Some(first_file) = data.first() {
                return Box::pin(process_curseforge_addon_recursive(
                    client,
                    target_dir,
                    first_file,
                    mc_version,
                    loader,
                    addon_type,
                    installed_addons,
                    downloaded_files,
                )).await;
            }
        }
    }

    Err(format!("No se encontró ninguna versión compatible en CurseForge del mod {addon_id} para {loader} {mc_version}"))
}

#[tauri::command]
pub async fn install_curseforge_addon(
    game_directory: String,
    addon_id: u64,
    file_id: Option<u64>,
    mc_version: Option<String>,
    loader: Option<String>,
    addon_type: Option<String>,
    old_file_name: Option<String>,
) -> Result<InstalledAddonResult, String> {
    let client = reqwest::Client::builder()
        .user_agent("NavithLabsLauncher/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let effective_mc_ver = mc_version.unwrap_or_else(|| "1.21.1".to_string());
    let effective_loader = loader.unwrap_or_else(|| "fabric".to_string());
    let effective_type = addon_type.unwrap_or_else(|| "mod".to_string());

    let base_path = std::path::PathBuf::from(&game_directory);
    let subfolder = match effective_type.as_str() {
        "shader" | "shaderpack" => "shaderpacks",
        "resourcepack" => "resourcepacks",
        "datapack" => "datapacks",
        _ => "mods",
    };
    let target_dir = base_path.join(subfolder);
    if !target_dir.exists() {
        let _ = std::fs::create_dir_all(&target_dir);
    }

    let mut installed_addons = std::collections::HashSet::new();
    let mut downloaded_files = Vec::new();

    resolve_and_download_curseforge_addon(
        &client,
        &target_dir,
        addon_id,
        file_id,
        &effective_mc_ver,
        &effective_loader,
        &effective_type,
        &mut installed_addons,
        &mut downloaded_files,
    ).await?;

    let main_file = downloaded_files.last().cloned().unwrap_or_default();

    if let Some(old_fn) = old_file_name {
        if !old_fn.trim().is_empty() && old_fn != main_file {
            let old_p = target_dir.join(&old_fn);
            if old_p.exists() {
                let _ = std::fs::remove_file(old_p);
            }
        }
    }

    let dependencies = if downloaded_files.len() > 1 {
        downloaded_files[..downloaded_files.len() - 1].to_vec()
    } else {
        Vec::new()
    };
    let total_files_installed = downloaded_files.len();

    Ok(InstalledAddonResult {
        main_file,
        dependencies,
        total_files_installed,
    })
}

#[tauri::command]
async fn download_and_extract_event_zip(
    app: tauri::AppHandle,
    url: String,
    instance_id: String,
    subfolder: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let dest_path = get_launcher_base_dir()
        .join("modpacks")
        .join(&instance_id);

    fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;

    let mut final_url = url.clone();
    if url.contains("mediafire.com") && !url.contains("download") {
        let html_resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
        let html_text = html_resp.text().await.map_err(|e| e.to_string())?;
        let re = regex::Regex::new(r#"href="(https?://download[^"]+)""#).unwrap();
        if let Some(caps) = re.captures(&html_text) {
            final_url = caps.get(1).unwrap().as_str().to_string();
        } else {
            return Err("No se pudo extraer el enlace directo de MediaFire. Es posible que el enlace requiera contraseña o sea inválido.".to_string());
        }
    }

    let mut resp = client.get(&final_url).send().await.map_err(|e| e.to_string())?;
    
    if !resp.status().is_success() {
        return Err(format!("Error HTTP al descargar: {}", resp.status()));
    }
    
    let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
        
    if content_type.contains("text/html") {
        return Err("El enlace es inválido o ha expirado. Si usas MediaFire, coloca el enlace normal de la página y NO el directo.".to_string());
    }

    let url_without_query = final_url.split('?').next().unwrap_or(&final_url).to_lowercase();
    let is_rar_url = url_without_query.ends_with(".rar");
    let ext = if is_rar_url { "rar" } else { "zip" };

    let url_hash = format!("{:x}", md5::compute(final_url.as_bytes()));
    let temp_filename = format!("download_{}_{}.part", instance_id, &url_hash[0..8]);
    let temp_path = dest_path.join(&temp_filename);

    let mut existing_len = 0u64;
    if temp_path.exists() {
        if let Ok(metadata) = fs::metadata(&temp_path) {
            existing_len = metadata.len();
        }
    }

    let mut req = client.get(&final_url);
    if existing_len > 0 {
        req = req.header("Range", format!("bytes={}-", existing_len));
    }

    let mut resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();

    let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
        
    if content_type.contains("text/html") {
        let _ = fs::remove_file(&temp_path);
        return Err("El enlace es inválido o ha expirado. Si usas MediaFire, coloca el enlace normal de la página y NO el directo.".to_string());
    }

    let is_partial = status == reqwest::StatusCode::PARTIAL_CONTENT;
    let (mut temp_file, mut downloaded, total_size) = if is_partial && existing_len > 0 {
        let remaining_len = resp.content_length().unwrap_or(0);
        let total = remaining_len + existing_len;
        let file = fs::OpenOptions::new().create(true).append(true).open(&temp_path).map_err(|e| e.to_string())?;
        (file, existing_len, total)
    } else {
        if !status.is_success() {
            return Err(format!("Error HTTP al descargar: {}", status));
        }
        let total = resp.content_length().unwrap_or(0);
        let file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
        (file, 0u64, total)
    };

    let mut last_emit = std::time::Instant::now();
    let mut stream_error = false;

    while let Ok(Some(chunk)) = resp.chunk().await {
        use std::io::Write;
        if let Err(e) = temp_file.write_all(&chunk) {
            stream_error = true;
            return Err(format!("Error al escribir archivo en disco: {}", e));
        }

        downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= 200 {
            if total_size > 0 {
                let pct = (downloaded as f64 / total_size as f64) * 100.0;
                let mb_down = downloaded as f64 / 1_048_576.0;
                let mb_total = total_size as f64 / 1_048_576.0;
                let _ = app.emit("download-progress", ProgressPayload {
                    message: format!("Descargando: {:.1} MB / {:.1} MB ({:.0}%)", mb_down, mb_total, pct.min(99.0)),
                    percentage: pct.min(99.0) as f32,
                });
            }
            last_emit = std::time::Instant::now();
        }
    }

    use std::io::Write;
    let _ = temp_file.flush();
    drop(temp_file);

    if stream_error || (total_size > 0 && downloaded < total_size) {
        return Err("La descarga se interrumpió o no se completó. El progreso se ha guardado para reanudarse automáticamente.".to_string());
    }

    let _ = app.emit("download-progress", ProgressPayload {
        message: "Verificando y descomprimiendo archivos en la carpeta de la instancia...".to_string(),
        percentage: 100.0,
    });

    let mut magic_header = [0u8; 4];
    if let Ok(mut f) = fs::File::open(&temp_path) {
        use std::io::Read;
        let _ = f.read_exact(&mut magic_header);
    }

    let is_rar = is_rar_url || &magic_header[0..4] == b"Rar!";

    if is_rar {
        let rar_file = temp_path.to_string_lossy().to_string();
        let mut archive = unrar::Archive::new(&rar_file)
            .open_for_processing()
            .map_err(|e| format!("Error abriendo paquete RAR: {}", e))?;
            
        while let Some(header) = archive.read_header().map_err(|e| format!("Error leyendo cabecera RAR: {}", e))? {
            if header.entry().is_directory() {
                archive = header.skip().map_err(|e| format!("Error saltando directorio RAR: {}", e))?;
            } else {
                let entry_filename = header.entry().filename.clone();
                let entry_str = entry_filename.to_string_lossy().replace('\\', "/");
                
                let final_rel_path = if let Some(sub) = &subfolder {
                    if !entry_str.starts_with(sub) {
                        PathBuf::from(sub).join(&entry_filename)
                    } else {
                        entry_filename.clone()
                    }
                } else {
                    entry_filename.clone()
                };

                let out_path = dest_path.join(&final_rel_path);
                if let Some(parent) = out_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }

                let out_path_str = out_path.to_string_lossy().to_string();
                archive = header.extract_to(&out_path_str).map_err(|e| format!("Error extrayendo archivo RAR {:?}: {}", out_path, e))?;
            }
        }
    } else {
        let file = fs::File::open(&temp_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            format!("Error: El archivo descargado estaba incompleto o corrupto ({}). Se reiniciará limpiamente.", e)
        })?;

        for i in 0..zip.len() {
            let mut file = match zip.by_index(i) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let enclosed_name = match file.enclosed_name() {
                Some(path) => path.to_owned(),
                None => continue,
            };

            let enclosed_str = enclosed_name.to_string_lossy().replace('\\', "/");
            let final_rel_path = if let Some(sub) = &subfolder {
                if !enclosed_str.starts_with(sub) {
                    PathBuf::from(sub).join(&enclosed_name)
                } else {
                    enclosed_name
                }
            } else {
                enclosed_name
            };

            let out_path = dest_path.join(final_rel_path);

            if file.name().ends_with('/') {
                let _ = fs::create_dir_all(&out_path);
            } else {
                if let Some(p) = out_path.parent() {
                    let _ = fs::create_dir_all(p);
                }
                if let Ok(mut outfile) = fs::File::create(&out_path) {
                    let _ = std::io::copy(&mut file, &mut outfile);
                }
            }
        }
    }

    let _ = fs::remove_file(&temp_path);
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn check_path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
async fn fetch_json_with_token(url: String, token: Option<String>) -> Result<serde_json::Value, String> {
    let mut req = HTTP_CLIENT.get(&url);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {}", t));
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

fn remove_readonly_recursive(p: &std::path::Path) {
    if p.is_dir() {
        if let Ok(entries) = fs::read_dir(p) {
            for entry in entries.flatten() {
                remove_readonly_recursive(&entry.path());
            }
        }
    }
    if let Ok(metadata) = fs::metadata(p) {
        let mut perms = metadata.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = fs::set_permissions(p, perms);
        }
    }
}

#[tauri::command]
fn delete_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        #[cfg(target_os = "windows")]
        remove_readonly_recursive(p);

        if p.is_dir() {
            let _ = fs::remove_dir_all(p);
        } else {
            let _ = fs::remove_file(p);
        }
    }
    Ok(())
}

fn make_event_tree_writable(path: &std::path::Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("No se pudo leer un archivo de la instancia: {}", e))?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| format!("No se pudo recorrer la instancia: {}", e))? {
            let entry = entry.map_err(|e| format!("No se pudo leer la instancia: {}", e))?;
            make_event_tree_writable(&entry.path())?;
        }
    }
    let mut permissions = metadata.permissions();
    if permissions.readonly() {
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions).map_err(|e| format!("No se pudieron ajustar los permisos de la instancia: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_event_instance(base_directory: String, instance_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let valid_id = instance_id.strip_prefix("event_")
            .map(|suffix| !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-'))
            .unwrap_or(false);
        if !valid_id {
            return Err("El identificador de evento no es válido.".to_string());
        }

        let requested_base = std::path::PathBuf::from(&base_directory);
        if !requested_base.exists() {
            return Ok(());
        }
        let base = requested_base.canonicalize().map_err(|e| format!("No se pudo resolver la carpeta del launcher: {}", e))?;
        let requested_modpacks = base.join("modpacks");
        if !requested_modpacks.exists() {
            return Ok(());
        }
        let modpacks = requested_modpacks.canonicalize().map_err(|e| format!("No se pudo resolver la carpeta de instancias: {}", e))?;
        if modpacks.parent() != Some(base.as_path()) {
            return Err("La carpeta de instancias está fuera de la ubicación configurada.".to_string());
        }

        let instance = modpacks.join(&instance_id);
        if instance.parent() != Some(modpacks.as_path()) {
            return Err("La ruta de la instancia no es válida.".to_string());
        }
        let metadata = match fs::symlink_metadata(&instance) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("No se pudo consultar la instancia: {}", error)),
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("La ruta del evento no es una carpeta de instancia segura.".to_string());
        }

        make_event_tree_writable(&instance)?;
        fs::remove_dir_all(&instance).map_err(|e| format!("No se pudieron borrar los archivos del evento: {}", e))
    }).await.map_err(|e| format!("No se pudo completar la limpieza del evento: {}", e))?
}

fn decode_percent_encoded(s: &str) -> String {
    let mut result = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16) {
                result.push(val);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&result).to_string()
}

fn safe_mod_basename(raw: &str) -> Option<String> {
    let decoded = decode_percent_encoded(&raw.replace('\\', "/"));
    let basename = decoded.rsplit('/').next()?.trim();
    if basename.is_empty() { return None; }
    let is_jar = std::path::Path::new(basename)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("jar"))
        .unwrap_or(false);
    is_jar.then(|| basename.to_string())
}

#[tauri::command]
async fn sync_individual_mods(
    game_directory: String,
    mut extra_mods: Vec<ExtraModItem>,
    removed_mods: Option<Vec<String>>,
) -> Result<String, String> {
    let base_path = PathBuf::from(&game_directory);
    let mods_dir = base_path.join("mods");
    fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;

    let manifest_path = base_path.join(".navithlabs_extra_mods.json");

    let removed_names: std::collections::HashSet<String> = removed_mods.unwrap_or_default().into_iter()
        .filter_map(|raw| safe_mod_basename(&raw).map(|filename| filename.to_lowercase()))
        .collect();

    fn remove_named_mods(directory: &std::path::Path, names: &std::collections::HashSet<String>) -> Result<(), String> {
        let entries = fs::read_dir(directory).map_err(|e| format!("No se pudo leer la carpeta de mods: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let path = entry.path();
            if kind.is_dir() {
                remove_named_mods(&path, names)?;
                continue;
            }
            if !kind.is_file() { continue; }
            let filename = entry.file_name().to_string_lossy().to_lowercase();
            if names.contains(&filename) {
                fs::remove_file(&path).map_err(|e| format!("No se pudo retirar el mod {}: {}", filename, e))?;
                println!("Removed server package mod: {:?}", path);
            }
        }
        Ok(())
    }

    if !removed_names.is_empty() {
        remove_named_mods(&mods_dir, &removed_names)?;
    }

    for m in &mut extra_mods {
        let mut raw_fn = m.filename.clone().unwrap_or_default();
        if raw_fn.trim().is_empty() {
            raw_fn = m.url.split('/').last().unwrap_or("mod.jar").split('?').next().unwrap_or("mod.jar").to_string();
        }
        let fn_decoded = decode_percent_encoded(&raw_fn.replace('\\', "/"));
        let safe_filename = fn_decoded.rsplit('/').next().unwrap_or("mod.jar").trim();
        let final_fn = if safe_filename.to_lowercase().ends_with(".jar") {
            safe_filename.to_string()
        } else {
            format!("{}.jar", safe_filename)
        };
        m.filename = Some(final_fn);
    }

    let mut old_mods: Vec<ExtraModItem> = Vec::new();
    if manifest_path.exists() {
        if let Ok(content) = fs::read_to_string(&manifest_path) {
            if let Ok(parsed) = serde_json::from_str::<ExtraModsManifest>(&content) {
                old_mods = parsed.mods;
            }
        }
    }

    for new_mod in &extra_mods {
        let new_filename = new_mod.filename.as_deref().unwrap_or_default();
        let previous = old_mods.iter().find(|old_mod| {
            let same_id = old_mod.id.as_ref().zip(new_mod.id.as_ref()).map(|(a, b)| a == b).unwrap_or(false);
            let same_filename = old_mod.filename.as_deref().map(|name| name.eq_ignore_ascii_case(new_filename)).unwrap_or(false);
            same_id || same_filename
        });
        if let Some(old_mod) = previous {
            let old_filename = old_mod.filename.as_deref().and_then(safe_mod_basename).unwrap_or_default();
            let target_changed = old_mod.url != new_mod.url || !old_filename.eq_ignore_ascii_case(new_filename);
            if target_changed && !old_filename.is_empty() {
                let old_file = mods_dir.join(&old_filename);
                if old_file.is_file() {
                    fs::remove_file(&old_file).map_err(|e| format!("No se pudo retirar el mod anterior {}: {}", old_filename, e))?;
                }
            }
            if old_mod.url != new_mod.url && !new_filename.is_empty() {
            let old_file = mods_dir.join(new_filename);
            if old_file.is_file() {
                fs::remove_file(&old_file).map_err(|e| format!("No se pudo sustituir {}: {}", new_filename, e))?;
            }
        }
        }
    }

    for old_mod in &old_mods {
        let old_fn_raw = old_mod.filename.as_deref().and_then(safe_mod_basename).unwrap_or_default();
        let old_fn_decoded = old_fn_raw.clone();

        let mut old_url_fn = String::new();
        if !old_mod.url.is_empty() {
            if let Some(last_segment) = old_mod.url.split('/').last() {
                let clean_seg = last_segment.split('?').next().unwrap_or(last_segment);
                old_url_fn = safe_mod_basename(clean_seg).unwrap_or_default();
            }
        }

        let is_still_present = extra_mods.iter().any(|m| {
            if let (Some(ref old_id), Some(ref new_id)) = (&old_mod.id, &m.id) {
                if old_id == new_id { return true; }
            }
            if let Some(ref new_fn) = &m.filename {
                if !old_fn_decoded.is_empty() && old_fn_decoded.eq_ignore_ascii_case(new_fn) {
                    return true;
                }
                if !old_fn_raw.is_empty() && old_fn_raw.eq_ignore_ascii_case(new_fn) {
                    return true;
                }
                if !old_url_fn.is_empty() && old_url_fn.eq_ignore_ascii_case(new_fn) {
                    return true;
                }
            }
            old_mod.url == m.url
        });

        if !is_still_present {
            if !old_fn_raw.is_empty() {
                let f1 = mods_dir.join(&old_fn_raw);
                if f1.exists() {
                    let _ = fs::remove_file(&f1);
                    println!("Deleted removed extra mod (raw): {:?}", f1);
                }
            }
            if !old_fn_decoded.is_empty() {
                let f2 = mods_dir.join(&old_fn_decoded);
                if f2.exists() {
                    let _ = fs::remove_file(&f2);
                    println!("Deleted removed extra mod (decoded): {:?}", f2);
                }
            }
            if !old_url_fn.is_empty() {
                let f3 = mods_dir.join(&old_url_fn);
                if f3.exists() {
                    let _ = fs::remove_file(&f3);
                    println!("Deleted removed extra mod (from URL): {:?}", f3);
                }
            }
        }
    }

    if let Ok(entries) = fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.contains("%2B") || name.contains("%2b") || name.contains("%20") {
                let decoded_name = decode_percent_encoded(&name);
                let encoded_path = entry.path();
                let _decoded_path = mods_dir.join(&decoded_name);

                let _ = fs::remove_file(&encoded_path);
                println!("Cleaned up url-encoded leftover file: {}", name);
            }
        }
    }

    let client = HTTP_CLIENT.clone();

    for mod_item in &extra_mods {
        let fn_name = mod_item.filename.clone().unwrap_or_else(|| "mod.jar".to_string());
        let target_file = mods_dir.join(&fn_name);

        if !target_file.exists() {
            let mut download_url = mod_item.url.clone();
            if download_url.contains("mediafire.com") && !download_url.contains("download") {
                if let Ok(html_resp) = client.get(&download_url).send().await {
                    if let Ok(html_text) = html_resp.text().await {
                        let re = regex::Regex::new(r#"href="(https?://download[^"]+)""#).unwrap();
                        if let Some(caps) = re.captures(&html_text) {
                            download_url = caps.get(1).unwrap().as_str().to_string();
                        }
                    }
                }
            }

            if let Ok(resp) = client.get(&download_url).send().await {
                if resp.status().is_success() {
                    if let Ok(bytes) = resp.bytes().await {
                        let _ = fs::write(&target_file, bytes);
                        println!("Downloaded individual mod: {}", fn_name);
                    }
                }
            }
        }
    }

    let new_manifest = ExtraModsManifest { mods: extra_mods };
    if let Ok(json_str) = serde_json::to_string_pretty(&new_manifest) {
        let _ = fs::write(&manifest_path, json_str);
    }

    Ok("Sincronización de mods individuales completada".to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModInfo {
    pub id: Option<String>,
    pub name: String,
    pub version: Option<String>,
    pub enabled: bool,
    pub filename: String,
    pub path: String,
    pub description: Option<String>,
    pub icon_base64: Option<String>,
    pub size_bytes: u64,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAddonInventory {
    pub mods: Vec<String>,
    pub shaders: Vec<String>,
    pub resource_packs: Vec<String>,
}

#[tauri::command]
pub async fn list_instance_addon_inventory(game_directory: String) -> Result<InstalledAddonInventory, String> {
    tokio::task::spawn_blocking(move || {
        let list_addon_files = |folder: &str, kind: &str| -> Vec<String> {
            let directory = PathBuf::from(&game_directory).join(folder);
            let Ok(entries) = fs::read_dir(directory) else { return Vec::new() };

            entries.flatten().filter_map(|entry| {
                let path = entry.path();
                let filename = path.file_name()?.to_string_lossy().to_string();
                let lower = filename.to_lowercase();
                let is_supported = match kind {
                    "mods" => lower.ends_with(".jar") || lower.ends_with(".jar.disabled") || lower.ends_with(".disabled"),
                    "archives" => lower.trim_end_matches(".disabled").ends_with(".zip") || path.is_dir(),
                    _ => false,
                };
                is_supported.then_some(filename)
            }).collect()
        };

        InstalledAddonInventory {
            mods: list_addon_files("mods", "mods"),
            shaders: list_addon_files("shaderpacks", "archives"),
            resource_packs: list_addon_files("resourcepacks", "archives"),
        }
    }).await.map_err(|error| format!("No se pudo escanear el inventario de addons: {error}"))
}

#[tauri::command]
pub async fn list_instance_mods(game_directory: String) -> Result<Vec<ModInfo>, String> {
    tokio::task::spawn_blocking(move || {
        use rayon::prelude::*;

        let mods_dir = PathBuf::from(&game_directory).join("mods");
        let mut entries: Vec<PathBuf> = if mods_dir.exists() {
            fs::read_dir(&mods_dir).ok().map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default()
        } else {
            Vec::new()
        };

        let has_jar = entries.iter().any(|p| {
            let fn_str = p.file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
            fn_str.ends_with(".jar") || fn_str.ends_with(".jar.disabled") || fn_str.ends_with(".disabled")
        });

        if !has_jar {
            if let Ok(report) = analyze_instance_environment_sync(&game_directory) {
                if report.requires_adaptation && !report.detected_mods.is_empty() {
                    let _ = import_and_standardize_instance_mods_sync(&game_directory);
                    if let Ok(new_rd) = fs::read_dir(&mods_dir) {
                        entries = new_rd.flatten().map(|e| e.path()).collect();
                    }
                }
            }
        }

        let mut mods: Vec<ModInfo> = entries
            .into_par_iter()
            .filter_map(|path| {
                let filename = path.file_name()?.to_string_lossy().to_string();
                let is_jar = filename.to_lowercase().ends_with(".jar");
                let is_disabled = filename.to_lowercase().ends_with(".jar.disabled") || filename.to_lowercase().ends_with(".disabled");

                if !is_jar && !is_disabled {
                    return None;
                }

                let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                if size_bytes < 50 {
                    return None;
                }

                let mut mod_id = None;
                let mut name = filename.clone();
                let mut version = None;
                let mut description = None;
                let mut icon_base64 = None;

                if let Ok(file) = fs::File::open(&path) {
                    if let Ok(mut archive) = zip::ZipArchive::new(file) {
                        let mut fabric_json: Option<serde_json::Value> = None;
                        let mut mcmod_json: Option<serde_json::Value> = None;
                        let mut mods_toml_content: Option<String> = None;
                        let mut icon_path_str: Option<String> = None;

                        if let Ok(mut fabric_file) = archive.by_name("fabric.mod.json") {
                            let mut content = String::new();
                            if fabric_file.read_to_string(&mut content).is_ok() {
                                fabric_json = serde_json::from_str(&content).ok();
                            }
                        }
                        if fabric_json.is_none() && mcmod_json.is_none() && mods_toml_content.is_none() {
                            if let Ok(mut mcmod_file) = archive.by_name("mcmod.info") {
                                let mut content = String::new();
                                if mcmod_file.read_to_string(&mut content).is_ok() {
                                    mcmod_json = serde_json::from_str(&content).ok();
                                }
                            }
                        }
                        if fabric_json.is_none() && mcmod_json.is_none() && mods_toml_content.is_none() {
                            if let Ok(mut mods_toml_file) = archive.by_name("META-INF/mods.toml") {
                                let mut content = String::new();
                                if mods_toml_file.read_to_string(&mut content).is_ok() {
                                    mods_toml_content = Some(content);
                                }
                            }
                        }
                        if fabric_json.is_none() && mcmod_json.is_none() && mods_toml_content.is_none() {
                            if let Ok(mut neoforge_file) = archive.by_name("META-INF/neoforge.mods.toml") {
                                let mut content = String::new();
                                if neoforge_file.read_to_string(&mut content).is_ok() {
                                    mods_toml_content = Some(content);
                                }
                            }
                        }

                        if let Some(v) = fabric_json {
                            if let Some(id_val) = v.get("id").and_then(|x| x.as_str()) {
                                mod_id = Some(id_val.to_string());
                            }
                            if let Some(name_val) = v.get("name").and_then(|x| x.as_str()) {
                                name = name_val.to_string();
                            }
                            if let Some(ver_val) = v.get("version").and_then(|x| x.as_str()) {
                                version = Some(ver_val.to_string());
                            }
                            if let Some(desc_val) = v.get("description").and_then(|x| x.as_str()) {
                                description = Some(desc_val.to_string());
                            }
                            if let Some(icon_p) = v.get("icon").and_then(|x| x.as_str()) {
                                icon_path_str = Some(icon_p.to_string());
                            }
                        } else if let Some(v) = mcmod_json {
                            let target_obj = if let Some(arr) = v.as_array() {
                                arr.first()
                            } else if let Some(modlist) = v.get("modList").and_then(|x| x.as_array()) {
                                modlist.first()
                            } else {
                                None
                            };
                            if let Some(obj) = target_obj {
                                if let Some(id_val) = obj.get("modid").and_then(|x| x.as_str()) {
                                    mod_id = Some(id_val.to_string());
                                }
                                if let Some(name_val) = obj.get("name").and_then(|x| x.as_str()) {
                                    name = name_val.to_string();
                                }
                                if let Some(ver_val) = obj.get("version").and_then(|x| x.as_str()) {
                                    version = Some(ver_val.to_string());
                                }
                                if let Some(desc_val) = obj.get("description").and_then(|x| x.as_str()) {
                                    description = Some(desc_val.to_string());
                                }
                            }
                        } else if let Some(content) = mods_toml_content {
                            for line in content.lines() {
                                let line_trim = line.trim();
                                if line_trim.starts_with("modId") || line_trim.starts_with("modid") {
                                    if let Some(val) = line_trim.split('=').nth(1) {
                                        let clean_val = val.trim().trim_matches('"').trim_matches('\'');
                                        mod_id = Some(clean_val.to_string());
                                    }
                                } else if line_trim.starts_with("displayName") {
                                    if let Some(val) = line_trim.split('=').nth(1) {
                                        let clean_val = val.trim().trim_matches('"').trim_matches('\'');
                                        name = clean_val.to_string();
                                    }
                                } else if line_trim.starts_with("version") && version.is_none() {
                                    if let Some(val) = line_trim.split('=').nth(1) {
                                        let clean_val = val.trim().trim_matches('"').trim_matches('\'');
                                        if clean_val != "${file.jarVersion}" {
                                            version = Some(clean_val.to_string());
                                        }
                                    }
                                } else if (line_trim.starts_with("logoFile") || line_trim.starts_with("logo_file") || line_trim.starts_with("icon")) && icon_path_str.is_none() {
                                    if let Some(val) = line_trim.split('=').nth(1) {
                                        let clean_val = val.trim().trim_matches('"').trim_matches('\'');
                                        if !clean_val.is_empty() {
                                            icon_path_str = Some(clean_val.to_string());
                                        }
                                    }
                                }
                            }
                        }

                        let mut candidate_paths = Vec::new();
                        if let Some(ref p) = icon_path_str {
                            let clean_p = p.trim_start_matches('/').trim_start_matches('\\').to_string();
                            candidate_paths.push(clean_p.clone());
                            if let Some(ref mid) = mod_id {
                                candidate_paths.push(format!("assets/{}/{}", mid, clean_p));
                                candidate_paths.push(format!("assets/{}/textures/gui/{}", mid, clean_p));
                                candidate_paths.push(format!("assets/{}/textures/{}", mid, clean_p));
                            }
                        }
                        if let Some(ref mid) = mod_id {
                            candidate_paths.push(format!("assets/{}/icon.png", mid));
                            candidate_paths.push(format!("assets/{}/logo.png", mid));
                            candidate_paths.push(format!("assets/{}/{}.png", mid, mid));
                        }
                        candidate_paths.push("icon.png".to_string());
                        candidate_paths.push("logo.png".to_string());
                        candidate_paths.push("pack.png".to_string());

                        for cpath in candidate_paths {
                            if let Ok(mut icon_file) = archive.by_name(&cpath) {
                                let mut icon_bytes = Vec::new();
                                if icon_file.read_to_end(&mut icon_bytes).is_ok() && !icon_bytes.is_empty() {
                                    let mime = if cpath.ends_with(".jpg") || cpath.ends_with(".jpeg") {
                                        "image/jpeg"
                                    } else if cpath.ends_with(".webp") {
                                        "image/webp"
                                    } else {
                                        "image/png"
                                    };
                                    icon_base64 = Some(format!("data:{};base64,{}", mime, base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &icon_bytes)));
                                    break;
                                }
                            }
                        }
                    }
                }

                Some(ModInfo {
                    id: mod_id,
                    name,
                    version,
                    enabled: is_jar,
                    filename,
                    path: path.to_string_lossy().to_string(),
                    description,
                    icon_base64,
                    size_bytes,
                })
            })
            .collect();

        mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(mods)
    }).await.map_err(|e| format!("Error en hilo de lectura de mods: {}", e))?
}

#[tauri::command]
pub fn toggle_instance_mod(
    mod_path: Option<String>,
    game_directory: Option<String>,
    file_name: Option<String>,
    enable: bool,
) -> Result<bool, String> {
    let target_path_buf = if let Some(mp) = mod_path.filter(|p| !p.trim().is_empty()) {
        PathBuf::from(mp)
    } else if let (Some(gd), Some(fn_str)) = (game_directory, file_name) {
        let p = PathBuf::from(&gd).join("mods").join(&fn_str);
        if !p.exists() {
            if fn_str.ends_with(".disabled") {
                let base = &fn_str[..fn_str.len() - 9];
                PathBuf::from(&gd).join("mods").join(base)
            } else {
                PathBuf::from(&gd).join("mods").join(format!("{}.disabled", fn_str))
            }
        } else {
            p
        }
    } else {
        return Err("Ruta de mod no especificada".to_string());
    };

    let path = target_path_buf;
    if !path.exists() {
        return Err("El archivo del mod no existe".to_string());
    }

    let parent = path.parent().ok_or("Ruta inválida")?;
    let filename = path.file_name().ok_or("Nombre de archivo inválido")?.to_string_lossy().to_string();

    let new_filename = if enable {
        if filename.to_lowercase().ends_with(".disabled") {
            let base = &filename[..filename.len() - 9];
            if base.to_lowercase().ends_with(".jar") {
                base.to_string()
            } else {
                format!("{}.jar", base)
            }
        } else {
            filename.clone()
        }
    } else {
        if !filename.to_lowercase().ends_with(".disabled") {
            format!("{}.disabled", filename)
        } else {
            filename.clone()
        }
    };

    let new_path = parent.join(&new_filename);
    if path != new_path {
        fs::rename(&path, &new_path).map_err(|e| format!("Error al renombrar el mod: {}", e))?;
    }

    Ok(enable)
}

#[tauri::command]
pub fn delete_instance_mod(mod_path: String) -> Result<(), String> {
    let path = PathBuf::from(&mod_path);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn add_instance_mod_file(game_directory: String, source_file_path: String) -> Result<String, String> {
    let mods_dir = PathBuf::from(&game_directory).join("mods");
    fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;

    let src_path = PathBuf::from(&source_file_path);
    if !src_path.exists() {
        return Err("El archivo de origen no existe".to_string());
    }

    let filename = src_path.file_name().ok_or("Nombre de archivo inválido")?;
    let dest_path = mods_dir.join(filename);

    fs::copy(&src_path, &dest_path).map_err(|e| format!("Error al copiar mod: {}", e))?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn install_mrpack_file(app: tauri::AppHandle, mrpack_path: String, instance_name: String) -> Result<serde_json::Value, String> {
    let client = HTTP_CLIENT.clone();

    let mrpack_bytes = if mrpack_path.starts_with("http://") || mrpack_path.starts_with("https://") {
        let resp = client.get(&mrpack_path).send().await.map_err(|e| format!("Error al descargar .mrpack: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Respuesta de descarga de .mrpack no válida: HTTP {}", resp.status()));
        }
        resp.bytes().await.map_err(|e| format!("Error al leer los datos de .mrpack: {}", e))?.to_vec()
    } else {
        let path = PathBuf::from(&mrpack_path);
        if !path.exists() {
            return Err("El archivo .mrpack no existe".to_string());
        }
        fs::read(path).map_err(|e| format!("Error al leer el archivo .mrpack local: {}", e))?
    };

    let cursor = std::io::Cursor::new(mrpack_bytes.clone());
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Error al abrir el paquete .mrpack: {}", e))?;

    let index_str = {
        let mut index_file = archive.by_name("modrinth.index.json").map_err(|_| "El archivo no contiene un modrinth.index.json válido".to_string())?;
        let mut s = String::new();
        index_file.read_to_string(&mut s).map_err(|e| e.to_string())?;
        s
    };

    let index_json: serde_json::Value = serde_json::from_str(&index_str).map_err(|e| e.to_string())?;

    let mc_version = index_json.get("dependencies").and_then(|d| d.get("minecraft")).and_then(|v| v.as_str()).unwrap_or("1.20.1").to_string();
    let fabric_ver = index_json.get("dependencies").and_then(|d| d.get("fabric-loader")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let forge_ver = index_json.get("dependencies").and_then(|d| d.get("forge")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let neoforge_ver = index_json.get("dependencies").and_then(|d| d.get("neoforge")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let quilt_ver = index_json.get("dependencies").and_then(|d| d.get("quilt-loader")).and_then(|v| v.as_str()).map(|s| s.to_string());

    let inst_id = uuid::Uuid::new_v4().to_string();
    let inst_dir = get_launcher_base_dir()
        .join("instances")
        .join(&inst_id);
    fs::create_dir_all(&inst_dir).map_err(|e| e.to_string())?;

    process_modrinth_index_and_extract(&app, &client, &index_json, &mrpack_bytes, &inst_dir).await?;

    let inst_type = if fabric_ver.is_some() { "fabric" } else if forge_ver.is_some() { "forge" } else if neoforge_ver.is_some() { "neoforge" } else if quilt_ver.is_some() { "quilt" } else { "vanilla" };

    let instance_result = serde_json::json!({
        "id": inst_id,
        "name": instance_name,
        "type": inst_type,
        "version": mc_version,
        "fabricVersion": fabric_ver,
        "forgeVersion": forge_ver,
        "neoforgeVersion": neoforge_ver,
        "quiltVersion": quilt_ver,
        "gameDirectory": inst_dir.to_string_lossy().to_string(),
    });

    Ok(instance_result)
}

#[tauri::command]
pub async fn get_curseforge_project_details(project_id: Option<u64>, mod_id: Option<u64>, id: Option<u64>) -> Result<serde_json::Value, String> {
    let p_id = project_id.or(mod_id).or(id).unwrap_or(0);
    if p_id == 0 {
        return Err("ID de proyecto inválido".to_string());
    }

    let client = HTTP_CLIENT.clone();
    let desc_url = format!("https://api.curseforge.com/v1/mods/{}/description", p_id);
    let mod_url = format!("https://api.curseforge.com/v1/mods/{}", p_id);

    let desc_fut = client
        .get(&desc_url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .send();
    let files_fut = fetch_all_curseforge_files(&client, p_id);
    let mod_fut = client
        .get(&mod_url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .send();

    let (desc_res, files_res, mod_res) = tokio::join!(desc_fut, files_fut, mod_fut);

    let desc_json: serde_json::Value = desc_res
        .map_err(|e| format!("No se pudo consultar la descripción de CurseForge: {}", e))?
        .error_for_status()
        .map_err(|e| format!("CurseForge rechazó la consulta de descripción: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Respuesta de descripción de CurseForge inválida: {}", e))?;
    let body_html = desc_json["data"].as_str().unwrap_or_default().to_string();

    let files_list: Vec<serde_json::Value> = files_res?;

    let mod_json: serde_json::Value = mod_res
        .map_err(|e| format!("No se pudo consultar el proyecto de CurseForge: {}", e))?
        .error_for_status()
        .map_err(|e| format!("CurseForge rechazó la consulta del proyecto: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Respuesta de proyecto de CurseForge inválida: {}", e))?;
    let mod_data = mod_json["data"].clone();
    let screenshots = mod_data["screenshots"].as_array().cloned().unwrap_or_default();

    Ok(serde_json::json!({
        "mod": mod_data,
        "description": body_html,
        "files": files_list,
        "screenshots": screenshots,
    }))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    pub name: String,
    pub path: String,
    pub size_kb: f64,
    pub modified_ms: u64,
    pub is_latest: bool,
    pub is_crash_report: bool,
}

#[tauri::command]
pub fn get_instance_logs(game_directory: String) -> Result<Vec<LogFileInfo>, String> {
    let base_dir = PathBuf::from(&game_directory);
    let mut logs = Vec::new();

    let logs_dir = base_dir.join("logs");
    if let Ok(entries) = fs::read_dir(&logs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if name.ends_with(".log") || name.ends_with(".log.gz") || name.ends_with(".txt") {
                    let meta = entry.metadata().ok();
                    let size_kb = meta.as_ref().map(|m| m.len() as f64 / 1024.0).unwrap_or(0.0);
                    let modified_ms = meta.as_ref().and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let is_latest = name == "latest.log" || name == "debug.log";
                    logs.push(LogFileInfo {
                        name: name.clone(),
                        path: path.to_string_lossy().to_string(),
                        size_kb: (size_kb * 100.0).round() / 100.0,
                        modified_ms,
                        is_latest,
                        is_crash_report: false,
                    });
                }
            }
        }
    }

    let crash_dir = base_dir.join("crash-reports");
    if let Ok(entries) = fs::read_dir(&crash_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if name.ends_with(".txt") || name.ends_with(".log") {
                    let meta = entry.metadata().ok();
                    let size_kb = meta.as_ref().map(|m| m.len() as f64 / 1024.0).unwrap_or(0.0);
                    let modified_ms = meta.as_ref().and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    logs.push(LogFileInfo {
                        name: format!("CRASH: {}", name),
                        path: path.to_string_lossy().to_string(),
                        size_kb: (size_kb * 100.0).round() / 100.0,
                        modified_ms,
                        is_latest: false,
                        is_crash_report: true,
                    });
                }
            }
        }
    }

    logs.sort_by(|a, b| {
        if a.name == "latest.log" {
            std::cmp::Ordering::Less
        } else if b.name == "latest.log" {
            std::cmp::Ordering::Greater
        } else {
            b.modified_ms.cmp(&a.modified_ms)
        }
    });

    Ok(logs)
}

#[tauri::command]
pub fn read_instance_log_file(file_path: String) -> Result<String, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err("El archivo de log no existe".to_string());
    }

    if file_path.ends_with(".gz") {
        let file = fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut decoder = flate2::read::GzDecoder::new(file);
        let mut s = String::new();
        decoder.read_to_string(&mut s).map_err(|e| format!("Error descomprimiendo log: {}", e))?;
        Ok(s)
    } else {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() > 2 * 1024 * 1024 {
            let start = bytes.len() - 2 * 1024 * 1024;
            let slice = &bytes[start..];
            let text = String::from_utf8_lossy(slice).to_string();
            Ok(format!("[... log truncado a las últimas 2 MB ...]\n{}", text))
        } else {
            Ok(String::from_utf8_lossy(&bytes).to_string())
        }
    }
}

#[tauri::command]
pub async fn upload_log_to_mclogs(log_content: String) -> Result<String, String> {
    let client = HTTP_CLIENT.clone();
    let mut params = std::collections::HashMap::new();
    params.insert("content", log_content);

    let resp = client.post("https://api.mclo.gs/1/log")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Error conectando a mclo.gs: {}", e))?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if json["success"].as_bool() == Some(true) {
        if let Some(url) = json["url"].as_str() {
            return Ok(url.to_string());
        }
    }
    Err(json["error"].as_str().unwrap_or("Error al subir log a mclo.gs").to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePackItem {
    pub name: String,
    pub file_name: String,
    pub enabled: bool,
    pub size_mb: f64,
    pub description: Option<String>,
}

#[tauri::command]
pub fn list_instance_resourcepacks(game_directory: String) -> Result<Vec<ResourcePackItem>, String> {
    let packs_dir = PathBuf::from(&game_directory).join("resourcepacks");
    let mut items = Vec::new();

    if let Ok(entries) = fs::read_dir(&packs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let enabled = !file_name.ends_with(".disabled");
            let clean_name = file_name.replace(".disabled", "");
            if clean_name.ends_with(".zip") || path.is_dir() {
                let size_mb = entry.metadata().map(|m| m.len() as f64 / 1024.0 / 1024.0).unwrap_or(0.0);
                items.push(ResourcePackItem {
                    name: clean_name.replace(".zip", ""),
                    file_name,
                    enabled,
                    size_mb: (size_mb * 100.0).round() / 100.0,
                    description: None,
                });
            }
        }
    }
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(items)
}

#[tauri::command]
pub fn toggle_instance_resourcepack(game_directory: String, file_name: String, enable: bool) -> Result<String, String> {
    let packs_dir = PathBuf::from(&game_directory).join("resourcepacks");
    let src = packs_dir.join(&file_name);
    if !src.exists() {
        return Err("El resourcepack no existe".to_string());
    }

    let new_name = if enable {
        file_name.replace(".disabled", "")
    } else {
        if file_name.ends_with(".disabled") { file_name.clone() } else { format!("{}.disabled", file_name) }
    };
    let dst = packs_dir.join(&new_name);
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(new_name)
}

#[tauri::command]
pub fn delete_instance_resourcepack(game_directory: String, file_name: String) -> Result<(), String> {
    let packs_dir = PathBuf::from(&game_directory).join("resourcepacks");
    let p = packs_dir.join(&file_name);
    if p.exists() {
        if p.is_dir() {
            fs::remove_dir_all(p).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn add_instance_resourcepack_file(game_directory: String, source_file_path: String) -> Result<String, String> {
    let packs_dir = PathBuf::from(&game_directory).join("resourcepacks");
    fs::create_dir_all(&packs_dir).map_err(|e| e.to_string())?;
    let src = PathBuf::from(&source_file_path);
    if !src.exists() {
        return Err("El archivo seleccionado no existe".to_string());
    }
    let filename = src.file_name().ok_or("Nombre de archivo no válido")?;
    let dest = packs_dir.join(filename);
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShaderPackItem {
    pub name: String,
    pub file_name: String,
    pub enabled: bool,
    pub size_mb: f64,
}

#[tauri::command]
pub fn list_instance_shaderpacks(game_directory: String) -> Result<Vec<ShaderPackItem>, String> {
    let shaders_dir = PathBuf::from(&game_directory).join("shaderpacks");
    let mut items = Vec::new();

    if let Ok(entries) = fs::read_dir(&shaders_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let enabled = !file_name.ends_with(".disabled");
            let clean_name = file_name.replace(".disabled", "");
            if clean_name.ends_with(".zip") || path.is_dir() {
                let size_mb = entry.metadata().map(|m| m.len() as f64 / 1024.0 / 1024.0).unwrap_or(0.0);
                items.push(ShaderPackItem {
                    name: clean_name.replace(".zip", ""),
                    file_name,
                    enabled,
                    size_mb: (size_mb * 100.0).round() / 100.0,
                });
            }
        }
    }
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(items)
}

#[tauri::command]
pub fn toggle_instance_shaderpack(game_directory: String, file_name: String, enable: bool) -> Result<String, String> {
    let shaders_dir = PathBuf::from(&game_directory).join("shaderpacks");
    let src = shaders_dir.join(&file_name);
    if !src.exists() {
        return Err("El shaderpack no existe".to_string());
    }

    let new_name = if enable {
        file_name.replace(".disabled", "")
    } else {
        if file_name.ends_with(".disabled") { file_name.clone() } else { format!("{}.disabled", file_name) }
    };
    let dst = shaders_dir.join(&new_name);
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(new_name)
}

#[tauri::command]
pub fn delete_instance_shaderpack(game_directory: String, file_name: String) -> Result<(), String> {
    let shaders_dir = PathBuf::from(&game_directory).join("shaderpacks");
    let p = shaders_dir.join(&file_name);
    if p.exists() {
        if p.is_dir() {
            fs::remove_dir_all(p).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn add_instance_shaderpack_file(game_directory: String, source_file_path: String) -> Result<String, String> {
    let shaders_dir = PathBuf::from(&game_directory).join("shaderpacks");
    fs::create_dir_all(&shaders_dir).map_err(|e| e.to_string())?;
    let src = PathBuf::from(&source_file_path);
    if !src.exists() {
        return Err("El archivo seleccionado no existe".to_string());
    }
    let filename = src.file_name().ok_or("Nombre de archivo no válido")?;
    let dest = shaders_dir.join(filename);
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorldItem {
    pub folder_name: String,
    pub world_name: String,
    pub size_mb: f64,
}

#[tauri::command]
pub fn list_instance_saves(game_directory: String) -> Result<Vec<SaveWorldItem>, String> {
    let saves_dir = PathBuf::from(&game_directory).join("saves");
    let mut items = Vec::new();

    if let Ok(entries) = fs::read_dir(&saves_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let folder_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let world_name = folder_name.clone();
                items.push(SaveWorldItem {
                    folder_name,
                    world_name,
                    size_mb: 0.0,
                });
            }
        }
    }
    items.sort_by(|a, b| a.world_name.to_lowercase().cmp(&b.world_name.to_lowercase()));
    Ok(items)
}

#[tauri::command]
pub fn export_instance_package(
    game_directory: String,
    output_path: String,
    format_type: String, // "mrpack" or "zip"
    include_mods: bool,
    include_config: bool,
    include_resourcepacks: bool,
    include_shaderpacks: bool,
    include_datapacks: bool,
    include_saves: bool,
    pack_name: String,
    pack_version: String,
    mc_version: String,
    loader_type: String,
    loader_version: Option<String>,
) -> Result<String, String> {
    let inst_dir = PathBuf::from(&game_directory);
    let out_file = fs::File::create(&output_path).map_err(|e| format!("Error creando archivo de exportación: {}", e))?;
    let mut zip = zip::ZipWriter::new(out_file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    let prefix = if format_type == "mrpack" { "overrides/" } else { "" };

    let mut folders_to_export = Vec::new();
    if include_mods { folders_to_export.push("mods"); }
    if include_config { folders_to_export.push("config"); }
    if include_resourcepacks { folders_to_export.push("resourcepacks"); }
    if include_shaderpacks { folders_to_export.push("shaderpacks"); }
    if include_datapacks { folders_to_export.push("datapacks"); }
    if include_saves { folders_to_export.push("saves"); }

    for folder in &folders_to_export {
        let src_folder = inst_dir.join(folder);
        if src_folder.exists() && src_folder.is_dir() {
            add_dir_to_zip(&mut zip, &src_folder, &format!("{}{}", prefix, folder), options)?;
        }
    }

    if format_type == "mrpack" {
        let mut deps = serde_json::json!({
            "minecraft": mc_version,
        });
        if let Some(lv) = &loader_version {
            let key = match loader_type.to_lowercase().as_str() {
                "fabric" => "fabric-loader",
                "forge" => "forge",
                "neoforge" => "neoforge",
                "quilt" => "quilt-loader",
                _ => "fabric-loader",
            };
            deps[key] = serde_json::Value::String(lv.clone());
        }

        let index_json = serde_json::json!({
            "formatVersion": 1,
            "game": "minecraft",
            "versionId": pack_version,
            "name": pack_name,
            "summary": format!("Exported from NavithLabs Launcher - {}", pack_name),
            "files": [],
            "dependencies": deps,
        });

        let index_bytes = serde_json::to_vec_pretty(&index_json).map_err(|e| e.to_string())?;
        zip.start_file("modrinth.index.json", options).map_err(|e| e.to_string())?;
        zip.write_all(&index_bytes).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| format!("Error finalizando paquete ZIP: {}", e))?;
    Ok(output_path)
}

fn add_dir_to_zip<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    src_dir: &PathBuf,
    dest_prefix: &str,
    options: zip::write::FileOptions,
) -> Result<(), String> {
    if let Ok(entries) = fs::read_dir(src_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let dest_name = if dest_prefix.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", dest_prefix, name)
            };

            if path.is_dir() {
                add_dir_to_zip(zip, &path, &dest_name, options)?;
            } else if path.is_file() {
                if let Ok(bytes) = fs::read(&path) {
                    zip.start_file(&dest_name, options).map_err(|e| e.to_string())?;
                    zip.write_all(&bytes).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeSearchResult {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration: String,
    pub thumbnail: String,
}

#[tauri::command]
pub async fn search_youtube(query: String) -> Result<Vec<YouTubeSearchResult>, String> {
    let resp = HTTP_CLIENT
        .get("https://www.youtube.com/results")
        .query(&[("search_query", &query)])
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept-Language", "es-MX,es;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let pattern1 = "var ytInitialData = ";
    let pattern2 = r#"window["ytInitialData"] = "#;

    let json_str = if let Some(pos) = resp.find(pattern1) {
        let start = pos + pattern1.len();
        if let Some(end) = resp[start..].find(";</script>") {
            Some(&resp[start..start + end])
        } else {
            None
        }
    } else if let Some(pos) = resp.find(pattern2) {
        let start = pos + pattern2.len();
        if let Some(end) = resp[start..].find(";</script>") {
            Some(&resp[start..start + end])
        } else {
            None
        }
    } else {
        None
    };

    if let Some(raw_json) = json_str {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw_json) {
            if let Some(contents) = v
                .pointer("/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents/0/itemSectionRenderer/contents")
                .and_then(|c| c.as_array())
            {
                for item in contents {
                    if let Some(video) = item.get("videoRenderer") {
                        if let Some(video_id) = video.get("videoId").and_then(|id| id.as_str()) {
                            let title = video
                                .pointer("/title/runs/0/text")
                                .and_then(|t| t.as_str())
                                .unwrap_or("")
                                .to_string();
                            let channel = video
                                .pointer("/ownerText/runs/0/text")
                                .and_then(|t| t.as_str())
                                .unwrap_or("")
                                .to_string();
                            let duration = video
                                .pointer("/lengthText/simpleText")
                                .and_then(|t| t.as_str())
                                .unwrap_or("")
                                .to_string();
                            let thumbnail = video
                                .pointer("/thumbnail/thumbnails")
                                .and_then(|arr| arr.as_array())
                                .and_then(|arr| arr.last())
                                .and_then(|thumb| thumb.get("url"))
                                .and_then(|u| u.as_str())
                                .unwrap_or(&format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id))
                                .to_string();

                            if !video_id.is_empty() && !title.is_empty() {
                                results.push(YouTubeSearchResult {
                                    id: video_id.to_string(),
                                    title,
                                    channel,
                                    duration,
                                    thumbnail,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

fn collect_jar_paths_recursively(dir: &std::path::Path, jars: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_jar_paths_recursively(&path, jars);
            } else if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.to_string_lossy().eq_ignore_ascii_case("jar") {
                        jars.push(path);
                    }
                }
            }
        }
    }
}

pub fn analyze_instance_environment_sync(game_directory: &str) -> Result<InstanceEnvironmentReport, String> {
    use rayon::prelude::*;
    let inst_dir = PathBuf::from(game_directory);
    let mods_dir = inst_dir.join("mods");
    
    let mut standard_mods_count = 0;
    if mods_dir.exists() {
        if let Ok(entries) = fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.ends_with(".jar") || name.ends_with(".jar.disabled") || name.ends_with(".disabled") {
                    standard_mods_count += 1;
                }
            }
        }
    }

    let has_eufonia_core = inst_dir.join("config").join("eufoniacore").exists() 
        || inst_dir.join("config").join("eufonia_backrooms.json").exists() 
        || inst_dir.join("rrp.debug").exists() 
        || inst_dir.join("downloads").join("log.json").exists()
        || inst_dir.join(".fabric").join("processedMods").exists();
        
    let has_multimc_cfg = inst_dir.join("instance.cfg").exists() || inst_dir.join("mmc-pack.json").exists();
    let has_curseforge = inst_dir.join("manifest.json").exists();
    let has_modrinth = inst_dir.join("modrinth.index.json").exists();

    let mut jar_candidates = Vec::new();

    if has_eufonia_core {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let eufonia_lib_path = PathBuf::from(appdata).join("eufonia").join("EufoniaClient").join("data").join("libraries").join("studio").join("eufonia");
            if eufonia_lib_path.exists() {
                collect_jar_paths_recursively(&eufonia_lib_path, &mut jar_candidates);
            }
        }
        
        let fabric_processed_path = inst_dir.join(".fabric").join("processedMods");
        if fabric_processed_path.exists() {
            collect_jar_paths_recursively(&fabric_processed_path, &mut jar_candidates);
        }
    }

    let parsed_mods: Vec<DetectedModInfo> = jar_candidates
        .into_par_iter()
        .filter_map(|path| inspect_jar_for_mod(&path))
        .collect();

    let mut seen_ids = std::collections::HashSet::new();
    let mut detected_mods = Vec::new();
    for m in parsed_mods {
        if !seen_ids.contains(&m.id) {
            seen_ids.insert(m.id.clone());
        } else {
            continue;
        }
        detected_mods.push(m);
    }

    let external_mods_count = detected_mods.len();

    let (environment_type, environment_name, details, requires_adaptation) = if has_eufonia_core && external_mods_count > 0 && standard_mods_count == 0 {
        (
            "eufonia".to_string(),
            "Eufonia Client (Librerías Centralizadas)".to_string(),
            format!("Se detectó una instancia de Eufonia Client con {} mods centralizados en librerías externas.", external_mods_count),
            true,
        )
    } else if has_multimc_cfg {
        (
            "multimc".to_string(),
            "MultiMC / Prism Launcher".to_string(),
            "Instancia con configuración de MultiMC/Prism.".to_string(),
            false,
        )
    } else if has_curseforge {
        (
            "curseforge".to_string(),
            "CurseForge Modpack".to_string(),
            "Instancia exportada con formato de CurseForge.".to_string(),
            false,
        )
    } else if has_modrinth {
        (
            "modrinth".to_string(),
            "Modrinth Modpack".to_string(),
            "Instancia con manifiesto Modrinth.".to_string(),
            false,
        )
    } else {
        (
            "standard".to_string(),
            "Estándar NavithLabs Launcher".to_string(),
            format!("Instancia estándar con {} mods en carpeta mods/.", standard_mods_count),
            false,
        )
    };

    Ok(InstanceEnvironmentReport {
        environment_type,
        environment_name,
        has_standard_mods: standard_mods_count > 0,
        standard_mods_count,
        external_mods_count,
        detected_mods,
        details,
        requires_adaptation,
    })
}

pub fn import_and_standardize_instance_mods_sync(game_directory: &str) -> Result<usize, String> {
    use rayon::prelude::*;
    let report = analyze_instance_environment_sync(game_directory)?;
    let mods_dir = PathBuf::from(game_directory).join("mods");
    fs::create_dir_all(&mods_dir).map_err(|e| format!("Error creando carpeta mods: {}", e))?;

    let imported_count: usize = report.detected_mods
        .into_par_iter()
        .map(|mod_info| {
            let src_path = PathBuf::from(&mod_info.source_path);
            if src_path.exists() {
                let dest_file = mods_dir.join(&mod_info.suggested_file_name);
                let should_copy = if dest_file.exists() {
                    dest_file.metadata().map(|m| m.len() == 0).unwrap_or(true)
                } else {
                    true
                };

                if should_copy {
                    if fs::copy(&src_path, &dest_file).is_ok() {
                        return 1;
                    }
                }
            }
            0
        })
        .sum();

    Ok(imported_count)
}

#[tauri::command]
pub async fn analyze_instance_environment(game_directory: String) -> Result<InstanceEnvironmentReport, String> {
    tokio::task::spawn_blocking(move || {
        analyze_instance_environment_sync(&game_directory)
    }).await.map_err(|e| format!("Error en análisis de entorno: {}", e))?
}

#[tauri::command]
pub async fn import_and_standardize_instance_mods(game_directory: String) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        import_and_standardize_instance_mods_sync(&game_directory)
    }).await.map_err(|e| format!("Error al importar mods: {}", e))?
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ScreenshotItem {
    pub file_name: String,
    pub file_path: String,
    pub instance_id: String,
    pub instance_name: String,
    pub created_at: u64,
    pub file_size_bytes: u64,
}

#[tauri::command]
pub async fn get_all_screenshots() -> Result<Vec<ScreenshotItem>, String> {
    tokio::task::spawn_blocking(move || {
        let mut screenshots = Vec::new();
        let default_dir = get_default_game_directory();

        let instances = get_instances();
        for inst in instances {
            let base_dir = match &inst.game_directory {
                Some(dir) if !dir.trim().is_empty() => dir.clone(),
                _ => format!("{}/instances/{}", default_dir, inst.id),
            };

            let screenshots_dir = std::path::Path::new(&base_dir).join("screenshots");
            if screenshots_dir.exists() && screenshots_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&screenshots_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                            if ext == "png" || ext == "jpg" || ext == "jpeg" {
                                let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                                let file_path = path.to_string_lossy().to_string();
                                let metadata = entry.metadata().ok();
                                let file_size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                                let created_at = metadata.as_ref()
                                    .and_then(|m| m.modified().or_else(|_| m.created()).ok())
                                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0);

                                screenshots.push(ScreenshotItem {
                                    file_name,
                                    file_path,
                                    instance_id: inst.id.clone(),
                                    instance_name: inst.name.clone(),
                                    created_at,
                                    file_size_bytes,
                                });
                            }
                        }
                    }
                }
            }
        }

        let default_screenshots_dir = std::path::Path::new(&default_dir).join("screenshots");
        if default_screenshots_dir.exists() && default_screenshots_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&default_screenshots_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                        if ext == "png" || ext == "jpg" || ext == "jpeg" {
                            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                            let file_path = path.to_string_lossy().to_string();
                            if !screenshots.iter().any(|s| s.file_path == file_path) {
                                let metadata = entry.metadata().ok();
                                let file_size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                                let created_at = metadata.as_ref()
                                    .and_then(|m| m.modified().or_else(|_| m.created()).ok())
                                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0);

                                screenshots.push(ScreenshotItem {
                                    file_name,
                                    file_path,
                                    instance_id: "default_mc".to_string(),
                                    instance_name: "Minecraft Oficial (.minecraft)".to_string(),
                                    created_at,
                                    file_size_bytes,
                                });
                            }
                        }
                    }
                }
            }
        }

        let modpacks_dir = std::path::Path::new(&default_dir).join("modpacks");
        if modpacks_dir.exists() && modpacks_dir.is_dir() {
            if let Ok(mp_entries) = std::fs::read_dir(&modpacks_dir) {
                for mp_entry in mp_entries.flatten() {
                    let mp_path = mp_entry.path();
                    if mp_path.is_dir() {
                        let mp_screenshots = mp_path.join("screenshots");
                        if mp_screenshots.exists() && mp_screenshots.is_dir() {
                            let folder_name = mp_path.file_name().and_then(|n| n.to_str()).unwrap_or("Servidor").to_string();
                            if let Ok(entries) = std::fs::read_dir(&mp_screenshots) {
                                for entry in entries.flatten() {
                                    let path = entry.path();
                                    if path.is_file() {
                                        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                                        if ext == "png" || ext == "jpg" || ext == "jpeg" {
                                            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                                            let file_path = path.to_string_lossy().to_string();
                                            if !screenshots.iter().any(|s| s.file_path == file_path) {
                                                let metadata = entry.metadata().ok();
                                                let file_size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                                                let created_at = metadata.as_ref()
                                                    .and_then(|m| m.modified().or_else(|_| m.created()).ok())
                                                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                                                    .map(|d| d.as_millis() as u64)
                                                    .unwrap_or(0);

                                                screenshots.push(ScreenshotItem {
                                                    file_name,
                                                    file_path,
                                                    instance_id: format!("mp_{}", folder_name),
                                                    instance_name: folder_name.replace("server_", "Servidor "),
                                                    created_at,
                                                    file_size_bytes,
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        screenshots.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        Ok(screenshots)
    }).await.map_err(|e| format!("Error escaneando capturas: {}", e))?
}

#[tauri::command]
pub async fn delete_screenshot(file_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let p = std::path::Path::new(&file_path);
        if p.exists() {
            std::fs::remove_file(p).map_err(|e| format!("Error eliminando captura: {}", e))?;
        }
        Ok(())
    }).await.map_err(|e| format!("Error eliminando captura: {}", e))?
}

    tauri::Builder::default()
        .manage(DiscordHandle {
            sender: tx,
            enabled: discord_presence_enabled,
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_minecraft_versions,
            get_forge_versions,
            get_fabric_versions,
            get_neoforge_versions,
            get_quilt_versions,
            launch_minecraft,
            close_splashscreen,
            get_instances,
            save_instances,
            get_default_game_directory,
            set_launcher_base_dir,
            get_system_ram,
            start_discord_auth,
            start_google_auth,
            start_microsoft_auth,
            exchange_microsoft_token,
            refresh_microsoft_token,
            open_folder,
            get_instance_icon,
            update_presence,
            clear_presence,
            get_curseforge_files,
            get_curseforge_project_details,
            precache_installation_components,
            install_modpack,
            install_curseforge_modpack,
            import_local_modpack,
            get_minecraft_profile,
            lookup_minecraft_skin,
            upload_minecraft_skin,
            set_minecraft_skin_url,
            set_minecraft_cape,
            hide_minecraft_cape,
            search_modrinth,
            search_curseforge,
            get_modrinth_project_versions,
            fetch_json_with_token,
            download_and_extract_event_zip,
            check_path_exists,
            delete_dir,
            delete_event_instance,
            kill_active_game,
            sync_individual_mods,
            server_content::sync_server_content,
            list_instance_addon_inventory,
            list_instance_mods,
            toggle_instance_mod,
            delete_instance_mod,
            add_instance_mod_file,
            install_mrpack_file,
            get_instance_logs,
            read_instance_log_file,
            upload_log_to_mclogs,
            list_instance_resourcepacks,
            toggle_instance_resourcepack,
            delete_instance_resourcepack,
            add_instance_resourcepack_file,
            list_instance_shaderpacks,
            toggle_instance_shaderpack,
            delete_instance_shaderpack,
            add_instance_shaderpack_file,
            list_instance_saves,
            export_instance_package,
            search_youtube,
            analyze_instance_environment,
            import_and_standardize_instance_mods,
            get_all_screenshots,
            delete_screenshot,
            install_modrinth_addon_with_dependencies,
            install_curseforge_addon
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
