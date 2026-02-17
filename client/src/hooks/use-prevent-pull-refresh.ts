import { useEffect } from "react";

export function usePreventPullRefresh() {
  useEffect(() => {
    let startY = 0;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 1) {
        startY = e.touches[0].clientY;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) {
        let el = e.target as HTMLElement | null;
        let scrollableParent: HTMLElement | null = null;
        while (el) {
          if (el.scrollTop > 0) {
            scrollableParent = el;
            break;
          }
          el = el.parentElement;
        }
        if (!scrollableParent && window.scrollY === 0) {
          e.preventDefault();
        }
      }
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);
}
