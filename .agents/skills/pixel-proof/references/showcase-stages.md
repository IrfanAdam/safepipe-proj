# Showcase specimen stages

How to build a gallery so every specimen renders and captures correctly — one framed stage per component, layers contained inside it.

## One stage per specimen, identical anatomy

Each specimen gets the same frame: a bordered, rounded stage with a dotted background, one centred trigger (or anchor), and a caption under it (note + `Spec · …` link). Identical anatomy across specimens is what makes the panel read as a product rather than a pile of demos — a stage that differs in height, background or trigger placement is the defect the user reports as "all over the place, no layout that makes sense".

```css
.ov-stage {
  position: relative;
  display: flex;                 /* flex centring: an in-flow trigger centres on both axes */
  align-items: center;
  justify-content: center;
  height: calc(var(--spacing-16) * 4);
  padding: var(--spacing-6);
  background-color: var(--bg-primary);
  background-image: radial-gradient(circle at 1px 1px, var(--border-default) 1px, transparent 0);
  background-size: var(--spacing-4) var(--spacing-4);
  border: var(--border-width-thin) solid var(--border-thin);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: padding-right var(--transition-spring);
}
```

## The stage owns its layers' geometry

Scope every layer's anchoring in the demo stylesheet, never leave it to the component's base rule alone. An absolutely positioned layer whose `position`/`right` comes only from a base stylesheet lands at its **static position** the moment that rule is missing, stale, or overridden — which inside a centring stage means the layer floats in the middle with dotted space on both sides. That reads as a layout bug to the user even though the component code is fine.

```css
.ov-stage .overlay { position: absolute; inset: 0; }                 /* scrim fills the stage, not the viewport */
.ov-stage .drawer  { position: absolute; top: 0; right: 0; left: auto; height: 100%; }
.ov-stage .toast-region { position: absolute; bottom: var(--spacing-4); right: var(--spacing-4); }
.ov-anchor .menu, .ov-anchor .popover { position: absolute; top: calc(100% + var(--spacing-1)); left: 0; }
```

Docked layers stay flush inside the stage's border (a 1px gap = the border itself), and the stage's `overflow: hidden` keeps a layer from painting outside it.

## A docked layer takes its lane

When a layer docks to one side, the in-flow trigger must not sit under it or look pushed against it: give the stage a padding equal to the layer's width while it is open, and the trigger re-centres in the space that is left. Transition the padding on the *same* easing as the slide so the two move together; the `--open` class is removed when the exit starts, so the padding retracts in step with the layer sliding out.

```css
.ov-stage:has(.drawer--open) { padding-right: calc(var(--spacing-6) + min(calc(var(--spacing-16) * 6), 85vw)); }
```

Mirror the component's own width expression (`min(calc(var(--spacing-16) * 6), 85vw)`) rather than hardcoding a number, and assert it numerically: trigger↔lane centre `0` while open, trigger↔stage centre `0` while closed, padding passing through intermediate values (~223 → 363 → 408 px) during the 400 ms spring.

## Open-state deep links

A gallery that can only be verified by clicking cannot be verified in a browser you cannot script. Let the shell open a layer from the URL, after the fetched panel has landed:

```js
const dsOpenParam = () => {
  const id = new URLSearchParams(location.search).get('open');
  if (!id) return;
  const t = document.querySelector('[data-overlay-target="' + id + '"]'), el = document.getElementById(id);
  if (t && el && el.hidden) t.click();          // idempotent: only fires while hidden
};
document.addEventListener('ds:doc', dsOpenParam);                                  // panel landed
// deferred modules (the overlay engine) run before DOMContentLoaded — earliest safe retry
document.addEventListener('DOMContentLoaded', () => [0, 250, 700].forEach(ms => setTimeout(dsOpenParam, ms)));
```

- A classic `<script>` shell runs *before* the deferred `<script type="module">` engine, so a click fired from the shell's first pass has no listener yet and silently does nothing. Retry; never conclude the feature is broken from one silent click.
- Guard every retry with the layer's own `hidden` rather than a one-shot flag: a flag set by a no-op click blocks the retry that would have worked, while `hidden` also makes the retry safe after the user has closed the layer.
- Ship the deep link as a feature (`?open=<layer-id>#<panel>`), not a debug hook: it makes every open state shareable and screenshot-able in one step.

## Motion inside the stage

- Entrance: remove `hidden`, force a reflow tick (`el.offsetWidth`), then add the open class so the first paint animates instead of snapping.
- Exit: add a closing class that drives the reverse transition, keep the element unhidden for the exit duration (`transitionend` with a timeout fallback), then set `hidden` — hiding in the same frame kills the dismissal and is what users report as "no smooth dismissal".
- Guard `@media (prefers-reduced-motion: reduce)` in every layer stylesheet, and check the user's OS setting (`defaults read com.apple.universalaccess reduceMotion`) before blaming the code for a snap.
