import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import SkinViewer3D from './SkinViewer3D';
import CapeViewer3D from './CapeViewer3D';
import './SkinsWorkspace.css';

interface MicrosoftData {
  uuid: string;
  name: string;
  access_token: string;
  refresh_token: string;
}

interface SkinAccount {
  provider: 'microsoft' | 'discord' | 'google' | 'offline';
  displayName: string;
  microsoftData?: MicrosoftData;
}

interface MinecraftProfile {
  id?: string;
  name?: string;
  skins?: Array<{ id: string; state: string; variant?: string; url: string }>;
  capes?: Array<{ id: string; state: string; alias?: string; url: string }>;
}

interface SavedSkin {
  id: string;
  name: string;
  url: string;
  model: 'classic' | 'slim';
}

interface LookupSkin {
  username: string;
  skinUrl: string | null;
  model: 'classic' | 'slim';
}

interface SkinsWorkspaceProps {
  account: SkinAccount;
  isNative: boolean;
  onMicrosoftDataChange: (data: MicrosoftData) => void;
}

const MICROSOFT_CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb';
const COOLDOWN_MS = 30_000;

function keyPart(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function getFileName(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.png$/i, '') || 'Nueva skin';
}

function isRemoteUrl(url: string) {
  return /^(https?:|data:|blob:)/i.test(url);
}

function previewUrl(url: string, isNative: boolean) {
  if (/^https?:\/\//i.test(url)) return url.replace(/^http:\/\//i, 'https://');
  if (!isRemoteUrl(url) && isNative) return convertFileSrc(url);
  return url;
}

function SkinGlyph({ name, size = 16 }: { name: 'skin' | 'cape' | 'search' | 'refresh' | 'upload' | 'check' | 'trash'; size?: number }) {
  const paths = {
    skin: <><path d="M9 3h6v3l3 2v13H6V8l3-2V3Z" /><path d="M9 9v5h6V9M9 17h.01M15 17h.01" /></>,
    cape: <><path d="M7 4 12 7l5-3 2 16H5L7 4Z" /><path d="m7 8 5 3 5-3M12 11v9" /></>,
    search: <><circle cx="10.7" cy="10.7" r="6.7" /><path d="m16 16 4.5 4.5" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7.5 7.5 0 0 1 18 6.5L20 9M4 15l2 2.5A7.5 7.5 0 0 0 18.5 15" /></>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M5 14v5h14v-5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function SkinsWorkspace({ account, isNative, onMicrosoftDataChange }: SkinsWorkspaceProps) {
  const scope = account.microsoftData?.uuid || keyPart(account.displayName || account.provider);
  const profileKey = `navithlabs.minecraft-profile.v1.${scope}`;
  const libraryKey = `navithlabs.skin-library.v1.${scope}`;
  const variantKey = `navithlabs.skin-variant.v1.${scope}`;
  const cooldownKey = `navithlabs.skin-last-change.v1.${scope}`;
  const offlineSkinKey = `navithlabs.public-skin.v1.${keyPart(account.displayName)}`;

  const [profile, setProfile] = useState<MinecraftProfile | null>(() => readJson<MinecraftProfile | null>(profileKey, null));
  const [library, setLibrary] = useState<SavedSkin[]>(() => readJson<SavedSkin[]>(libraryKey, []));
  const [offlineSkin, setOfflineSkin] = useState<LookupSkin | null>(() => readJson<LookupSkin | null>(offlineSkinKey, null));
  const [skinVariant, setSkinVariant] = useState<'classic' | 'slim'>(() => {
    const saved = localStorage.getItem(variantKey);
    if (saved === 'classic' || saved === 'slim') return saved;
    const active = readJson<MinecraftProfile | null>(profileKey, null)?.skins?.find(skin => skin.state === 'ACTIVE');
    return active?.variant === 'SLIM' ? 'slim' : 'classic';
  });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [skinTab, setSkinTab] = useState<'skins' | 'capes'>('skins');
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [query, setQuery] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [saveDialog, setSaveDialog] = useState<{ url: string; model: 'classic' | 'slim'; id?: string } | null>(null);
  const [saveName, setSaveName] = useState('');
  const [lightboxSkin, setLightboxSkin] = useState<SavedSkin | null>(null);
  const [searchResult, setSearchResult] = useState<LookupSkin | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveBrowserFileToCollection = useRef(false);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const lastSkinChange = useRef(Number(localStorage.getItem(cooldownKey)) || 0);
  const accountRef = useRef(account);
  const updateAccountRef = useRef(onMicrosoftDataChange);
  accountRef.current = account;
  updateAccountRef.current = onMicrosoftDataChange;

  const activeSkin = profile?.skins?.find(skin => skin.state === 'ACTIVE');
  const activeCape = profile?.capes?.find(cape => cape.state === 'ACTIVE');
  const currentSkinUrl = selectedFile
    ? previewUrl(selectedFile, isNative)
    : activeSkin?.url || offlineSkin?.skinUrl || '';
  const currentCapeUrl = activeCape?.url || '';
  const visibleLibrary = useMemo(() => library.filter(skin => skin.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [library, query]);
  const hasMinecraftAccount = account.provider === 'microsoft' && !!account.microsoftData?.access_token;

  const notify = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    setFeedback({ type, text });
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 5200);
  }, []);

  const invokeWithMicrosoft = useCallback(async <T,>(command: string, payload: Record<string, unknown> = {}): Promise<T> => {
    const credentials = accountRef.current.microsoftData;
    if (!credentials?.access_token) throw new Error('Inicia sesión con Microsoft para cambiar aspectos o capas.');
    try {
      return await invoke<T>(command, { ...payload, token: credentials.access_token });
    } catch (firstError) {
      const message = String(firstError);
      const expired = /401|unauthori[sz]ed|invalid.?token|token.?expired/i.test(message);
      if (!expired || !credentials.refresh_token) throw firstError;

      const refreshed = await invoke<MicrosoftData>('refresh_microsoft_token', {
        clientId: MICROSOFT_CLIENT_ID,
        refreshToken: credentials.refresh_token,
      });
      accountRef.current = { ...accountRef.current, displayName: refreshed.name, microsoftData: refreshed };
      updateAccountRef.current(refreshed);
      return invoke<T>(command, { ...payload, token: refreshed.access_token });
    }
  }, []);

  const storeProfile = useCallback((next: MinecraftProfile) => {
    setProfile(next);
    localStorage.setItem(profileKey, JSON.stringify(next));
    const model = next.skins?.find(skin => skin.state === 'ACTIVE')?.variant === 'SLIM' ? 'slim' : 'classic';
    setSkinVariant(model);
    localStorage.setItem(variantKey, model);
  }, [profileKey, variantKey]);

  const syncProfile = useCallback(async (showMessage = true) => {
    if (!hasMinecraftAccount) {
      if (showMessage) notify('info', 'Conecta una cuenta Microsoft con Minecraft Java para sincronizar el perfil.');
      return;
    }
    setIsSyncing(true);
    try {
      const next = await invokeWithMicrosoft<MinecraftProfile>('get_minecraft_profile');
      storeProfile(next);
      if (showMessage) notify('success', 'Perfil de Minecraft sincronizado con Mojang.');
    } catch (error) {
      if (showMessage) notify('error', `No se pudo sincronizar el perfil: ${String(error).replace(/^Error:\s*/i, '')}`);
    } finally {
      setIsSyncing(false);
    }
  }, [hasMinecraftAccount, invokeWithMicrosoft, notify, storeProfile]);

  useEffect(() => {
    setProfile(readJson<MinecraftProfile | null>(profileKey, null));
    setLibrary(readJson<SavedSkin[]>(libraryKey, []));
    setOfflineSkin(readJson<LookupSkin | null>(offlineSkinKey, null));
    const savedVariant = localStorage.getItem(variantKey);
    setSkinVariant(savedVariant === 'slim' ? 'slim' : 'classic');

    let active = true;
    if (hasMinecraftAccount) {
      setLoadingProfile(true);
      void invokeWithMicrosoft<MinecraftProfile>('get_minecraft_profile').then(next => {
        if (active) storeProfile(next);
      }).catch(error => {
        if (active && !readJson<MinecraftProfile | null>(profileKey, null)) {
          notify('error', `No se pudo cargar tu perfil de Minecraft: ${String(error).replace(/^Error:\s*/i, '')}`);
        }
      }).finally(() => { if (active) setLoadingProfile(false); });
    } else {
      setLoadingProfile(false);
      const cached = readJson<LookupSkin | null>(offlineSkinKey, null);
      if (cached?.skinUrl) setOfflineSkin(cached);
      else if (account.displayName.trim()) {
        void invoke<LookupSkin>('lookup_minecraft_skin', { username: account.displayName.trim() }).then(next => {
          if (!active || !next.skinUrl) return;
          setOfflineSkin(next);
          setSkinVariant(next.model === 'slim' ? 'slim' : 'classic');
          localStorage.setItem(offlineSkinKey, JSON.stringify(next));
        }).catch(() => undefined);
      }
    }
    return () => { active = false; };
  }, [scope]);

  useEffect(() => () => {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightboxSkin(null);
        setSaveDialog(null);
        setSearchResult(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const persistLibrary = (next: SavedSkin[]) => {
    setLibrary(next);
    localStorage.setItem(libraryKey, JSON.stringify(next));
  };

  const saveToLibrary = (name: string, url: string, model: 'classic' | 'slim', id?: string) => {
    const cleanedName = name.trim() || 'Skin importada';
    const next = id
      ? library.map(item => item.id === id ? { ...item, name: cleanedName, url, model } : item)
      : [{ id: crypto.randomUUID(), name: cleanedName, url, model }, ...library];
    persistLibrary(next);
    setSaveDialog(null);
    setSaveName('');
  };

  const chooseSkinFile = async (saveToCollection = false) => {
    if (isNative) {
      try {
        const path = await open({ title: 'Elige una skin PNG de Minecraft', multiple: false, filters: [{ name: 'Skin de Minecraft', extensions: ['png'] }] });
        if (typeof path !== 'string') return;
        setSelectedFile(path);
        if (saveToCollection) {
          persistLibrary([{ id: crypto.randomUUID(), name: getFileName(path), url: path, model: skinVariant }, ...library]);
          notify('success', 'PNG añadido a tu biblioteca de skins.');
        }
      } catch (error) { notify('error', `No se pudo abrir el archivo: ${String(error)}`); }
      return;
    }
    saveBrowserFileToCollection.current = saveToCollection;
    fileInput.current?.click();
  };

  const handleBrowserFile = (event: ChangeEvent<HTMLInputElement>, saveToCollection: boolean) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setSelectedFile(dataUrl);
      if (saveToCollection) {
        persistLibrary([{ id: crypto.randomUUID(), name: getFileName(file.name), url: dataUrl, model: skinVariant }, ...library]);
        notify('success', 'PNG añadido a tu biblioteca de skins.');
      }
    };
    reader.readAsDataURL(file);
  };

  const importPlayerSkin = async (event?: FormEvent) => {
    event?.preventDefault();
    const name = playerName.trim();
    if (!name || isWorking) return;
    setSearchResult(null);
    setIsWorking(true);
    try {
      const result = await invoke<LookupSkin>('lookup_minecraft_skin', { username: name });
      if (!result.skinUrl) throw new Error('PROFILE_NO_SKIN');
      setSearchResult({ ...result, username: result.username || name, model: result.model === 'slim' ? 'slim' : 'classic' });
    } catch (error) {
      const reason = String(error);
      const message = reason.includes('PLAYER_NOT_FOUND') ? `No encontramos a ${name}. Revisa el nombre de Minecraft.`
        : reason.includes('PROFILE_NO_SKIN') ? `${name} no tiene una skin pública disponible.`
          : reason.includes('INVALID_USERNAME') ? 'Usa un nickname de Minecraft de hasta 16 letras, números o guion bajo.'
            : 'No se pudo consultar el perfil. Revisa tu conexión e inténtalo de nuevo.';
      notify('error', message);
    } finally { setIsWorking(false); }
  };

  const saveSearchResult = () => {
    if (!searchResult?.skinUrl) return;
    saveToLibrary(`Skin de ${searchResult.username}`, searchResult.skinUrl, searchResult.model);
    setPlayerName('');
    setSearchResult(null);
    notify('success', `La skin de ${searchResult.username} se añadió a tu biblioteca.`);
  };

  const ensureCooldown = () => {
    const remainingMs = COOLDOWN_MS - (Date.now() - lastSkinChange.current);
    if (remainingMs <= 0) return true;
    notify('info', `Microsoft limita los cambios de skin. Espera ${Math.ceil(remainingMs / 1000)} s antes de intentarlo otra vez.`);
    return false;
  };

  const rememberSkinChange = () => {
    lastSkinChange.current = Date.now();
    localStorage.setItem(cooldownKey, String(lastSkinChange.current));
  };

  const applySkin = async (skin?: SavedSkin) => {
    if (!hasMinecraftAccount || !isNative) {
      notify('info', 'Para aplicar skins necesitas abrir el launcher de escritorio e iniciar sesión con Microsoft.');
      return;
    }
    if (!ensureCooldown()) return;
    const url = skin?.url || selectedFile;
    const model = skin?.model || skinVariant;
    if (!url) return;
    setIsWorking(true);
    try {
      if (/^https?:\/\//i.test(url)) {
        await invokeWithMicrosoft('set_minecraft_skin_url', { url: url.replace(/^http:\/\//i, 'https://'), variant: model });
      } else if (!url.startsWith('data:') && !url.startsWith('blob:')) {
        await invokeWithMicrosoft('upload_minecraft_skin', { filePath: url, variant: model });
      } else {
        throw new Error('Vuelve a elegir el PNG desde el launcher para poder subirlo a Minecraft.');
      }
      setSkinVariant(model);
      localStorage.setItem(variantKey, model);
      setSelectedFile(null);
      const next = await invokeWithMicrosoft<MinecraftProfile>('get_minecraft_profile');
      storeProfile(next);
      rememberSkinChange();
      notify('success', 'La skin se aplicó a tu perfil de Minecraft.');
    } catch (error) { notify('error', `No se pudo aplicar la skin: ${String(error).replace(/^Error:\s*/i, '')}`); }
    finally { setIsWorking(false); }
  };

  const setCape = async (capeId?: string) => {
    if (!hasMinecraftAccount || !isNative) {
      notify('info', 'Para cambiar capas necesitas iniciar sesión con Microsoft en el launcher de escritorio.');
      return;
    }
    setIsWorking(true);
    try {
      if (capeId) await invokeWithMicrosoft('set_minecraft_cape', { capeId });
      else await invokeWithMicrosoft('hide_minecraft_cape');
      storeProfile(await invokeWithMicrosoft<MinecraftProfile>('get_minecraft_profile'));
      notify('success', capeId ? 'Capa equipada en tu perfil.' : 'Capa retirada de tu perfil.');
    } catch (error) { notify('error', `No se pudo actualizar la capa: ${String(error).replace(/^Error:\s*/i, '')}`); }
    finally { setIsWorking(false); }
  };

  const handleSaveDialog = (event: FormEvent) => {
    event.preventDefault();
    if (!saveDialog) return;
    saveToLibrary(saveName, saveDialog.url, saveDialog.model, saveDialog.id);
    notify('success', saveDialog.id ? 'La skin guardada se actualizó.' : 'Skin guardada en tu biblioteca.');
  };

  const openSaveDialog = (skin: SavedSkin) => {
    setSaveDialog({ url: skin.url, model: skin.model, id: skin.id });
    setSaveName(skin.name);
  };

  const removeFromLibrary = (id: string) => {
    persistLibrary(library.filter(item => item.id !== id));
    setLightboxSkin(current => current?.id === id ? null : current);
    notify('success', 'Skin eliminada de tu biblioteca local.');
  };

  const activeCapeLabel = activeCape?.alias?.replace(/_cape$/i, '').replace(/[-_]/g, ' ') || 'Capa activa';

  return <section className="skins-workspace">
    <input ref={fileInput} className="skin-file-input" type="file" accept="image/png,.png" onChange={event => {
      handleBrowserFile(event, saveBrowserFileToCollection.current);
      saveBrowserFileToCollection.current = false;
    }} />
    <header className="skins-page-heading">
      <div>
        <div className="skins-eyebrow"><span /> PERSONALIZACIÓN <i>/</i> PERFIL DE MINECRAFT</div>
        <h1>Aspectos & Capas.<br /></h1>
        <p>Administra tus aspectos y capas oficiales desde un solo lugar.</p>
      </div>
      <div className="skin-profile-stamp"><span>PERFIL ACTIVO</span><b>{profile?.name || account.displayName}</b><small>{hasMinecraftAccount ? 'MICROSOFT · JAVA EDITION' : `${account.provider.toUpperCase()} · VISTA PÚBLICA`}</small></div>
    </header>

    {feedback && <div className={`skins-feedback is-${feedback.type}`} role="status"><span>{feedback.type === 'success' ? '✓' : feedback.type === 'error' ? '!' : 'i'}</span>{feedback.text}<button type="button" onClick={() => setFeedback(null)} aria-label="Cerrar aviso">×</button></div>}

    <div className="skins-toolbar">
      <div className="skins-tab-list" role="tablist" aria-label="Aspectos y capas">
        <button type="button" role="tab" aria-selected={skinTab === 'skins'} className={skinTab === 'skins' ? 'is-active' : ''} onClick={() => setSkinTab('skins')}><SkinGlyph name="skin" /> Skins <span>{String(library.length).padStart(2, '0')}</span></button>
        <button type="button" role="tab" aria-selected={skinTab === 'capes'} className={skinTab === 'capes' ? 'is-active' : ''} onClick={() => setSkinTab('capes')}><SkinGlyph name="cape" /> Capas <span>{String(profile?.capes?.length || 0).padStart(2, '0')}</span></button>
      </div>
      {hasMinecraftAccount && <button className="skin-sync-button" type="button" onClick={() => void syncProfile(true)} disabled={isSyncing || loadingProfile}><SkinGlyph name="refresh" />{isSyncing || loadingProfile ? 'SINCRONIZANDO' : 'SINCRONIZAR MOJANG'}</button>}
    </div>

    {skinTab === 'skins' ? <div className="skins-layout">
      <article className="skin-current-card">
        <div className="skin-card-heading"><div><span className="skins-micro-label">VISTA DE PERSONAJE</span><h2>{selectedFile ? 'Nueva skin' : activeSkin ? 'Skin activa' : 'Vista previa'}</h2></div><span className={`skin-state-pill ${hasMinecraftAccount ? 'is-online' : ''}`}><i />{hasMinecraftAccount ? loadingProfile ? 'SINCRONIZANDO' : 'PERFIL JAVA' : 'LECTURA PÚBLICA'}</span></div>
        <div className="skin-render-stage">
          <div className="skin-render-orbit skin-render-orbit-a" /><div className="skin-render-orbit skin-render-orbit-b" />
          {currentSkinUrl ? <SkinViewer3D skinUrl={currentSkinUrl} capeUrl={currentCapeUrl || undefined} model={skinVariant} width={300} height={350} animation="idle" autoRotate outerLayer /> : <div className="skin-preview-placeholder"><SkinGlyph name="skin" size={38} /><span>{loadingProfile ? 'Consultando perfil…' : 'Elige una skin PNG o busca un jugador'}</span></div>}
          {currentCapeUrl && <span className="skin-cape-tag"><SkinGlyph name="cape" size={12} /> {activeCapeLabel}</span>}
        </div>
        <div className="skin-model-switch" role="group" aria-label="Modelo de brazo">
          <span>MODELO</span>
          <button type="button" className={skinVariant === 'classic' ? 'is-selected' : ''} onClick={() => { setSkinVariant('classic'); localStorage.setItem(variantKey, 'classic'); }}>CLÁSICO <small>4 PX</small></button>
          <button type="button" className={skinVariant === 'slim' ? 'is-selected' : ''} onClick={() => { setSkinVariant('slim'); localStorage.setItem(variantKey, 'slim'); }}>DELGADO <small>3 PX</small></button>
        </div>
        <div className="skin-preview-actions">
          <button className="skin-secondary-button" type="button" onClick={() => void chooseSkinFile()}><SkinGlyph name="upload" /> ELEGIR PNG</button>
          {selectedFile ? <>
            <button className="skin-primary-button" type="button" disabled={isWorking} onClick={() => void applySkin()}>{isWorking ? 'APLICANDO…' : hasMinecraftAccount ? 'APLICAR EN MINECRAFT' : 'REQUIERE MICROSOFT'}</button>
            <button className="skin-icon-button" type="button" title="Guardar en biblioteca" onClick={() => { setSaveDialog({ url: selectedFile, model: skinVariant }); setSaveName(getFileName(selectedFile)); }}><SkinGlyph name="check" /></button>
          </> : currentSkinUrl && <button className="skin-secondary-button skin-save-current" type="button" onClick={() => { setSaveDialog({ url: activeSkin?.url || offlineSkin?.skinUrl || '', model: skinVariant }); setSaveName('Mi skin actual'); }}>GUARDAR ACTUAL</button>}
        </div>
        {!hasMinecraftAccount && <div className="skin-readonly-note"><span>i</span> Puedes explorar y guardar skins. Para sincronizarlas con Mojang, inicia sesión con Microsoft y Minecraft Java.</div>}
      </article>

      <section className="skin-library-panel">
        <div className="skin-library-heading"><div><span className="skins-micro-label">COLECCIÓN LOCAL</span><h2>Biblioteca de skins</h2><p>Guarda PNG o importa un aspecto público por nickname.</p></div><span className="skin-library-total">{String(library.length).padStart(2, '0')}</span></div>
        <form className="skin-player-import" onSubmit={event => void importPlayerSkin(event)}>
          <label htmlFor="skin-player-name">IMPORTAR PERFIL PÚBLICO</label>
          <div><input id="skin-player-name" value={playerName} onChange={event => setPlayerName(event.target.value)} placeholder="Nombre de Minecraft" maxLength={16} autoComplete="off" /><button type="submit" disabled={isWorking || !playerName.trim()}><SkinGlyph name="search" />{isWorking ? 'BUSCANDO' : 'IMPORTAR'}</button></div>
        </form>
        <div className="skin-library-controls">
          <label className="skin-library-search"><SkinGlyph name="search" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar en tu biblioteca" /></label>
          <button className="skin-add-button" type="button" onClick={() => void chooseSkinFile(true)}><SkinGlyph name="upload" /> AÑADIR PNG</button>
        </div>
        {library.length === 0 ? <div className="skin-library-empty"><div><SkinGlyph name="skin" size={27} /></div><span className="skins-micro-label">TU COLECCIÓN PERSONAL</span><h3>Aún no guardas skins</h3><p>Importa una PNG o busca el nickname de otro jugador para empezar tu colección.</p><button type="button" onClick={() => void chooseSkinFile(true)}>AÑADIR PRIMERA SKIN</button></div>
          : visibleLibrary.length ? <div className="skin-library-grid">{visibleLibrary.map((skin, index) => <article className="skin-library-card" key={skin.id} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
            <button type="button" className="skin-library-preview" aria-label={`Previsualizar ${skin.name}`} onClick={() => setLightboxSkin(skin)}><SkinViewer3D skinUrl={previewUrl(skin.url, isNative)} model={skin.model} width={126} height={158} isStatic autoRotate={false} /></button>
            <div className="skin-library-card-copy"><b title={skin.name}>{skin.name}</b><span>{skin.model === 'slim' ? 'DELGADO' : 'CLÁSICO'} · {skin.url.startsWith('http') ? 'ONLINE' : 'LOCAL'}</span></div>
            <div className="skin-library-card-actions"><button type="button" onClick={() => void applySkin(skin)} disabled={isWorking || !hasMinecraftAccount} title={hasMinecraftAccount ? 'Aplicar a Minecraft' : 'Requiere cuenta Microsoft'}>EQUIPAR</button><button type="button" onClick={() => openSaveDialog(skin)} title="Cambiar nombre"><SkinGlyph name="skin" size={14} /></button><button type="button" onClick={() => removeFromLibrary(skin.id)} title="Eliminar de la biblioteca"><SkinGlyph name="trash" size={14} /></button></div>
          </article>)}</div> : <div className="skin-library-empty skin-search-empty"><h3>No hay coincidencias</h3><p>Prueba otro nombre o limpia la búsqueda.</p><button type="button" onClick={() => setQuery('')}>LIMPIAR BÚSQUEDA</button></div>}
      </section>
    </div> : <section className="cape-workspace">
      <header className="cape-workspace-heading"><div><span className="skins-micro-label">INVENTARIO DE MOJANG</span><h2>Capas oficiales</h2><p>Previsualiza, equipa o retira las capas vinculadas a tu cuenta de Minecraft.</p></div><span className="cape-count">{String(profile?.capes?.length || 0).padStart(2, '0')} <small>CAPAS</small></span></header>
      {!hasMinecraftAccount ? <div className="cape-empty-state"><SkinGlyph name="cape" size={34} /><h3>Vincula una cuenta Microsoft</h3><p>Las capas oficiales se sincronizan directamente con el perfil de Minecraft Java.</p></div>
        : loadingProfile || isSyncing ? <div className="cape-empty-state is-loading"><span className="skin-loader" /><h3>Sincronizando tu colección</h3><p>Estamos consultando las capas vinculadas a tu perfil de Minecraft.</p></div>
          : profile?.capes?.length ? <div className="cape-grid">{profile.capes.map((cape, index) => {
            const equipped = cape.state === 'ACTIVE';
            const label = (cape.alias || 'Capa de Minecraft').replace(/_cape$/i, '').replace(/[-_]/g, ' ');
            return <article className={`cape-card ${equipped ? 'is-equipped' : ''}`} key={cape.id} style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
              <div className="cape-card-meta"><span>MOJANG / {String(index + 1).padStart(2, '0')}</span><span className={equipped ? 'is-equipped' : ''}><i />{equipped ? 'EQUIPADA' : 'EN COLECCIÓN'}</span></div>
              <div className="cape-preview"><CapeViewer3D capeUrl={cape.url.replace(/^http:\/\//i, 'https://')} width={150} height={180} /></div>
              <div className="cape-card-info"><h3>{label}</h3><p>{equipped ? 'Visible en tu personaje.' : 'Disponible para equipar en tu perfil.'}</p></div>
              <button className={equipped ? 'skin-secondary-button' : 'skin-primary-button'} type="button" onClick={() => void setCape(equipped ? undefined : cape.id)} disabled={isWorking}>{isWorking ? 'ACTUALIZANDO…' : equipped ? 'QUITAR CAPA' : 'EQUIPAR CAPA'}</button>
            </article>;
          })}</div> : <div className="cape-empty-state"><SkinGlyph name="cape" size={34} /><h3>No tienes capas disponibles</h3><p>Cuando Mojang vincule una capa con tu cuenta aparecerá aquí.</p><button className="skin-secondary-button" type="button" onClick={() => void syncProfile(true)}>VOLVER A SINCRONIZAR</button></div>}
    </section>}

    {saveDialog && createPortal(<div className="skin-modal-backdrop skin-global-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSaveDialog(null); }}><form className="skin-save-modal" role="dialog" aria-modal="true" aria-labelledby="skin-save-title" onSubmit={handleSaveDialog}>
      <div className="skin-modal-top"><span className="skins-micro-label">BIBLIOTECA LOCAL</span><button type="button" onClick={() => setSaveDialog(null)} aria-label="Cerrar">×</button></div>
      <h2 id="skin-save-title">Guardar <em>skin.</em></h2><p>Revisa el aspecto y asígnale un nombre antes de guardarlo.</p>
      <div className="skin-save-preview"><div className="skin-save-preview-stage"><SkinViewer3D skinUrl={previewUrl(saveDialog.url, isNative)} model={saveDialog.model} width={132} height={166} isStatic autoRotate={false} /></div><div className="skin-save-preview-copy"><span>VISTA PREVIA</span><b>{saveName || 'Nueva skin'}</b><small>MODELO {saveDialog.model === 'slim' ? 'DELGADO · 3 PX' : 'CLÁSICO · 4 PX'}</small></div></div>
      <label htmlFor="saved-skin-name">NOMBRE DE LA SKIN</label><input id="saved-skin-name" value={saveName} onChange={event => setSaveName(event.target.value)} maxLength={40} autoFocus />
      <div className="skin-modal-actions"><button type="button" className="skin-secondary-button" onClick={() => setSaveDialog(null)}>CANCELAR</button><button type="submit" className="skin-primary-button" disabled={!saveName.trim()}>GUARDAR SKIN</button></div>
    </form></div>, document.body)}

    {searchResult && createPortal(<div className="skin-modal-backdrop skin-global-backdrop skin-search-result-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSearchResult(null); }}><section className="skin-search-result-modal" role="dialog" aria-modal="true" aria-labelledby="skin-search-result-title">
      <button type="button" className="skin-search-result-close" aria-label="Cerrar" onClick={() => setSearchResult(null)}>×</button>
      <div className="skin-search-result-stage"><div className="skin-result-orbit skin-result-orbit-a" /><div className="skin-result-orbit skin-result-orbit-b" /><SkinViewer3D skinUrl={previewUrl(searchResult.skinUrl || '', isNative)} model={searchResult.model} width={220} height={290} animation="idle" autoRotate /></div>
      <div className="skin-search-result-copy"><span className="skins-micro-label">RESULTADO DE MOJANG</span><h2 id="skin-search-result-title">Skin encontrada<em>.</em></h2><p>Esta es la skin pública de <b>{searchResult.username}</b>. Revísala antes de guardarla en tu biblioteca.</p><div className="skin-result-details"><span>MODELO</span><b>{searchResult.model === 'slim' ? 'Delgado · 3 px' : 'Clásico · 4 px'}</b></div><div className="skin-search-result-actions"><button type="button" className="skin-secondary-button" onClick={() => setSearchResult(null)}>CANCELAR</button><button type="button" className="skin-primary-button" onClick={saveSearchResult}><SkinGlyph name="check" /> GUARDAR EN BIBLIOTECA</button></div></div>
    </section></div>, document.body)}

    {lightboxSkin && createPortal(<div className="skin-modal-backdrop skin-lightbox-backdrop skin-global-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setLightboxSkin(null); }}><section className="skin-lightbox" role="dialog" aria-modal="true" aria-label={`Vista de ${lightboxSkin.name}`}>
      <button type="button" className="skin-lightbox-close" aria-label="Cerrar" onClick={() => setLightboxSkin(null)}>×</button><span className="skins-micro-label">VISTA DE SKIN</span><h2>{lightboxSkin.name}</h2><SkinViewer3D skinUrl={previewUrl(lightboxSkin.url, isNative)} model={lightboxSkin.model} width={250} height={330} animation="idle" autoRotate />
    </section></div>, document.body)}
  </section>;
}
