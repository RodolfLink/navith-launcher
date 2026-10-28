import React, { useEffect, useRef, useState } from 'react';

type PlaybackState = 'loading' | 'playing' | 'paused' | 'error';

interface ServerMusicPlayerProps {
  url: string;
  title?: string | null;
  author?: string | null;
  accent: string;
  theme?: string;
  isActive: boolean;
}

function extractYouTubeVideoId(value: string): string | null {
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const id = host === 'youtu.be'
      ? url.pathname.split('/').filter(Boolean)[0]
      : ['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)
        ? url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1]
        : null;
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export const ServerMusicPlayer: React.FC<ServerMusicPlayerProps> = ({ url, title, author, accent, theme = 'white', isActive }) => {
  const youtubeId = extractYouTubeVideoId(url);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const volumeRef = useRef(38);
  const isActiveRef = useRef(isActive);
  const manualPausedRef = useRef(false);
  const pausedForNavigationRef = useRef(!isActive);
  const youtubeReadyRef = useRef(false);
  const [volume, setVolume] = useState(38);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('loading');

  isActiveRef.current = isActive;

  useEffect(() => {
    const pauseForGameLaunch = () => {
      if (!manualPausedRef.current) pausedForNavigationRef.current = true;
      if (youtubeId) {
        try { playerRef.current?.pauseVideo(); } catch {}
      } else {
        audioRef.current?.pause();
      }
      setPlaybackState(current => current === 'error' ? current : 'paused');
    };
    window.addEventListener('navithlabs:pause-server-music', pauseForGameLaunch);
    return () => window.removeEventListener('navithlabs:pause-server-music', pauseForGameLaunch);
  }, [youtubeId]);

  useEffect(() => {
    let cancelled = false;
    let pollId: number | undefined;
    let timeoutId: number | undefined;

    if (!youtubeId) {
      const audio = audioRef.current;
      if (!audio) return;
      audio.src = url;
      audio.loop = true;
      audio.volume = volumeRef.current / 100;
      audio.load();
      if (isActiveRef.current) {
        audio.play()
          .then(() => {
            if (!cancelled && isActiveRef.current && !manualPausedRef.current) setPlaybackState('playing');
            else audio.pause();
          })
          .catch(() => { if (!cancelled && isActiveRef.current) setPlaybackState('paused'); });
      } else {
        pausedForNavigationRef.current = true;
        setPlaybackState('paused');
      }

      const onAudioError = () => { if (!cancelled) setPlaybackState('error'); };
      audio.addEventListener('error', onAudioError);
      return () => {
        cancelled = true;
        audio.pause();
        audio.removeEventListener('error', onAudioError);
        audio.removeAttribute('src');
        audio.load();
      };
    }

    const mountYouTubePlayer = () => {
      const yt = (window as any).YT;
      if (cancelled || !yt?.Player || !playerHostRef.current || playerRef.current) return;

      playerRef.current = new yt.Player(playerHostRef.current, {
        width: '1',
        height: '1',
        videoId: youtubeId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          enablejsapi: 1,
          loop: 1,
          playlist: youtubeId,
          playsinline: 1,
          rel: 0
        },
        events: {
          onReady: (event: any) => {
            if (cancelled) {
              try { event.target.destroy(); } catch {}
              return;
            }
            event.target.setVolume(volumeRef.current);
            youtubeReadyRef.current = true;
            if (isActiveRef.current && !manualPausedRef.current) {
              setPlaybackState('loading');
              event.target.playVideo();
            } else {
              pausedForNavigationRef.current = !manualPausedRef.current;
              event.target.pauseVideo();
              setPlaybackState('paused');
            }
          },
          onStateChange: (event: any) => {
            if (cancelled) return;
            if (event.data === 1 && (!isActiveRef.current || manualPausedRef.current)) {
              event.target.pauseVideo();
              setPlaybackState('paused');
            }
            else if (event.data === 1) setPlaybackState('playing');
            else if (event.data === 2) setPlaybackState('paused');
            else if (event.data === 0 && isActiveRef.current && !manualPausedRef.current) event.target.playVideo();
          },
          onError: () => { if (!cancelled) setPlaybackState('error'); }
        }
      });
    };

    if (!(window as any).YT?.Player && !document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }

    mountYouTubePlayer();
    if (!playerRef.current) {
      pollId = window.setInterval(mountYouTubePlayer, 120);
      timeoutId = window.setTimeout(() => {
        if (!playerRef.current && !cancelled) setPlaybackState('error');
      }, 20000);
    }

    return () => {
      cancelled = true;
      youtubeReadyRef.current = false;
      if (pollId !== undefined) window.clearInterval(pollId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      try { playerRef.current?.destroy(); } catch {}
      playerRef.current = null;
    };
  }, [url, youtubeId]);

  useEffect(() => {
    if (!isActive) {
      if (!manualPausedRef.current) pausedForNavigationRef.current = true;
      if (youtubeId) {
        try { playerRef.current?.pauseVideo(); } catch {}
      } else {
        audioRef.current?.pause();
      }
      setPlaybackState((current) => current === 'error' ? current : 'paused');
      return;
    }

    if (!pausedForNavigationRef.current || manualPausedRef.current) return;
    pausedForNavigationRef.current = false;

    if (youtubeId) {
      if (youtubeReadyRef.current) {
        try { playerRef.current?.playVideo(); } catch { setPlaybackState('error'); }
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.play()
      .then(() => {
        if (isActiveRef.current && !manualPausedRef.current) setPlaybackState('playing');
        else audio.pause();
      })
      .catch(() => {
        if (isActiveRef.current) setPlaybackState('error');
      });
  }, [isActive, youtubeId]);

  useEffect(() => {
    volumeRef.current = volume;
    if (youtubeId) {
      try { playerRef.current?.setVolume(volume); } catch {}
    } else if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume, youtubeId]);

  const togglePlayback = () => {
    if (youtubeId) {
      const player = playerRef.current;
      if (!player) return;
      if (playbackState === 'playing') {
        manualPausedRef.current = true;
        pausedForNavigationRef.current = false;
        player.pauseVideo();
      } else {
        manualPausedRef.current = false;
        player.playVideo();
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      manualPausedRef.current = false;
      audio.play()
        .then(() => {
          if (isActiveRef.current && !manualPausedRef.current) setPlaybackState('playing');
          else audio.pause();
        })
        .catch(() => {
          if (isActiveRef.current) setPlaybackState('error');
        });
    } else {
      manualPausedRef.current = true;
      pausedForNavigationRef.current = false;
      audio.pause();
      setPlaybackState('paused');
    }
  };

  const statusText = playbackState === 'loading'
    ? 'Conectando…'
    : playbackState === 'playing'
      ? 'Reproduciendo'
      : playbackState === 'error'
        ? 'No se pudo reproducir'
        : 'Pausada';

  return (
    <section
      className="server-music-player"
      style={{ '--server-music-accent': accent } as React.CSSProperties & { '--server-music-accent': string }}
      data-theme={theme}
      data-playback-state={playbackState}
      aria-label="Reproductor de música del servidor"
    >
      <div className="server-music-player-main">
        <div className="server-music-player-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
        </div>
        <div className="server-music-player-copy">
          <span className="server-music-player-kicker">MÚSICA DEL SERVIDOR</span>
          <strong title={title || undefined}>{title?.trim() || 'Tema del servidor'}</strong>
          <span className="server-music-player-status">
            <i className={playbackState === 'playing' ? 'is-playing' : ''} />
            {author ? `${author} · ` : ''}{statusText}
          </span>
        </div>
        <label className="server-music-player-volume" title={`Volumen ${volume}%`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>
          </svg>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label="Volumen de la música del servidor"
            style={{ '--server-volume': `${volume}%` } as React.CSSProperties & { '--server-volume': string }}
          />
          <span>{volume}%</span>
        </label>
        <button
          type="button"
          className="server-music-player-toggle"
          onClick={togglePlayback}
          aria-label={playbackState === 'playing' ? 'Pausar música del servidor' : 'Reproducir música del servidor'}
          title={playbackState === 'playing' ? 'Pausar' : 'Reproducir'}
        >
          {playbackState === 'playing' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM15 5h4v14h-4z"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
      </div>
      {youtubeId ? (
        <div className="server-music-player-youtube-shell" aria-hidden="true">
          <div ref={playerHostRef} className="server-music-player-youtube" />
        </div>
      ) : (
        <audio ref={audioRef} preload="auto" loop />
      )}
    </section>
  );
};
