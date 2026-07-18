

/**
 * Minimal motion helpers - fade/slide/scale only, no library.
 * Covers the same ground Framer Motion would for effects this subtle;
 * this is genuinely all the reference apps' actual motion amounts to.
 */

function fadeSlideIn(el, { delay = 0, distance = 6 } = {}) {
  el.style.opacity = "0";
  el.style.transform = `translateY(${distance}px)`;
  el.style.transition = `opacity 0.18s ease ${delay}ms, transform 0.18s ease ${delay}ms`;
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
}

function fadeScaleIn(el, { delay = 0 } = {}) {
  el.style.opacity = "0";
  el.style.transform = "scale(0.96)";
  el.style.transition = `opacity 0.16s ease ${delay}ms, transform 0.16s ease ${delay}ms`;
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "scale(1)";
  });
}

function fadeIn(el, { delay = 0 } = {}) {
  el.style.opacity = "0";
  el.style.transition = `opacity 0.15s ease ${delay}ms`;
  requestAnimationFrame(() => {
    el.style.opacity = "1";
  });
}
