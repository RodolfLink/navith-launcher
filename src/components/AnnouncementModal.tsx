import React from 'react';
import { createPortal } from 'react-dom';

export interface LauncherAnnouncement {
  id: string | number;
  type?: string;
  title?: string;
  message?: string;
  image_url?: string;
  link_url?: string;
  link_text?: string;
}

interface AnnouncementModalProps {
  announcement: LauncherAnnouncement;
  announcements: LauncherAnnouncement[];
  currentIndex: number;
  isClosing: boolean;
  themeId: string;
  themeAccent: string;
  themeRgb: string;
  onDismiss: (id: string | number) => void;
  onSelectIndex: (index: number) => void;
}

const AnnouncementModal: React.FC<AnnouncementModalProps> = ({
  announcement,
  announcements,
  currentIndex,
  isClosing,
  themeId,
  themeAccent,
  themeRgb,
  onDismiss,
  onSelectIndex
}) => {
  if (typeof document === 'undefined') return null;

  const normalizedType = (announcement.type || '').toUpperCase();
  const isUpdate = ['ACTUALIZACION', 'ACTUALIZACIÓN', 'UPDATE'].includes(normalizedType);
  const isEvent = normalizedType === 'EVENTO';
  const isAlert = normalizedType === 'ALERTA';
  const badgeLabel = isEvent ? 'EVENTO' : isAlert ? 'ALERTA' : isUpdate ? 'ACTUALIZACIÓN' : 'COMUNICADO';
  const actionLabel = announcement.link_text || (isEvent ? 'UNIRSE AL EVENTO' : isUpdate ? 'VER CAMBIOS' : 'ABRIR ENLACE');
  const hasImage = Boolean(announcement.image_url);
  const announcementTitle = announcement.title || 'Novedades de NavithLabs Launcher';

  return createPortal(
    <div
      className={`announcement-modal-overlay theme-${themeId} ${isClosing ? 'closing' : ''}`}
      style={{ '--announcement-accent': themeAccent, '--announcement-rgb': themeRgb } as React.CSSProperties}
    >
      <section
        className={`announcement-modal-card ${hasImage ? 'has-image' : 'text-only'} ${isClosing ? 'closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-modal-title"
      >
        <aside className="ann-visual" aria-label="Portada de novedades">
          {hasImage ? (
            <img
              key={`ann-img-${announcement.id}`}
              src={announcement.image_url}
              alt=""
              className="ann-poster-image"
              onError={event => { event.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <div className="ann-poster-fallback" aria-hidden="true">
              <span className="ann-fallback-orbit ann-fallback-orbit-one" />
              <span className="ann-fallback-orbit ann-fallback-orbit-two" />
              <span className="ann-fallback-core">✦</span>
            </div>
          )}
          <div className="ann-visual-shade" />
          <div className="ann-visual-topline">
            <span className="ann-type-badge"><span className="ann-badge-spark">✦</span>{badgeLabel}</span>
            <span className="ann-visual-mark">NL<span> / </span>NEWS</span>
          </div>
          <div className="ann-hero-copy">
            <span className="ann-hero-eyebrow">NAVITHLABS LAUNCHER · TRANSMISIÓN OFICIAL</span>
            <strong>HAY ALGO<br />NUEVO EN EL UNIVERSO.</strong>
            <span className="ann-hero-caption">Descubre lo que acaba de llegar.</span>
          </div>
          {announcements.length > 1 && (
            <nav className="ann-story-dots" aria-label="Seleccionar anuncio">
              {announcements.map((item, index) => (
                <button
                  key={item.id || index}
                  type="button"
                  className={`ann-story-dot ${index === currentIndex ? 'active' : ''}`}
                  onClick={() => onSelectIndex(index)}
                  aria-label={`Ver anuncio ${index + 1}: ${item.title || 'Novedad'}`}
                  aria-pressed={index === currentIndex}
                  title={item.title}
                />
              ))}
            </nav>
          )}
        </aside>

        <div className="ann-content-body">
          <header className="ann-header">
            <div className="ann-header-kicker">
              <span className="ann-live-dot" />
              <span>NOVEDAD OFICIAL</span>
              <span className="ann-header-divider">/</span>
              <span className="ann-header-brand">NAVITHLABS LAUNCHER</span>
            </div>
            <div className="ann-header-actions">
              <button
                type="button"
                className="ann-close-btn"
                onClick={() => onDismiss(announcement.id)}
                aria-label="Cerrar anuncio"
                title="Cerrar aviso"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </header>

          <div key={`ann-title-${announcement.id}`} className="ann-title-block">
            <span className="ann-title-eyebrow">LO NUEVO, EN UN SOLO LUGAR</span>
            <h2 id="announcement-modal-title">{announcementTitle}</h2>
          </div>

          <section key={`ann-message-${announcement.id}`} className="ann-message-panel" aria-label="Detalles del anuncio">
            <div className="ann-message-heading">
              <span className="ann-message-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M5 4.75h14a1.25 1.25 0 0 1 1.25 1.25v12A1.25 1.25 0 0 1 19 19.25H5A1.25 1.25 0 0 1 3.75 18V6A1.25 1.25 0 0 1 5 4.75Z" /><path d="M8 9h8M8 12.5h8M8 16h5" /></svg>
              </span>
              <span>NOTAS DE LA NOVEDAD</span>
              <span className="ann-message-tag">{badgeLabel}</span>
            </div>
            <div className="ann-message-scroll custom-scrollbar">
              <p>{announcement.message || 'Abre el enlace para conocer todos los detalles.'}</p>
            </div>
          </section>

          <footer className="ann-footer">
            {announcements.length > 1 ? (
              <div className="ann-navigation">
                <button
                  type="button"
                  className="ann-nav-btn"
                  onClick={() => onSelectIndex(currentIndex <= 0 ? announcements.length - 1 : currentIndex - 1)}
                  aria-label="Anuncio anterior"
                  title="Anuncio anterior"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>
                </button>
                <span>{String(currentIndex + 1).padStart(2, '0')} <i>/</i> {String(announcements.length).padStart(2, '0')}</span>
                <button
                  type="button"
                  className="ann-nav-btn"
                  onClick={() => onSelectIndex(currentIndex >= announcements.length - 1 ? 0 : currentIndex + 1)}
                  aria-label="Siguiente anuncio"
                  title="Siguiente anuncio"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7" /></svg>
                </button>
              </div>
            ) : <span className="ann-footer-signature"><span className="ann-live-dot" /> NAVITHLABS · SIEMPRE EN MOVIMIENTO</span>}

            <div className="ann-footer-actions">
              {announcement.link_url && (
                <a href={announcement.link_url} target="_blank" rel="noopener noreferrer" className="ann-action-btn primary">
                  <span>{actionLabel}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>
                </a>
              )}
              <button type="button" className="ann-action-btn secondary" onClick={() => onDismiss(announcement.id)}>
                ENTENDIDO
              </button>
            </div>
          </footer>
        </div>
      </section>
    </div>,
    document.body
  );
};

export default React.memo(AnnouncementModal);
