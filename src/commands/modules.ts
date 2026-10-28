import { resolve } from 'path';
import { ModuleRegistry, isGitSource, parseGitSource } from '../core/module';

export interface ModulesCmdOptions {
    dir?: string;
    isJson?: boolean;
}

export const modulesCmd = async (options: ModulesCmdOptions = {}) => {
    const { dir = '.', isJson = false } = options;
    const workDir = resolve(process.cwd(), dir);
    const registry = new ModuleRegistry(workDir);
    const declared = registry.getDeclaredModules();

    if (declared.size === 0) {
        if (isJson) {
            console.log(JSON.stringify({ format_version: '1.0', modules: null }));
        } else {
            console.log('No modules found in configuration.');
        }
        return;
    }

    if (isJson) {
        const modulesList: any[] = [];
        for (const [name, decl] of declared.entries()) {
            let version = decl.version || '';
            if (!version && isGitSource(decl.source)) {
                const parsed = parseGitSource(decl.source);
                if (parsed.ref) {
                    version = parsed.ref;
                }
            }

            modulesList.push({
                key: name,
                source: decl.source,
                version: version
            });
        }
        console.log(JSON.stringify({ format_version: '1.0', modules: modulesList }));
        return;
    }

    const entries = Array.from(declared.entries());
    console.log(`Modules declared by configuration:\n.`);
    entries.forEach(([name, decl], index) => {
        const isLast = index === entries.length - 1;
        const branch = isLast ? '└──' : '├──';
        let version = decl.version || '';
        if (!version && isGitSource(decl.source)) {
            const parsed = parseGitSource(decl.source);
            if (parsed.ref) {
                version = parsed.ref;
            }
        }
        const versionSuffix = version ? ` ${version}` : '';
        console.log(`${branch} "${name}"[${decl.source}]${versionSuffix}`);
    });
};
