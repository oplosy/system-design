import { useEffect, useState } from 'react';
import { api, type LiveLoad } from './api.ts';
import { errorText } from './format.ts';

const POLL_MS = 15000;

/** Live load from Prometheus (server/api.ts), shown on the lines in place of the designed numbers while on. */
export function useLiveLoad(designId: string | undefined, setError: (message: string | null) => void) {
  const [live, setLive] = useState<LiveLoad | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  useEffect(() => {
    setLive(null);
    if (!liveOn || !designId) return;
    let stop = false;
    const poll = () =>
      api.live(designId).then(
        (l) => !stop && setLive(l),
        (e) => {
          if (stop) return;
          setLiveOn(false);
          setError(`Live load: ${errorText(e)}`);
        },
      );
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [liveOn, designId, setError]);
  return { live, liveOn, toggleLive: () => setLiveOn((on) => !on) };
}
