// Finite, interruptible motion: state changes never wait for an animation.
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const active = new Map();
export function cancelWithin(container) {
  for (const [element, animation] of active) {
    if (container.contains(element)) {
      animation.cancel();
      active.delete(element);
    }
  }
}
export function move(element, frames, options = {}) {
  if (!element) return;
  active.get(element)?.cancel();
  active.delete(element);
  if (preference.matches || document.hidden || !element.animate) return;
  const animation = element.animate(frames, {
    duration: 220,
    easing: "cubic-bezier(.22,1,.36,1)",
    ...options,
  });
  active.set(element, animation);
  const release = () => {
    if (active.get(element) === animation) active.delete(element);
  };
  animation.onfinish = release;
  animation.oncancel = release;
  return animation;
}
export function arrive(element, options) {
  return move(
    element,
    [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    options,
  );
}
function stop() {
  for (const animation of active.values()) animation.cancel();
  active.clear();
}
preference.addEventListener("change", () => {
  if (preference.matches) stop();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});

export function signalBetween(container, nodes, duration = 600) {
  if (!container || !container.animate || preference.matches || document.hidden) return;
  const previous = container.querySelector(".motion-signal");
  if (previous) {
    cancelWithin(previous);
    previous.remove();
  }
  const bounds = container.getBoundingClientRect();
  if (!bounds.width || !bounds.height || bounds.bottom < 0 || bounds.top > innerHeight) return;
  const points = nodes.filter(Boolean).map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top };
  });
  if (points.length < 2) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("motion-signal");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  const path = document.createElementNS(svg.namespaceURI, "path");
  // Neighbors are separate relationships, never a fabricated neighbor-to-neighbor chain.
  path.setAttribute(
    "d",
    points
      .slice(1)
      .map((p) => `M${points[0].x} ${points[0].y}L${p.x} ${p.y}`)
      .join(" "),
  );
  const dot = document.createElementNS(svg.namespaceURI, "circle");
  dot.setAttribute("r", "4");
  svg.append(path, dot);
  container.append(svg);
  const frames = Array.from({ length: 31 }, (_, index) => {
    const fraction = index / 30;
    const point = {
      x: points[0].x + (points[1].x - points[0].x) * fraction,
      y: points[0].y + (points[1].y - points[0].y) * fraction,
    };
    return { transform: `translate(${point.x}px, ${point.y}px)`, opacity: index === 30 ? 0 : 1 };
  });
  move(dot, frames, { duration, easing: "linear" });
  const fade = move(svg, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay: duration });
  if (fade)
    fade.onfinish = fade.oncancel = () => {
      active.delete(svg);
      svg.remove();
    };
}
