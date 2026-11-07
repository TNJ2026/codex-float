import './fluent.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MacOSWindow} from './platform/MacOSWindow';
import {WindowsWindow} from './platform/WindowsWindow';
import {readTheme} from './theme';
import {readAppearance,applyTransparency} from './appearance';
import {getLanguage} from './i18n';

const native=!!window.__TAURI_INTERNALS__;
const macOS=native&&window.__CODEX_FLOAT_PLATFORM__==='macos';
const root=document.documentElement;
root.lang=getLanguage();
root.dataset.windowPlatform=native?(macOS?'macos':'windows'):'browser';
root.dataset.theme=readTheme(localStorage);
applyTransparency(root,readAppearance(localStorage).transparency);

const App=macOS?MacOSWindow:WindowsWindow;
createRoot(document.getElementById('root')).render(<App/>);
