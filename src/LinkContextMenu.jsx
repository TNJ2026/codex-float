import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, ExternalLink, FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { t, useLanguage } from './i18n';
import { copyText } from './message-actions';
import { useSettingsGlass } from './useSettingsGlass';

export function LinkContextMenu({ menu, onClose, onOpen }) {
  useLanguage();
  const root = useRef(),
    [position, setPosition] = useState({ left: menu.x, top: menu.y }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useLayoutEffect(() => {
    const element = root.current;
    if (element.showPopover) element.showPopover();
    else element.removeAttribute('popover');
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    });
  }, [error]);
  const glass = useSettingsGlass(root, true);
  useEffect(() => {
    root.current?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    const pointer = (event) => {
      if (!root.current?.contains(event.target)) onClose(false);
    };
    const dismiss = () => onClose(false);
    const focus = (event) => {
      if (event.target.closest?.('.settings-panel')) dismiss();
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('scroll', dismiss, true);
    document.addEventListener('focusin', focus);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('focusin', focus);
      window.removeEventListener('resize', dismiss);
    };
  }, []);
  function keyboard(event) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...root.current.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    buttons[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    ].focus();
  }
  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onClose(true);
    } catch (reason) {
      setError(t(String(reason.message || reason)));
      setBusy(false);
    }
  }
  const path = menu.target?.path;
  return createPortal(
    <div
      ref={root}
      popover="manual"
      className="permission-popup link-context-menu"
      data-native-glass={glass || undefined}
      style={position}
      role="menu"
      aria-label={t('链接操作')}
      onKeyDown={keyboard}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={busy || !menu.target}
        onClick={() => {
          onClose(true);
          onOpen(menu.value);
        }}
      >
        <ExternalLink size={14} />
        {t('打开链接')}
      </button>
      {path && (
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => run(() => invoke('open_file', { path }))}
        >
          <ExternalLink size={14} />
          {t('使用默认 App 打开')}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={() => run(() => copyText(path || menu.value))}
      >
        <Copy size={14} />
        {t(path ? '复制文件路径' : '复制链接地址')}
      </button>
      {path && (
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => run(() => invoke('reveal_file', { path }))}
        >
          <FolderOpen size={14} />
          {t('在文件夹中查看')}
        </button>
      )}
      {error && (
        <p className="model-popup-error" role="alert">
          {error}
        </p>
      )}
    </div>,
    menu.container,
  );
}
