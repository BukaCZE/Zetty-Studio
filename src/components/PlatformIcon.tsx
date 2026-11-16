import type { Platform } from '../../shared/types';
export function PlatformIcon({ platform, size = 22 }: { platform: Platform; size?: number }) {
  return (
    <span
      className={`platform-icon ${platform}`}
      style={{ width: size, height: size }}
      aria-label={platform}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {platform === 'twitch' && (
          <>
            <path d="M4 2h18v13l-5 5h-5l-3 3v-3H4V2zm2 2v13h5v3l3-3h4l2-2V4H6z" />
            <path d="M10 7h2v6h-2zm6 0h2v6h-2z" />
          </>
        )}
        {platform === 'youtube' && (
          <>
            <path d="M22.5 6.2c-.3-1-1-1.8-2.1-2.1C18.6 3.6 12 3.6 12 3.6s-6.6 0-8.4.5C2.5 4.4 1.8 5.2 1.5 6.2 1 8 1 12 1 12s0 4 .5 5.8c.3 1 1 1.8 2.1 2.1 1.8.5 8.4.5 8.4.5s6.6 0 8.4-.5c1.1-.3 1.8-1.1 2.1-2.1C23 16 23 12 23 12s0-4-.5-5.8z" />
            <path d="m10 8 6 4-6 4V8z" fill="#111416" />
          </>
        )}
        {platform === 'kick' && (
          <path d="M3 3h6v6h3V6h3V3h6v6h-3v3h-3v3h3v3h3v3h-6v-3h-3v-3H9v6H3V3z" />
        )}
        {platform === 'tiktok' && (
          <path d="M15.7 2h-3.5v12.8a2.8 2.8 0 1 1-2.4-2.7V8.5a6.3 6.3 0 1 0 5.9 6.3V8.4a8.8 8.8 0 0 0 5.2 1.7V6.5A5.2 5.2 0 0 1 15.7 2z" />
        )}
      </svg>
    </span>
  );
}
