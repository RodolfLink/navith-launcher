import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ScreenshotsGallery } from './components/ScreenshotsGallery';
import { SkinsWorkspace } from './components/SkinsWorkspace';
import { ServerMusicPlayer } from './components/ServerMusicPlayer';
import LegalModal from './components/LegalModal';
import { completeEventCleanups, createInvitedEvent, eventFolder, isFinalizedEvent, isFinalizedEventError, loadInvitedEvents, loadPendingEventCleanups, queueEventCleanups, redeemEventCode, refreshInvitedEvent, saveInvitedEvents, type InvitedEvent } from './services/eventCatalog';
import { LAUNCHER_API_BASE_URL } from './services/launcherApi';
import { fetchCommunityFeed, recordLauncherLaunch, sendLauncherHeartbeat, type CommunityFeed } from './services/launcherCommunity';
import './App.css';

type Provider = 'microsoft' | 'discord' | 'google' | 'offline';
type Loader = 'Vanilla' | 'Fabric' | 'Forge' | 'NeoForge' | 'Quilt';
type Page = 'home' | 'events' | 'skins' | 'screenshots' | 'settings';

interface Account {
  provider: Provider;
  displayName: string;
  microsoftData?: { uuid: string; name: string; access_token: string; refresh_token: string };
  discordData?: { id: string; username: string; global_name?: string; avatar?: string };
  googleData?: { id?: string; sub?: string; email?: string; name: string; given_name?: string; picture?: string };
}

const MICROSOFT_CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb';
const DISCORD_CLIENT_ID = '1499568005774839918';
const GOOGLE_CLIENT_ID = '1031178148980-8n11b64j8pt6656cp1tb668oipm3bkml.apps.googleusercontent.com';
const ACCOUNT_KEY = 'navithlabs.account.v1';
const RAM_KEY = 'navithlabs.ram.v1';
const GAME_DIRECTORY_KEY = 'navithlabs.game-directory.v1';
const MIN_RAM_KEY = 'navithlabs.min-ram-mib.v1';
const JAVA_PATH_KEY = 'navithlabs.java-path.v1';
const JVM_ARGUMENTS_KEY = 'navithlabs.jvm-arguments.v1';
const DISCORD_PRESENCE_KEY = 'navithlabs.discord-presence.v1';
const LEGAL_ACCEPTANCE_KEY = 'navithlabs.legal-acceptance.v1';
const LEGAL_TERMS_VERSION = '2026-10-23';
const DEFAULT_JVM = '-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=16M';
const AIKAR_JVM = '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1';
const ZGC_JVM = '-XX:SoftMaxHeapSize=6G -XX:+UseZGC -XX:AllocatePrefetchStyle=1 -XX:+ZGenerational -XX:+UnlockExperimentalVMOptions -XX:+UnlockDiagnosticVMOptions -XX:+AlwaysActAsServerClassMachine -XX:+AlwaysPreTouch -XX:+DisableExplicitGC -XX:NmethodSweepActivity=1 -XX:ReservedCodeCacheSize=400M -XX:NonNMethodCodeHeapSize=12M -XX:ProfiledCodeHeapSize=194M -XX:NonProfiledCodeHeapSize=194M -XX:-DontCompileHugeMethods -XX:+PerfDisableSharedMem -XX:+UseFastUnorderedTimeStamps -XX:+EagerJVMCI -Djdk.graal.CompilerConfiguration=enterprise -Djdk.graal.TuneInlinerExploration=1 -XX:+UseFastUnorderedTimeStamps -XX:+UseCriticalJavaThreadPriority -XX:+UseStringDeduplication -XX:+UseAES -XX:+UseAESIntrinsics -XX:+UseFMA -XX:+UseLoopPredicate -XX:+RangeCheckElimination -XX:+OptimizeStringConcat -XX:+UseCompressedOops -XX:+UseThreadPriorities -XX:+OmitStackTraceInFastThrow -XX:+RewriteBytecodes -XX:+RewriteFrequentPairs -XX:+UseFPUForSpilling -XX:+UseNewLongLShift -XX:+UseVectorCmov -XX:+UseXMMForArrayCopy -XX:+UseXmmI2D -XX:+UseXmmI2F -XX:+UseXmmLoadAndClearUpper -XX:+UseXmmRegToRegMoveAll -XX:+EliminateLocks -XX:+DoEscapeAnalysis -XX:+AlignVector -XX:+OptimizeFill -XX:+EnableVectorSupport -XX:+UseCharacterCompareIntrinsics -XX:+UseCopySignIntrinsic -XX:+UseVectorStubs -XX:UseAVX=2 -XX:UseSSE=4 -XX:+UseFastJNIAccessors -XX:+UseInlineCaches -XX:+SegmentedCodeCache -XX:ThreadPriorityPolicy=1';

function Icon({ name, size = 18, strokeWidth = 1.7 }: { name: string; size?: number; strokeWidth?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m2.5 10 9.5-7.5 9.5 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /><path d="M4 11h2M18 11h2" /></>,
    events: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M7.5 3v4M16.5 3v4M4 9h16M8 13h.01M12 13h.01M16 13h.01M8 17h8" /></>,
    invite: <><path d="M4 6.5h16v3a2.5 2.5 0 0 0 0 5v3H4v-3a2.5 2.5 0 0 0 0-5v-3Z" /><path d="M9 7v2M9 13v2M9 17v.5M12.5 10h4M12.5 13h4M12.5 16h2.5" /></>,
    announcement: <><path d="M3 10v4h4l10 5V5L7 10H3Z" /><path d="m7 14 1.7 5h3.2l-2-4M19 9a4 4 0 0 1 0 6" /></>,
    status: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16.5 9" /><path d="M12 2v2M22 12h-2" /></>,
    skin: <><path d="M9 3.5h6v3l3 2.5V21H6V9l3-2.5v-3Z" /><path d="M9 9h6v4H9zM6 11H4v5h2M18 11h2v5h-2M10 16v5M14 16v5" /><path d="M11 10.5h.01M13 10.5h.01" /></>,
    captures: <><path d="M3 7h4l2-2h6l2 2h4v13H3V7Z" /><circle cx="12" cy="13.5" r="4" /><path d="m10.5 13.5 1 1 2-2.2M5.5 9h1" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--ink-2)" /><circle cx="15" cy="12" r="2" fill="var(--ink-2)" /><circle cx="8" cy="18" r="2" fill="var(--ink-2)" /><path d="M9 4v4M15 10v4M8 16v4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    minimize: <path d="M5 12h14" />,
    maximize: <rect x="4" y="4" width="16" height="16" rx="1.5" />,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    folder: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10Z" /><path d="M3 10h18" /></>,
    memory: <><rect x="4" y="6" width="16" height="12" rx="2" /><path d="M8 10h2v4H8zM14 10h2M14 14h2M8 3v3M16 3v3M8 18v3M16 18v3M1 10h3M1 14h3M20 10h3M20 14h3" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 17v3h14v-3" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.status}</svg>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <img className={compact ? 'brand-mark' : 'brand-wordmark'} src={compact ? '/navithlabs-mark.png' : '/navithlabs-wordmark.png'} alt="navith.labs" />;
}

function BrandRenderScene({ variant = 'hero' }: { variant?: 'hero' | 'login' }) {
  return <div className={`brand-render-scene brand-render-${variant}`} aria-hidden="true">
    <div className="render-aura" />
    <div className="render-orbit render-orbit-a" />
    <div className="render-orbit render-orbit-b" />
    <div className="render-orbit render-orbit-c" />
    <svg className="render-structure" viewBox="0 0 620 600" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`portal-${variant}`} x1="127" y1="112" x2="494" y2="498" gradientUnits="userSpaceOnUse"><stop stopColor="#8F8CDC" stopOpacity=".76" /><stop offset=".52" stopColor="#FF6C82" stopOpacity=".78" /><stop offset="1" stopColor="#6667B4" stopOpacity=".65" /></linearGradient>
        <radialGradient id={`well-${variant}`} cx="0" cy="0" r="1" gradientTransform="matrix(0 205 -223 0 310 300)" gradientUnits="userSpaceOnUse"><stop stopColor="#4A477F" stopOpacity=".55" /><stop offset="1" stopColor="#12152B" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="310" cy="303" rx="219" ry="220" fill={`url(#well-${variant})`} />
      <path className="render-frame-outer" d="M185 101h-49v398h49M435 101h49v398h-49" stroke={`url(#portal-${variant})`} strokeWidth="3" />
      <path className="render-frame-inner" d="M225 151h-28v298h28M395 151h28v298h-28" stroke="rgba(235,236,255,.48)" strokeWidth="1.5" />
      <path className="render-floor" d="m101 433 209 105 209-105M142 413l168 84 168-84M186 392l124 62 124-62" stroke="rgba(183,186,227,.22)" strokeWidth="1" />
      <g className="render-cube render-cube-a"><path d="m130 265 39-22 40 22-40 23-40-23Z" fill="#666A9D" /><path d="m130 265 40 23v47l-40-23v-47Z" fill="#343958" /><path d="m170 288 39-23v47l-39 23v-47Z" fill="#4B4F7A" /></g>
      <g className="render-cube render-cube-b"><path d="m408 370 28-16 29 16-29 17-28-17Z" fill="#CF6379" /><path d="m408 370 28 17v34l-28-16v-35Z" fill="#793C5B" /><path d="m436 387 29-17v35l-29 16v-34Z" fill="#A84A68" /></g>
      <g className="render-cube render-cube-c"><path d="m411 176 17-10 17 10-17 10-17-10Z" fill="#8589BA" /><path d="m411 176 17 10v20l-17-10v-20Z" fill="#4C507D" /><path d="m428 186 17-10v20l-17 10v-20Z" fill="#696D9D" /></g>
      <circle className="render-particle render-particle-a" cx="110" cy="368" r="3" fill="#FF647B" />
      <circle className="render-particle render-particle-b" cx="503" cy="308" r="2" fill="#F5F6FB" />
      <circle className="render-dot render-dot-a" cx="229" cy="135" r="3" fill="#FF647B" /><circle className="render-dot render-dot-b" cx="454" cy="457" r="2" fill="#E6DFFF" />
    </svg>
    <div className="render-logo"><Brand compact /></div>
  </div>;
}

function readStoredAccount(): Account | null {
  try {
    const saved = localStorage.getItem(ACCOUNT_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Account;
    return parsed?.provider && parsed?.displayName ? parsed : null;
  } catch {
    return null;
  }
}

function accountAvatar(account: Account | null): string | null {
  if (!account) return null;
  if (account.provider === 'google' && account.googleData?.picture) return account.googleData.picture;
  if (account.provider === 'discord' && account.discordData?.id && account.discordData?.avatar) {
    return `https://cdn.discordapp.com/avatars/${account.discordData.id}/${account.discordData.avatar}.png?size=96`;
  }
  if (account.provider === 'microsoft' || account.provider === 'offline') {
    return `https://minotar.net/helm/${encodeURIComponent(account.displayName)}/96.png`;
  }
  return null;
}

function WindowControls() {
  if (!(window as any).__TAURI_INTERNALS__) return null;
  const win = getCurrentWindow();
  return <div className="window-actions">
    <button aria-label="Minimizar" onClick={() => void win.minimize()}><Icon name="minimize" size={14} /></button>
    <button aria-label="Maximizar" onClick={() => void win.toggleMaximize()}><Icon name="maximize" size={13} /></button>
    <button className="window-close" aria-label="Cerrar" onClick={() => void win.close()}><Icon name="close" size={14} /></button>
  </div>;
}

function LoginScreen({ onLogin, onTermsAccepted }: { onLogin: (next: Account) => void; onTermsAccepted: (accepted: boolean) => void }) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState('');
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [offlineName, setOfflineName] = useState('');
  const [cancelAvailable, setCancelAvailable] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(() => localStorage.getItem(LEGAL_ACCEPTANCE_KEY) === LEGAL_TERMS_VERSION);
  const [legalTab, setLegalTab] = useState<'terms' | 'privacy' | null>(null);

  const updateLegalAcceptance = (accepted: boolean) => {
    setAcceptedTerms(accepted);
    if (accepted) localStorage.setItem(LEGAL_ACCEPTANCE_KEY, LEGAL_TERMS_VERSION);
    else localStorage.removeItem(LEGAL_ACCEPTANCE_KEY);
    onTermsAccepted(accepted);
  };

  const startOAuth = async <T,>(eventName: string, commandName: string, authUrl: string): Promise<T> => {
    let resolveReady!: () => void;
    const listenerReady = new Promise<void>(resolve => { resolveReady = resolve; });
    const unlisten = await listen(eventName, () => resolveReady());
    let completed = false;
    try {
      const nativeResult = invoke<T>(commandName).then(
        value => ({ ok: true as const, value }),
        error => ({ ok: false as const, error }),
      );
      const startup = await Promise.race([
        listenerReady.then(() => ({ kind: 'ready' as const })),
        nativeResult.then(result => ({ kind: 'finished' as const, result })),
        new Promise<{ kind: 'timeout' }>(resolve => window.setTimeout(() => resolve({ kind: 'timeout' }), 15000)),
      ]);
      if (startup.kind === 'timeout') throw new Error('No se pudo iniciar el receptor de inicio de sesión. Cierra otra ventana de acceso e inténtalo de nuevo.');
      if (startup.kind === 'finished') {
        completed = true;
        if (!startup.result.ok) throw startup.result.error;
        return startup.result.value;
      }

      await openUrl(authUrl);
      const result = await nativeResult;
      completed = true;
      if (!result.ok) throw result.error;
      return result.value;
    } finally {
      unlisten();
      if (!completed) await fetch('http://127.0.0.1:3456/cancel').catch(() => undefined);
    }
  };

  const authenticate = async (provider: Exclude<Provider, 'offline'>) => {
    if (!(window as any).__TAURI_INTERNALS__) {
      setError('Abre NavithLabs Launcher para iniciar sesión.');
      return;
    }
    setBusy(provider);
    setCancelAvailable(true);
    setError('');
    try {
      if (provider === 'microsoft') {
        const redirectUri = 'http://localhost:3456/';
        const authUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=${MICROSOFT_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=XboxLive.SignIn%20XboxLive.offline_access&prompt=select_account`;
        const code = await startOAuth<string>('microsoft-auth-listening', 'start_microsoft_auth', authUrl);
          if (!code) throw new Error('Microsoft no devolvió el código de acceso. Vuelve al launcher e inténtalo de nuevo.');
          const profile = await invoke<Account['microsoftData']>('exchange_microsoft_token', { clientId: MICROSOFT_CLIENT_ID, code });
          if (!profile?.name) throw new Error('La cuenta inició sesión con Microsoft, pero no se encontró un perfil de Minecraft Java.');
          onLogin({ provider, displayName: profile.name, microsoftData: profile });
      } else if (provider === 'discord') {
        const redirectUri = 'http://127.0.0.1:3456/auth';
        const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=identify`;
        const token = await startOAuth<string>('discord-auth-listening', 'start_discord_auth', authUrl);
        const profile = await invoke<Account['discordData']>('fetch_json_with_token', { url: 'https://discord.com/api/users/@me', token });
        if (!profile?.username) throw new Error('No se pudo leer tu perfil de Discord.');
        onLogin({ provider, displayName: profile.global_name || profile.username, discordData: profile });
      } else {
        const redirectUri = 'http://127.0.0.1:3456/google-callback';
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=profile%20email`;
        const token = await startOAuth<string>('google-auth-listening', 'start_google_auth', authUrl);
        const profile = await invoke<Account['googleData']>('fetch_json_with_token', { url: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json', token });
        if (!profile?.name) throw new Error('No se pudo leer tu perfil de Google.');
        onLogin({ provider, displayName: profile.given_name || profile.name, googleData: profile });
      }
    } catch (cause) {
      const message = String(cause);
      if (!message.toLowerCase().includes('cancel')) setError(message.replace(/^Error:\s*/i, ''));
    } finally {
      setBusy(null);
      setCancelAvailable(false);
    }
  };

  const cancel = async () => {
    await fetch('http://127.0.0.1:3456/cancel').catch(() => undefined);
    setBusy(null);
    setCancelAvailable(false);
  };

  const enterOffline = (event: FormEvent) => {
    event.preventDefault();
    if (!acceptedTerms) return;
    const name = offlineName.trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
    if (!name) return;
    onLogin({ provider: 'offline', displayName: name });
  };

  return <div className="login-shell">
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-label"><Brand compact /> <span>NAVITHLABS LAUNCHER</span></span>
      <WindowControls />
    </header>
    <main className="login-scene">
      <div className="login-atmosphere" aria-hidden="true" />
      <div className="login-scene-art"><BrandRenderScene variant="login" /></div>
      <div className="login-copy">
        <Brand />
        <h1>Donde nacen<br /><span>los eventos.</span></h1>
        <p>Accede con tu perfil de Minecraft y prepara tu cliente de forma automática para explorar nuestras creaciones.</p>
        <ol className="login-steps" aria-label="Cómo entrar a un evento">
          <li><span>01</span> Inicia sesión</li>
          <li><span>02</span> Canjea tu código</li>
          <li><span>03</span> Juega</li>
        </ol>
      </div>
      <section className="login-card">
          <div className="login-card-top">INICIAR SESIÓN</div>
          <h2>Bienvenido<br />de vuelta.</h2>
          <p className="login-card-intro">Elige cómo quieres entrar.</p>
          <button className="auth-button auth-microsoft" disabled={!acceptedTerms || busy !== null} onClick={() => void authenticate('microsoft')}>
            <span className="microsoft-symbol"><i /><i /><i /><i /></span>
            <span><b>{busy === 'microsoft' ? 'Esperando a Microsoft…' : 'Continuar con Microsoft'}</b><small>Para jugar con tu cuenta Java</small></span>
            <Icon name="arrow" size={16} />
          </button>
          <div className="auth-secondary">
            <button className="auth-button auth-social" disabled={!acceptedTerms || busy !== null} onClick={() => void authenticate('discord')}><span className="discord-glyph">◉</span><b>{busy === 'discord' ? 'Conectando…' : 'Discord'}</b></button>
            <button className="auth-button auth-social" disabled={!acceptedTerms || busy !== null} onClick={() => void authenticate('google')}><span className="google-glyph">G</span><b>{busy === 'google' ? 'Conectando…' : 'Google'}</b></button>
          </div>
          <div className="auth-divider"><span>O ENTRA SIN CONEXIÓN</span></div>
          {!offlineOpen ? <button className="offline-open" disabled={!acceptedTerms || busy !== null} onClick={() => setOfflineOpen(true)}>Usar un nombre de jugador <span>→</span></button> : (
            <form className="offline-form" onSubmit={enterOffline}>
              <label htmlFor="offlineName">Nombre de jugador</label>
              <div className="offline-input-row"><input id="offlineName" autoFocus value={offlineName} maxLength={16} onChange={event => setOfflineName(event.target.value)} placeholder="Steve" /><button type="submit" aria-label="Continuar" disabled={!acceptedTerms}><Icon name="chevron" /></button></div>
            </form>
          )}
          {cancelAvailable && <button className="cancel-auth" onClick={() => void cancel()}>Cancelar acceso</button>}
          {error && <div className="auth-error" role="alert"><span>!</span>{error}</div>}
          <div className="legal-login-footer">
            <div className="legal-document-links">
              <button type="button" onClick={() => setLegalTab('terms')}>Términos y condiciones <Icon name="arrow" size={13} /></button>
              <button type="button" onClick={() => setLegalTab('privacy')}>Política de privacidad <Icon name="arrow" size={13} /></button>
            </div>
            <label className="legal-acceptance-check">
              <input type="checkbox" checked={acceptedTerms} onChange={event => updateLegalAcceptance(event.target.checked)} />
              <span>He leído y acepto los términos y la política de privacidad.</span>
            </label>
          </div>
          <div className="login-card-foot"><Icon name="shield" size={15} /><span>{acceptedTerms ? 'Aceptación guardada en este equipo.' : 'Acepta los documentos para habilitar el inicio de sesión.'}</span></div>
      </section>
      <footer className="login-footer"><span>© NAVITH.LABS</span><span>V 0.1.0</span></footer>
    </main>
    {legalTab && <LegalModal initialTab={legalTab} onClose={() => setLegalTab(null)} />}
  </div>;
}

function App() {
  const [account, setAccount] = useState<Account | null>(readStoredAccount);
  const [legalAccepted, setLegalAccepted] = useState(() => localStorage.getItem(LEGAL_ACCEPTANCE_KEY) === LEGAL_TERMS_VERSION);
  const [page, setPage] = useState<Page>('home');
  const [events, setEvents] = useState<InvitedEvent[]>(loadInvitedEvents);
  const [selectedEventId, setSelectedEventId] = useState(() => Number(localStorage.getItem('navithlabs.selected-event.v1')) || 0);
  const [eventCode, setEventCode] = useState('');
  const [eventError, setEventError] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [gameDirectory, setGameDirectory] = useState(() => localStorage.getItem(GAME_DIRECTORY_KEY) || '');
  const [systemRam, setSystemRam] = useState(8);
  const [globalRam, setGlobalRam] = useState(() => Number(localStorage.getItem(RAM_KEY)) || 4);
  const [minimumRamMiB, setMinimumRamMiB] = useState(() => Number(localStorage.getItem(MIN_RAM_KEY)) || 2048);
  const [javaPath, setJavaPath] = useState(() => localStorage.getItem(JAVA_PATH_KEY) || '');
  const [jvmArguments, setJvmArguments] = useState(() => localStorage.getItem(JVM_ARGUMENTS_KEY) || DEFAULT_JVM);
  const [discordPresenceEnabled, setDiscordPresenceEnabled] = useState(() => localStorage.getItem(DISCORD_PRESENCE_KEY) !== 'false');
  const [appVersion, setAppVersion] = useState('0.1.0');
  const [isNative] = useState(() => Boolean((window as any).__TAURI_INTERNALS__));
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchingEventId, setLaunchingEventId] = useState<number | null>(null);
  const [activeGameEvent, setActiveGameEvent] = useState<{ name: string; version: string; loader: string } | null>(null);
  const [progress, setProgress] = useState({ message: 'Preparando Minecraft…', percentage: 0 });
  const [toast, setToast] = useState('');
  const [authMenuOpen, setAuthMenuOpen] = useState(false);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [openedEventId, setOpenedEventId] = useState<number | null>(null);
  const [instancePreview, setInstancePreview] = useState<{ eventId: number; top: number } | null>(null);
  const [community, setCommunity] = useState<CommunityFeed>({ announcements: [], maintenance: { enabled: false, message: '' } });
  const toastTimer = useRef<number | undefined>(undefined);
  const instancePreviewTimer = useRef<number | undefined>(undefined);
  const codeInput = useRef<HTMLInputElement>(null);
  const redeemModalInput = useRef<HTMLInputElement>(null);
  const progressRange = useRef({ start: 0, end: 100 });
  const eventSyncInProgress = useRef(false);
  const gameExitedDuringLaunch = useRef(false);

  const selectedEvent = useMemo(() => events.find(event => event.server.id === selectedEventId) || events[0] || null, [events, selectedEventId]);
  const openedEvent = useMemo(() => events.find(event => event.server.id === openedEventId) || null, [events, openedEventId]);
  const avatar = useMemo(() => accountAvatar(account), [account]);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 4500);
  };

  const updateDiscordPresence = (details: string, state: string) => {
    if (!isNative || !discordPresenceEnabled) return;
    void invoke('update_presence', {
      details,
      state,
      largeImage: 'navithlabs',
      largeText: 'NavithLabs Launcher',
      smallImage: 'minecraft',
      smallText: 'Minecraft Java',
      buttons: null,
      startTime: null,
    }).catch(() => undefined);
  };

  const toggleDiscordPresence = () => {
    const enabled = !discordPresenceEnabled;
    setDiscordPresenceEnabled(enabled);
    localStorage.setItem(DISCORD_PRESENCE_KEY, String(enabled));
    if (!enabled && isNative) void invoke('clear_presence').catch(() => undefined);
  };

  const openRedeemModal = () => {
    setEventCode('');
    setEventError('');
    setRedeemModalOpen(true);
  };

  const showInstancePreview = (eventId: number, element: HTMLElement) => {
    if (instancePreviewTimer.current) window.clearTimeout(instancePreviewTimer.current);
    const sidebar = element.closest('.sidebar')?.getBoundingClientRect();
    const button = element.getBoundingClientRect();
    const center = button.top - (sidebar?.top || 0) + button.height / 2;
    const inset = Math.min(145, Math.max(0, ((sidebar?.height || 0) - 24) / 2));
    setInstancePreview({ eventId, top: Math.max(inset, Math.min(center, (sidebar?.height || center) - inset)) });
  };

  const scheduleHideInstancePreview = () => {
    if (instancePreviewTimer.current) window.clearTimeout(instancePreviewTimer.current);
    instancePreviewTimer.current = window.setTimeout(() => setInstancePreview(null), 180);
  };

  const openEventDetails = (event: InvitedEvent) => {
    setSelectedEventId(event.server.id);
    localStorage.setItem('navithlabs.selected-event.v1', String(event.server.id));
    setInstancePreview(null);
    setPage('events');
    setOpenedEventId(event.server.id);
  };

  useEffect(() => {
    let active = true;
    let mounted = true;
    if (isNative) {
      void invoke('close_splashscreen').catch(() => undefined);
      void invoke<string>('get_default_game_directory').then(path => {
        if (!active) return;
        setGameDirectory(path);
        localStorage.setItem(GAME_DIRECTORY_KEY, path);
      }).catch(() => undefined);
      void invoke<number>('get_system_ram').then(ram => {
        if (!active || !ram) return;
        setSystemRam(ram);
        setGlobalRam(current => Math.min(current, Math.max(1, ram - 1)));
      }).catch(() => undefined);
      import('@tauri-apps/api/app').then(({ getVersion }) => getVersion().then(version => active && setAppVersion(version))).catch(() => undefined);
    }

    const unlisteners: Array<() => void> = [];
    void listen<{ message: string; percentage: number }>('download-progress', event => {
      const rawPercentage = Math.max(0, Math.min(100, event.payload.percentage || 0));
      const { start, end } = progressRange.current;
      setProgress(current => ({
        message: event.payload.message || 'Preparando Minecraft…',
        percentage: Math.max(current.percentage, start + (rawPercentage / 100) * (end - start)),
      }));
    }).then(stop => { if (mounted) unlisteners.push(stop); else stop(); }).catch(() => undefined);
    void listen<void>('minecraft-exit', () => {
      gameExitedDuringLaunch.current = true;
      setActiveGameEvent(null);
    })
      .then(stop => { if (mounted) unlisteners.push(stop); else stop(); }).catch(() => undefined);
    void listen<number>('minecraft-crash', () => {
      gameExitedDuringLaunch.current = true;
      setActiveGameEvent(null);
    })
      .then(stop => { if (mounted) unlisteners.push(stop); else stop(); }).catch(() => undefined);

    return () => {
      active = false;
      mounted = false;
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      unlisteners.forEach(stop => stop());
    };
  }, [isNative]);

  useEffect(() => {
    if (!isNative) return;
    if (!account || !discordPresenceEnabled) {
      void invoke('clear_presence').catch(() => undefined);
      return;
    }
    if (activeGameEvent) {
      updateDiscordPresence(`Jugando ${activeGameEvent.name}`, `Minecraft ${activeGameEvent.version} · ${activeGameEvent.loader}`);
    } else if (isLaunching && launchingEventId !== null) {
      const server = events.find(event => event.server.id === launchingEventId)?.server;
      updateDiscordPresence(`Preparando ${server?.name || 'tu evento'}`, `Minecraft ${server?.minecraft_version || ''} · ${server?.loader || 'Java'}`);
    } else {
      updateDiscordPresence('En NavithLabs Launcher', 'Explorando tus eventos');
    }
  }, [isNative, account, discordPresenceEnabled, activeGameEvent, isLaunching, launchingEventId, events]);

  useEffect(() => {
    let active = true;
    const syncCommunity = () => {
      void fetchCommunityFeed().then(feed => { if (active) setCommunity(feed); }).catch(() => undefined);
      void sendLauncherHeartbeat(appVersion).catch(() => undefined);
    };
    syncCommunity();
    const timer = window.setInterval(syncCommunity, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [appVersion]);

  useEffect(() => {
    saveInvitedEvents(events);
  }, [events]);

  useEffect(() => {
    if (!redeemModalOpen) return;
    const focusTimer = window.setTimeout(() => redeemModalInput.current?.focus(), 30);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRedeemModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [redeemModalOpen]);

  useEffect(() => {
    if (page !== 'events') setOpenedEventId(null);
  }, [page]);

  useEffect(() => () => {
    if (instancePreviewTimer.current) window.clearTimeout(instancePreviewTimer.current);
  }, []);

  useEffect(() => {
    if (!isNative || !gameDirectory || activeGameEvent) return;
    let active = true;
    const syncInvitations = async () => {
      if (eventSyncInProgress.current) return;
      const savedEvents = loadInvitedEvents();
      const pendingCleanupIds = loadPendingEventCleanups();
      if (!savedEvents.length && !pendingCleanupIds.length) return;
      eventSyncInProgress.current = true;
      try {
        const checks = await Promise.all(savedEvents.map(async event => {
          try {
            const server = await refreshInvitedEvent(event);
            return isFinalizedEvent(server)
              ? { event, server: null, finalized: true }
              : { event, server, finalized: false };
          } catch (error) {
            return isFinalizedEventError(error)
              ? { event, server: null, finalized: true }
              : { event, server: null, finalized: false };
          }
        }));
        if (!active) return;

        const finalized = checks.filter(result => result.finalized).map(result => result.event);
        const finalizedIds = new Set(finalized.map(event => event.server.id));
        const refreshedById = new Map(checks.flatMap(result => result.server ? [[result.event.server.id, { ...result.event, server: result.server }] as const] : []));
        const latestEvents = loadInvitedEvents();
        const next = latestEvents
          .filter(event => !finalizedIds.has(event.server.id))
          .map(event => refreshedById.get(event.server.id) || event);

        if (finalized.length) queueEventCleanups(finalized.map(event => event.instanceId));
        const cleanupQueue = loadPendingEventCleanups();
        const cleanupResults = await Promise.all(cleanupQueue.map(async instanceId =>
          await invoke('delete_event_instance', { baseDirectory: gameDirectory, instanceId })
            .then(() => ({ instanceId, deleted: true }))
            .catch(() => ({ instanceId, deleted: false }))
        ));
        if (!active) return;
        const cleanedIds = cleanupResults.filter(result => result.deleted).map(result => result.instanceId);
        if (cleanedIds.length) completeEventCleanups(cleanedIds);
        const deletionResults = new Map(cleanupResults.map(result => [result.instanceId, result.deleted]));
        saveInvitedEvents(next);
        setEvents(next);
        const selectedId = Number(localStorage.getItem('navithlabs.selected-event.v1')) || 0;
        if (finalizedIds.has(selectedId)) {
          const nextId = next[0]?.server.id || 0;
          setSelectedEventId(nextId);
          if (nextId) localStorage.setItem('navithlabs.selected-event.v1', String(nextId));
          else localStorage.removeItem('navithlabs.selected-event.v1');
        }
        if (openedEventId !== null && finalizedIds.has(openedEventId)) setOpenedEventId(null);
        if (finalized.length) {
          const deleted = finalized.filter(event => deletionResults.get(event.instanceId)).length;
          showToast(deleted === finalized.length
            ? `${finalized.length === 1 ? 'El evento finalizó' : `${finalized.length} eventos finalizaron`}. Se quitaron de tu colección y se borraron sus archivos.`
            : `${finalized.length === 1 ? 'El evento finalizó' : 'Los eventos finalizaron'} y se quitaron de tu colección. La limpieza de archivos se reintentará automáticamente.`);
        }
      } finally {
        eventSyncInProgress.current = false;
      }
    };

    void syncInvitations();
    const timer = window.setInterval(() => void syncInvitations(), 90_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [isNative, gameDirectory, activeGameEvent, openedEventId]);

  const persistAccount = (next: Account) => {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
    setAccount(next);
    setAuthMenuOpen(false);
  };

  const redeemCode = async (event: FormEvent) => {
    event.preventDefault();
    const code = eventCode.trim();
    if (!code || isRedeeming) return;
    setEventError('');
    setIsRedeeming(true);
    try {
      const { server, accessToken } = await redeemEventCode(code);
      const existing = events.find(item => item.server.id === server.id);
      const invitedEvent: InvitedEvent = existing
        ? { ...existing, server, accessToken }
        : createInvitedEvent(server, accessToken);
      const next = [invitedEvent, ...events.filter(item => item.server.id !== server.id)];
      setEvents(next);
      setSelectedEventId(server.id);
      localStorage.setItem('navithlabs.selected-event.v1', String(server.id));
      setEventCode('');
      setInstancePreview(null);
      setRedeemModalOpen(false);
      setOpenedEventId(null);
      setPage('events');
      showToast(`Acceso confirmado: ${server.name}`);
    } catch (error) {
      setEventError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRedeeming(false);
    }
  };

  const removeEvent = (event: InvitedEvent) => {
    const next = events.filter(item => item.server.id !== event.server.id);
    setEvents(next);
    if (selectedEventId === event.server.id) {
      const nextId = next[0]?.server.id || 0;
      setSelectedEventId(nextId);
      if (nextId) localStorage.setItem('navithlabs.selected-event.v1', String(nextId));
      else localStorage.removeItem('navithlabs.selected-event.v1');
    }
    showToast(`Se quitó “${event.server.name}” de tus eventos guardados.`);
  };

  const launchEvent = async (savedEvent: InvitedEvent) => {
    if (!isNative) {
      showToast('Abre NavithLabs Launcher para preparar Minecraft.');
      return;
    }
    if (isLaunching) return;
    if (savedEvent.server.availability === 'maintenance') {
      showToast(savedEvent.server.maintenance_message || 'Este evento está en mantenimiento.');
      return;
    }
    if (community.maintenance.enabled) {
      showToast(community.maintenance.message || 'NavithLabs está en mantenimiento.');
      return;
    }
    if (!gameDirectory) {
      showToast('No se pudo encontrar la carpeta de Minecraft. Reinicia el launcher e inténtalo de nuevo.');
      return;
    }

    window.dispatchEvent(new Event('navithlabs:pause-server-music'));
    setIsLaunching(true);
    setLaunchingEventId(savedEvent.server.id);
    setSelectedEventId(savedEvent.server.id);
    localStorage.setItem('navithlabs.selected-event.v1', String(savedEvent.server.id));
    const safeMinimumRam = Math.min(minimumRamMiB, globalRam * 1024);
    const customJvmArguments = jvmArguments.trim().split(/\s+/).filter(Boolean).filter(argument => !/^-Xm[sx]/i.test(argument));
    const softMaxArgument = customJvmArguments.find(argument => /^-XX:SoftMaxHeapSize=\d+G$/i.test(argument));
    const effectiveJvmArguments = [
      ...customJvmArguments.filter(argument => !/^-XX:SoftMaxHeapSize=/i.test(argument)),
      ...(softMaxArgument ? [`-XX:SoftMaxHeapSize=${Math.min(Number(softMaxArgument.match(/=(\d+)G/i)?.[1] || globalRam), globalRam)}G`] : []),
      `-Xms${safeMinimumRam}M`,
    ].join(' ');
    progressRange.current = { start: 0, end: 8 };
    setProgress({ message: 'Comprobando tu invitación…', percentage: 2 });
    try {
      let server = savedEvent.server;
      let event = savedEvent;
      try {
        server = await refreshInvitedEvent(savedEvent);
        event = { ...savedEvent, server };
        setEvents(current => current.map(item => item.server.id === server.id ? event : item));
      } catch (error) {
        const serviceUnavailable = error instanceof TypeError
          || (error instanceof Error && error.name === 'LauncherApiUnavailableError');
        if (!serviceUnavailable) throw error;
        showToast('Sin conexión con NavithLabs · usando los datos guardados del evento.');
      }
      const loaderName = ({ VANILLA: 'Vanilla', FABRIC: 'Fabric', FORGE: 'Forge', NEOFORGE: 'NeoForge', QUILT: 'Quilt' } as Record<string, Loader>)[server.loader.toUpperCase()] || 'Vanilla';
      const loaderVersion = server.loader_version?.trim() || null;
      const gamePath = eventFolder(event.instanceId, gameDirectory);
      let playerName = account?.displayName || 'Jugador';
      let uuid: string | null = null;
      let accessToken: string | null = null;

      if (account?.provider === 'microsoft' && account.microsoftData) {
        let profile = account.microsoftData;
        try {
          profile = await invoke<Account['microsoftData']>('refresh_microsoft_token', { clientId: MICROSOFT_CLIENT_ID, refreshToken: profile.refresh_token }) as NonNullable<Account['microsoftData']>;
          const refreshed: Account = { ...account, displayName: profile.name, microsoftData: profile };
          setAccount(refreshed);
          localStorage.setItem(ACCOUNT_KEY, JSON.stringify(refreshed));
        } catch { /* Continue with the cached Minecraft token when Microsoft is temporarily unavailable. */ }
        playerName = profile.name;
        uuid = profile.uuid;
        accessToken = profile.access_token;
      }

      progressRange.current = { start: 8, end: 40 };
      setProgress({ message: `Preparando Minecraft ${server.minecraft_version} y ${loaderName}…`, percentage: 8 });
      await invoke('precache_installation_components', {
        version: server.minecraft_version,
        loaderType: loaderName,
        loaderVersion: loaderName === 'Vanilla' ? null : loaderVersion,
      });

      const manifest = server.content_manifest;
      const needsPackageRefresh = event.installedRevision < server.content_revision;
      if (needsPackageRefresh && manifest.base_archive_url) {
        progressRange.current = { start: 40, end: manifest.config_archive_url && manifest.config_archive_url !== manifest.base_archive_url ? 70 : 88 };
        setProgress({ message: 'Descargando archivos del evento…', percentage: 40 });
        await invoke('download_and_extract_event_zip', {
          url: manifest.base_archive_url,
          instanceId: event.instanceId,
          subfolder: null,
        });
      }
      if (needsPackageRefresh && manifest.config_archive_url && manifest.config_archive_url !== manifest.base_archive_url) {
        progressRange.current = { start: 70, end: 88 };
        setProgress({ message: 'Aplicando configuraciones del evento…', percentage: 70 });
        await invoke('download_and_extract_event_zip', {
          url: manifest.config_archive_url,
          instanceId: event.instanceId,
          subfolder: null,
        });
      }

      const enabledFiles = (manifest.files || []).filter(file => file.enabled !== false).map(file => ({
        id: file.id || null,
        name: file.name || file.filename.replace(/\.jar$/i, ''),
        filename: file.filename,
        url: file.url,
      }));
      const excludedFiles = [
        ...(manifest.excluded_files || []),
        ...(manifest.files || []).filter(file => file.enabled === false).map(file => file.filename),
      ];
      progressRange.current = { start: 88, end: 93 };
      setProgress({ message: 'Sincronizando archivos del evento…', percentage: 88 });
      await invoke('sync_individual_mods', {
        gameDirectory: gamePath,
        extraMods: enabledFiles,
        removedMods: excludedFiles,
      });

      if (needsPackageRefresh) {
        const installedEvent = { ...event, installedRevision: server.content_revision };
        setEvents(current => current.map(item => item.server.id === server.id ? installedEvent : item));
      }

      progressRange.current = { start: 94, end: 100 };
      setProgress({ message: `Entrando a ${server.name}…`, percentage: 94 });
      gameExitedDuringLaunch.current = false;
      const result = await invoke<string>('launch_minecraft', {
        version: server.minecraft_version,
        forgeVersion: loaderName === 'Forge' ? loaderVersion : null,
        fabricVersion: loaderName === 'Fabric' ? loaderVersion : null,
        neoforgeVersion: loaderName === 'NeoForge' ? loaderVersion : null,
        quiltVersion: loaderName === 'Quilt' ? loaderVersion : null,
        username: playerName,
        uuid,
        accessToken,
        ram: String(globalRam),
        gameDirectory: gamePath,
        resolutionWidth: '1280',
        resolutionHeight: '720',
        fullscreen: false,
        jvmArguments: effectiveJvmArguments,
        launcherVisibility: 'hide_reopen',
        javaExecutable: javaPath,
        skipJavaCheck: false,
      });
      void recordLauncherLaunch(server.minecraft_version, loaderName, server.id).catch(() => undefined);
      if (!gameExitedDuringLaunch.current) {
        setActiveGameEvent({ name: server.name, version: server.minecraft_version, loader: loaderName });
      }
      showToast(result || `Entrando a ${server.name}…`);
    } catch (error) {
      showToast(`No se pudo preparar el evento: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLaunching(false);
      setLaunchingEventId(null);
      window.setTimeout(() => setProgress({ message: '', percentage: 0 }), 500);
    }
  };

  const changeRam = (value: number) => {
    const maxRam = Math.max(1, Math.min(value, systemRam - 1));
    setGlobalRam(maxRam);
    localStorage.setItem(RAM_KEY, String(maxRam));
    if (minimumRamMiB > maxRam * 1024) {
      setMinimumRamMiB(maxRam * 1024);
      localStorage.setItem(MIN_RAM_KEY, String(maxRam * 1024));
    }
    const softMax = jvmArguments.match(/-XX:SoftMaxHeapSize=(\d+)G/i);
    if (softMax && Number(softMax[1]) > maxRam) {
      changeJvmArguments(jvmArguments.replace(softMax[0], `-XX:SoftMaxHeapSize=${maxRam}G`));
    }
  };

  const changeMinimumRam = (value: number) => {
    const minRam = Math.max(512, Math.min(value, globalRam * 1024));
    setMinimumRamMiB(minRam);
    localStorage.setItem(MIN_RAM_KEY, String(minRam));
  };

  const changeJvmArguments = (value: string) => {
    setJvmArguments(value);
    localStorage.setItem(JVM_ARGUMENTS_KEY, value);
  };

  const applyJvmPreset = (preset: 'default' | 'aikar' | 'zgc') => {
    if (preset === 'default') {
      changeJvmArguments(DEFAULT_JVM);
      return;
    }
    if (preset === 'aikar') {
      changeJvmArguments(AIKAR_JVM);
      return;
    }
    const targetMax = Math.max(1, Math.min(6, systemRam - 1));
    changeRam(targetMax);
    changeMinimumRam(Math.min(4096, targetMax * 1024));
    changeJvmArguments(ZGC_JVM.replace('-XX:SoftMaxHeapSize=6G', `-XX:SoftMaxHeapSize=${targetMax}G`));
  };

  const chooseGameDirectory = async () => {
    if (!isNative) {
      showToast('Selecciona la carpeta desde NavithLabs Launcher.');
      return;
    }
    try {
      const selected = await openDialog({ title: 'Carpeta de instalación de NavithLabs', directory: true, multiple: false });
      if (typeof selected !== 'string' || !selected) return;
      const savedPath = await invoke<string>('set_launcher_base_dir', { path: selected });
      setGameDirectory(savedPath);
      localStorage.setItem(GAME_DIRECTORY_KEY, savedPath);
      showToast('La carpeta de instalación se aplicará en los próximos inicios.');
    } catch (error) {
      showToast(`No se pudo guardar la carpeta: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const resetGameDirectory = async () => {
    if (!isNative) {
      localStorage.removeItem(GAME_DIRECTORY_KEY);
      setGameDirectory('');
      return;
    }
    try {
      const defaultPath = await invoke<string>('set_launcher_base_dir', { path: '' });
      setGameDirectory(defaultPath);
      localStorage.setItem(GAME_DIRECTORY_KEY, defaultPath);
      showToast('Se restauró la carpeta predeterminada.');
    } catch (error) {
      showToast(`No se pudo restaurar la carpeta: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const chooseJavaPath = async () => {
    if (!isNative) {
      showToast('Selecciona Java desde NavithLabs Launcher.');
      return;
    }
    try {
      const selected = await openDialog({ title: 'Selecciona java.exe', multiple: false, filters: [{ name: 'Java', extensions: ['exe'] }] });
      if (typeof selected !== 'string' || !selected) return;
      setJavaPath(selected);
      localStorage.setItem(JAVA_PATH_KEY, selected);
    } catch (error) {
      showToast(`No se pudo seleccionar Java: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const clearJavaPath = () => {
    setJavaPath('');
    localStorage.removeItem(JAVA_PATH_KEY);
  };

  const openGameFolder = async () => {
    try {
      if (isNative && gameDirectory) await invoke('open_folder', { path: gameDirectory });
      else showToast('La carpeta de datos aún no está disponible.');
    } catch (error) { showToast(`No se pudo abrir la carpeta: ${error}`); }
  };

  const pageTitle = ({ home: 'Inicio', events: 'Eventos', skins: 'Skins', screenshots: 'Capturas', settings: 'Configuración' } as Record<Page, string>)[page];

  if (!legalAccepted) return <LoginScreen onLogin={persistAccount} onTermsAccepted={setLegalAccepted} />;
  if (!account) return <LoginScreen onLogin={persistAccount} onTermsAccepted={setLegalAccepted} />;

  return <div className="launcher-shell">
    <header className="app-titlebar" data-tauri-drag-region>
      <div className="titlebar-brand"><Brand /><span className="titlebar-divider" /><span>{pageTitle.toUpperCase()}</span></div>
      <div className="titlebar-state"><span className={`state-dot ${community.maintenance.enabled ? 'is-maintenance' : ''}`} /> {community.maintenance.enabled ? 'MANTENIMIENTO' : events.length ? 'INVITACIÓN LISTA' : 'ACCESO PRIVADO'} <span className="titlebar-version">V {appVersion}</span></div>
      <WindowControls />
    </header>
    <aside className="sidebar">
      <nav className="side-nav" aria-label="Navegación principal">
        {([
          ['home', 'Inicio', 'home'],
          ['events', 'Eventos', 'invite'],
          ['skins', 'Skins', 'skin'],
          ['screenshots', 'Capturas', 'captures'],
        ] as [Page, string, string][]).map(([key, label, icon]) => <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} data-label={label} aria-label={label} aria-current={page === key ? 'page' : undefined} title={label} onClick={() => { if (key === 'events') setOpenedEventId(null); setPage(key); }}>
          <Icon name={icon} size={16} /><span>{label}</span>{key === 'events' && events.length > 0 && <small className="nav-indicator">{events.length}</small>}
        </button>)}
      </nav>
      <>
        <div className="instance-rail-separator" />
        <nav className="instance-rail" aria-label="Eventos canjeados">
          {events.map(event => {
            const server = event.server;
            const artwork = server.banner_url || server.menu_background || server.logo_url;
            return <button
              key={server.id}
              className={`instance-rail-button ${selectedEvent?.server.id === server.id ? 'is-selected' : ''}`}
              aria-label={`Abrir ${server.name}`}
              title={server.name}
              onMouseEnter={element => showInstancePreview(server.id, element.currentTarget)}
              onMouseLeave={scheduleHideInstancePreview}
              onFocus={element => showInstancePreview(server.id, element.currentTarget)}
              onBlur={scheduleHideInstancePreview}
              onClick={() => openEventDetails(event)}
            >
              {artwork ? <img src={artwork} alt="" /> : <span className="instance-rail-monogram">{server.name.slice(0, 2).toUpperCase()}</span>}
              <i aria-hidden="true" />
            </button>;
          })}
          <button className="instance-rail-add" aria-label="Canjear código de invitación" title="Canjear código" onClick={openRedeemModal}><Icon name="plus" size={20} strokeWidth={1.8} /></button>
        </nav>
      </>
      {instancePreview && (() => {
        const event = events.find(item => item.server.id === instancePreview.eventId);
        if (!event) return null;
        const server = event.server;
        const artwork = server.banner_url || server.menu_background || server.logo_url || '';
        const unavailable = community.maintenance.enabled || server.availability === 'maintenance' || server.availability === 'full';
        const status = community.maintenance.enabled || server.availability === 'maintenance' ? 'MANTENIMIENTO' : server.availability === 'full' ? 'AFORO COMPLETO' : 'LISTO PARA JUGAR';
        return <article className="instance-popover" style={{ top: instancePreview.top }} onMouseEnter={() => { if (instancePreviewTimer.current) window.clearTimeout(instancePreviewTimer.current); }} onMouseLeave={scheduleHideInstancePreview}>
          <div className="instance-popover-art" style={artwork ? { backgroundImage: `linear-gradient(180deg,rgba(8,10,22,.08),rgba(8,10,22,.86)),url("${artwork.replace(/["\\]/g, '')}")` } : undefined}>
            <span className="instance-popover-kicker">{server.minecraft_version} · {server.loader}</span>
            {server.logo_url && <img src={server.logo_url} alt="" />}
            <h2>{server.name}</h2>
          </div>
          <div className="instance-popover-body">
            <span className={`instance-popover-status ${unavailable ? 'is-unavailable' : ''}`}><i />{status}</span>
            <p>{server.description || server.subtitle || 'Tu invitación está lista para preparar Minecraft.'}</p>
            <div className="instance-popover-actions">
              <button className="button-play" disabled={unavailable || isLaunching} onClick={() => { setInstancePreview(null); void launchEvent(event); }}><Icon name="play" size={14} />{isLaunching && launchingEventId === server.id ? 'PREPARANDO…' : 'JUGAR AHORA'}</button>
              <button className="instance-popover-open" aria-label="Ver evento" title="Ver evento" onClick={() => openEventDetails(event)}><Icon name="arrow" size={16} /></button>
            </div>
          </div>
        </article>;
      })()}
      <div className="sidebar-spacer" />
      <nav className="side-nav side-nav-utility" aria-label="Preferencias">
        <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} data-label="Configuración" aria-label="Configuración" aria-current={page === 'settings' ? 'page' : undefined} title="Configuración" onClick={() => setPage('settings')}>
          <Icon name="settings" size={16} /><span>Configuración</span>
        </button>
      </nav>
      <div className="sidebar-separator" />
      <div className="account-anchor">
        {authMenuOpen && <div className="account-popover"><div className="popover-heading">SESIÓN ACTIVA</div><div className="popover-account"><Avatar account={account} avatar={avatar} /><span><b>{account.displayName}</b><small>{account.provider === 'microsoft' ? 'MICROSOFT' : account.provider.toUpperCase()}</small></span></div><button onClick={() => { localStorage.removeItem(ACCOUNT_KEY); setAccount(null); setAuthMenuOpen(false); }}>Cerrar sesión <Icon name="logout" size={15} /></button></div>}
        <button className="account-button" aria-label={`Perfil de ${account.displayName}`} title={account.displayName} aria-expanded={authMenuOpen} onClick={() => setAuthMenuOpen(open => !open)}>
          <Avatar account={account} avatar={avatar} /><span className="account-presence" aria-hidden="true" /><span className="account-button-copy"><b>{account.displayName}</b><small>{account.provider === 'microsoft' ? 'CUENTA DE MINECRAFT' : account.provider === 'offline' ? 'MODO SIN CONEXIÓN' : `CONECTADO CON ${account.provider.toUpperCase()}`}</small></span><span className="account-menu-dots">···</span>
        </button>
      </div>
    </aside>
    <main className="main-stage">
      <div className="main-scroll" key={page}>
        {community.maintenance.enabled && <aside className="community-notice maintenance-notice"><span className="notice-icon"><Icon name="settings" size={16} /></span><div><b>NavithLabs está en mantenimiento</b><p>{community.maintenance.message || 'El acceso a eventos volverá pronto.'}</p></div><span className="notice-tag">SERVICE</span></aside>}
        {community.announcements[0] && <aside className="community-notice"><span className="notice-icon"><Icon name="announcement" size={17} /></span><div><b>{community.announcements[0].title}</b><p>{community.announcements[0].body}</p></div>{community.announcements[0].link && <button className="notice-link" onClick={() => void openUrl(community.announcements[0].link!)}>VER <Icon name="arrow" size={13} /></button>}</aside>}
        {page === 'home' && <section className="dashboard-page">
          <header className="dashboard-heading">
            <div><div className="eyebrow"><span className="eyebrow-dot" /> NAVITH.LABS <span className="eyebrow-slash">/</span> CENTRO DE JUEGO</div><h1>Hola, <span>{account.displayName.split(/\s+/)[0]}.</span></h1><p>Tu colección y las herramientas importantes del launcher están aquí.</p></div>
            <div className="dashboard-summary"><span><b>{String(events.length).padStart(2, '0')}</b> EVENTOS</span><span><b>{globalRam}</b> GB RAM</span></div>
          </header>
          <section className="hero-panel event-hero home-overview-hero">
            <div className="hero-noise" />
            <div className="hero-corner hero-corner-tl" /><div className="hero-corner hero-corner-br" />
            <div className="hero-art"><BrandRenderScene /></div>
            <div className="hero-art-light" />
            <div className="hero-content">
              <div className="eyebrow"><span className="eyebrow-dot" /> NAVITH.LABS <span className="eyebrow-slash">/</span> TU ESPACIO DE JUEGO</div>
              <h1>Tu próxima aventura<br /><span>empieza en Eventos.</span></h1>
              <p>Encuentra tus accesos privados, abre cada mundo y prepara Minecraft desde tu colección.</p>
              <button className="button-primary home-overview-cta" type="button" onClick={() => setPage('events')}><Icon name="layers" size={16} /> EXPLORAR EVENTOS <Icon name="arrow" size={14} /></button>
            </div>
            <div className="hero-index"><span>{String(events.length).padStart(2, '0')}</span><i /> <span>NL</span><small>YOUR<br />WORLDS</small></div>
            <div className="hero-bottomline"><span>MINECRAFT JAVA · TU BIBLIOTECA PRIVADA</span><button type="button" onClick={() => setPage('events')}>ABRIR EVENTOS <b>↗</b></button></div>
          </section>
          <div className="dashboard-grid">
            <article className="dashboard-featured dashboard-featured-empty"><div className="dashboard-featured-copy"><span className="eyebrow-muted">TU COLECCIÓN · {String(events.length).padStart(2, '0')} {events.length === 1 ? 'EVENTO' : 'EVENTOS'}</span><h2>{events.length ? 'Tus mundos están listos.' : 'Tu próxima aventura te espera.'}</h2><p>{events.length ? 'Abre Eventos para revisar tus accesos y entrar al mundo que quieras.' : 'Cuando tengas acceso a un evento, aparecerá en tu colección dentro de Eventos.'}</p><button className="button-primary" onClick={() => setPage('events')}><Icon name="layers" size={15} /> IR A EVENTOS <Icon name="arrow" size={14} /></button></div><div className="dashboard-empty-mark"><Brand compact /></div></article>
            <aside className="dashboard-quick">
              <div className="dashboard-quick-head"><span className="eyebrow-muted">ACCESOS RÁPIDOS</span><h2>Todo a mano.</h2></div>
              <button onClick={() => setPage('events')}><span className="quick-icon"><Icon name="layers" size={18} /></span><span><b>Ver mis eventos</b><small>{events.length ? `${events.length} en tu biblioteca` : 'Tu biblioteca privada'}</small></span><Icon name="chevron" size={15} /></button>
              <button onClick={() => setPage('settings')}><span className="quick-icon"><Icon name="memory" size={18} /></span><span><b>Memoria de Minecraft</b><small>{globalRam} GB asignados</small></span><Icon name="chevron" size={15} /></button>
              <button onClick={() => void openGameFolder()}><span className="quick-icon"><Icon name="folder" size={18} /></span><span><b>Carpeta del launcher</b><small>Eventos y archivos del juego</small></span><Icon name="chevron" size={15} /></button>
            </aside>
          </div>
        </section>}
        {page === 'events' && (openedEvent ? <EventDetailPage
          event={openedEvent}
          isLaunching={isLaunching && launchingEventId === openedEvent.server.id}
          gameRunning={Boolean(activeGameEvent)}
          unavailable={community.maintenance.enabled || openedEvent.server.availability === 'maintenance' || openedEvent.server.availability === 'full'}
          availabilityMessage={community.maintenance.enabled ? community.maintenance.message || 'NavithLabs está en mantenimiento.' : openedEvent.server.maintenance_message || (openedEvent.server.availability === 'full' ? 'Este evento alcanzó su aforo.' : 'Este evento está en mantenimiento.')}
          onBack={() => setOpenedEventId(null)}
          onLaunch={() => void launchEvent(openedEvent)}
          onCopyAddress={address => {
            if (!navigator.clipboard?.writeText) { showToast(`Servidor: ${address}`); return; }
            void navigator.clipboard.writeText(address).then(() => showToast('Dirección del servidor copiada.')).catch(() => showToast(`Servidor: ${address}`));
          }}
        /> : <section className="events-page events-library-page">
          <header className="events-library-heading">
            <div><div className="eyebrow"><span className="eyebrow-dot" /> NAVITH.LABS <span className="eyebrow-slash">/</span> TU COLECCIÓN</div><h1>Tus eventos<span>.</span></h1><p>Los mundos a los que tienes acceso, reunidos en un solo lugar.</p></div>
            <div className="events-library-total"><b>{String(events.length).padStart(2, '0')}</b><span>{events.length === 1 ? 'EVENTO' : 'EVENTOS'}</span></div>
          </header>

          <section className="event-redeem-panel">
            <div className="event-redeem-icon"><Icon name="invite" size={21} /></div>
            <div className="event-redeem-copy"><span className="eyebrow-muted">ACCESO PRIVADO</span><h2>¿Tienes un código?</h2><p>Canjéalo para añadir el evento a tu biblioteca.</p></div>
            <form className="event-redeem-form" onSubmit={event => void redeemCode(event)}>
              <label className="invite-label" htmlFor="event-code">CÓDIGO DE INVITACIÓN</label>
              <div className="invite-input-row"><input ref={codeInput} id="event-code" value={eventCode} maxLength={64} onChange={event => { setEventCode(event.target.value); setEventError(''); }} placeholder="ESCRIBE TU CÓDIGO" autoComplete="off" /><button className="button-primary" type="submit" disabled={isRedeeming || !eventCode.trim()}>{isRedeeming ? 'VALIDANDO…' : 'CANJEAR'}</button></div>
              {eventError && <div className="invite-error" role="alert">{eventError}</div>}
            </form>
          </section>

          <section className="event-list-section">
            <div className="section-heading"><div><span className="eyebrow-muted">MINECRAFT JAVA / ACCESOS GUARDADOS</span><h2>Eventos disponibles</h2></div><span className="event-count">{String(events.length).padStart(2, '0')} {events.length === 1 ? 'EVENTO' : 'EVENTOS'}</span></div>
            {events.length ? <div className="event-grid">{events.map((event, index) => {
              const server = event.server;
              const banner = server.banner_url || server.menu_background || '';
              const isSelected = selectedEvent?.server.id === server.id;
              const isBusy = isLaunching && launchingEventId === server.id;
              const status = community.maintenance.enabled ? 'SERVICIO EN MANTENIMIENTO' : server.availability === 'maintenance' ? 'MANTENIMIENTO' : server.availability === 'full' ? 'AFORO COMPLETO' : 'INVITACIÓN VÁLIDA';
              return <article
                className={`event-card ${isSelected ? 'is-selected' : ''}`}
                key={server.id}
                style={{ animationDelay: `${index * 70}ms` }}
                tabIndex={0}
                aria-label={`Ver detalles de ${server.name}`}
                onClick={clickEvent => {
                  if ((clickEvent.target as HTMLElement).closest('button, a, input, select, textarea')) return;
                  openEventDetails(event);
                }}
                onKeyDown={keyEvent => {
                  if (keyEvent.target !== keyEvent.currentTarget || (keyEvent.key !== 'Enter' && keyEvent.key !== ' ')) return;
                  keyEvent.preventDefault();
                  openEventDetails(event);
                }}
              >
                <div className="event-card-art" style={banner ? { backgroundImage: `linear-gradient(180deg,rgba(8,10,22,.08),rgba(8,10,22,.82)),url("${banner.replace(/["\\]/g, '')}")` } : undefined}>
                  <div className="event-card-grid" />
                  <span className={`event-status ${server.availability === 'maintenance' ? 'is-maintenance' : ''}`}><i />{status}</span>
                  <span className="event-card-index">NL / {String(index + 1).padStart(2, '0')}</span>
                  <span className="event-card-open-hint">VER EVENTO <Icon name="arrow" size={13} /></span>
                  {server.logo_url && <img className="event-server-logo" src={server.logo_url} alt="" />}
                  <div className="event-card-heading"><span>{server.loader} · MINECRAFT {server.minecraft_version}</span><h3>{server.name}</h3>{server.subtitle && <p>{server.subtitle}</p>}</div>
                </div>
                <div className="event-card-body">
                  <div className="event-tags">{(server.tags || []).slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}<span>{server.is_private ? 'PRIVADO' : 'EVENTO'}</span></div>
                  <p className="event-description">{server.description || 'Tu invitación está lista. Prepara el paquete del evento y entra al servidor.'}</p>
                  <div className="event-card-actions"><button className="button-play" onClick={clickEvent => { clickEvent.stopPropagation(); void launchEvent(event); }} disabled={isLaunching || community.maintenance.enabled || server.availability === 'maintenance' || server.availability === 'full'}><Icon name="play" size={15} />{isBusy ? 'PREPARANDO…' : community.maintenance.enabled || server.availability === 'maintenance' ? 'EN MANTENIMIENTO' : server.availability === 'full' ? 'AFORO COMPLETO' : 'ENTRAR AL EVENTO'}</button><button className="event-remove" onClick={clickEvent => { clickEvent.stopPropagation(); removeEvent(event); }}>Quitar</button></div>
                </div>
              </article>;
            })}</div> : <div className="event-empty"><div className="empty-sigil"><Icon name="layers" size={27} /></div><span className="eyebrow-muted">AÚN NO HAY EVENTOS</span><h2>Tu próxima aventura te espera.</h2><p>Canjea arriba el código de invitación que recibiste de NavithLabs. El evento aparecerá aquí y quedará listo para preparar Minecraft.</p><button className="button-primary" onClick={() => codeInput.current?.focus()}><Icon name="invite" size={16} /> CANJEAR MI PRIMER CÓDIGO</button></div>}
            <div className="home-footnote"><span><Icon name="shield" size={14} /> TUS INVITACIONES SE GUARDAN EN ESTE EQUIPO</span><span>BUILT FOR THE NEXT EVENT</span></div>
          </section>
        </section>)}

        {page === 'skins' && <SkinsWorkspace account={account} isNative={isNative} onMicrosoftDataChange={next => {
          setAccount(current => {
            if (!current) return current;
            const updated = { ...current, displayName: next.name, microsoftData: next };
            localStorage.setItem(ACCOUNT_KEY, JSON.stringify(updated));
            return updated;
          });
        }} />}

        {page === 'screenshots' && (isNative ? <ScreenshotsGallery onOpenFolder={path => {
          void invoke('open_folder', { path }).catch(error => showToast(`No se pudo abrir la carpeta: ${error}`));
        }} /> : <section className="native-feature-gate"><div className="native-feature-gate-icon"><Icon name="captures" size={26} /></div><span className="eyebrow-muted">FUNCIÓN DE ESCRITORIO</span><h1>Capturas del juego.</h1><p>Abre NavithLabs Launcher para escanear, abrir, copiar y administrar las capturas guardadas en tus perfiles de Minecraft.</p></section>)}

        {page === 'settings' && <section className="settings-page settings-workspace">
          <header className="settings-workspace-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> PREFERENCIAS DEL SISTEMA <span className="eyebrow-slash">/</span> NAVITH.LABS</div><h1>Ajustes del launcher</h1><p>Configura el rendimiento y dónde se instalan los archivos de tus eventos.</p></div><span className="settings-heading-mark"><Icon name="settings" size={22} /></span></header>
          <div className="settings-layout">
            <section className="settings-card settings-performance-card">
              <div className="settings-card-head"><div className="settings-icon"><Icon name="memory" size={20} /></div><div><span className="eyebrow-muted">01 · JAVA Y RENDIMIENTO</span><h2>Memoria y argumentos</h2></div></div>
              <p>Estos valores se aplican a cada evento al iniciar Minecraft.</p>

              <div className="settings-field-block">
                <div className="ram-value-line"><label htmlFor="maximum-ram">Memoria RAM máxima</label><strong>{globalRam}<small> GB</small></strong></div>
                {(() => {
                  const minRam = 1;
                  const maxRam = Math.max(2, systemRam - 1);
                  const safeRam = Math.max(minRam, Math.min(globalRam, maxRam));
                  const progressPct = ((safeRam - minRam) / (maxRam - minRam)) * 100;
                  return <><input id="maximum-ram" className="ram-range" type="range" min={minRam} max={maxRam} value={safeRam} onChange={event => changeRam(Number(event.target.value))} style={{ '--range-progress': `${progressPct}%` } as CSSProperties} /><div className="ram-range-labels"><span>{minRam} GB mínimo</span><span>Equipo: {systemRam} GB</span><span>{maxRam} GB disponible</span></div></>;
                })()}
                <div className="settings-inline-field"><label htmlFor="minimum-ram">Memoria Java mínima</label><div className="settings-number-wrap"><input id="minimum-ram" type="number" min={512} max={globalRam * 1024} step={512} value={Math.min(minimumRamMiB, globalRam * 1024)} onChange={event => changeMinimumRam(Number(event.target.value) || 512)} /><span>MiB</span></div></div>
                <small className="settings-help">Deja memoria libre para Windows y las aplicaciones en segundo plano.</small>
              </div>

              <div className="settings-field-block">
                <label className="settings-label" htmlFor="java-path">Ruta de Java <span>(opcional)</span></label>
                <div className="settings-path-row"><input id="java-path" value={javaPath} onChange={event => { setJavaPath(event.target.value); localStorage.setItem(JAVA_PATH_KEY, event.target.value); }} placeholder="Vacío: detección automática" /><button type="button" className="settings-icon-button" onClick={() => void chooseJavaPath()} aria-label="Buscar Java" title="Buscar java.exe"><Icon name="folder" size={16} /></button>{javaPath && <button type="button" className="settings-text-button" onClick={clearJavaPath}>AUTOMÁTICO</button>}</div>
                <small className="settings-help">Puedes elegir java.exe o escribir la ruta a una instalación de Java. Vacío usa la detección automática.</small>
              </div>

              <div className="settings-field-block settings-jvm-block">
                <div className="settings-jvm-heading"><label className="settings-label" htmlFor="jvm-arguments">Argumentos JVM globales</label><div className="settings-presets" aria-label="Perfiles de argumentos JVM">
                  <button type="button" className={!jvmArguments.includes('-XX:+UseZGC') && !jvmArguments.includes('-XX:+ParallelRefProcEnabled') ? 'is-active' : ''} onClick={() => applyJvmPreset('default')}>POR DEFECTO</button>
                  <button type="button" className={jvmArguments.includes('-XX:+ParallelRefProcEnabled') ? 'is-active' : ''} onClick={() => applyJvmPreset('aikar')}>AIKAR</button>
                  <button type="button" className={jvmArguments.includes('-XX:+UseZGC') ? 'is-active' : ''} onClick={() => applyJvmPreset('zgc')}>ZGC</button>
                </div></div>
                <textarea id="jvm-arguments" value={jvmArguments} onChange={event => changeJvmArguments(event.target.value)} spellCheck={false} rows={5} placeholder="-XX:+UseG1GC ..." />
                <small className="settings-help">Los perfiles avanzados dependen de la versión de Java. Si Minecraft rechaza un argumento, restaura el perfil por defecto.</small>
              </div>

              <div className="settings-presence-row"><div><b>Discord Rich Presence</b><small>Muestra en Discord el evento que estás jugando.</small></div><button type="button" className={`settings-toggle ${discordPresenceEnabled ? 'is-on' : ''}`} role="switch" aria-checked={discordPresenceEnabled} aria-label="Discord Rich Presence" onClick={toggleDiscordPresence}><i /></button></div>
            </section>

            <div className="settings-side-column">
              <section className="settings-card settings-install-card">
                <div className="settings-card-head"><div className="settings-icon"><Icon name="folder" size={20} /></div><div><span className="eyebrow-muted">02 · ARCHIVOS DEL JUEGO</span><h2>Carpeta de instalación</h2></div></div>
                <p>Versiones, bibliotecas, Java y perfiles de evento se guardan aquí.</p>
                <div className="settings-path-display"><span>{gameDirectory || 'Detectando carpeta…'}</span></div>
                <div className="settings-folder-actions"><button type="button" className="button-primary" onClick={() => void chooseGameDirectory()}><Icon name="folder" size={15} /> ELEGIR CARPETA</button><button type="button" className="button-secondary" onClick={() => void openGameFolder()}><Icon name="arrow" size={14} /> ABRIR</button><button type="button" className="settings-text-button" onClick={() => void resetGameDirectory()}>PREDETERMINADA</button></div>
                <div className="folder-note"><Icon name="shield" size={14} /><span>Cambiar la ruta no mueve archivos existentes; los próximos inicios usarán esta carpeta.</span></div>
              </section>

              <section className="settings-card settings-about-card">
                <div className="settings-card-head"><div className="settings-icon"><Brand compact /></div><div><span className="eyebrow-muted">03 · NAVITH.LABS</span><h2>Acerca del launcher</h2></div></div>
                <p>Tu acceso privado a los eventos de NavithLabs.</p>
                <div className="settings-about-version"><b>NavithLabs Launcher</b><span>Versión {appVersion}</span></div>
                <div className="settings-about-version"><b>Servicio de eventos</b><span>{new URL(LAUNCHER_API_BASE_URL).host}</span></div>
              </section>
            </div>
          </div>
          <div className="settings-version"><Brand compact /><span>NAVITHLABS LAUNCHER <b>{appVersion}</b></span><span>UN NUEVO LUGAR PARA JUGAR.</span></div>
        </section>}
      </div>
    </main>

    {redeemModalOpen && createPortal(<div className="redeem-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !isRedeeming) setRedeemModalOpen(false); }}>
      <section className="redeem-code-modal" role="dialog" aria-modal="true" aria-labelledby="redeem-modal-title">
        <div className="redeem-modal-top"><span>ACCESO PRIVADO <b>/</b> NAVITH.LABS</span><button type="button" aria-label="Cerrar" onClick={() => !isRedeeming && setRedeemModalOpen(false)} disabled={isRedeeming}><Icon name="close" size={16} /></button></div>
        <div className="redeem-modal-mark"><Icon name="invite" size={22} /></div>
        <h2 id="redeem-modal-title">Canjear <span>invitación.</span></h2>
        <p>Escribe el código que recibiste. El evento se añadirá a esta sección para que abras sus detalles cuando quieras.</p>
        <form onSubmit={event => void redeemCode(event)}>
          <label className="invite-label" htmlFor="redeem-modal-code">CÓDIGO DE INVITACIÓN</label>
          <div className="invite-input-row"><input ref={redeemModalInput} id="redeem-modal-code" value={eventCode} maxLength={64} onChange={event => { setEventCode(event.target.value); setEventError(''); }} placeholder="ESCRIBE TU CÓDIGO" autoComplete="off" /><button className="button-primary" type="submit" disabled={isRedeeming || !eventCode.trim()}>{isRedeeming ? 'VALIDANDO…' : 'ACEPTAR'}</button></div>
          {eventError && <div className="invite-error" role="alert">{eventError}</div>}
          <div className="redeem-modal-actions"><button type="button" className="button-secondary" onClick={() => setRedeemModalOpen(false)} disabled={isRedeeming}>CANCELAR</button><span><Icon name="shield" size={14} /> El acceso se guarda en este equipo.</span></div>
        </form>
      </section>
    </div>, document.body)}
    {isLaunching && <div className="launch-overlay"><div className="launch-modal"><div className="render-mark"><Brand compact /></div><span className="eyebrow">EVENTO NAVITH.LABS <span className="eyebrow-slash">/</span> {events.find(event => event.server.id === launchingEventId)?.server.minecraft_version}</span><h2>Preparando<br /><span>tu evento.</span></h2><p>{progress.message || 'Abriendo Minecraft…'}</p><div className="launch-meter"><i style={{ width: `${progress.percentage}%` }} /></div><div className="launch-progress-label"><span>DESCARGA E INICIO</span><b>{Math.round(progress.percentage)}%</b></div></div></div>}
    {toast && <div className="toast-message" role="status"><span className="toast-mark"><Icon name="status" size={15} /></span>{toast}</div>}
  </div>;
}

function EventDetailPage({
  event,
  isLaunching,
  gameRunning,
  unavailable,
  availabilityMessage,
  onBack,
  onLaunch,
  onCopyAddress,
}: {
  event: InvitedEvent;
  isLaunching: boolean;
  gameRunning: boolean;
  unavailable: boolean;
  availabilityMessage: string;
  onBack: () => void;
  onLaunch: () => void;
  onCopyAddress: (address: string) => void;
}) {
  const { server } = event;
  const banner = server.banner_url || server.menu_background || '';
  const needsInstall = event.installedRevision < server.content_revision;
  const status = unavailable
    ? server.availability === 'full' ? 'AFORO COMPLETO' : 'EN MANTENIMIENTO'
    : 'LISTO PARA JUGAR';

  return <section className="server-view-page" style={banner ? { backgroundImage: `linear-gradient(90deg,rgba(7,9,20,.76),rgba(7,9,20,.48) 44%,rgba(7,9,20,.62)),linear-gradient(0deg,#0b0d1b 0%,rgba(11,13,27,.04) 74%),url("${banner.replace(/["\\]/g, '')}")` } : undefined}>
    <div className="server-view-backdrop" />
    <div className="server-view-topline">
      <button type="button" className="server-view-back" onClick={onBack}><Icon name="chevron" size={15} /> SERVIDORES & EVENTOS</button>
      <span><i /> COMUNIDAD NAVITH.LABS</span>
    </div>
    <div className="server-view-layout">
      <div className="server-view-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> NAVITH.LABS <span className="eyebrow-slash">/</span> {server.is_private ? 'EVENTO PRIVADO' : 'EVENTO'}</div>
        <span className={`server-view-status ${unavailable ? 'is-unavailable' : ''}`}><i />{status}</span>
        <p className="server-view-version">{server.loader}{server.loader_version ? ` ${server.loader_version}` : ''} <b>·</b> MINECRAFT {server.minecraft_version}</p>
        <h1>{server.name}</h1>
        {server.subtitle && <h2>{server.subtitle}</h2>}
        <div className="server-view-tags"><span>{server.minecraft_version}</span><span>{server.loader.toUpperCase()}</span>{(server.tags || []).map(tag => <span key={tag}>{tag}</span>)}</div>
        <p className="server-view-description">{server.description || 'Tu invitación está confirmada. Prepara tu instancia y entra al evento.'}</p>
      </div>

      <aside className="server-install-card">
        <div className="server-install-kicker"><Icon name="download" size={15} /> TU INSTANCIA</div>
        <h2>Prepara tu aventura.</h2>
        <p>{needsInstall ? 'Instala la versión y el contenido del evento en una instancia propia.' : 'Tu instancia está lista para abrir Minecraft y entrar.'}</p>
        <div className="server-install-facts">
          <div><span>MINECRAFT</span><b>{server.minecraft_version}</b></div>
          <div><span>LOADER</span><b>{server.loader}{server.loader_version ? ` ${server.loader_version}` : ''}</b></div>
        </div>
        <button type="button" className="server-install-button" disabled={unavailable || isLaunching} onClick={onLaunch}>
          <Icon name={needsInstall ? 'download' : 'play'} size={16} />
          {isLaunching ? 'PREPARANDO EVENTO…' : needsInstall ? 'INSTALAR SERVIDOR' : 'JUGAR AHORA'}
        </button>
        {unavailable && <p className="server-install-notice" role="status">{availabilityMessage}</p>}
        <div className="server-install-state"><i className={needsInstall ? 'is-pending' : ''} /><span>{needsInstall ? 'CONTENIDO DEL EVENTO' : 'INSTANCIA PREPARADA'}</span><small>{needsInstall ? 'Se instalará al continuar.' : 'Archivos guardados en este equipo.'}</small></div>
        <div className="server-address-block">
          <span>Dirección del servidor</span>
          <div><b title={server.server_ip}>{server.server_ip}</b><button type="button" aria-label="Copiar dirección del servidor" title="Copiar dirección" onClick={() => onCopyAddress(server.server_ip)}><Icon name="copy" size={15} /></button></div>
          <small>La configuración de acceso se guarda en tu instancia.</small>
        </div>
      </aside>
    </div>
    {server.music_url && <div className="server-view-music"><ServerMusicPlayer url={server.music_url} title={server.music_title} author={server.music_author} accent="#ff4059" theme="navith" isActive={!isLaunching && !gameRunning} /></div>}
    <div className="server-view-footer"><span>JAVA EDITION <b>·</b> ACCESO PRIVADO</span><span>NAVITH.LABS <b>✦</b></span></div>
  </section>;
}

function Avatar({ account, avatar }: { account: Account; avatar: string | null }) {
  const [failed, setFailed] = useState(false);
  return <span className="avatar-frame">{avatar && !failed ? <img src={avatar} alt="" onError={() => setFailed(true)} /> : <span>{account.displayName.slice(0, 1).toUpperCase()}</span>}</span>;
}

export default App;
