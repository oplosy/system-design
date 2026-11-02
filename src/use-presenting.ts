import { useEffect, useState } from 'react';

/** Presenting mode, which follows full screen: leaving full screen by any means ends it. */
export function usePresenting() {
  const [presenting, setPresenting] = useState(false);
  useEffect(() => {
    const onChange = () => !document.fullscreenElement && setPresenting(false);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const setFullScreen = (on: boolean) => {
    setPresenting(on);
    if (on) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  return [presenting, setFullScreen] as const;
}
