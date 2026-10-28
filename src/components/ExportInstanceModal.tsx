import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { 
  IconPackage, 
  IconBox, 
  IconSettings, 
  IconPalette, 
  IconSparkles, 
  IconGlobe, 
  IconZap, 
  IconUpload 
} from './Icons';

interface ExportInstanceModalProps {
  isOpen: boolean;
  theme?: string;
  onClose: () => void;
  gameDirectory: string;
  instanceName: string;
  mcVersion: string;
  loaderType: string;
  loaderVersion?: string;
}

export const ExportInstanceModal: React.FC<ExportInstanceModalProps> = ({
  isOpen,
  theme = 'white',
  onClose,
  gameDirectory,
  instanceName,
  mcVersion,
  loaderType,
  loaderVersion,
}) => {
  const [formatType, setFormatType] = useState<'mrpack' | 'zip'>('mrpack');
  const [packName, setPackName] = useState(instanceName);
  const [packVersion, setPackVersion] = useState('1.0.0');
  const [packSummary] = useState(`Modpack ${instanceName} para Minecraft ${mcVersion}`);
  const [includeMods, setIncludeMods] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(true);
  const [includeResourcepacks, setIncludeResourcepacks] = useState(true);
  const [includeShaderpacks, setIncludeShaderpacks] = useState(true);
  const [includeDatapacks, setIncludeDatapacks] = useState(true);
  const [includeSaves, setIncludeSaves] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExport = async () => {
    try {
      setExporting(true);
      setExportError(null);
      setExportSuccess(null);

      const defaultFileName = `${packName.replace(/[^a-zA-Z0-9_-]/g, '_')}-${packVersion}.${formatType}`;

      const targetPath = await save({
        defaultPath: defaultFileName,
        filters: [
          {
            name: formatType === 'mrpack' ? 'Modrinth Modpack (*.mrpack)' : 'Archivo ZIP (*.zip)',
            extensions: [formatType],
          },
        ],
        title: 'Guardar Modpack Exportado',
      });

      if (!targetPath) {
        setExporting(false);
        return;
      }

      await invoke('export_instance_package', {
        gameDirectory,
        outputPath: targetPath,
        formatType,
        packName,
        packVersion,
        packSummary,
        mcVersion,
        loaderType,
        loaderVersion: loaderVersion || '',
        includeMods,
        includeConfig,
        includeResourcepacks,
        includeShaderpacks,
        includeDatapacks,
        includeSaves,
      });

      setExportSuccess(`¡Exportación completada exitosamente en:\n${targetPath}`);
    } catch (e: any) {
      setExportError(`Error al exportar: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  return typeof document !== 'undefined' ? createPortal(
    <div
      className="theme-dialog-overlay export-instance-overlay"
      data-theme={theme}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(16px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      <div
        className="theme-dialog-card export-instance-card"
        style={{
          width: '640px',
          maxWidth: '95vw',
          backgroundColor: '#0a0a0f',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 40px rgba(255,255,255,0.06)',
          overflow: 'hidden',
          padding: '24px',
          gap: '18px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                border: '1px solid rgba(255,255,255,0.18)',
                color: '#ffffff',
              }}
            >
              <IconPackage size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>
                Exportar Modpack
              </h2>
              <span style={{ fontSize: '0.78rem', color: '#888899' }}>
                {instanceName} • {loaderType} {mcVersion}
              </span>
            </div>
          </div>
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

        <div>
          <label style={{ fontSize: '0.82rem', color: '#aaaaaa', fontWeight: 700, display: 'block', marginBottom: '8px' }}>
            Formato de Exportación:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div
              className={`export-format-choice ${formatType === 'mrpack' ? 'active' : ''}`}
              onClick={() => setFormatType('mrpack')}
              style={{
                padding: '14px',
                borderRadius: '11px',
                background: formatType === 'mrpack' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255,255,255,0.03)',
                border: '1px solid ' + (formatType === 'mrpack' ? '#ffffff' : 'rgba(255,255,255,0.08)'),
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: formatType === 'mrpack' ? '0 0 15px rgba(255,255,255,0.15)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, color: '#ffffff', fontSize: '0.9rem' }}>
                <IconZap size={16} />
                <span>Modrinth (.mrpack)</span>
              </div>
              <div style={{ fontSize: '0.74rem', color: '#888899', marginTop: '6px', lineHeight: 1.4 }}>
                Estándar oficial de Modrinth. Optimizado y ligero para compartir.
              </div>
            </div>

            <div
              className={`export-format-choice ${formatType === 'zip' ? 'active' : ''}`}
              onClick={() => setFormatType('zip')}
              style={{
                padding: '14px',
                borderRadius: '11px',
                background: formatType === 'zip' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255,255,255,0.03)',
                border: '1px solid ' + (formatType === 'zip' ? '#ffffff' : 'rgba(255,255,255,0.08)'),
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: formatType === 'zip' ? '0 0 15px rgba(255,255,255,0.15)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, color: '#ffffff', fontSize: '0.9rem' }}>
                <IconPackage size={16} />
                <span>Archivo ZIP (.zip)</span>
              </div>
              <div style={{ fontSize: '0.74rem', color: '#888899', marginTop: '6px', lineHeight: 1.4 }}>
                Copia directa de archivos para respaldo local o importación genérica.
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: '#aaa', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Nombre del Paquete:
            </label>
            <input
              type="text"
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
              style={{
                width: '100%',
                background: '#121218',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: '#aaa', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Versión:
            </label>
            <input
              type="text"
              value={packVersion}
              onChange={(e) => setPackVersion(e.target.value)}
              style={{
                width: '100%',
                background: '#121218',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: '0.82rem', color: '#aaaaaa', fontWeight: 700, display: 'block', marginBottom: '8px' }}>
            Carpetas a Incluir:
          </label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              background: 'rgba(255,255,255,0.02)',
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {[
              { label: 'Mods (mods/)', icon: <IconBox size={14} />, checked: includeMods, set: setIncludeMods },
              { label: 'Configuración (config/)', icon: <IconSettings size={14} />, checked: includeConfig, set: setIncludeConfig },
              { label: 'Resource Packs', icon: <IconPalette size={14} />, checked: includeResourcepacks, set: setIncludeResourcepacks },
              { label: 'Shaders (shaderpacks/)', icon: <IconSparkles size={14} />, checked: includeShaderpacks, set: setIncludeShaderpacks },
              { label: 'Datapacks (datapacks/)', icon: <IconPackage size={14} />, checked: includeDatapacks, set: setIncludeDatapacks },
              { label: 'Mundos Guardados (saves/)', icon: <IconGlobe size={14} />, checked: includeSaves, set: setIncludeSaves },
            ].map((item, idx) => (
              <label
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.8rem',
                  color: item.checked ? '#ffffff' : '#777788',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => item.set(e.target.checked)}
                  style={{ accentColor: '#ffffff' }}
                />
                {item.icon}
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        {exportSuccess && (
          <div
            style={{
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#86efac',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '0.8rem',
              whiteSpace: 'pre-line',
            }}
          >
            {exportSuccess}
          </div>
        )}

        {exportError && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '0.8rem',
            }}
          >
            {exportError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#aaa',
              padding: '9px 18px',
              borderRadius: '9px',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
          <button
            className="dialog-accent-button"
            onClick={handleExport}
            disabled={exporting}
            style={{
              background: exporting ? 'rgba(255,255,255,0.2)' : '#ffffff',
              border: 'none',
              color: '#050508',
              padding: '9px 24px',
              borderRadius: '9px',
              fontWeight: 900,
              fontSize: '0.85rem',
              cursor: exporting ? 'not-allowed' : 'pointer',
              boxShadow: '0 0 20px rgba(255,255,255,0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <IconUpload size={16} />
            <span>{exporting ? 'Exportando...' : 'Exportar Paquete'}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;
};
