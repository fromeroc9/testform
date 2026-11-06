import { existsSync, readdirSync } from 'fs';
import { resolve, extname } from 'path';
import { pathToFileURL } from 'url';
import { PolicyDefinition } from './types';

export class PolicyLoader {
    public static async loadCustomPolicies(dir: string, registerFn: (policy: PolicyDefinition) => void): Promise<string[]> {
        const candidateDirs = [
            resolve(dir, '.testform', 'policies'),
            resolve(dir, 'policies'),
        ];

        // Modules support: .testform/modules/*/policies and .testform/modules/*/.testform/policies
        const modulesDir = resolve(dir, '.testform', 'modules');
        if (existsSync(modulesDir)) {
            try {
                const entries = readdirSync(modulesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        candidateDirs.push(resolve(modulesDir, entry.name, 'policies'));
                        candidateDirs.push(resolve(modulesDir, entry.name, '.testform', 'policies'));
                    }
                }
            } catch {
                // Ignore unreadable modules directory
            }
        }

        const loadedFiles: string[] = [];
        const validExts = ['.js', '.mjs', '.cjs', '.ts'];

        for (const cDir of candidateDirs) {
            if (!existsSync(cDir)) continue;
            try {
                const files = readdirSync(cDir, { withFileTypes: true });
                for (const file of files) {
                    if (file.isFile()) {
                        const ext = extname(file.name).toLowerCase();
                        if (validExts.includes(ext)) {
                            const fullPath = resolve(cDir, file.name);
                            await this.loadPolicyFile(fullPath, registerFn);
                            loadedFiles.push(fullPath);
                        }
                    }
                }
            } catch {
                // Ignore directory read errors
            }
        }

        return loadedFiles;
    }

    private static async loadPolicyFile(filePath: string, registerFn: (policy: PolicyDefinition) => void): Promise<void> {
        let loadedModule: any;
        try {
            loadedModule = await import(pathToFileURL(filePath).href);
        } catch {
            try {
                loadedModule = require(filePath);
            } catch {
                return;
            }
        }

        const exported = loadedModule?.default || loadedModule;
        if (!exported) return;

        // 1. Direct policy definition: { id, scope, action, description, severity }
        if (exported.id && Array.isArray(exported.scope) && typeof exported.action === 'function') {
            registerFn(exported);
            return;
        }

        // 2. Array of policy definitions: [{ id, ... }, { id, ... }]
        if (Array.isArray(exported)) {
            for (const item of exported) {
                if (item?.id && Array.isArray(item.scope) && typeof item.action === 'function') {
                    registerFn(item);
                }
            }
            return;
        }

        // 3. Factory function: (context) => void
        if (typeof exported === 'function') {
            try {
                exported({
                    registerPolicy: registerFn,
                });
            } catch {
                // Ignore factory invocation error
            }
        }
    }
}
