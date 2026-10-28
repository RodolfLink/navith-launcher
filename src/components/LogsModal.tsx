import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { 
  IconTerminal, 
  IconSearch, 
  IconCopy, 
  IconCheck, 
  IconUpload, 
  IconExternalLink 
} from './Icons';

interface LogFileInfo {
  name: string;
  path: string;
  sizeKb: number;
  modifiedMs: number;
  isLatest: boolean;
  isCrashReport: boolean;
}

interface LogsModalProps {
  isOpen: boolean;
  theme?: string;
  onClose: () => void;
  gameDirectory: string;
  instanceName: string;
}

export const LogsModal: React.FC<LogsModalProps> = ({
  isOpen,
  theme = 'white',
  onClose,
  gameDirectory,
  instanceName,
}) => {
  const [logsList, setLogsList] = useState<LogFileInfo[]>([]);
  const [selectedLogPath, setSelectedLogPath] = useState<string>('');
  const [logContent, setLogContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [sharing, setSharing] = useState<boolean>(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && gameDirectory) {
      loadLogsList();
    }
  }, [isOpen, gameDirectory]);

  const loadLogsList = async () => {
    try {
      setLoading(true);
      const list = await invoke<LogFileInfo[]>('get_instance_logs', { gameDirectory });
      setLogsList(list);
      if (list.length > 0) {
        setSelectedLogPath(list[0].path);
        loadLogFile(list[0].path);
      } else {
        setLogContent('No se encontraron archivos de log en esta instancia.');
      }
    } catch (e: any) {
      setLogContent(`Error al cargar lista de logs: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const loadLogFile = async (filePath: string) => {
    try {
      setLoading(true);
      const content = await invoke<string>('read_instance_log_file', { filePath });
      setLogContent(content);
      setShareUrl(null);
    } catch (e: any) {
      setLogContent(`Error al leer archivo de log: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUploadMclogs = async () => {
    if (!logContent || sharing) return;
    try {
      setSharing(true);
      const res = await invoke<{ success: boolean; url?: string; error?: string }>('upload_log_to_mclogs', {
        logContent,
      });
      if (res.success && res.url) {
        setShareUrl(res.url);
      } else {
        alert(`Error subiendo a mclo.gs: ${res.error}`);
      }
    } catch (e: any) {
      alert(`Error: ${e}`);
    } finally {
      setSharing(false);
    }
  };

  const filteredLines = React.useMemo(() => {
    if (!logContent) return [];
    const lines = logContent.split('\n');
    return lines.filter((line) => {
      if (filterLevel === 'ERROR' && !line.includes('/ERROR') && !line.includes('Exception') && !line.includes('Error')) {
        return false;
      }
      if (filterLevel === 'WARN' && !line.includes('/WARN') && !line.includes('Warning')) {
        return false;
      }
      if (filterLevel === 'INFO' && !line.includes('/INFO')) {
        return false;
      }

      if (searchQuery && !line.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      return true;
    });
  }, [logContent, filterLevel, searchQuery]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredLines, autoScroll]);

  if (!isOpen) return null;

  return typeof document !== 'undefined' ? createPortal(
    <div
      className="theme-dialog-overlay logs-modal-overlay"
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
        className="theme-dialog-card logs-modal-card"
        style={{
          width: '980px',
          maxWidth: '96vw',
          height: '680px',
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
                border: '1px solid rgba(255,255,255,0.18)',
                color: '#ffffff',
              }}
            >
              <IconTerminal size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>
                Consola y Registros: {instanceName}
              </h2>
              <span style={{ fontSize: '0.78rem', color: '#888899' }}>
                Visualizador en tiempo real y visor de reportes de fallos
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

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '14px',
            background: 'rgba(255,255,255,0.03)',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.8rem', color: '#aaa', fontWeight: 600 }}>Archivo:</span>
            <select
              value={selectedLogPath}
              onChange={(e) => {
                setSelectedLogPath(e.target.value);
                loadLogFile(e.target.value);
              }}
              style={{
                background: '#141418',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                outline: 'none',
                maxWidth: '240px',
              }}
            >
              {logsList.map((log) => (
                <option key={log.path} value={log.path}>
                  {log.isLatest ? `[latest] ${log.name}` : log.isCrashReport ? `[crash] ${log.name}` : log.name} (
                  {log.sizeKb} KB)
                </option>
              ))}
            </select>
            <button
              onClick={() => selectedLogPath && loadLogFile(selectedLogPath)}
              title="Recargar"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
                padding: '6px 10px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <IconTerminal size={14} />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
              <button
                key={lvl}
                className={`log-filter-btn ${filterLevel === lvl ? 'active' : ''}`}
                onClick={() => setFilterLevel(lvl)}
                style={{
                  background: filterLevel === lvl ? '#fff' : 'rgba(255,255,255,0.05)',
                  color: filterLevel === lvl ? '#000' : '#888',
                  border: '1px solid ' + (filterLevel === lvl ? '#fff' : 'rgba(255,255,255,0.1)'),
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {lvl}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#121216', border: '1px solid rgba(255,255,255,0.15)', padding: '6px 10px', borderRadius: '8px', minWidth: '180px' }}>
            <IconSearch size={14} color="#888899" />
            <input
              type="text"
              placeholder="Buscar en logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: 'transparent',
                color: '#fff',
                border: 'none',
                fontSize: '0.82rem',
                width: '100%',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleCopyLogs}
              style={{
                background: copied ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.06)',
                border: '1px solid ' + (copied ? '#22c55e' : 'rgba(255,255,255,0.15)'),
                color: copied ? '#86efac' : '#fff',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              <span>{copied ? 'Copiado' : 'Copiar'}</span>
            </button>

            <button
              className="dialog-accent-button"
              onClick={handleUploadMclogs}
              disabled={sharing}
              style={{
                background: '#ffffff',
                border: 'none',
                color: '#050508',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 800,
                cursor: sharing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 0 15px rgba(255,255,255,0.25)',
              }}
            >
              <IconUpload size={14} />
              <span>{sharing ? 'Subiendo...' : 'Subir a mclo.gs'}</span>
            </button>
          </div>
        </div>

        {shareUrl && (
          <div
            style={{
              background: 'rgba(59, 130, 246, 0.12)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              padding: '10px 16px',
              borderRadius: '8px',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: '0.82rem', color: '#93c5fd' }}>
              Enlace de mclo.gs listo para compartir: <strong style={{ color: '#fff' }}>{shareUrl}</strong>
            </span>
            <button
              onClick={() => openUrl(shareUrl)}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <IconExternalLink size={13} />
              <span>Abrir en navegador</span>
            </button>
          </div>
        )}

        <div
          ref={logContainerRef}
          className="custom-scrollbar"
          style={{
            flex: 1,
            backgroundColor: '#040407',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '10px',
            padding: '14px 18px',
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            fontSize: '0.78rem',
            lineHeight: 1.5,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {loading ? (
            <div style={{ color: '#888', textAlign: 'center', padding: '40px' }}>Cargando registros...</div>
          ) : filteredLines.length === 0 ? (
            <div style={{ color: '#666', textAlign: 'center', padding: '40px' }}>No hay líneas que coincidan.</div>
          ) : (
            filteredLines.map((line, idx) => {
              let lineClass = 'log-line-default';
              if (line.includes('/ERROR') || line.includes('Exception') || line.includes('Error')) {
                lineClass = 'log-line-error';
              } else if (line.includes('/WARN') || line.includes('Warning')) {
                lineClass = 'log-line-warn';
              } else if (line.includes('/INFO')) {
                lineClass = 'log-line-info';
              }
              return (
                <div key={idx} className={lineClass}>
                  {line}
                </div>
              );
            })
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '12px',
            fontSize: '0.75rem',
            color: '#666',
          }}
        >
          <span>
            {filteredLines.length} líneas mostradas de {logContent ? logContent.split('\n').length : 0} totales
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} style={{ accentColor: '#ffffff' }} />
            <span>Auto-scroll</span>
          </label>
        </div>
      </div>
    </div>,
    document.body
  ) : null;
};
