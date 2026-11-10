import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/shared/styles/global.css';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { App } from './App.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

if (import.meta.env.DEV) {
    // Debug handle for the smoke script and the browser console; never part of a release build.
    Object.assign(window, { __editorDebug: { session, store: useEditorStore } });
}

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
