import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface DownloadTask {
  id: string;
  instanceId?: string;
  title: string;
  source: 'curseforge' | 'modrinth' | 'local' | 'server';
  iconUrl?: string;
  progress: number;
  message: string;
  status: 'downloading' | 'installing' | 'completed' | 'error';
  awaitsCommandCompletion?: boolean;
  error?: string;
  startTime?: number;
}

const THEME_ACCENTS: Record<string, { color: string; rgb: string }> = {
  white: { color: '#ffffff', rgb: '255, 255, 255' },
  wine: { color: '#ff0033', rgb: '255, 0, 51' },
  blue: { color: '#00d4ff', rgb: '0, 212, 255' },
  pink: { color: '#ff007f', rgb: '255, 0, 127' },
  purple: { color: '#b100ff', rgb: '177, 0, 255' },
  green: { color: '#00ff66', rgb: '0, 255, 102' },
};

interface DownloadManagerDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: DownloadTask[];
  theme?: string;
  onClearCompleted: () => void;
  onNavigateToInstallations: () => void;
}

export const DownloadManagerDropdown: React.FC<DownloadManagerDropdownProps> = ({
  isOpen,
  onClose,
  tasks,
  theme = 'white',
  onClearCompleted,
  onNavigateToInstallations,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const currentAccent = THEME_ACCENTS[theme] || THEME_ACCENTS.white;

  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (panelRef.current && !panelRef.current.contains(target) && !target.closest('.download-topbar-btn')) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handleGlobalClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleGlobalClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const activeTasks = tasks.filter(t => t.status === 'downloading' || t.status === 'installing');
  const finishedTasks = tasks.filter(t => t.status === 'completed' || t.status === 'error');

  const dropdownMarkup = (
    <div 
      className="download-dropdown-overlay" 
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483646,
        background: 'transparent'
      }}
    >
      <div 
        ref={panelRef}
        className={`download-dropdown-panel-themed theme-${theme}`}
        data-theme={theme}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '52px',
          right: '90px',
          width: '410px',
          maxWidth: '92vw',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 2147483647,
          overflow: 'hidden',
          animation: 'dropdown-slide-down 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          ['--dropdown-accent' as any]: currentAccent.color,
          ['--dropdown-rgb' as any]: currentAccent.rgb
        }}
      >
        <div className="download-dropdown-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={currentAccent.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 6px ${currentAccent.color})` }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span style={{ fontFamily: 'Orbitron', fontWeight: 900, fontSize: '0.9rem', color: '#fff', letterSpacing: '1px', textShadow: `0 0 10px rgba(${currentAccent.rgb}, 0.7)` }}>
              CENTRO DE DESCARGAS
            </span>
            {activeTasks.length > 0 && (
              <span style={{ 
                background: currentAccent.color, 
                color: '#000000', 
                fontSize: '0.68rem', 
                fontWeight: 900, 
                fontFamily: 'Orbitron', 
                padding: '2px 8px', 
                borderRadius: '4px',
                boxShadow: `0 0 10px rgba(${currentAccent.rgb}, 0.6)`
              }}>
                {activeTasks.length} {activeTasks.length > 1 ? 'ACTIVAS' : 'ACTIVA'}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {finishedTasks.length > 0 && (
              <button 
                type="button" 
                onClick={onClearCompleted}
                className="download-clear-btn"
                style={{
                  fontSize: '0.72rem',
                  fontFamily: 'Orbitron',
                  fontWeight: 800,
                  padding: '4px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                LIMPIAR
              </button>
            )}
            <button 
              type="button" 
              onClick={onClose}
              className="dropdown-theme-close-btn"
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ maxHeight: '340px', overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }} className="download-dropdown-list custom-scrollbar">
          {tasks.length === 0 ? (
            <div className="download-empty-state" style={{ padding: '36px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={currentAccent.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: '12px', filter: `drop-shadow(0 0 8px rgba(${currentAccent.rgb}, 0.3))` }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#ffffff', fontFamily: 'Orbitron', letterSpacing: '0.5px' }}>
                NO HAY DESCARGAS ACTIVAS
              </div>
              <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
                Al instalar modpacks o componentes, el progreso aparecerá aquí.
              </div>
            </div>
          ) : (
            tasks.map(task => {
              const isDone = task.status === 'completed';
              const isErr = task.status === 'error';
              const sourceColor = task.source === 'curseforge' ? '#F16436' : task.source === 'modrinth' ? '#00AF5C' : currentAccent.color;

              return (
                <div 
                  key={task.id} 
                  className={`download-task-card ${isDone ? 'completed' : ''} ${isErr ? 'error' : ''}`}
                  data-status={task.status}
                  style={{
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <div className="download-task-top" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <img 
                      src={task.iconUrl || '/logo.png'} 
                      alt={task.title} 
                      className="download-task-icon"
                      style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover', border: '1px solid rgba(255, 255, 255, 0.15)' }}
                      onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }}
                    />

                    <div className="download-task-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="download-task-title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                        <span style={{ color: '#fff', fontSize: '0.82rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={task.title}>
                          {task.title}
                        </span>
                        <span className="download-task-source-tag"
                          style={{ 
                            fontSize: '0.62rem', 
                            fontWeight: 800, 
                            fontFamily: 'Orbitron',
                            border: `1px solid ${sourceColor}`, 
                            color: sourceColor,
                            padding: '1px 6px',
                            borderRadius: '4px'
                          }}
                        >
                          {task.source === 'curseforge' ? 'CurseForge' : task.source === 'modrinth' ? 'Modrinth' : 'Local'}
                        </span>
                      </div>

                      <p className="download-task-msg" style={{ margin: '2px 0 0 0', fontSize: '0.72rem', color: isErr ? '#ff4d4d' : 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={task.message}>
                        {isErr ? (task.error || task.message) : task.message}
                      </p>
                    </div>

                    <div className="download-task-status-badge" style={{ display: 'flex', alignItems: 'center' }}>
                      {isDone ? (
                        <span style={{ color: currentAccent.color, fontSize: '0.72rem', fontWeight: 900, fontFamily: 'Orbitron', display: 'flex', alignItems: 'center', gap: '4px', filter: `drop-shadow(0 0 4px ${currentAccent.color})` }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={currentAccent.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                          LISTO
                        </span>
                      ) : isErr ? (
                        <span style={{ color: '#ff4d4d', fontSize: '0.72rem', fontWeight: 900, fontFamily: 'Orbitron' }}>ERROR</span>
                      ) : (
                        <span style={{ color: currentAccent.color, fontSize: '0.78rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.floor(task.progress)}%</span>
                      )}
                    </div>
                  </div>

                  {!isDone && !isErr && (
                    <div className="download-progress-track" style={{ height: '3px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div 
                        className="download-progress-fill"
                        style={{ 
                          width: `${Math.min(Math.max(task.progress, 0), 100)}%`,
                          height: '100%',
                          background: currentAccent.color,
                          boxShadow: `0 0 8px rgba(${currentAccent.rgb}, 0.8)`
                        }} 
                      />
                    </div>
                  )}

                  {isDone && (
                    <button 
                      type="button"
                      className="download-view-inst-btn"
                      onClick={() => {
                        onClose();
                        onNavigateToInstallations();
                      }}
                      style={{
                        borderRadius: '6px',
                        padding: '5px 10px',
                        fontSize: '0.72rem',
                        fontFamily: 'Orbitron',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        marginTop: '2px',
                        transition: 'all 0.2s'
                      }}
                    >
                      <span>VER EN INSTALACIONES</span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dropdownMarkup, document.body);
};
