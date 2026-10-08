/* Test-only ESM loader: stub out `import './x.css'` side-effect imports.
 * Plain node --test cannot load .css; the HUD is the only ops3d module
 * with a css import, so map it to an empty module. Registered from the
 * test file via `module.register()` — no flags, no runner changes. */
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.css')) {
    return { url: 'data:text/javascript,export default {};', shortCircuit: true };
  }
  return next(specifier, context);
}
