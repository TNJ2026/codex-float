import { useLayoutEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

let queue = Promise.resolve();
const surfaces = [];
const topSurface = () => surfaces.at(-1);

export function useSettingsGlass(
  panel,
  open,
  mode = document.documentElement.dataset.windowPlatform === 'macos'
    ? document.documentElement.dataset.nativeBackground
    : undefined,
) {
  const [nativeGlass, setNativeGlass] = useState(false);
  useLayoutEffect(() => {
    if (!open || mode !== 'liquid-glass') return;
    const surface = panel.current;
    if (!surface) return;
    const previous = topSurface();
    previous?.suspend();
    const entry = {
      surface,
      update: () => update(),
      suspend: () => {
        applied = false;
        restore();
        setNativeGlass(false);
      },
    };
    surfaces.push(entry);
    let active = true,
      applied = false;
    const originals = new Map();
    const restore = () => {
      for (const [element, value] of originals) element.style.clipPath = value;
      originals.clear();
    };
    const mask = () => {
      const bounds = panel.current?.getBoundingClientRect();
      if (!bounds) return;
      // Remove only the HTML content directly below the native glass surface.
      // Other chat content stays visible, and the popup keeps receiving events.
      const elements = new Set([
        ...document.querySelectorAll(
          '.chat-panel > :not(.browser-brand):not(.settings-control), .file-preview[open], .mcp-app-card.expanded, .rich-preview.expanded',
        ),
        ...surfaces.map((entry) => entry.surface),
      ]);
      for (const element of elements) {
        if (element.contains(surface)) continue;
        if (!originals.has(element)) originals.set(element, element.style.clipPath);
        const box = element.getBoundingClientRect(),
          x = bounds.left - box.left,
          y = bounds.top - box.top,
          r = x + bounds.width,
          b = y + bounds.height;
        element.style.clipPath = `polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${x}px ${y}px,${r}px ${y}px,${r}px ${b}px,${x}px ${b}px,${x}px ${y}px,0 0)`;
      }
    };
    const update = () => {
      if (!active || topSurface() !== entry) return;
      const bounds = panel.current?.getBoundingClientRect();
      if (!bounds || !bounds.width || !bounds.height) return;
      const rect = [bounds.left, bounds.top, bounds.width, bounds.height];
      if (applied) mask();
      // Serialize updates and teardown so an in-flight resize cannot resurrect
      // the native backdrop after the user has closed settings.
      queue = queue
        .then(() => active && topSurface() === entry && invoke('settings_backdrop', { rect }))
        .then((result) => {
          if (!active || topSurface() !== entry) return;
          applied = !!result;
          setNativeGlass(applied);
          if (applied) mask();
          else restore();
        })
        .catch(() => {
          if (active && topSurface() === entry) {
            applied = false;
            setNativeGlass(false);
            restore();
          }
        });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (panel.current) observer?.observe(panel.current);
    const visibility =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
    visibility?.observe(surface, { attributes: true, attributeFilter: ['open'] });
    window.addEventListener('resize', update);
    return () => {
      active = false;
      observer?.disconnect();
      visibility?.disconnect();
      window.removeEventListener('resize', update);
      restore();
      setNativeGlass(false);
      const wasTop = topSurface() === entry;
      surfaces.splice(surfaces.indexOf(entry), 1);
      if (wasTop) {
        if (topSurface()) topSurface().update();
        else
          queue = queue
            .then(() => !topSurface() && invoke('settings_backdrop', { rect: null }))
            .catch(() => {});
      }
    };
  }, [open, mode, panel]);
  return nativeGlass;
}
