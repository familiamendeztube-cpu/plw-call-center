/** True when the person asked the system for less motion. The global CSS rule only covers CSS
 *  animations; anything started from JavaScript (element.animate) has to check this itself. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const SPARK_COLORS = ['#9CC2FF', '#4D8DFF', '#FCD34D', '#86EFAC'];
const SPARK_COUNT = 12;

/**
 * A short burst of sparks flying out from behind a spot on screen, for a moment worth
 * celebrating (a sale won, a follow-up done). Takes a rectangle measured before any await, so
 * it still works when the button that started it has already left the page. Lives on its own
 * layer in <body> and removes itself when the sparks fade.
 */
export function sparkBurst(origin: DOMRect): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const layer = document.createElement('div');
  if (typeof layer.animate !== 'function') return;
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60;overflow:hidden';
  document.body.append(layer);

  const centerX = origin.left + origin.width / 2;
  const centerY = origin.top + origin.height / 2;
  const sparks = Array.from({ length: SPARK_COUNT }, (_, index) => {
    const angle = (index / SPARK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Start on the edge of the element, so the sparks seem to come from behind it.
    const startX = centerX + (cos * origin.width) / 2;
    const startY = centerY + (sin * origin.height) / 2;
    const distance = 16 + Math.random() * 20;
    const spark = document.createElement('span');
    spark.style.cssText = `position:absolute;left:${startX}px;top:${startY}px;width:9px;height:2px;border-radius:9999px;background:${SPARK_COLORS[index % SPARK_COLORS.length]}`;
    layer.append(spark);
    const turn = `rotate(${angle}rad)`;
    return spark.animate(
      [
        { transform: `translate(-50%, -50%) ${turn} scaleX(1)`, opacity: 1 },
        {
          transform: `translate(calc(-50% + ${cos * distance}px), calc(-50% + ${sin * distance}px)) ${turn} scaleX(0.2)`,
          opacity: 0,
        },
      ],
      {
        duration: 450 + Math.random() * 200,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        fill: 'forwards',
      }
    );
  });
  void Promise.allSettled(sparks.map((spark) => spark.finished)).then(() => layer.remove());
}
