import { useEffect, useState } from "react";

/** True while the browser window matches the CSS media query, e.g. useMediaQuery("(min-width: 1024px)").
 *  Re-renders when the window is resized or the phone is rotated. */
export function useMediaQuery(query) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Same breakpoint as Tailwind's `lg:` (1024px and up = the desktop layout) */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
