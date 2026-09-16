import { useRef, useState } from 'react';
import { Play, MessageCircle } from 'lucide-react';
import { WELCOME_VIDEO, WELCOME_POSTER } from '../../pages/public/welcomeMedia';

/**
 * The trust anchor, at the top of the front door.
 *
 * A face and a voice do more against "is this a scam?" than any amount of
 * badge-work, so this sits above the grid rather than on an about page nobody
 * opens. It stays on the storefront even for people who have already seen the
 * welcome screen, because the doubt comes back at the moment of paying, not at
 * the moment of arriving.
 *
 * `preload="none"` until it is asked for: most visits will scroll straight past
 * it, and a hero that costs a megabyte before anybody presses play is a hero
 * that costs a bounce.
 */
export function WelcomeVideoCard() {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  if (failed) return null;

  return (
    <div className="kl-stage relative mb-3 aspect-[16/9] w-full bg-black sm:aspect-[21/9]">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={WELCOME_VIDEO}
        poster={WELCOME_POSTER || undefined}
        controls={playing}
        playsInline
        preload="none"
        onError={() => setFailed(true)}
      />

      {!playing && (
        <button
          onClick={() => {
            setPlaying(true);
            void videoRef.current?.play();
          }}
          aria-label="Play the welcome video"
          className="kl-scrim absolute inset-0 flex flex-col items-center justify-center gap-4"
        >
          <span className="kl-glass kl-rim relative z-[3] flex h-16 w-16 items-center justify-center rounded-full">
            <Play className="ml-0.5 h-6 w-6 fill-current" strokeWidth={1.5} />
          </span>
          <span className="kl-glass kl-rim relative z-[3] rounded-[var(--radius-lg)] px-4 py-2.5 text-center">
            <span className="block text-sm font-semibold sm:text-base">
              We are new, and we would rather say so
            </span>
            <span className="mt-0.5 flex items-center justify-center gap-1.5 text-[0.6875rem] font-light opacity-75 sm:text-xs">
              <MessageCircle className="h-3 w-3" strokeWidth={2} />
              A minute on who we are, and how to reach us directly
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
