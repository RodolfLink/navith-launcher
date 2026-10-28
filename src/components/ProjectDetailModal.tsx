import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { normalizeYouTubeEmbeds } from '../projectEmbedUtils';

interface ProjectDetailModalProps {
  isOpen: boolean;
  theme: string;
  onClose: () => void;
  projectIdOrSlug: string | null;
  projectData?: any;
  onInstallVersion: (version: any, project: any) => void;
}

const parseModrinthDescriptionToHtml = (raw: string) => {
  if (!raw) return '';

  let text = raw;

  text = text
    .replace(/width="[^"]*"/gi, '')
    .replace(/height="[^"]*"/gi, '')
    .replace(/style="[^"]*"/gi, '');

  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
    return `<img src="${src}" alt="${alt}" class="project-markdown-img" />`;
  });

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  text = text.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  text = text.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  text = text.replace(/(✓[^\n✓]+)/g, '<div className="feature-item">$1</div>');

  text = text.replace(/\n\s*\n/g, '</p><p>');
  text = text.replace(/\n/g, '<br />');

  if (!text.trim().startsWith('<')) {
    text = '<p>' + text + '</p>';
  }

  return normalizeYouTubeEmbeds(text);
};

const projectCache = new Map<string, any>();
const versionCache = new Map<string, any>();
const dependenciesCache = new Map<string, any[]>();

export const prefetchProjects = (hits: any[]) => {
  if (!Array.isArray(hits)) return;
  const topHits = hits.slice(0, 15);
  topHits.forEach(async (hit) => {
    const id = hit.project_id || hit.id || hit.slug;
    if (!id || projectCache.has(id)) return;

    try {
      const resProj = await fetch(`https://api.modrinth.com/v2/project/${id}`, {
        headers: { 'User-Agent': 'NavithLabsLauncher/0.1.0' }
      });
      if (resProj.ok) {
        const pData = await resProj.json();
        projectCache.set(id, pData);
      }

      const resVer = await fetch(`https://api.modrinth.com/v2/project/${id}/version`, {
        headers: { 'User-Agent': 'NavithLabsLauncher/0.1.0' }
      });
      if (resVer.ok) {
        const vData = await resVer.json();
        versionCache.set(id, vData);
      }
    } catch (e) {
    }
  });
};

export const ProjectDetailModal: React.FC<ProjectDetailModalProps> = ({
  isOpen,
  theme,
  onClose,
  projectIdOrSlug,
  projectData,
  onInstallVersion,
}) => {
  const [project, setProject] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'description' | 'mods' | 'versions' | 'gallery'>('description');
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingVersions, setLoadingVersions] = useState<boolean>(false);
  const [loadingMods, setLoadingMods] = useState<boolean>(false);
  const [selectedVersion, setSelectedVersion] = useState<any>(null);
  const [includedMods, setIncludedMods] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [customLightboxImg, setCustomLightboxImg] = useState<{ url: string; title: string } | null>(null);
  const [isZoomed, setIsZoomed] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && projectIdOrSlug) {
      loadProjectDetails();
    } else {
      setProject(null);
      setVersions([]);
      setIncludedMods([]);
      setSelectedVersion(null);
      setActiveTab('description');
      setActiveImageIndex(null);
      setCustomLightboxImg(null);
      setIsZoomed(false);
    }
  }, [isOpen, projectIdOrSlug]);

  useEffect(() => {
    setIsZoomed(false);
  }, [activeImageIndex, customLightboxImg]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeImageIndex !== null && project?.gallery?.length) {
        if (e.key === 'ArrowRight') {
          setActiveImageIndex((prev) => (prev !== null ? (prev + 1) % project.gallery.length : 0));
        } else if (e.key === 'ArrowLeft') {
          setActiveImageIndex((prev) => (prev !== null ? (prev - 1 + project.gallery.length) % project.gallery.length : 0));
        } else if (e.key === 'Escape') {
          if (isZoomed) {
            setIsZoomed(false);
          } else {
            setActiveImageIndex(null);
          }
        }
      } else if (customLightboxImg && e.key === 'Escape') {
        if (isZoomed) {
          setIsZoomed(false);
        } else {
          setCustomLightboxImg(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeImageIndex, project?.gallery, customLightboxImg, isZoomed]);

  const loadProjectDetails = async () => {
    if (!projectIdOrSlug) return;

    setError(null);
    setVersions([]);
    setIncludedMods([]);
    setSelectedVersion(null);

    const initialProject = projectCache.get(projectIdOrSlug) || projectData;
    if (initialProject) {
      setProject(initialProject);
    }

    const isCurseForge = projectData?.source === 'curseforge' || initialProject?.source === 'curseforge' || (!isNaN(Number(projectIdOrSlug)) && !projectCache.has(projectIdOrSlug));

    if (isCurseForge) {
      const p = initialProject || projectData;
      setProject(p);
      setLoading(true);
      setLoadingVersions(true);
      const modId = Number(p?.id || projectIdOrSlug);

      try {
        const details = await invoke<any>('get_curseforge_project_details', {
          projectId: modId,
          project_id: modId,
          modId: modId,
          id: modId
        });
        
        let fullBody = details?.description || p?.summary || p?.description || '';
        let gallery = Array.isArray(details?.screenshots)
          ? details.screenshots.map((s: any) => ({ url: s.url, title: s.title || '' }))
          : (p?.gallery || []);

        let mappedVers: any[] = [];
        if (Array.isArray(details?.files) && details.files.length > 0) {
          mappedVers = details.files.map((f: any) => {
            let fileUrl = f.downloadUrl || f.url || '';
            if (!fileUrl && f.id) {
              fileUrl = `https://edge.forgecdn.net/files/${Math.floor(f.id / 1000)}/${f.id % 1000}/${f.fileName || 'modpack.zip'}`;
            }
            return {
              id: f.id,
              version_number: f.displayName || f.fileName || `v${f.id}`,
              game_versions: f.gameVersions || [],
              loaders: (f.gameVersions || []).filter((tag: unknown) =>
                typeof tag === 'string' && /^(forge|neoforge|fabric|quilt)$/i.test(tag)
              ),
              changelog: f.changelog || '',
              date_published: f.fileDate || '',
              files: [{ url: fileUrl, primary: true }]
            };
          });
        }

        if (mappedVers.length === 0 && !Array.isArray(details?.files)) {
          const rawFiles = p?.latestFiles || p?.files || [];
          if (rawFiles.length > 0) {
            mappedVers = rawFiles.map((f: any) => {
              let fileUrl = f.downloadUrl || f.url || p?.downloadUrl;
              if (!fileUrl && f.id) {
                fileUrl = `https://edge.forgecdn.net/files/${Math.floor(f.id / 1000)}/${f.id % 1000}/${f.fileName || 'modpack.zip'}`;
              }
              return {
                id: f.id || f.fileID || 'cf-version',
                version_number: f.displayName || f.fileName || 'Última Versión',
                game_versions: f.gameVersions || ['1.20.1'],
                files: [{ url: fileUrl, primary: true }]
              };
            });
          } else {
            let fileUrl = p?.downloadUrl || p?.url;
            if (!fileUrl && p?.id) {
              fileUrl = `https://edge.forgecdn.net/files/${Math.floor(p.id / 1000)}/${p.id % 1000}/modpack.zip`;
            }
            mappedVers = [{
              id: p?.id || 'cf-version',
              version_number: 'Última Versión (CurseForge)',
              files: [{ url: fileUrl || '', primary: true }]
            }];
          }
        }

        const cfModData = details?.mod || {};
        const fullProjectObj = {
          ...p,
          title: cfModData?.name || p?.name || p?.title,
          description: cfModData?.summary || p?.summary || p?.description,
          body: fullBody,
          icon_url: cfModData?.logo?.thumbnailUrl || cfModData?.logo?.url || p?.logo?.thumbnailUrl || p?.logo?.url || p?.iconUrl,
          downloads: cfModData?.downloadCount || p?.downloadCount || p?.downloads,
          gallery: gallery.length > 0 ? gallery : p?.gallery,
          source: 'curseforge'
        };

        setProject(fullProjectObj);
        setVersions(mappedVers);
        if (mappedVers.length > 0) {
          setSelectedVersion(mappedVers[0]);
        }
      } catch (err) {
        console.error('Error invocando get_curseforge_project_details:', err);
        setError(`No se pudieron cargar los detalles oficiales de CurseForge: ${String(err)}`);
      } finally {
        setLoading(false);
        setLoadingVersions(false);
      }
      return;
    }

    setLoading(true);
    setLoadingVersions(true);
    setError(null);

    try {
      const fetchProjectPromise = (async () => {
        if (projectCache.has(projectIdOrSlug) && projectCache.get(projectIdOrSlug)?.body) {
          return projectCache.get(projectIdOrSlug);
        }
        const res = await fetch(`https://api.modrinth.com/v2/project/${projectIdOrSlug}`, {
          headers: { 'User-Agent': 'NavithLabsLauncher/0.1.0' }
        });
        if (res.ok) {
          const data = await res.json();
          projectCache.set(projectIdOrSlug, data);
          return data;
        }
        return initialProject;
      })();

      const fetchVersionsPromise = (async () => {
        if (versionCache.has(projectIdOrSlug)) {
          return versionCache.get(projectIdOrSlug);
        }
        const versRes = await invoke<any[]>('get_modrinth_project_versions', {
          projectId: projectIdOrSlug,
        });
        if (Array.isArray(versRes)) {
          versionCache.set(projectIdOrSlug, versRes);
          return versRes;
        }
        return [];
      })();

      const [fullProj, versList] = await Promise.all([
        fetchProjectPromise,
        fetchVersionsPromise,
      ]);

      if (fullProj) {
        setProject(fullProj);
      }

      if (Array.isArray(versList)) {
        setVersions(versList);
        if (versList.length > 0) {
          const firstVer = versList[0];
          setSelectedVersion(firstVer);
          loadVersionDependencies(firstVer);
        }
      }
    } catch (err: any) {
      setError(err?.toString() || 'Error al cargar los detalles del proyecto');
    } finally {
      setLoading(false);
      setLoadingVersions(false);
    }
  };

  const loadVersionDependencies = async (ver: any) => {
    if (!ver || !ver.dependencies || ver.dependencies.length === 0) {
      setIncludedMods([]);
      return;
    }

    const cached = dependenciesCache.get(ver.id);
    if (cached) {
      setIncludedMods(cached);
      return;
    }

    setLoadingMods(true);
    try {
      const projectIds = ver.dependencies
        .map((d: any) => d.project_id)
        .filter(Boolean);

      if (projectIds.length === 0) {
        setIncludedMods([]);
        return;
      }

      const idsParam = JSON.stringify(projectIds);
      const res = await fetch(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(idsParam)}`, {
          headers: { 'User-Agent': 'NavithLabsLauncher/0.1.0' }
      });
      if (res.ok) {
        const modsList = await res.json();
        dependenciesCache.set(ver.id, modsList);
        setIncludedMods(modsList);
      }
    } catch (err) {
      console.error('Error cargando mods del paquete:', err);
    } finally {
      setLoadingMods(false);
    }
  };

  const handleSelectVersion = (ver: any) => {
    setSelectedVersion(ver);
    loadVersionDependencies(ver);
  };

  const title = project?.title || project?.name || 'Detalles del Proyecto';
  const iconUrl = project?.icon_url || project?.iconUrl;
  const description = project?.description || '';
  const rawBody = project?.body || project?.description || '';
  const renderedHtmlDescription = useMemo(() => parseModrinthDescriptionToHtml(rawBody), [rawBody]);
  const renderedDescriptionMarkup = useMemo(() => ({ __html: renderedHtmlDescription }), [renderedHtmlDescription]);
  const downloads = project?.downloads ? project.downloads.toLocaleString() : '0';
  const followers = project?.followers ? project.followers.toLocaleString() : null;
  const categories = project?.categories || [];

  if (!isOpen) return null;

  return typeof document !== 'undefined' ? createPortal(
    <div className="project-modal-overlay theme-dialog-overlay" data-theme={theme}>
      <div className="project-modal-container theme-dialog-card">
        
        <div className="project-modal-header">
          <button onClick={onClose} className="project-modal-close" title="Cerrar">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div className="project-header-top">
            {iconUrl ? (
              <img src={iconUrl} alt={title} className="project-header-icon" />
            ) : (
              <div className="project-header-icon-fallback">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                </svg>
              </div>
            )}

            <div className="project-header-info">
              <h2 className="project-header-title">{title}</h2>

              <div className="project-header-meta">
                {categories.map((cat: string) => (
                  <span key={cat} className="project-tag">
                    {cat}
                  </span>
                ))}
              </div>

              <p className="project-header-desc">{description}</p>

              <div className="project-header-stats">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  {downloads} descargas
                </span>

                {followers && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                    {followers} seguidores
                  </span>
                )}
              </div>
            </div>

            {selectedVersion && (
              <button
                onClick={() => onInstallVersion(selectedVersion, project)}
                className="project-install-btn"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Instalar Modpack
              </button>
            )}
          </div>

          <div className="project-modal-tabs custom-scrollbar">
            <button
              onClick={() => setActiveTab('description')}
              className={`project-modal-tab ${activeTab === 'description' ? 'active' : ''}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              Descripción
            </button>

            <button
              onClick={() => setActiveTab('mods')}
              className={`project-modal-tab ${activeTab === 'mods' ? 'active' : ''}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              Mods Incluidos ({includedMods.length})
            </button>

            <button
              onClick={() => setActiveTab('versions')}
              className={`project-modal-tab ${activeTab === 'versions' ? 'active' : ''}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                <line x1="7" y1="7" x2="7.01" y2="7"></line>
              </svg>
              Versiones ({versions.length})
            </button>

            {project?.gallery && project.gallery.length > 0 && (
              <button
                onClick={() => setActiveTab('gallery')}
                className={`project-modal-tab ${activeTab === 'gallery' ? 'active' : ''}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                Galería ({project.gallery.length})
              </button>
            )}
          </div>
        </div>

        <div className="project-modal-body custom-scrollbar">
          {error ? (
            <div style={{ padding: '16px', background: 'rgba(255,0,0,0.1)', border: '1px solid rgba(255,0,0,0.3)', borderRadius: '12px', color: '#ff6b6b' }}>
              {error}
            </div>
          ) : (
            <>
              {activeTab === 'description' && (
                <div>
                  {renderedHtmlDescription ? (
                    <div
                      className="project-html-content custom-scrollbar"
                      dangerouslySetInnerHTML={renderedDescriptionMarkup}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target && target.tagName === 'IMG') {
                          const img = target as HTMLImageElement;
                          if (img.src) {
                            setCustomLightboxImg({
                              url: img.src,
                              title: img.alt || project?.title || 'Captura de Modpack'
                            });
                          }
                        }
                      }}
                    />
                  ) : null}

                  {loading && (
                    <div style={{ padding: '20px 0' }}>
                      <div className="skeleton-shimmer skeleton-card" />
                      <div className="skeleton-shimmer skeleton-line" />
                      <div className="skeleton-shimmer skeleton-line medium" />
                      <div className="skeleton-shimmer skeleton-line short" />
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'mods' && (
                <div>
                  <h3 style={{ fontFamily: 'Orbitron', fontSize: '0.8rem', fontWeight: 800, color: '#a3a3a3', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '16px' }}>
                    Mods en versión ({selectedVersion?.version_number || 'Actual'}):
                  </h3>

                  {loadingMods ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#a3a3a3', fontFamily: 'Orbitron' }}>
                      Consultando dependencias en Modrinth...
                    </div>
                  ) : includedMods.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '50px', background: '#0f0f14', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <p style={{ fontFamily: 'Orbitron', fontSize: '1rem', fontWeight: 700, color: '#ffffff' }}>No hay dependencias declaradas</p>
                      <p style={{ fontSize: '0.8rem', color: '#a3a3a3', marginTop: '4px' }}>
                        Los mods están empaquetados directamente en el modpack.
                      </p>
                    </div>
                  ) : (
                    <div className="included-mods-grid">
                      {includedMods.map((mod: any) => (
                        <div key={mod.id} className="included-mod-card">
                          {mod.icon_url ? (
                            <img src={mod.icon_url} alt={mod.title} className="included-mod-icon" />
                          ) : (
                            <div className="included-mod-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#141419', color: '#ffffff', fontWeight: 'bold' }}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="7" height="7"></rect>
                                <rect x="14" y="3" width="7" height="7"></rect>
                                <rect x="14" y="14" width="7" height="7"></rect>
                                <rect x="3" y="14" width="7" height="7"></rect>
                              </svg>
                            </div>
                          )}

                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="included-mod-title">{mod.title}</div>
                            <div className="included-mod-desc">{mod.description}</div>
                            <div style={{ fontSize: '0.7rem', color: '#a3a3a3', marginTop: '6px', fontFamily: 'monospace' }}>
                              {mod.downloads?.toLocaleString() || 0} descargas • <span style={{ textTransform: 'capitalize' }}>{mod.project_type}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'versions' && (
                <div>
                  {loadingVersions ? (
                    <div style={{ textAlign: 'center', padding: '50px', color: '#a3a3a3', fontFamily: 'Orbitron' }}>
                      Cargando lista de versiones...
                    </div>
                  ) : versions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '50px', color: '#a3a3a3' }}>
                      No hay versiones disponibles.
                    </div>
                  ) : (
                    versions.map((ver) => (
                      <div
                        key={ver.id}
                        className={`version-card-item ${selectedVersion?.id === ver.id ? 'selected' : ''}`}
                        onClick={() => handleSelectVersion(ver)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'Orbitron', fontWeight: 800, fontSize: '0.95rem', color: '#ffffff' }}>
                              {ver.name || ver.version_number}
                            </span>
                            <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', color: '#ffffff', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                              MC {ver.game_versions?.join(', ')}
                            </span>
                            <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.15)', color: '#ffffff', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace', textTransform: 'uppercase' }}>
                              {ver.loaders?.join(', ')}
                            </span>
                          </div>

                          {ver.changelog && (
                            <div className="version-changelog-text custom-scrollbar">
                              {ver.changelog}
                            </div>
                          )}
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectVersion(ver);
                            onInstallVersion(ver, project);
                          }}
                          className="version-btn-install"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                          </svg>
                          Instalar Esta Versión
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'gallery' && project?.gallery && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                  {project.gallery.map((img: any, idx: number) => (
                    <div
                      key={idx}
                      className="project-gallery-card"
                      onClick={() => setActiveImageIndex(idx)}
                      style={{
                        background: '#0c0c11',
                        borderRadius: '14px',
                        overflow: 'hidden',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        cursor: 'pointer',
                        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#ffffff';
                        e.currentTarget.style.transform = 'translateY(-3px)';
                        e.currentTarget.style.boxShadow = '0 10px 25px rgba(0,0,0,0.8), 0 0 15px rgba(255,255,255,0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      title="Clic para ver en pantalla completa"
                    >
                      <div style={{ position: 'relative', width: '100%', height: '180px', background: '#050507', overflow: 'hidden' }}>
                        <img
                          src={img.url}
                          alt={img.title || `Captura ${idx + 1}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        <div style={{
                          position: 'absolute',
                          bottom: '8px',
                          right: '8px',
                          background: 'rgba(0, 0, 0, 0.75)',
                          backdropFilter: 'blur(6px)',
                          border: '1px solid rgba(255, 255, 255, 0.25)',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          color: '#ffffff',
                          fontFamily: 'Orbitron',
                          fontSize: '0.62rem',
                          fontWeight: 800
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          </svg>
                          <span>AMPLIAR</span>
                        </div>
                      </div>
                      {img.title && (
                        <p style={{ padding: '10px 14px', fontSize: '0.78rem', color: '#e0e0e0', fontWeight: 600, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                          {img.title}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {((activeImageIndex !== null && project?.gallery && project.gallery[activeImageIndex]) || customLightboxImg) && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: 'rgba(0, 0, 0, 0.95)',
            backdropFilter: 'blur(25px)',
            WebkitBackdropFilter: 'blur(25px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
          }}
          onClick={() => {
            setActiveImageIndex(null);
            setCustomLightboxImg(null);
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '20px',
              left: '30px',
              right: '30px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              zIndex: 10
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontFamily: 'Orbitron', fontWeight: 800, color: '#ffffff', fontSize: '1.05rem', letterSpacing: '1px' }}>
                {project?.title || 'Galería'}
              </span>
              {activeImageIndex !== null && project?.gallery && (
                <span style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  color: '#ffffff',
                  fontFamily: 'Orbitron',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: '6px'
                }}>
                  {activeImageIndex + 1} / {project.gallery.length}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={() => setIsZoomed(!isZoomed)}
                style={{
                  background: isZoomed ? '#ffffff' : 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  color: isZoomed ? '#000000' : '#ffffff',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontFamily: 'Orbitron',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
                title="Alternar entre modo ajustado y tamaño ampliado"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
                <span>{isZoomed ? 'AJUSTAR' : 'AMPLIAR'}</span>
              </button>

              <button
                onClick={() => {
                  setActiveImageIndex(null);
                  setCustomLightboxImg(null);
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  color: '#ffffff',
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.2rem',
                  transition: 'all 0.2s ease'
                }}
                title="Cerrar visor (ESC)"
              >
                &times;
              </button>
            </div>
          </div>

          {activeImageIndex !== null && project?.gallery && project.gallery.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveImageIndex((prev) => (prev !== null ? (prev - 1 + project.gallery.length) % project.gallery.length : 0));
              }}
              style={{
                position: 'absolute',
                left: '25px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(20, 20, 26, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                transition: 'all 0.2s ease'
              }}
              title="Anterior (Flecha Izquierda)"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          )}

          {(() => {
            const rawUrl = customLightboxImg ? customLightboxImg.url : project.gallery[activeImageIndex!].url;
            const highResUrl = rawUrl.replace(/(\?|&)width=\d+/gi, '').replace(/(\?|&)size=\d+/gi, '');
            const title = customLightboxImg ? customLightboxImg.title : project.gallery[activeImageIndex!].title;

            return (
              <div
                style={{
                  maxWidth: '90vw',
                  maxHeight: '80vh',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  borderRadius: '12px'
                }}>
                  <img
                    src={highResUrl}
                    alt="Captura ampliada"
                    style={{
                      maxWidth: isZoomed ? '94vw' : '84vw',
                      maxHeight: isZoomed ? '82vh' : '72vh',
                      width: 'auto',
                      height: 'auto',
                      objectFit: 'contain',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.25)',
                      boxShadow: '0 0 35px rgba(255, 255, 255, 0.12), 0 20px 50px rgba(0, 0, 0, 0.95)',
                      background: 'rgba(5, 5, 8, 0.85)',
                      cursor: isZoomed ? 'zoom-out' : 'zoom-in',
                      transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                      transform: isZoomed ? 'scale(1.15)' : 'scale(1)',
                      imageRendering: 'auto'
                    }}
                    onClick={() => setIsZoomed(!isZoomed)}
                    title={isZoomed ? "Clic para ajustar tamaño" : "Clic para ampliar (Zoom)"}
                  />
                </div>

                {title && (
                  <div style={{
                    marginTop: '12px',
                    color: '#ffffff',
                    fontFamily: 'Inter',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    background: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(8px)',
                    padding: '6px 18px',
                    borderRadius: '20px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
                    maxWidth: '80vw',
                    textAlign: 'center'
                  }}>
                    {title}
                  </div>
                )}
              </div>
            );
          })()}

          {activeImageIndex !== null && project?.gallery && project.gallery.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveImageIndex((prev) => (prev !== null ? (prev + 1) % project.gallery.length : 0));
              }}
              style={{
                position: 'absolute',
                right: '25px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(20, 20, 26, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                transition: 'all 0.2s ease'
              }}
              title="Siguiente (Flecha Derecha)"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          )}
        </div>
      )}
    </div>,
    document.body
  ) : null;
};
