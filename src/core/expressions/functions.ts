import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

export const standardFunctions: Record<string, (...args: any[]) => any> = {
    // ─── Text Functions ──────────────────────────────────────────────────────────
    lower: (val: any) => String(val ?? '').toLowerCase(),
    upper: (val: any) => String(val ?? '').toUpperCase(),
    trim: (val: any, cutset?: string) => {
        const str = String(val ?? '');
        if (!cutset) return str.trim();
        const escaped = cutset.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const regex = new RegExp(`^[${escaped}]+|[${escaped}]+$`, 'g');
        return str.replace(regex, '');
    },
    trimprefix: (val: any, prefix: any) => {
        const str = String(val ?? '');
        const p = String(prefix ?? '');
        return str.startsWith(p) ? str.slice(p.length) : str;
    },
    trimsuffix: (val: any, suffix: any) => {
        const str = String(val ?? '');
        const s = String(suffix ?? '');
        return str.endsWith(s) ? str.slice(0, str.length - s.length) : str;
    },
    startswith: (val: any, prefix: any) => {
        return String(val ?? '').startsWith(String(prefix ?? ''));
    },
    endswith: (val: any, suffix: any) => {
        return String(val ?? '').endsWith(String(suffix ?? ''));
    },
    replace: (val: any, substr: any, replacement: any) => {
        const str = String(val ?? '');
        const search = String(substr ?? '');
        const rep = String(replacement ?? '');
        return str.split(search).join(rep);
    },
    split: (sep: any, val: any) => {
        const str = String(val ?? '');
        const s = String(sep ?? '');
        return str.split(s);
    },
    join: (sep: any, list: any) => {
        const s = String(sep ?? '');
        if (!Array.isArray(list)) return String(list ?? '');
        return list.join(s);
    },
    format: (fmt: any, ...args: any[]) => {
        let str = String(fmt ?? '');
        let i = 0;
        return str.replace(/%[sdj%]/g, (match) => {
            if (match === '%%') return '%';
            if (i >= args.length) return match;
            const arg = args[i++];
            if (match === '%d') return String(Number(arg));
            if (match === '%j') return JSON.stringify(arg);
            return String(arg);
        });
    },
    substr: (val: any, offset: any, length: any) => {
        const str = String(val ?? '');
        const off = Number(offset);
        const len = Number(length);
        if (isNaN(off)) return str;
        if (isNaN(len)) return str.substring(off);
        return str.substring(off, off + len);
    },

    // ─── Logic & Collections ───────────────────────────────────────────────────
    coalesce: (...args: any[]) => {
        for (const arg of args) {
            if (arg !== null && arg !== undefined && arg !== '') {
                return arg;
            }
        }
        return '';
    },
    lookup: (map: any, key: any, defaultValue?: any) => {
        if (map && typeof map === 'object' && key in map) {
            return map[key];
        }
        return defaultValue !== undefined ? defaultValue : null;
    },
    contains: (list: any, val: any) => {
        if (Array.isArray(list)) {
            return list.some(item => item === val || String(item) === String(val));
        }
        if (typeof list === 'string') {
            return list.includes(String(val));
        }
        return false;
    },
    length: (val: any) => {
        if (Array.isArray(val) || typeof val === 'string') {
            return val.length;
        }
        if (val && typeof val === 'object') {
            return Object.keys(val).length;
        }
        return 0;
    },
    element: (list: any, index: any) => {
        if (!Array.isArray(list)) return null;
        const idx = Number(index);
        return list[idx % list.length];
    },
    slice: (list: any, start: any, end?: any) => {
        if (!Array.isArray(list)) return [];
        return list.slice(Number(start), end !== undefined ? Number(end) : undefined);
    },
    merge: (...maps: any[]) => {
        const result: Record<string, any> = {};
        for (const m of maps) {
            if (m && typeof m === 'object' && !Array.isArray(m)) {
                Object.assign(result, m);
            }
        }
        return result;
    },

    // ─── System / Environment / IO ─────────────────────────────────────────────
    env: (name: any) => {
        const key = String(name ?? '');
        return process.env[key] ?? '';
    },
    uuid: () => randomUUID(),
    timestamp: () => new Date().toISOString(),
    jsonencode: (val: any) => JSON.stringify(val),
    jsondecode: (str: any) => {
        try {
            return JSON.parse(String(str ?? ''));
        } catch {
            return null;
        }
    },
    file: (filePath: any, workDir: string = '.') => {
        try {
            const resolved = resolve(workDir, String(filePath));
            if (existsSync(resolved)) {
                return readFileSync(resolved, 'utf-8');
            }
        } catch {}
        return '';
    }
};
