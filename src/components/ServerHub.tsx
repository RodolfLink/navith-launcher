import { useState, type CSSProperties } from 'react';
import './ServerHub.css';

export interface CommunityServer {
  id: string | number;
  name: string;
  subtitle?: string | null;
  description?: string | null;
  menu_background?: string | null;
  banner_url?: string | null;
  image_url?: string | null;
  minecraft_version?: string | null;
  loader?: string | null;
  server_ip?: string | null;
  music_url?: string | null;
}
type CatalogFilter = 'all' | 'installed' | 'available';
type CatalogSort = 'catalog' | 'name' | 'installed';
type HubIconName = 'arrow' | 'back' | 'search' | 'key' | 'world' | 'check' | 'music' | 'download' | 'play' | 'settings' | 'copy' | 'close';
const iconPaths: Record<HubIconName, string> = {
  arrow: 'M5 12h14m-6-6 6 6-6 6', back: 'M19 12H5m6-6-6 6 6 6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  key: 'M14 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8M10 13l-7 7m0 0v-4m0 4h4',
  world: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  check: 'm5 12 4 4L19 6', music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3h3m12 1a3 3 0 1 1-3-3h3',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4', play: 'm8 5 11 7-11 7V5',
  settings: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  copy: 'M9 9h12v12H9zM15 5V2H2v13h3', close: 'm6 6 12 12M6 18 18 6',
};
function HubIcon({ name }: { name: HubIconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>;
}
function ServerArtwork({ server, resolveImage }: { server: CommunityServer; resolveImage: (path: string) => string | null }) {
  const source = server.banner_url || server.menu_background || server.image_url;
  const url = source ? resolveImage(source) : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className="hub-artwork" aria-hidden="true">
    <span className="hub-artwork-grid" /><span className="hub-artwork-emblem">{server.name?.trim().slice(0, 2).toLocaleUpperCase() || 'MC'}</span>
    {url && failedUrl !== url && <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} />}
  </span>;
}
function ServerTags({ server }: { server: CommunityServer }) {
  return <span className="hub-tags"><span>{server.minecraft_version || '1.20.1'}</span><span>{server.loader || 'Fabric'}</span>{server.music_url && <span><HubIcon name="music" /> Banda sonora</span>}</span>;
}

interface ServerDirectoryProps {
  servers: CommunityServer[];
  installations: { id: string }[];
  downloads: { id: string; status: string }[];
  accent: string;
  loading: boolean;
  search: string;
  filter: CatalogFilter;
  sort: CatalogSort;
  initialFeaturedId?: string | number;
  onSearch: (value: string) => void;
  onFilter: (filter: CatalogFilter) => void;
  onSort: (sort: CatalogSort) => void;
  onOpen: (server: CommunityServer, origin: HTMLElement) => void;
  onRedeem: () => void;
  resolveImage: (path: string) => string | null;
}

export function ServerDirectory({ servers, installations, downloads, accent, loading, search, filter, sort, initialFeaturedId, onSearch, onFilter, onSort, onOpen, onRedeem, resolveImage }: ServerDirectoryProps) {
  const [featuredId, setFeaturedId] = useState<string | number | null>(initialFeaturedId ?? null);
  const installedIds = new Set(installations.map(item => item.id));
  const installed = (server: CommunityServer) => installedIds.has(`server_${server.id}`);
  const installing = (server: CommunityServer) => downloads.some(task => (task.id === `server-${server.id}` || task.id.startsWith(`server-${server.id}-`)) && ['downloading', 'installing'].includes(task.status));
  const library = servers.filter(installed);
  const query = search.trim().toLocaleLowerCase();
  const visible = servers.filter(server =>
    (filter === 'all' || (filter === 'installed' ? installed(server) : !installed(server))) &&
    (!query || [server.name, server.description, server.minecraft_version, server.loader, server.server_ip].filter(Boolean).join(' ').toLocaleLowerCase().includes(query))
  );
  if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }));
  if (sort === 'installed') visible.sort((a, b) => Number(installed(b)) - Number(installed(a)));
  const featured = servers.find(server => server.id === featuredId) || servers[0];
  const showShowcase = Boolean(featured) && !query && filter === 'all';
  const showGrid = visible.length > 0 && (!showShowcase || servers.length > 1);
  const counts = { all: servers.length, installed: library.length, available: servers.length - library.length };
  const openEntry = (server: CommunityServer, button: HTMLButtonElement) => onOpen(server, button.closest<HTMLElement>('[data-server-entry]') || button);

  return <section className="server-hub" style={{ '--server-accent': accent } as CSSProperties}>
    <header className="view-header-unified hub-heading">
      <div className="view-header-left"><h1 className="view-header-title">Servidores <span className="hub-count">{servers.length}</span></h1><p className="view-header-subtitle">Encuentra tu próximo mundo. Compártelo con la comunidad.</p></div>
      <button className="hub-button hub-button-secondary" type="button" onClick={onRedeem}><HubIcon name="key" /> Canjear código</button>
    </header>

    {showShowcase && <div className={`hub-showcase${servers.length === 1 ? ' is-single' : ''}`}>
      <article className="hub-feature" data-server-entry key={featured.id}>
        <ServerArtwork server={featured} resolveImage={resolveImage} />
        <div className="hub-feature-shade" />
        <div className="hub-feature-top"><span className="hub-eyebrow"><span /> EXPLORA LA COMUNIDAD</span><span className="hub-feature-number">{String(servers.indexOf(featured) + 1).padStart(2, '0')} <small>/ {String(servers.length).padStart(2, '0')}</small></span></div>
        <div className="hub-feature-copy">
          <ServerTags server={featured} /><h2>{featured.name}</h2>
          {featured.subtitle && <p className="hub-feature-subtitle">{featured.subtitle}</p>}
          <p>{featured.description || 'Un nuevo lugar para construir, explorar y compartir tu próxima aventura.'}</p>
          <button className="hub-button hub-button-primary" type="button" onClick={event => openEntry(featured, event.currentTarget)}>Explorar servidor <HubIcon name="arrow" /></button>
        </div>
        {servers.length > 1 && <div className="hub-feature-selector" role="group" aria-label="Servidor protagonista">{servers.map((server, index) => <button key={server.id} type="button" aria-label={`Mostrar ${server.name}`} aria-pressed={server.id === featured.id} onClick={() => setFeaturedId(server.id)}>{String(index + 1).padStart(2, '0')}</button>)}</div>}
      </article>
      <aside className="hub-library">
        <div className="hub-section-label"><HubIcon name="world" /><span>TU BIBLIOTECA</span><b>{library.length}</b></div>
        {library.length ? <>
          <h2>Vuelve a tu mundo.</h2><p>Tus servidores instalados, a un paso de la siguiente partida.</p>
          <div className="hub-library-list">{library.slice(0, 3).map(server => <button type="button" key={server.id} onClick={event => onOpen(server, event.currentTarget)}>
            <span className="hub-library-cover"><ServerArtwork server={server} resolveImage={resolveImage} /></span>
            <span><strong>{server.name}</strong><small>{server.minecraft_version || '1.20.1'} · {server.loader || 'Fabric'}</small></span><HubIcon name="arrow" />
          </button>)}</div>
          <button className="hub-text-button" type="button" onClick={() => onFilter('installed')}>Ver mis servidores <HubIcon name="arrow" /></button>
        </> : <>
          <h2>Tu próxima aventura empieza aquí.</h2><p>Abre un servidor para conocer su mundo y preparar tu instancia.</p>
          <ol className="hub-guide"><li><span>01</span><div><strong>Descubre un mundo</strong><small>Conoce su propuesta y su versión.</small></div></li><li><span>02</span><div><strong>Prepara tu instancia</strong><small>Instala el contenido desde su ficha.</small></div></li><li><span>03</span><div><strong>Entra a jugar</strong><small>Todo tu acceso, en el mismo lugar.</small></div></li></ol>
        </>}
      </aside>
    </div>}

    {(!showShowcase || servers.length > 1) && <><div className="hub-catalog-header"><div><span className="hub-eyebrow">ELIGE TU DESTINO</span><h2>Explorar servidores</h2></div><span className="hub-results" role="status">{loading ? 'Actualizando catálogo…' : `${visible.length} ${visible.length === 1 ? 'servidor' : 'servidores'}`}</span></div>
    <div className="hub-toolbar">
      <div className="hub-filters" role="group" aria-label="Filtrar servidores">{([['all', 'Todos'], ['installed', 'Instalados'], ['available', 'Por instalar']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => onFilter(value)}>{label}<span>{counts[value]}</span></button>)}</div>
      <label className="hub-search"><HubIcon name="search" /><input value={search} onChange={event => onSearch(event.target.value)} aria-label="Buscar servidores" placeholder="Nombre, versión o loader…" />{search && <button type="button" aria-label="Limpiar búsqueda" onClick={() => onSearch('')}><HubIcon name="close" /></button>}</label>
      <label className="hub-sort"><span>Orden</span><select value={sort} onChange={event => onSort(event.target.value as CatalogSort)} aria-label="Ordenar servidores"><option value="catalog">Del catálogo</option><option value="name">Nombre A–Z</option><option value="installed">Instalados primero</option></select></label>
    </div></>}

    {loading && !servers.length ? <div className="hub-skeletons" role="status" aria-label="Cargando servidores">{[0, 1, 2].map(index => <div key={index}><span /><span /><span /></div>)}</div>
      : !visible.length ? <div className="hub-empty"><span className="hub-empty-icon"><HubIcon name={servers.length ? 'search' : 'world'} /></span><h2>{servers.length ? 'No hay coincidencias' : 'Los próximos mundos aparecerán aquí'}</h2><p>{servers.length ? 'Prueba otro nombre, versión o filtro para encontrar tu servidor.' : 'Si tienes una invitación, puedes canjear su código para acceder al servidor.'}</p><button className="hub-button hub-button-secondary" type="button" onClick={servers.length ? () => { onSearch(''); onFilter('all'); } : onRedeem}>{servers.length ? 'Limpiar filtros' : 'Canjear código'}<HubIcon name={servers.length ? 'search' : 'key'} /></button></div>
      : showGrid ? <div className="hub-grid">{visible.map((server, index) => <div className="hub-card-entry" key={server.id} style={{ '--entry-delay': `${Math.min(index, 8) * 55}ms` } as CSSProperties}>
        <button className="hub-card" data-server-entry type="button" onClick={event => onOpen(server, event.currentTarget)} aria-label={`Explorar ${server.name}`}>
          <span className="hub-card-media"><ServerArtwork server={server} resolveImage={resolveImage} /><span className={`hub-install-badge${installed(server) ? ' is-installed' : ''}`}><HubIcon name={installing(server) ? 'download' : installed(server) ? 'check' : 'world'} />{installing(server) ? 'En instalación' : installed(server) ? 'En tu biblioteca' : 'Por descubrir'}</span><span className="hub-card-arrow"><HubIcon name="arrow" /></span></span>
          <span className="hub-card-body"><strong>{server.name}</strong>{server.subtitle && <span className="hub-card-subtitle">{server.subtitle}</span>}<span className="hub-card-description">{server.description || 'Explora este servidor y descubre tu próxima aventura.'}</span><ServerTags server={server} /><span className="hub-card-footer">Explorar servidor<HubIcon name="arrow" /></span></span>
        </button>
      </div>)}</div> : null}
  </section>;
}

interface ServerOverviewProps {
  server: CommunityServer;
  accent: string;
  resolveImage: (path: string) => string | null;
  installed: boolean;
  hasUpdate: boolean;
  downloading: boolean;
  launching: boolean;
  maintenance: boolean;
  maintenanceMessage: string;
  progress: number;
  status: { online: boolean; players: number; maxPlayers: number; ping: number | null };
  copied: boolean;
  onCopy: () => void;
  onBack: () => void;
  onInstall: () => void;
  onSettings: () => void;
}

export function ServerOverview({ server, accent, resolveImage, installed, hasUpdate, downloading, launching, maintenance, maintenanceMessage, progress, status, copied, onCopy, onBack, onInstall, onSettings }: ServerOverviewProps) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const action = maintenance ? 'En mantenimiento' : downloading ? (installed ? 'Actualizando' : 'Instalando') : launching ? 'Iniciando Minecraft…' : installed ? (hasUpdate ? 'Actualizar instancia' : 'Jugar ahora') : 'Instalar servidor';
  return <section className={`server-scene${server.music_url ? ' has-soundtrack' : ''}`} style={{ '--server-accent': accent } as CSSProperties}>
    <ServerArtwork server={server} resolveImage={resolveImage} /><div className="server-scene-veil" />
    <div className="server-scene-scroll">
      <header className="server-scene-navigation"><button type="button" className="hub-button hub-button-secondary" onClick={onBack}><HubIcon name="back" /> Servidores</button><span className="hub-eyebrow"><HubIcon name="world" /> COMUNIDAD NAVITHLABS</span></header>
      <div className="server-scene-layout">
        <div className="server-scene-story">
          <span className="hub-eyebrow"><span /> TU SIGUIENTE DESTINO</span>
          <h1>{server.name}</h1>{server.subtitle && <p className="server-scene-subtitle">{server.subtitle}</p>}<ServerTags server={server} />
          <div className="server-scene-description" tabIndex={0} aria-label="Descripción del servidor">{server.description || 'Un mundo por descubrir. Prepara tu instancia y empieza una nueva aventura con la comunidad.'}</div>
          <div className="server-scene-connection"><span className={status.online ? 'hub-live-dot is-online' : 'hub-live-dot'} /><span>{status.online ? `${status.players} / ${status.maxPlayers} jugadores en línea` : 'Estado de conexión no disponible'}</span>{status.online && status.ping !== null && <b>{status.ping} ms</b>}</div>
        </div>
        <aside className="server-session">
          <div className="hub-section-label"><HubIcon name={installed ? 'check' : 'download'} /><span>TU INSTANCIA</span></div>
          <h2>{maintenance ? 'Volvemos pronto' : downloading ? 'Preparando tu mundo' : installed ? (hasUpdate ? 'Hay novedades' : 'Todo listo para volver') : 'Prepara tu aventura'}</h2>
          <p>{maintenance ? maintenanceMessage || 'El acceso está temporalmente en mantenimiento.' : downloading ? 'Puedes seguir explorando mientras termina la descarga.' : installed ? (hasUpdate ? 'Actualiza el contenido antes de entrar al servidor.' : 'Tu instancia está instalada. Entra al servidor desde aquí.') : 'Instala la versión y el contenido del servidor en una instancia propia.'}</p>
          <dl className="server-session-specs"><div><dt>Minecraft</dt><dd>{server.minecraft_version || '1.20.1'}</dd></div><div><dt>Loader</dt><dd>{server.loader || 'Fabric'}</dd></div></dl>
          {downloading && <div className="server-session-download"><div><span>{installed ? 'Actualización' : 'Instalación'} en curso</span><b>{Math.round(percent)}%</b></div><progress value={percent} max="100" aria-label="Progreso de instalación" /></div>}
          <div className="server-session-actions"><button type="button" className="hub-button hub-button-primary" onClick={onInstall} disabled={maintenance || downloading || launching}>{downloading || launching ? <span className="hub-spinner" /> : <HubIcon name={maintenance ? 'key' : installed && !hasUpdate ? 'play' : 'download'} />}{action}</button>{installed && <button type="button" className="hub-button hub-button-secondary server-session-settings" onClick={onSettings} disabled={downloading || launching} aria-label="Ajustes de la instancia" title="Ajustes de la instancia"><HubIcon name="settings" /></button>}</div>
          <div className="server-session-address"><span>Dirección del servidor</span><div><strong title={server.server_ip || undefined}>{server.server_ip || 'Dirección privada'}</strong>{server.server_ip && server.server_ip !== 'Oculto' && <button type="button" onClick={onCopy} aria-label={copied ? 'Dirección copiada' : 'Copiar dirección del servidor'} title={copied ? 'Copiado' : 'Copiar dirección'}><HubIcon name={copied ? 'check' : 'copy'} /></button>}</div><small role="status">{copied ? 'Dirección copiada al portapapeles' : 'La configuración se guarda en tu instancia.'}</small></div>
        </aside>
      </div>
    </div>
  </section>;
}
