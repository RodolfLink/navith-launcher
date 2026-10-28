import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { 
  IconBox, 
  IconPalette, 
  IconSparkles, 
  IconGlobe, 
  IconFolderOpen, 
  IconTrash, 
  IconSearch, 
  IconPlus,
  IconRefresh
} from './Icons';

interface ModItem {
  id?: string;
  name: string;
  version?: string;
  enabled: boolean;
  filename?: string;
  fileName?: string;
  path?: string;
  description?: string;
  icon_base64?: string;
  iconBase64?: string;
  size_bytes?: number;
  sizeBytes?: number;
  size_mb?: number;
  sizeMb?: number;
}

interface ResourcePackItem {
  name: string;
  fileName?: string;
  file_name?: string;
  enabled: boolean;
  sizeMb?: number;
  size_mb?: number;
  size_bytes?: number;
}

interface ShaderPackItem {
  name: string;
  fileName?: string;
  file_name?: string;
  enabled: boolean;
  sizeMb?: number;
  size_mb?: number;
  size_bytes?: number;
}

interface SaveWorldItem {
  folderName?: string;
  folder_name?: string;
  worldName?: string;
  world_name?: string;
  sizeMb?: number;
  size_mb?: number;
}

interface ResourceManagerModalProps {
  isOpen: boolean;
  theme?: string;
  onClose: () => void;
  gameDirectory: string;
  instanceName: string;
  instanceVersion?: string;
  instanceLoader?: string;
  onOpenFolder: (folderName?: string) => void;
  onOpenAddonsExplorer?: () => void;
}

function formatFileSize(item: any): string {
  const mb = item.sizeMb ?? item.size_mb;
  if (mb !== undefined && mb > 0) {
    return `${mb.toFixed(2)} MB`;
  }
  const bytes = item.size_bytes ?? item.sizeBytes;
  if (bytes !== undefined && bytes > 0) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return '';
}

function getModIconSrc(icon?: string): string | null {
  if (!icon || typeof icon !== 'string' || icon.trim() === '') return null;
  if (icon.startsWith('data:') || icon.startsWith('http://') || icon.startsWith('https://')) {
    return icon;
  }
  return `data:image/png;base64,${icon}`;
}

export const ResourceManagerModal: React.FC<ResourceManagerModalProps> = ({
  isOpen,
  theme = 'white',
  onClose,
  gameDirectory,
  instanceName,
  instanceVersion = '1.21.1',
  instanceLoader = 'Fabric',
  onOpenFolder,
  onOpenAddonsExplorer,
}) => {
  const [activeTab, setActiveTab] = useState<'mods' | 'resourcepacks' | 'shaderpacks' | 'saves'>('mods');
  const [mods, setMods] = useState<ModItem[]>([]);
  const [resourcePacks, setResourcePacks] = useState<ResourcePackItem[]>([]);
  const [shaderPacks, setShaderPacks] = useState<ShaderPackItem[]>([]);
  const [saves, setSaves] = useState<SaveWorldItem[]>([]);

  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isStandardizing, setIsStandardizing] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ title: string; desc: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (title: string, desc: string, type: 'success' | 'error' = 'success') => {
    setNotification({ title, desc, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const loadAllCategories = useCallback(async () => {
    if (!gameDirectory) return;
    setLoading(true);
    try {
      const [mRes, rpRes, spRes, svRes] = await Promise.all([
        invoke<ModItem[]>('list_instance_mods', { gameDirectory }).catch(() => []),
        invoke<ResourcePackItem[]>('list_instance_resourcepacks', { gameDirectory }).catch(() => []),
        invoke<ShaderPackItem[]>('list_instance_shaderpacks', { gameDirectory }).catch(() => []),
        invoke<SaveWorldItem[]>('list_instance_saves', { gameDirectory }).catch(() => []),
      ]);

      if (Array.isArray(mRes)) setMods(mRes);
      if (Array.isArray(rpRes)) setResourcePacks(rpRes);
      if (Array.isArray(spRes)) setShaderPacks(spRes);
      if (Array.isArray(svRes)) setSaves(svRes);
    } catch (e: any) {
      console.error('Error cargando recursos:', e);
    } finally {
      setLoading(false);
    }
  }, [gameDirectory]);

  const handleStandardizeMods = async () => {
    if (!gameDirectory) return;
    setIsStandardizing(true);
    try {
      const importedCount = await invoke<number>('import_and_standardize_instance_mods', { gameDirectory });
      showNotification('Mods Sincronizados', `Se sincronizaron e importaron ${importedCount} mods correctamente.`, 'success');
      await loadAllCategories();
    } catch (err: any) {
      showNotification('Error al Importar', String(err), 'error');
    } finally {
      setIsStandardizing(false);
    }
  };

  useEffect(() => {
    if (isOpen && gameDirectory) {
      loadAllCategories();
    }
  }, [isOpen, gameDirectory, loadAllCategories]);

  const reloadActive = async () => {
    if (!gameDirectory) return;
    try {
      if (activeTab === 'mods') {
        const res = await invoke<ModItem[]>('list_instance_mods', { gameDirectory });
        setMods(res);
      } else if (activeTab === 'resourcepacks') {
        const res = await invoke<ResourcePackItem[]>('list_instance_resourcepacks', { gameDirectory });
        setResourcePacks(res);
      } else if (activeTab === 'shaderpacks') {
        const res = await invoke<ShaderPackItem[]>('list_instance_shaderpacks', { gameDirectory });
        setShaderPacks(res);
      } else if (activeTab === 'saves') {
        const res = await invoke<SaveWorldItem[]>('list_instance_saves', { gameDirectory });
        setSaves(res);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleMod = async (mod: ModItem) => {
    const fn = mod.filename || mod.fileName || mod.name;
    const oldEnabled = mod.enabled;
    const newEnabled = !oldEnabled;

    setMods(prev => prev.map(m => (m.filename === fn || m.fileName === fn || m.name === fn) ? { ...m, enabled: newEnabled } : m));

    try {
      const modPath = mod.path || (gameDirectory ? `${gameDirectory}/mods/${fn}` : undefined);
      await invoke('toggle_instance_mod', {
        modPath,
        gameDirectory,
        fileName: fn,
        enable: newEnabled,
      });
      reloadActive();
    } catch (e: any) {
      setMods(prev => prev.map(m => (m.filename === fn || m.fileName === fn || m.name === fn) ? { ...m, enabled: oldEnabled } : m));
      showNotification('Error de Mod', `No se pudo cambiar el estado: ${e}`, 'error');
    }
  };

  const handleDeleteMod = async (mod: ModItem) => {
    const fn = mod.filename || mod.fileName || mod.name;
    if (!confirm(`¿Eliminar "${mod.name}"?`)) return;
    try {
      const modPath = mod.path || (gameDirectory ? `${gameDirectory}/mods/${fn}` : undefined);
      await invoke('delete_instance_mod', {
        modPath,
        gameDirectory,
        fileName: fn,
      });
      setMods(prev => prev.filter(m => (m.filename !== fn && m.fileName !== fn && m.name !== fn)));
      showNotification('Mod Eliminado', `Se eliminó "${mod.name}" de la instancia.`, 'success');
    } catch (e: any) {
      showNotification('Error', `No se pudo eliminar el mod: ${e}`, 'error');
    }
  };

  const handleToggleResourcePack = async (rp: ResourcePackItem) => {
    const fn = rp.fileName || rp.file_name || rp.name;
    const oldEnabled = rp.enabled;
    const newEnabled = !oldEnabled;

    setResourcePacks(prev => prev.map(r => (r.fileName === fn || r.file_name === fn || r.name === fn) ? { ...r, enabled: newEnabled } : r));

    try {
      await invoke('toggle_instance_resourcepack', {
        gameDirectory,
        fileName: fn,
        enable: newEnabled,
      });
      reloadActive();
    } catch (e: any) {
      setResourcePacks(prev => prev.map(r => (r.fileName === fn || r.file_name === fn || r.name === fn) ? { ...r, enabled: oldEnabled } : r));
      alert(`Error: ${e}`);
    }
  };

  const handleDeleteResourcePack = async (rp: ResourcePackItem) => {
    const fn = rp.fileName || rp.file_name || rp.name;
    if (!confirm(`¿Eliminar resourcepack "${rp.name}"?`)) return;
    try {
      await invoke('delete_instance_resourcepack', {
        gameDirectory,
        fileName: fn,
      });
      setResourcePacks(prev => prev.filter(r => (r.fileName !== fn && r.file_name !== fn && r.name !== fn)));
    } catch (e: any) {
      alert(`Error: ${e}`);
    }
  };

  const handleToggleShaderPack = async (sp: ShaderPackItem) => {
    const fn = sp.fileName || sp.file_name || sp.name;
    if (!fn || !gameDirectory) return;

    const newEnabled = !sp.enabled;
    setShaderPacks((prev) =>
      prev.map((s) => {
        const sFn = s.fileName || s.file_name || s.name;
        if (sFn === fn) return { ...s, enabled: newEnabled };
        return s;
      })
    );

    try {
      await invoke('toggle_instance_shaderpack', {
        gameDirectory,
        fileName: fn,
        enable: newEnabled,
      });
      reloadActive();
    } catch (e: any) {
      setShaderPacks((prev) =>
        prev.map((s) => {
          const sFn = s.fileName || s.file_name || s.name;
          if (sFn === fn) return { ...s, enabled: !newEnabled };
          return s;
        })
      );
      alert(`Error: ${e}`);
    }
  };

  const handleDeleteShaderPack = async (sp: ShaderPackItem) => {
    const fn = sp.fileName || sp.file_name || sp.name;
    if (!confirm(`¿Eliminar shaderpack "${sp.name}"?`)) return;
    try {
      await invoke('delete_instance_shaderpack', {
        gameDirectory,
        fileName: fn,
      });
      setShaderPacks((prev) => prev.filter((s) => (s.fileName !== fn && s.file_name !== fn && s.name !== fn)));
    } catch (e: any) {
      alert(`Error: ${e}`);
    }
  };

  const handleAddFile = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: activeTab === 'mods'
          ? [{ name: 'Mods', extensions: ['jar', 'zip'] }]
          : [{ name: 'Paquetes', extensions: ['zip', 'rar', 'tar.gz'] }],
      });

      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];

      for (const f of files) {
        if (activeTab === 'mods') {
          await invoke('add_instance_mod_file', { gameDirectory, filePath: f });
        } else if (activeTab === 'resourcepacks') {
          await invoke('add_instance_resourcepack_file', { gameDirectory, filePath: f });
        } else if (activeTab === 'shaderpacks') {
          await invoke('add_instance_shaderpack_file', { gameDirectory, filePath: f });
        }
      }
      reloadActive();
    } catch (e: any) {
      alert(`Error al añadir archivo: ${e}`);
    }
  };

  if (!isOpen) return null;

  return typeof document !== 'undefined' ? createPortal(
    <div
      className="theme-dialog-overlay resource-manager-overlay"
      data-theme={theme}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
        backdropFilter: 'blur(18px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      {notification && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '32px',
          background: '#000000',
          border: `1px solid ${notification.type === 'success' ? '#ffffff' : '#ff4444'}`,
          boxShadow: `0 0 25px ${notification.type === 'success' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 68, 68, 0.3)'}`,
          padding: '14px 20px',
          borderRadius: '10px',
          zIndex: 99999,
          maxWidth: '420px',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '0.8rem', fontWeight: 900, color: '#ffffff', marginBottom: '4px' }}>
            {notification.title}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.75)', lineHeight: '1.4' }}>
            {notification.desc}
          </div>
        </div>
      )}

      <div
        className="theme-dialog-card resource-manager-card"
        style={{
          width: '920px',
          maxWidth: '95vw',
          height: '660px',
          maxHeight: '92vh',
          backgroundColor: '#0a0a0f',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 40px rgba(255,255,255,0.06)',
          overflow: 'hidden',
          padding: '24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '11px',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <IconBox size={22} color="#ffffff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#fff', letterSpacing: '0.5px' }}>
                  {instanceName}
                </h2>
                <span style={{
                  fontSize: '0.66rem',
                  fontFamily: "'Orbitron', sans-serif",
                  fontWeight: 800,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  color: '#ffffff'
                }}>
                  {instanceLoader} {instanceVersion}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#8e8e9f', marginTop: '3px' }}>
                Administra mods, resource packs, shaders y descarga complementos con dependencias automáticas
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => {
                const sub = activeTab === 'mods' ? 'mods' : activeTab === 'resourcepacks' ? 'resourcepacks' : activeTab === 'shaderpacks' ? 'shaderpacks' : 'saves';
                onOpenFolder(sub);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#e0e0f0',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <IconFolderOpen size={16} />
              <span>Abrir Carpeta</span>
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: '1.3rem',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { id: 'mods', label: `Mods (${mods.length})`, icon: <IconBox size={14} /> },
              { id: 'shaderpacks', label: `Shaders (${shaderPacks.length})`, icon: <IconSparkles size={14} /> },
              { id: 'resourcepacks', label: `Resource Packs (${resourcePacks.length})`, icon: <IconPalette size={14} /> },
              { id: 'saves', label: `Mundos (${saves.length})`, icon: <IconGlobe size={14} /> },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className={`resource-manager-tab ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    setSearchQuery('');
                  }}
                  style={{
                    background: isActive ? '#ffffff' : 'rgba(255,255,255,0.04)',
                    color: isActive ? '#050508' : '#8e8e9f',
                    border: '1px solid ' + (isActive ? '#ffffff' : 'rgba(255,255,255,0.08)'),
                    padding: '8px 16px',
                    borderRadius: '9px',
                    fontWeight: isActive ? 800 : 600,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    transition: 'all 0.18s ease',
                  }}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {onOpenAddonsExplorer && (
            <button
              onClick={onOpenAddonsExplorer}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                padding: '8px 16px',
                borderRadius: '8px',
                fontWeight: 800,
                fontSize: '0.72rem',
                fontFamily: "'Orbitron', sans-serif",
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.18s ease',
              }}
              title="Abrir el catálogo completo de addons"
            >
              <span>↗ EXPLORAR ADDONS</span>
            </button>
          )}
        </div>

        <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '10px' }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: '350px' }}>
                <input
                  type="text"
                  placeholder={`Buscar en ${activeTab === 'mods' ? 'mods' : activeTab === 'resourcepacks' ? 'resource packs' : activeTab === 'shaderpacks' ? 'shaders' : 'mundos'}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    padding: '8px 12px 8px 34px',
                    color: '#fff',
                    fontSize: '0.82rem',
                    outline: 'none',
                  }}
                />
                <div style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
                  <IconSearch size={16} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                {activeTab === 'mods' && (
                  <button
                    onClick={handleStandardizeMods}
                    disabled={isStandardizing}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#ffffff',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: isStandardizing ? 'not-allowed' : 'pointer',
                    }}
                    title="Mover mods dispersos a la carpeta mods/"
                  >
                    <IconRefresh size={14} className={isStandardizing ? 'spin-anim' : ''} />
                    <span>{isStandardizing ? 'Importando...' : 'Sincronizar'}</span>
                  </button>
                )}

                {activeTab !== 'saves' && (
                  <>
                    {onOpenAddonsExplorer && (
                      <button
                        onClick={onOpenAddonsExplorer}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.25)',
                          color: '#ffffff',
                          padding: '8px 14px',
                          borderRadius: '8px',
                          fontSize: '0.78rem',
                          fontFamily: "'Orbitron', sans-serif",
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        <IconPlus size={14} />
                        <span>Explorar Addons</span>
                      </button>
                    )}

                    <button
                      className="dialog-accent-button"
                      onClick={handleAddFile}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: '#ffffff',
                        border: 'none',
                        color: '#050508',
                        padding: '8px 14px',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      <IconPlus size={14} />
                      <span>Añadir Archivo Local</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }} className="custom-scrollbar">
              {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#888' }}>
                  Cargando recursos...
                </div>
              ) : activeTab === 'mods' ? (
                mods.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '220px', color: '#777' }}>
                    <IconBox size={36} />
                    <p style={{ marginTop: '12px', fontSize: '0.85rem' }}>No hay mods instalados en esta instancia.</p>
                    {onOpenAddonsExplorer && (
                      <button
                        onClick={onOpenAddonsExplorer}
                        style={{ marginTop: '8px', background: '#ffffff', color: '#000000', border: 'none', padding: '6px 14px', borderRadius: '6px', fontFamily: "'Orbitron', sans-serif", fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}
                      >
                        + Explorar Catálogo de Mods
                      </button>
                    )}
                  </div>
                ) : (
                  mods
                    .filter((m) => {
                      const name = (m.name || m.filename || m.fileName || '').toLowerCase();
                      const desc = (m.description || '').toLowerCase();
                      const q = searchQuery.toLowerCase();
                      return name.includes(q) || desc.includes(q);
                    })
                    .map((m) => {
                      const fn = m.filename || m.fileName || m.name;
                      const sizeStr = formatFileSize(m);
                      return (
                        <div
                          key={fn}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 16px',
                            borderRadius: '10px',
                            background: m.enabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                            border: '1px solid ' + (m.enabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'),
                            opacity: m.enabled ? 1 : 0.6,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                            {(() => {
                              const iconSrc = getModIconSrc(m.icon_base64 || m.iconBase64);
                              return (
                                <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                  {iconSrc ? (
                                    <img
                                      src={iconSrc}
                                      alt={m.name}
                                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                      }}
                                    />
                                  ) : (
                                    <IconBox size={16} color="#888" />
                                  )}
                                </div>
                              );
                            })()}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.88rem' }}>{m.name}</span>
                                {m.version && (
                                  <span style={{ fontSize: '0.72rem', color: '#888', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: '4px' }}>
                                    v{m.version}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#777788', marginTop: '2px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <span style={{ fontFamily: 'monospace' }}>{fn}</span>
                                {sizeStr && <span>• {sizeStr}</span>}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div
                              onClick={() => handleToggleMod(m)}
                              style={{
                                width: '40px',
                                height: '22px',
                                borderRadius: '12px',
                                background: m.enabled ? '#ffffff' : 'rgba(255, 255, 255, 0.12)',
                                border: `1px solid ${m.enabled ? '#ffffff' : 'rgba(255, 255, 255, 0.2)'}`,
                                boxShadow: m.enabled ? '0 0 12px rgba(255, 255, 255, 0.45)' : 'none',
                                position: 'relative',
                                cursor: 'pointer',
                                transition: 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                padding: '2px',
                                boxSizing: 'border-box'
                              }}
                              title={m.enabled ? 'Mod Activo (Clic para desactivar)' : 'Mod Inactivo (Clic para activar)'}
                            >
                              <div
                                style={{
                                  width: '16px',
                                  height: '16px',
                                  borderRadius: '50%',
                                  background: m.enabled ? '#000000' : 'rgba(255, 255, 255, 0.6)',
                                  boxShadow: m.enabled ? '0 1px 4px rgba(0, 0, 0, 0.4)' : 'none',
                                  transform: m.enabled ? 'translateX(18px)' : 'translateX(0px)',
                                  transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), background 0.22s ease',
                                }}
                              />
                            </div>

                            <button
                              onClick={() => handleDeleteMod(m)}
                              style={{
                                background: 'rgba(255, 255, 255, 0.04)',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                color: 'rgba(255, 255, 255, 0.6)',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 77, 77, 0.15)';
                                e.currentTarget.style.borderColor = '#ff4d4d';
                                e.currentTarget.style.color = '#ff4d4d';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                              }}
                              title="Eliminar"
                            >
                              <IconTrash size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                )
              ) : activeTab === 'resourcepacks' ? (
                resourcePacks
                  .filter((rp) => {
                    const name = (rp.name || rp.fileName || rp.file_name || '').toLowerCase();
                    const q = searchQuery.toLowerCase();
                    return name.includes(q);
                  })
                  .map((rp) => {
                    const fn = rp.fileName || rp.file_name || rp.name;
                    const sizeStr = formatFileSize(rp);
                    return (
                      <div
                        key={fn}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 16px',
                          borderRadius: '10px',
                          background: rp.enabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                          border: '1px solid ' + (rp.enabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'),
                          opacity: rp.enabled ? 1 : 0.6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <IconPalette size={16} color="#888" />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.88rem' }}>{rp.name}</div>
                            <div style={{ fontSize: '0.74rem', color: '#777788', marginTop: '2px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <span style={{ fontFamily: 'monospace' }}>{fn}</span>
                              {sizeStr && <span>• {sizeStr}</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div
                            onClick={() => handleToggleResourcePack(rp)}
                            style={{
                              width: '40px',
                              height: '22px',
                              borderRadius: '12px',
                              background: rp.enabled ? '#ffffff' : 'rgba(255, 255, 255, 0.12)',
                              border: `1px solid ${rp.enabled ? '#ffffff' : 'rgba(255, 255, 255, 0.2)'}`,
                              boxShadow: rp.enabled ? '0 0 12px rgba(255, 255, 255, 0.45)' : 'none',
                              position: 'relative',
                              cursor: 'pointer',
                              transition: 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              padding: '2px',
                              boxSizing: 'border-box'
                            }}
                            title={rp.enabled ? 'Resource Pack Activo (Clic para desactivar)' : 'Resource Pack Inactivo (Clic para activar)'}
                          >
                            <div
                              style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                background: rp.enabled ? '#000000' : 'rgba(255, 255, 255, 0.6)',
                                boxShadow: rp.enabled ? '0 1px 4px rgba(0, 0, 0, 0.4)' : 'none',
                                transform: rp.enabled ? 'translateX(18px)' : 'translateX(0px)',
                                transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), background 0.22s ease',
                              }}
                            />
                          </div>
                          <button
                            onClick={() => handleDeleteResourcePack(rp)}
                            style={{
                              background: 'rgba(255, 255, 255, 0.04)',
                              border: '1px solid rgba(255, 255, 255, 0.12)',
                              color: 'rgba(255, 255, 255, 0.6)',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 77, 77, 0.15)';
                              e.currentTarget.style.borderColor = '#ff4d4d';
                              e.currentTarget.style.color = '#ff4d4d';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                            }}
                            title="Eliminar"
                          >
                            <IconTrash size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
              ) : activeTab === 'shaderpacks' ? (
                shaderPacks
                  .filter((sp) => {
                    const name = (sp.name || sp.fileName || sp.file_name || '').toLowerCase();
                    const q = searchQuery.toLowerCase();
                    return name.includes(q);
                  })
                  .map((sp) => {
                    const fn = sp.fileName || sp.file_name || sp.name;
                    const sizeStr = formatFileSize(sp);
                    return (
                      <div
                        key={fn}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 16px',
                          borderRadius: '10px',
                          background: sp.enabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                          border: '1px solid ' + (sp.enabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'),
                          opacity: sp.enabled ? 1 : 0.6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <IconSparkles size={16} color="#888" />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.88rem' }}>{sp.name}</div>
                            <div style={{ fontSize: '0.74rem', color: '#777788', marginTop: '2px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <span style={{ fontFamily: 'monospace' }}>{fn}</span>
                              {sizeStr && <span>• {sizeStr}</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div
                            onClick={() => handleToggleShaderPack(sp)}
                            style={{
                              width: '40px',
                              height: '22px',
                              borderRadius: '12px',
                              background: sp.enabled ? '#ffffff' : 'rgba(255, 255, 255, 0.12)',
                              border: `1px solid ${sp.enabled ? '#ffffff' : 'rgba(255, 255, 255, 0.2)'}`,
                              boxShadow: sp.enabled ? '0 0 12px rgba(255, 255, 255, 0.45)' : 'none',
                              position: 'relative',
                              cursor: 'pointer',
                              transition: 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              padding: '2px',
                              boxSizing: 'border-box'
                            }}
                            title={sp.enabled ? 'Shader Pack Activo (Clic para desactivar)' : 'Shader Pack Inactivo (Clic para activar)'}
                          >
                            <div
                              style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                background: sp.enabled ? '#000000' : 'rgba(255, 255, 255, 0.6)',
                                boxShadow: sp.enabled ? '0 1px 4px rgba(0, 0, 0, 0.4)' : 'none',
                                transform: sp.enabled ? 'translateX(18px)' : 'translateX(0px)',
                                transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), background 0.22s ease',
                              }}
                            />
                          </div>
                          <button
                            onClick={() => handleDeleteShaderPack(sp)}
                            style={{
                              background: 'rgba(255, 255, 255, 0.04)',
                              border: '1px solid rgba(255, 255, 255, 0.12)',
                              color: 'rgba(255, 255, 255, 0.6)',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 77, 77, 0.15)';
                              e.currentTarget.style.borderColor = '#ff4d4d';
                              e.currentTarget.style.color = '#ff4d4d';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                            }}
                            title="Eliminar"
                          >
                            <IconTrash size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
              ) : (
                saves
                  .filter((sv) => {
                    const name = (sv.worldName || sv.world_name || sv.folderName || sv.folder_name || '').toLowerCase();
                    const q = searchQuery.toLowerCase();
                    return name.includes(q);
                  })
                  .map((sv) => {
                    const wn = sv.worldName || sv.world_name || sv.folderName || sv.folder_name || 'Mundo';
                    const fn = sv.folderName || sv.folder_name || wn;
                    const sizeStr = formatFileSize(sv);
                    return (
                      <div
                        key={fn}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 16px',
                          borderRadius: '10px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <IconGlobe size={16} color="#888" />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.88rem' }}>{wn}</div>
                            <div style={{ fontSize: '0.74rem', color: '#777788', marginTop: '2px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <span style={{ fontFamily: 'monospace' }}>{fn}</span>
                              {sizeStr && <span>• {sizeStr}</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            onClick={() => onOpenFolder(`saves/${fn}`)}
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.12)',
                              color: '#fff',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <IconFolderOpen size={12} />
                            <span>Abrir</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </>
      </div>
    </div>,
    document.body
  ) : null;
};

export default ResourceManagerModal;
