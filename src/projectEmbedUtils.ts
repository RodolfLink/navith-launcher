export function normalizeYouTubeEmbeds(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html;

  try {
    const document = new DOMParser().parseFromString(html, 'text/html');

    document.querySelectorAll('iframe[src]').forEach((frame) => {
      const rawSrc = frame.getAttribute('src');
      if (!rawSrc) return;

      let videoUrl: URL;
      try {
        videoUrl = new URL(rawSrc, 'https://localhost');
      } catch {
        return;
      }

      const host = videoUrl.hostname.toLowerCase().replace(/^www\./, '');
      const isYouTube = host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com';
      if (!isYouTube) return;

      if (host === 'youtu.be') {
        const videoId = videoUrl.pathname.split('/').filter(Boolean)[0];
        if (videoId) videoUrl.pathname = `/embed/${videoId}`;
        videoUrl.hostname = 'www.youtube.com';
      } else if (/^\/(watch|shorts|live)\//i.test(videoUrl.pathname) || videoUrl.pathname === '/watch') {
        const pathParts = videoUrl.pathname.split('/').filter(Boolean);
        const videoId = videoUrl.searchParams.get('v') || pathParts[1];
        if (videoId) {
          videoUrl.pathname = `/embed/${videoId}`;
          videoUrl.searchParams.delete('v');
        }
      }

      videoUrl.protocol = 'https:';
      if (!videoUrl.searchParams.has('playsinline')) videoUrl.searchParams.set('playsinline', '1');
      frame.setAttribute('src', videoUrl.toString());
      frame.setAttribute('title', frame.getAttribute('title') || 'Video de YouTube');
      if (!frame.hasAttribute('loading')) frame.setAttribute('loading', 'lazy');
      if (!frame.hasAttribute('referrerpolicy')) frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      if (!frame.hasAttribute('allow')) {
        frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
      }
      if (!frame.hasAttribute('allowfullscreen')) frame.setAttribute('allowfullscreen', '');
    });

    return document.body.innerHTML;
  } catch {
    return html;
  }
}
