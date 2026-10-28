import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export interface ScreenshotItem {
  file_name: string;
  file_path: string;
  instance_id: string;
  instance_name: string;
  created_at: number;
  file_size_bytes: number;
}

interface ScreenshotsGalleryProps {
  onOpenFolder?: (path: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(timestamp: number): string {
  if (!timestamp) return 'Fecha desconocida';
  const d = new Date(timestamp);
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function ScreenshotsGallery({ onOpenFolder }: ScreenshotsGalleryProps) {
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInstance, setSelectedInstance] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeLightboxIndex, setActiveLightboxIndex] = useState<number | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const loadScreenshots = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<ScreenshotItem[]>('get_all_screenshots');
      setScreenshots(list || []);
    } catch (err) {
      console.error('Error cargando capturas:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScreenshots();
  }, [loadScreenshots]);

  const instancesList = useMemo(() => {
    const map = new Map<string, string>();
    screenshots.forEach(s => {
      if (!map.has(s.instance_id)) {
        map.set(s.instance_id, s.instance_name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [screenshots]);

  const filteredScreenshots = useMemo(() => {
    return screenshots.filter(s => {
      const matchesInst = selectedInstance === 'all' || s.instance_id === selectedInstance;
      const matchesSearch = !searchQuery || 
        s.file_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        s.instance_name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesInst && matchesSearch;
    });
  }, [screenshots, selectedInstance, searchQuery]);

  const totalSizeBytes = useMemo(() => {
    return filteredScreenshots.reduce((acc, s) => acc + (s.file_size_bytes || 0), 0);
  }, [filteredScreenshots]);

  const handleDeleteScreenshot = async (s: ScreenshotItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm(`¿Eliminar la captura "${s.file_name}"?`)) return;

    try {
      await invoke('delete_screenshot', { filePath: s.file_path });
      setScreenshots(prev => prev.filter(item => item.file_path !== s.file_path));
      if (activeLightboxIndex !== null) {
        setActiveLightboxIndex(null);
      }
      showToast('Captura eliminada correctamente');
    } catch (err) {
      console.error('Error eliminando captura:', err);
      showToast('Error al eliminar la captura');
    }
  };

  const handleCopyImage = async (s: ScreenshotItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const srcUrl = convertFileSrc(s.file_path);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = srcUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context no disponible');
      ctx.drawImage(img, 0, 0);

      canvas.toBlob(async (blob) => {
        if (!blob) {
          navigator.clipboard.writeText(s.file_path);
          setCopiedPath(s.file_path);
          showToast('Ruta copiada al portapapeles');
          setTimeout(() => setCopiedPath(null), 2500);
          return;
        }
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          setCopiedPath(s.file_path);
          showToast('¡Imagen copiada al portapapeles! Puedes pegarla con Ctrl+V');
          setTimeout(() => setCopiedPath(null), 2500);
        } catch {
          await navigator.clipboard.writeText(s.file_path);
          setCopiedPath(s.file_path);
          showToast('Ruta de captura copiada al portapapeles');
          setTimeout(() => setCopiedPath(null), 2500);
        }
      }, 'image/png');
    } catch (err) {
      console.warn('Fallback copiando ruta:', err);
      navigator.clipboard.writeText(s.file_path);
      setCopiedPath(s.file_path);
      showToast('Ruta copiada al portapapeles');
      setTimeout(() => setCopiedPath(null), 2500);
    }
  };

  const handleOpenFolder = (s: ScreenshotItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const folderPath = s.file_path.substring(0, Math.max(s.file_path.lastIndexOf('\\'), s.file_path.lastIndexOf('/')));
    if (onOpenFolder) {
      onOpenFolder(folderPath || s.file_path);
    } else {
      invoke('open_folder', { path: folderPath || s.file_path }).catch(console.error);
    }
  };

  useEffect(() => {
    if (activeLightboxIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveLightboxIndex(null);
      } else if (e.key === 'ArrowLeft') {
        setActiveLightboxIndex(prev => (prev !== null && prev > 0 ? prev - 1 : filteredScreenshots.length - 1));
      } else if (e.key === 'ArrowRight') {
        setActiveLightboxIndex(prev => (prev !== null && prev < filteredScreenshots.length - 1 ? prev + 1 : 0));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeLightboxIndex, filteredScreenshots.length]);

  const currentLightboxItem = activeLightboxIndex !== null ? filteredScreenshots[activeLightboxIndex] : null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      padding: '24px 36px 30px 36px',
      boxSizing: 'border-box',
      overflowY: 'auto',
      color: '#ffffff',
      fontFamily: "'Inter', sans-serif"
    }} className="screenshots-gallery-view custom-scrollbar">

      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '28px',
          right: '32px',
          background: '#000000',
          border: '1px solid #ffffff',
          boxShadow: '0 0 25px rgba(255, 255, 255, 0.4)',
          padding: '12px 20px',
          borderRadius: '8px',
          fontFamily: "'Orbitron', sans-serif",
          fontSize: '0.78rem',
          fontWeight: 900,
          letterSpacing: '0.5px',
          color: '#ffffff',
          zIndex: 99999,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          {toastMessage}
        </div>
      )}

      <div className="view-header-unified screenshots-header">
        <div className="view-header-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 className="view-header-title">Galería de Capturas</h1>
            {screenshots.length > 0 && (
              <span className="dynamic-count-badge">
                {screenshots.length} {screenshots.length === 1 ? 'CAPTURA' : 'CAPTURAS'}
              </span>
            )}
          </div>
          <p className="view-header-subtitle">Explora, copia y administra las fotos tomadas en todas tus instancias de Minecraft.</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={loadScreenshots}
            title="Recargar capturas"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 14px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              borderRadius: '8px',
              color: '#ffffff',
              fontFamily: "'Orbitron', sans-serif",
              fontSize: '0.72rem',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <span>ACTUALIZAR</span>
          </button>
        </div>
      </div>

      <div className="screenshots-toolbar" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(10, 10, 16, 0.7)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        padding: '12px 18px',
        borderRadius: '12px',
        marginBottom: '24px',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '0.68rem', fontWeight: 800, color: 'rgba(255, 255, 255, 0.6)' }}>
              PERFIL:
            </span>
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              style={{
                background: '#000000',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontFamily: "'Orbitron', sans-serif",
                fontSize: '0.72rem',
                fontWeight: 700,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="all">TODAS LAS INSTANCIAS ({screenshots.length})</option>
              {instancesList.map(inst => (
                <option key={inst.id} value={inst.id}>
                  {inst.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Buscar por nombre o fecha..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: 'rgba(0, 0, 0, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                padding: '6px 12px 6px 30px',
                color: '#ffffff',
                fontSize: '0.76rem',
                outline: 'none',
                width: '210px'
              }}
            />
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255, 255, 255, 0.5)"
              strokeWidth="2.5"
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)' }}>
            <strong style={{ color: '#ffffff', fontFamily: "'Orbitron', sans-serif" }}>{filteredScreenshots.length}</strong> {filteredScreenshots.length === 1 ? 'captura' : 'capturas'}
          </div>
          <div style={{ height: '14px', width: '1px', background: 'rgba(255, 255, 255, 0.15)' }} />
          <div style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)' }}>
            Espacio: <strong style={{ color: '#ffffff', fontFamily: "'Orbitron', sans-serif" }}>{formatBytes(totalSizeBytes)}</strong>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="screenshots-loading-state" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          color: 'rgba(255, 255, 255, 0.6)'
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            border: '2px solid rgba(255, 255, 255, 0.15)',
            borderTopColor: '#ffffff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: '16px'
          }} />
          <p style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '0.8rem', fontWeight: 700 }}>ESCANEA CARPETAS DE SCREENSHOTS...</p>
        </div>
      ) : filteredScreenshots.length === 0 ? (
        <div className="screenshots-empty-state" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          background: 'rgba(10, 10, 16, 0.5)',
          border: '1px dashed rgba(255, 255, 255, 0.15)',
          borderRadius: '16px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '18px'
          }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
              <circle cx="12" cy="13" r="3"/>
            </svg>
          </div>
          <h3 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '1.05rem', color: '#ffffff', margin: '0 0 8px' }}>
            No se encontraron capturas de pantalla
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.6)', maxWidth: '440px', lineHeight: '1.5', margin: 0 }}>
            Presiona <strong style={{ color: '#ffffff' }}>F2</strong> dentro de Minecraft en cualquier momento y tus fotos se organizarán aquí automáticamente.
          </p>
        </div>
      ) : (
        <div className="screenshots-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px',
          paddingBottom: '40px'
        }}>
          {filteredScreenshots.map((item, idx) => {
            const srcUrl = convertFileSrc(item.file_path);
            const isCopied = copiedPath === item.file_path;

            return (
              <div
                key={item.file_path}
                className="screenshot-card-item"
                onClick={() => setActiveLightboxIndex(idx)}
                style={{
                  position: 'relative',
                  background: 'rgba(12, 12, 18, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <div style={{
                  position: 'relative',
                  width: '100%',
                  height: '170px',
                  background: '#050508',
                  overflow: 'hidden'
                }}>
                  <img
                    className="screenshot-image"
                    src={srcUrl}
                    alt={item.file_name}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      transition: 'transform 0.3s ease'
                    }}
                  />

                  <span style={{
                    position: 'absolute',
                    top: '8px',
                    left: '8px',
                    background: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.62rem',
                    fontFamily: "'Orbitron', sans-serif",
                    fontWeight: 800,
                    color: '#ffffff',
                    maxWidth: '180px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {item.instance_name}
                  </span>

                  <span style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '0.6rem',
                    fontFamily: "'Orbitron', sans-serif",
                    color: 'rgba(255, 255, 255, 0.8)'
                  }}>
                    {formatBytes(item.file_size_bytes)}
                  </span>
                </div>

                <div style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(0, 0, 0, 0.4)',
                  borderTop: '1px solid rgba(255, 255, 255, 0.06)'
                }}>
                  <div style={{ overflow: 'hidden', marginRight: '8px' }}>
                    <div style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: '#ffffff',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {item.file_name}
                    </div>
                    <div style={{ fontSize: '0.66rem', color: 'rgba(255, 255, 255, 0.5)', marginTop: '2px' }}>
                      {formatDate(item.created_at)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => handleCopyImage(item, e)}
                      title="Copiar imagen al portapapeles"
                      style={{
                        background: isCopied ? '#ffffff' : 'rgba(255, 255, 255, 0.06)',
                        border: `1px solid ${isCopied ? '#ffffff' : 'rgba(255, 255, 255, 0.2)'}`,
                        color: isCopied ? '#000000' : '#ffffff',
                        padding: '5px',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s'
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleOpenFolder(item, e)}
                      title="Abrir carpeta en Windows"
                      style={{
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#ffffff',
                        padding: '5px',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s'
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleDeleteScreenshot(item, e)}
                      title="Eliminar captura"
                      style={{
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#ff5555',
                        padding: '5px',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 85, 85, 0.2)'; e.currentTarget.style.borderColor = '#ff5555'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)'; }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {currentLightboxItem && (
        <div
          onClick={() => setActiveLightboxIndex(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.94)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveLightboxIndex(null)}
            title="Cerrar (Esc)"
            style={{
              position: 'absolute',
              top: '20px',
              right: '24px',
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              color: '#ffffff',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 10
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {filteredScreenshots.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveLightboxIndex(prev => (prev !== null && prev > 0 ? prev - 1 : filteredScreenshots.length - 1));
                }}
                title="Anterior (←)"
                style={{
                  position: 'absolute',
                  left: '24px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(0, 0, 0, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  color: '#ffffff',
                  borderRadius: '50%',
                  width: '50px',
                  height: '50px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 10,
                  transition: 'all 0.2s'
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveLightboxIndex(prev => (prev !== null && prev < filteredScreenshots.length - 1 ? prev + 1 : 0));
                }}
                title="Siguiente (→)"
                style={{
                  position: 'absolute',
                  right: '24px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(0, 0, 0, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  color: '#ffffff',
                  borderRadius: '50%',
                  width: '50px',
                  height: '50px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 10,
                  transition: 'all 0.2s'
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </>
          )}

          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '75vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(255, 255, 255, 0.15)',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}
          >
            <img
              src={convertFileSrc(currentLightboxItem.file_path)}
              alt={currentLightboxItem.file_name}
              style={{
                maxWidth: '100%',
                maxHeight: '75vh',
                objectFit: 'contain',
                display: 'block'
              }}
            />
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              marginTop: '18px',
              background: 'rgba(10, 10, 16, 0.9)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '30px',
              padding: '10px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.8)',
              zIndex: 10
            }}
          >
            <div>
              <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '0.8rem', fontWeight: 800, color: '#ffffff' }}>
                {currentLightboxItem.file_name}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '2px' }}>
                {currentLightboxItem.instance_name} • {formatDate(currentLightboxItem.created_at)} • {formatBytes(currentLightboxItem.file_size_bytes)}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={(e) => handleCopyImage(currentLightboxItem, e)}
                style={{
                  background: '#ffffff',
                  color: '#000000',
                  border: 'none',
                  borderRadius: '20px',
                  padding: '7px 16px',
                  fontFamily: "'Orbitron', sans-serif",
                  fontSize: '0.68rem',
                  fontWeight: 900,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>COPIAR IMAGEN</span>
              </button>

              <button
                type="button"
                onClick={(e) => handleOpenFolder(currentLightboxItem, e)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  borderRadius: '20px',
                  padding: '7px 16px',
                  fontFamily: "'Orbitron', sans-serif",
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>ABRIR CARPETA</span>
              </button>

              <button
                type="button"
                onClick={(e) => handleDeleteScreenshot(currentLightboxItem, e)}
                style={{
                  background: 'rgba(255, 85, 85, 0.15)',
                  color: '#ff5555',
                  border: '1px solid rgba(255, 85, 85, 0.3)',
                  borderRadius: '20px',
                  padding: '7px 14px',
                  fontFamily: "'Orbitron', sans-serif",
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                </svg>
                <span>ELIMINAR</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
