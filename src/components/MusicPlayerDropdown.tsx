import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface TrackItem {
  id: string;
  title: string;
  channel: string;
  duration?: string;
  thumbnail?: string;
}

const THEME_ACCENTS: Record<string, { color: string; rgb: string }> = {
  white: { color: '#ffffff', rgb: '255, 255, 255' },
  wine: { color: '#ff0033', rgb: '255, 0, 51' },
  blue: { color: '#00d4ff', rgb: '0, 212, 255' },
  pink: { color: '#ff007f', rgb: '255, 0, 127' },
  purple: { color: '#b100ff', rgb: '177, 0, 255' },
  green: { color: '#00ff66', rgb: '0, 255, 102' },
};

function extractYouTubeId(urlOrText: string): string | null {
  const trimmed = urlOrText.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const id = url.searchParams.get('v')
        || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {}

  return null;
}

const CLEAN_PRESETS: { name: string; track: TrackItem }[] = [
  {
    name: 'Minecraft OST (C418)',
    track: {
      id: 'h8UpC5JbMU0',
      title: 'Minecraft Relax & Ambience (C418 Music)',
      channel: 'BeforePhantoms',
      duration: '3:00:01',
      thumbnail: 'https://i.ytimg.com/vi/h8UpC5JbMU0/hqdefault.jpg'
    }
  },
  {
    name: 'Lena Raine Mix',
    track: {
      id: 'vCTRNKPJr40',
      title: 'Minecraft Music & Lena Raine Collection',
      channel: 'BeforePhantoms',
      duration: '3:00:01',
      thumbnail: 'https://i.ytimg.com/vi/vCTRNKPJr40/hqdefault.jpg'
    }
  },
  {
    name: 'Lofi Girl 24/7',
    track: {
      id: '4xDzrJKXOOY',
      title: 'Lofi Hip Hop Radio - Beats to Relax/Game to',
      channel: 'Lofi Girl',
      duration: 'LIVE',
      thumbnail: 'https://i.ytimg.com/vi/4xDzrJKXOOY/hqdefault.jpg'
    }
  }
];

const STORAGE_KEY = 'navithlabs_music_player_state_v2';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: any;
  }
}

interface MusicPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  isGameRunning: boolean;
  theme?: string;
  suspendForServerMusic?: boolean;
  onTrackChange?: (track: TrackItem | null, isPlaying: boolean) => void;
}

export const MusicPlayerDropdown: React.FC<MusicPlayerProps> = ({
  isOpen,
  onClose,
  isGameRunning,
  theme = 'white',
  suspendForServerMusic = false,
  onTrackChange
}) => {
  const currentAccent = THEME_ACCENTS[theme] || THEME_ACCENTS.white;

  const loadSavedState = () => {
    try {
      const userPaused = localStorage.getItem('navithlabs_music_user_paused') === 'true';
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          currentTrack: parsed.currentTrack || CLEAN_PRESETS[0].track,
          isPlaying: userPaused ? false : (parsed.isPlaying !== undefined ? parsed.isPlaying : true),
          isLoop: parsed.isLoop !== undefined ? parsed.isLoop : true,
          volume: parsed.volume !== undefined ? parsed.volume : 50,
          isMuted: parsed.isMuted || false,
          userPaused
        };
      }
      return {
        currentTrack: CLEAN_PRESETS[0].track,
        isPlaying: !userPaused,
        isLoop: true,
        volume: 50,
        isMuted: false,
        userPaused
      };
    } catch {}
    return {
      currentTrack: CLEAN_PRESETS[0].track,
      isPlaying: false,
      isLoop: true,
      volume: 50,
      isMuted: false,
      userPaused: true
    };
  };

  const [initial] = useState(loadSavedState);
  const [currentTrack, setCurrentTrack] = useState<TrackItem | null>(initial.currentTrack);
  const [isPlaying, setIsPlaying] = useState<boolean>(initial.isPlaying);
  const [userPaused, setUserPaused] = useState<boolean>(initial.userPaused);
  const [isLoop, setIsLoop] = useState<boolean>(initial.isLoop);
  const [volume, setVolume] = useState<number>(initial.volume);
  const [isMuted, setIsMuted] = useState<boolean>(initial.isMuted);

  const userPausedRef = useRef<boolean>(initial.userPaused);
  userPausedRef.current = userPaused;
  const suspendForServerMusicRef = useRef<boolean>(suspendForServerMusic);
  suspendForServerMusicRef.current = suspendForServerMusic;
  const pausedForServerMusicRef = useRef(false);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<TrackItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const playerRef = useRef<any>(null);
  const isPlayerReadyRef = useRef<boolean>(false);
  const isLoopRef = useRef<boolean>(isLoop);
  const currentTrackRef = useRef<TrackItem | null>(currentTrack);
  const isPlayingRef = useRef<boolean>(isPlaying);

  isLoopRef.current = isLoop;
  currentTrackRef.current = currentTrack;
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    try {
      if (!suspendForServerMusic) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            currentTrack,
            isPlaying,
            userPaused,
            isLoop,
            volume,
            isMuted
          })
        );
      }
      localStorage.setItem('navithlabs_music_user_paused', userPaused ? 'true' : 'false');
    } catch {}
    if (onTrackChange) {
      onTrackChange(currentTrack, isPlaying);
    }
  }, [currentTrack, isPlaying, userPaused, isLoop, volume, isMuted, onTrackChange, suspendForServerMusic]);

  useEffect(() => {
    if (suspendForServerMusic) {
      if (!userPausedRef.current && isPlayingRef.current) pausedForServerMusicRef.current = true;
      if (playerRef.current && isPlayerReadyRef.current && isPlayingRef.current) {
        try { playerRef.current.pauseVideo(); } catch {}
      }
      isPlayingRef.current = false;
      setIsPlaying(false);
      return;
    }

    if (pausedForServerMusicRef.current) {
      pausedForServerMusicRef.current = false;
      if (!userPausedRef.current && playerRef.current && isPlayerReadyRef.current && currentTrackRef.current) {
        try {
          playerRef.current.playVideo();
          isPlayingRef.current = true;
          setIsPlaying(true);
        } catch {}
      }
    }
  }, [suspendForServerMusic]);

  useEffect(() => {
    const initYT = () => {
      if (playerRef.current || !window.YT || !window.YT.Player) return;

      playerRef.current = new window.YT.Player('navithlabs-hidden-yt-iframe', {
        height: '1',
        width: '1',
        videoId: currentTrack?.id || CLEAN_PRESETS[0].track.id,
        playerVars: {
          autoplay: userPausedRef.current ? 0 : 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1
        },
        events: {
          onReady: (event: any) => {
            isPlayerReadyRef.current = true;
            event.target.setVolume(volume);
            if (isMuted) event.target.mute();

            const track = currentTrackRef.current;
            if (track?.id) {
              try {
                if (userPausedRef.current || suspendForServerMusicRef.current || !isPlayingRef.current) event.target.cueVideoById(track.id);
                else event.target.loadVideoById({ videoId: track.id, startSeconds: 0 });
              } catch {}
            }
            if (!userPausedRef.current && suspendForServerMusicRef.current && isPlayingRef.current && track) {
              pausedForServerMusicRef.current = true;
              isPlayingRef.current = false;
              setIsPlaying(false);
            } else if (!userPausedRef.current && !suspendForServerMusicRef.current && isPlayingRef.current && track) {
              event.target.playVideo();
            }
          },
          onStateChange: (event: any) => {
            if (event.data === 1) {
              if (userPausedRef.current || suspendForServerMusicRef.current) {
                try { event.target.pauseVideo(); } catch {}
                isPlayingRef.current = false;
                setIsPlaying(false);
                return;
              }
              isPlayingRef.current = true;
              setIsPlaying(true);
            } else if (event.data === 2) {
              isPlayingRef.current = false;
              setIsPlaying(false);
            } else if (event.data === 0) {
              if (isLoopRef.current && playerRef.current) {
                playerRef.current.seekTo(0, true);
                playerRef.current.playVideo();
              } else {
                isPlayingRef.current = false;
                setIsPlaying(false);
              }
            }
          }
        }
      });
    };

    if (!window.YT?.Player) {
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      }
      window.onYouTubeIframeAPIReady = initYT;
    } else if (window.YT && window.YT.Player) {
      initYT();
    }

    const unlockAudio = () => {
      if (playerRef.current && isPlayerReadyRef.current && isPlaying && !userPausedRef.current) {
        try {
          playerRef.current.playVideo();
        } catch {}
      }
    };
    window.addEventListener('click', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('click', unlockAudio);
    };
  }, []);

  const pausedDueToGameRef = useRef<boolean>(false);

  useEffect(() => {
    if (isGameRunning) {
      if (isPlaying && !userPausedRef.current) {
        pausedDueToGameRef.current = true;
        if (playerRef.current && isPlayerReadyRef.current) {
          try { playerRef.current.pauseVideo(); } catch {}
        }
        isPlayingRef.current = false;
        setIsPlaying(false);
      } else {
        pausedDueToGameRef.current = false;
      }
    } else {
      if (pausedDueToGameRef.current && !userPausedRef.current) {
        pausedDueToGameRef.current = false;
        if (playerRef.current && isPlayerReadyRef.current && currentTrack) {
          try {
            playerRef.current.playVideo();
            setIsPlaying(true);
          } catch {}
        }
      } else {
        pausedDueToGameRef.current = false;
      }
    }
  }, [isGameRunning, isPlaying]);

  useEffect(() => {
    let unlistenExit: (() => void) | null = null;
    let unlistenCrash: (() => void) | null = null;

    const setupListeners = async () => {
      unlistenExit = await listen('minecraft-exit', () => {
        if (pausedDueToGameRef.current && !userPausedRef.current) {
          pausedDueToGameRef.current = false;
          if (playerRef.current && isPlayerReadyRef.current && currentTrack) {
            try {
              playerRef.current.playVideo();
              setIsPlaying(true);
            } catch {}
          }
        } else {
          pausedDueToGameRef.current = false;
        }
      });

      unlistenCrash = await listen('minecraft-crash', () => {
        if (pausedDueToGameRef.current && !userPausedRef.current) {
          pausedDueToGameRef.current = false;
          if (playerRef.current && isPlayerReadyRef.current && currentTrack) {
            try {
              playerRef.current.playVideo();
              setIsPlaying(true);
            } catch {}
          }
        } else {
          pausedDueToGameRef.current = false;
        }
      });
    };

    setupListeners();

    return () => {
      if (unlistenExit) unlistenExit();
      if (unlistenCrash) unlistenCrash();
    };
  }, [currentTrack]);

  useEffect(() => {
    if (!isOpen || !isPlaying) return;

    const interval = setInterval(() => {
      if (playerRef.current && isPlayerReadyRef.current && isPlaying) {
        try {
          const cur = playerRef.current.getCurrentTime() || 0;
          const dur = playerRef.current.getDuration() || 0;
          setCurrentTime(cur);
          setDuration(dur);
        } catch {}
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, isPlaying]);

  const playTrack = (track: TrackItem) => {
    currentTrackRef.current = track;
    setCurrentTrack(track);
    setUserPaused(false);
    userPausedRef.current = false;
    localStorage.setItem('navithlabs_music_user_paused', 'false');
    if (suspendForServerMusicRef.current) {
      pausedForServerMusicRef.current = true;
      isPlayingRef.current = false;
      setIsPlaying(false);
      if (playerRef.current && isPlayerReadyRef.current) {
        try { playerRef.current.cueVideoById(track.id); } catch {}
      }
      return;
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
    if (playerRef.current && isPlayerReadyRef.current) {
      playerRef.current.loadVideoById({
        videoId: track.id,
        startSeconds: 0
      });
      playerRef.current.playVideo();
    }
  };

  const togglePlay = () => {
    if (suspendForServerMusicRef.current) return;
    if (!playerRef.current || !isPlayerReadyRef.current) return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
      isPlayingRef.current = false;
      setIsPlaying(false);
      setUserPaused(true);
      userPausedRef.current = true;
      localStorage.setItem('navithlabs_music_user_paused', 'true');
    } else {
      setUserPaused(false);
      userPausedRef.current = false;
      isPlayingRef.current = true;
      localStorage.setItem('navithlabs_music_user_paused', 'false');
      if (currentTrack) {
        playerRef.current.playVideo();
        setIsPlaying(true);
      } else {
        playTrack(CLEAN_PRESETS[0].track);
      }
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (playerRef.current && isPlayerReadyRef.current) {
      playerRef.current.setVolume(newVol);
      if (newVol > 0 && isMuted) {
        setIsMuted(false);
        playerRef.current.unMute();
      }
    }
  };

  const toggleMute = () => {
    if (!playerRef.current || !isPlayerReadyRef.current) return;
    if (isMuted) {
      playerRef.current.unMute();
      setIsMuted(false);
    } else {
      playerRef.current.mute();
      setIsMuted(true);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    const extractedId = extractYouTubeId(query);
    if (extractedId) {
      const directTrack: TrackItem = {
        id: extractedId,
        title: 'Enlace Directo de YouTube',
        channel: 'YouTube Video',
        duration: '',
        thumbnail: `https://i.ytimg.com/vi/${extractedId}/hqdefault.jpg`
      };
      playTrack(directTrack);
      setSearchResults([directTrack]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await invoke<TrackItem[]>('search_youtube', { query });
      if (res && Array.isArray(res)) {
        setSearchResults(res);
      }
    } catch (err) {
      console.error('Error buscando en YouTube:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <>
      <div 
        style={{ 
          position: 'fixed', 
          bottom: '-100px', 
          right: '-100px', 
          width: '1px', 
          height: '1px', 
          overflow: 'hidden', 
          pointerEvents: 'none', 
          opacity: 0.001 
        }}
      >
        <div id="navithlabs-hidden-yt-iframe" />
      </div>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="music-dropdown-overlay" 
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483646,
            background: 'transparent'
          }}
        >
          <div 
            className={`music-dropdown-panel-themed theme-${theme}`}
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
            <div className="music-dropdown-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={currentAccent.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 6px ${currentAccent.color})` }}>
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
                </svg>
                <span style={{ fontFamily: 'Orbitron', fontWeight: 900, fontSize: '0.9rem', color: '#fff', letterSpacing: '1px', textShadow: `0 0 10px rgba(${currentAccent.rgb}, 0.7)` }}>
                  REPRODUCTOR DE FONDO
                </span>
              </div>
              <button 
                type="button" 
                onClick={onClose}
                className="dropdown-theme-close-btn"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSearch} className="music-search-form" style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: '8px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="text"
                  className="music-search-input"
                  placeholder="Buscar canción o link de YouTube..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '8px',
                    padding: '8px 12px 8px 32px',
                    color: '#fff',
                    fontSize: '0.84rem',
                    outline: 'none',
                    transition: 'border-color 0.2s, box-shadow 0.2s'
                  }}
                />
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="14" 
                  height="14" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="rgba(255,255,255,0.6)" 
                  strokeWidth="2.5" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  style={{ position: 'absolute', left: '10px', top: '10px' }}
                >
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.3-4.3"/>
                </svg>
              </div>
              <button
                type="submit"
                className="music-search-submit"
                disabled={isSearching}
                style={{
                  borderRadius: '8px',
                  padding: '0 14px',
                  fontFamily: 'Orbitron',
                  fontSize: '0.75rem',
                  fontWeight: 900,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {isSearching ? '...' : 'BUSCAR'}
              </button>
            </form>

            <div className="music-presets-section" style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="music-section-kicker" style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)', fontWeight: 800, textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.6px', fontFamily: 'Orbitron' }}>
                Estaciones Rápidas
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {CLEAN_PRESETS.map((preset) => {
                  const isCur = currentTrack?.id === preset.track.id;
                  return (
                    <button
                      key={preset.track.id}
                      type="button"
                      onClick={() => playTrack(preset.track)}
                      className={`music-preset-btn ${isCur ? 'active' : ''}`}
                    >
                      {preset.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {searchResults.length > 0 && (
              <div style={{ maxHeight: '170px', overflowY: 'auto', padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }} className="music-search-results custom-scrollbar">
                <div className="music-section-kicker" style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)', fontWeight: 800, textTransform: 'uppercase', marginBottom: '6px', fontFamily: 'Orbitron' }}>
                  Resultados ({searchResults.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {searchResults.map((t) => {
                    const isCur = currentTrack?.id === t.id;
                    return (
                      <div
                        key={t.id}
                        onClick={() => playTrack(t)}
                        className={`music-search-result ${isCur ? 'active' : ''}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '6px 8px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          transition: 'background 0.2s'
                        }}
                      >
                        <img 
                          src={t.thumbnail} 
                          alt="" 
                          style={{ width: '42px', height: '30px', objectFit: 'cover', borderRadius: '4px' }} 
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: '#fff', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.title}
                          </div>
                          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem' }}>
                            {t.channel} {t.duration ? `• ${t.duration}` : ''}
                          </div>
                        </div>
                        {isCur && isPlaying && (
                          <div style={{ color: currentAccent.color, fontSize: '0.75rem', fontWeight: 800 }}>▶</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="music-now-playing" style={{ padding: '16px 18px', background: 'rgba(0, 0, 0, 0.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <img 
                  src={currentTrack?.thumbnail || '/logo.png'} 
                  alt="" 
                  style={{ 
                    width: '48px', 
                    height: '48px', 
                    borderRadius: '8px', 
                    objectFit: 'cover',
                    border: `1px solid rgba(${currentAccent.rgb}, 0.35)`,
                    boxShadow: isPlaying ? `0 0 16px rgba(${currentAccent.rgb}, 0.4)` : 'none'
                  }} 
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#fff', fontSize: '0.86rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.3px' }}>
                    {currentTrack?.title || 'Selecciona una pista'}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.74rem', marginTop: '2px' }}>
                    {currentTrack?.channel || 'NavithLabs Background Radio'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', minWidth: '32px', fontFamily: 'monospace' }}>
                  {formatTime(currentTime)}
                </span>
                <div 
                  className="music-seek-track"
                  style={{ 
                    flex: 1, 
                    height: '4px', 
                    background: 'rgba(255,255,255,0.12)', 
                    borderRadius: '2px', 
                    position: 'relative',
                    cursor: 'pointer' 
                  }}
                  onClick={(e) => {
                    if (!duration || !playerRef.current) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pos = (e.clientX - rect.left) / rect.width;
                    const seekToSec = pos * duration;
                    playerRef.current.seekTo(seekToSec, true);
                    setCurrentTime(seekToSec);
                  }}
                >
                  <div 
                    className="music-seek-fill"
                    style={{ 
                      width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`, 
                      height: '100%', 
                      background: currentAccent.color, 
                      borderRadius: '2px',
                      boxShadow: `0 0 10px rgba(${currentAccent.rgb}, 0.9)`
                    }} 
                  />
                </div>
                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', minWidth: '32px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatTime(duration)}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`music-loop-btn ${isLoop ? 'active' : ''}`}
                  onClick={() => setIsLoop(!isLoop)}
                  title={isLoop ? 'Bucle Activado' : 'Bucle Desactivado'}
                  style={{
                    background: isLoop ? currentAccent.color : 'transparent',
                    border: `1px solid ${isLoop ? currentAccent.color : 'rgba(255,255,255,0.2)'}`,
                    color: isLoop ? '#000000' : 'rgba(255,255,255,0.6)',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 900,
                    fontFamily: 'Orbitron',
                    boxShadow: isLoop ? `0 0 12px rgba(${currentAccent.rgb}, 0.4)` : 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m17 2 4 4-4 4"/>
                    <path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
                    <path d="m7 22-4-4 4-4"/>
                    <path d="M21 13v1a4 4 0 0 1-4 4H3"/>
                  </svg>
                  <span>BUCLE</span>
                </button>

                <button
                  type="button"
                  className="music-play-btn"
                  onClick={togglePlay}
                  disabled={suspendForServerMusic}
                  title={suspendForServerMusic ? 'La música global se pausa mientras suena el tema del servidor' : undefined}
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '50%',
                    background: currentAccent.color,
                    border: 'none',
                    color: '#000000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: suspendForServerMusic ? 'not-allowed' : 'pointer',
                    opacity: suspendForServerMusic ? 0.55 : 1,
                    boxShadow: isPlaying ? `0 0 22px rgba(${currentAccent.rgb}, 0.85)` : `0 0 10px rgba(${currentAccent.rgb}, 0.3)`,
                    transition: 'all 0.2s'
                  }}
                >
                  {isPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  )}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    className="music-mute-btn"
                    onClick={toggleMute}
                    style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
                  >
                    {isMuted || volume === 0 ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="1" y1="1" x2="23" y2="23"/>
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                        <line x1="12" y1="19" x2="12" y2="23"/>
                        <line x1="8" y1="23" x2="16" y2="23"/>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                      </svg>
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                    style={{ width: '65px', height: '4px', cursor: 'pointer', accentColor: currentAccent.color }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
