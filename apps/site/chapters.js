import { arrive } from "./motion.js";

const clamp = (value) => Math.max(0, Math.min(1, value));
const smoother = (value) => value * value * value * (value * (value * 6 - 15) + 10);
// Each scene has its own acceleration and settling rhythm; scroll input remains native.
function rhythm(scene, value) {
  const t = clamp(value);
  if (scene === 1) return smoother(t ** 1.35);
  if (scene === 2) return 1 - (1 - t) ** 3;
  return smoother(t ** 1.7);
}
function slideTravel(progress) {
  const t = clamp(progress);
  // A short overshoot belongs to the canvas, never to the document scroll position.
  const shifted = t - 1;
  return 1 + 1.65 * shifted ** 3 + 0.65 * shifted ** 2;
}

export function mountChapters() {
  const chapters = [...document.querySelectorAll(".story-chapter")];
  if (!chapters.length) return;
  const surfaces = chapters.map((chapter) => chapter.querySelector(".chapter-surface"));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const desktop = matchMedia("(min-width: 1000px) and (min-height: 650px)");
  const anchors = ["main", "workspace", "playground", "get-started"];
  let enabled = false;
  let frame = 0;
  let scrollFrame = 0;
  let active = -1;
  let offsets = [];
  let heights = [];

  function paint() {
    frame = 0;
    if (!enabled || document.hidden) return;
    const available = innerHeight - 72;
    const y = scrollY;
    let selected = 0;
    offsets.forEach((offset, i) => {
      if (y + available * 0.48 >= offset) selected = i;
    });
    surfaces.forEach((surface, i) => {
      const nextTop = offsets[i + 1] === undefined ? innerHeight : offsets[i + 1] - y + 72;
      const progress = Math.max(0, Math.min(1, (innerHeight - nextTop) / available));
      surface.style.setProperty("--chapter-exit", String(progress));
      const entry = Math.max(0, Math.min(1, (offsets[i] - y) / available));
      surface.style.setProperty("--chapter-entry", String(entry));
      surface.style.setProperty("--chapter-travel", String(1 - slideTravel(1 - entry)));
      surface.style.setProperty("--chapter-aperture", String(rhythm(3, 1 - entry)));
      surface.style.setProperty("--chapter-depth", String(rhythm(i === 0 ? 1 : 2, progress)));
      surface.style.setProperty("--chapter-radius", `${entry * 40}px`);
    });
    if (selected !== active) {
      active = selected;
      if (active > 0) arrive(surfaces[active].querySelector("h2"), { duration: 380 });
    }
  }
  function requestPaint() {
    if (!frame && enabled) frame = requestAnimationFrame(paint);
  }
  function measure() {
    enabled = desktop.matches && !reduced.matches;
    document.documentElement.classList.toggle("chapter-motion", enabled);
    heights = surfaces.map((surface) => surface.offsetHeight);
    offsets = chapters.map((chapter) => chapter.getBoundingClientRect().top + scrollY - 72);
    chapters.forEach((chapter, i) => {
      surfaces[i].style.setProperty("--chapter-top", `${72 - Math.max(0, heights[i] - (innerHeight - 72))}px`);
      chapter.classList.toggle("chapter-fit", heights[i] <= innerHeight - 72 + 2);
      if (!enabled) {
        surfaces[i].style.removeProperty("--chapter-exit");
        surfaces[i].style.removeProperty("--chapter-radius");
        surfaces[i].style.removeProperty("--chapter-entry");
        surfaces[i].style.removeProperty("--chapter-travel");
        surfaces[i].style.removeProperty("--chapter-aperture");
        surfaces[i].style.removeProperty("--chapter-depth");
      }
    });
    requestPaint();
  }
  function cancelScroll() {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    document.documentElement.classList.remove("chapter-navigating");
  }
  function go(index) {
    cancelScroll();
    document.documentElement.classList.add("chapter-navigating");
    const start = scrollY;
    const target = Math.max(0, offsets[index]);
    if (Math.abs(target - start) < 1) {
      cancelScroll();
      return;
    }
    const started = performance.now();
    const origin = offsets.reduce(
      (closest, offset, i) => (Math.abs(offset - start) < Math.abs(offsets[closest] - start) ? i : closest),
      0,
    );
    const scene = Math.max(1, Math.max(origin, index));
    const duration = [0, 1050, 1150, 1350][scene];
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = rhythm(scene, t);
      window.scrollTo({ top: start + (target - start) * eased, behavior: "instant" });
      if (t < 1) scrollFrame = requestAnimationFrame(tick);
      else cancelScroll();
    };
    scrollFrame = requestAnimationFrame(tick);
  }
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (
      !enabled ||
      !link ||
      link.classList.contains("skip-link") ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const id = link.hash.slice(1) || "main";
    const index = anchors.indexOf(id);
    if (index < 0) return;
    event.preventDefault();
    history.pushState(null, "", `#${id}`);
    go(index);
  });
  // Wheel/touch remain native; nested editors and long chapters are never trapped.
  window.addEventListener("scroll", requestPaint, { passive: true });
  window.addEventListener("wheel", cancelScroll, { passive: true });
  window.addEventListener("touchstart", cancelScroll, { passive: true });
  window.addEventListener("pointerdown", cancelScroll, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (!event.defaultPrevented) cancelScroll();
  });
  window.addEventListener("resize", measure);
  window.addEventListener("popstate", () => {
    const index = anchors.indexOf(location.hash.slice(1) || "main");
    if (enabled && index >= 0) go(index);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelScroll();
      cancelAnimationFrame(frame);
      frame = 0;
    } else requestPaint();
  });
  reduced.addEventListener("change", () => {
    cancelScroll();
    measure();
  });
  desktop.addEventListener("change", () => {
    cancelScroll();
    measure();
  });
  new ResizeObserver(measure).observe(document.querySelector("main"));
  const resize = new ResizeObserver(measure);
  surfaces.forEach((surface) => resize.observe(surface));
  new MutationObserver(() => {
    measure();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  measure();
}
