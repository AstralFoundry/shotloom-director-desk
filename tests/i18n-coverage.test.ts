import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { english } from '../src/shared/i18n/en.ts';
import { panelEnglish } from '../src/shared/i18n/en-panels.ts';
import { assetEnglish } from '../src/shared/i18n/en-assets.ts';

/**
 * The English UI is only as good as its dictionary. This test walks the shipped components,
 * collects every literal passed to `t(...)` (plus the help dialog's [keys, description] rows)
 * and fails when a Chinese source string has no English entry — the regression that quietly
 * produced a half-translated interface.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DICTIONARY: Record<string, string> = { ...english, ...panelEnglish, ...assetEnglish };

function fileURLToPath(url: URL): string {
    return decodeURIComponent(url.pathname);
}

function componentFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...componentFiles(full));
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
    return files;
}

/** Keys resolved by the dynamic patterns in `englishText`, so they are not gaps. */
function handledDynamically(key: string): boolean {
    const unit = /^(.*?) \/ (米|秒|度|m|s|°)$/.exec(key);
    if (unit && DICTIONARY[unit[1]]) return true;
    const library = /^(基础|内置) \/ (.+)$/.exec(key);
    if (library && DICTIONARY[library[2]]) return true;
    if (/ · [\d.]+ 秒( · 待映射)?$/.test(key)) return true;
    return false;
}

function untranslatedKeys(): Map<string, string> {
    const missing = new Map<string, string>();
    const files = [...componentFiles(path.join(ROOT, 'src/features')), ...componentFiles(path.join(ROOT, 'src/app'))];
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        const relative = path.relative(ROOT, file);
        for (const match of source.matchAll(/\bt\(\s*'([^'\\]+)'\s*\)/g)) {
            const key = match[1];
            if (!/[\u4e00-\u9fff]/.test(key)) continue;
            if (DICTIONARY[key] || handledDynamically(key)) continue;
            if (!missing.has(key)) missing.set(key, relative);
        }
    }
    const help = fs.readFileSync(path.join(ROOT, 'src/features/dialogs/help-dialog.tsx'), 'utf8');
    // Rows are [keys, description]; both columns are rendered. Key glyphs such as
    // "Ctrl / ⌘ + Z" need no translation, so only Chinese text is required to resolve.
    for (const match of help.matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)) {
        for (const key of [match[1], match[2]]) {
            if (!/[\u4e00-\u9fff]/.test(key)) continue;
            if (DICTIONARY[key] || handledDynamically(key)) continue;
            if (!missing.has(key)) missing.set(key, 'src/features/dialogs/help-dialog.tsx');
        }
    }
    return missing;
}

test('every Chinese UI string has an English dictionary entry', () => {
    const missing = [...untranslatedKeys()].map(([key, file]) => `  ${key}   (${file})`);
    assert.deepEqual(missing, [], `Untranslated strings found:\n${missing.join('\n')}`);
});
