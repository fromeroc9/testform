import { bold, cyan, dim, green, yellow } from 'chalk';
import { resolve, relative, dirname } from 'path';
import { existsSync, statSync } from 'fs';
import { ModuleRegistry, isGitSource, parseGitSource } from '../core/module';
import { TITLE_CLI } from '../core/const';

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
        const modulesList: any[] = [
            {
                Key: '',
                Source: '',
                Dir: '.'
            }
        ];
        for (const [name, decl] of declared.entries()) {
            const isGit = isGitSource(decl.source);
            let installedDir: string = decl.source;
            const dotTestform = resolve(workDir, '.testform', 'modules', name);
            if (existsSync(dotTestform)) {
                installedDir = relative(workDir, dotTestform).replace(/\\/g, '/');
            } else if (!isGit) {
                const localPath = resolve(workDir, decl.source);
                if (existsSync(localPath)) {
                    installedDir = relative(workDir, statSync(localPath).isFile() ? dirname(localPath) : localPath).replace(/\\/g, '/');
                }
            }

            const modObj: Record<string, any> = {
                Key: name,
                Source: decl.source
            };
            if (isGit) {
                const parsed = parseGitSource(decl.source);
                if (parsed.ref) {
                    modObj.Version = parsed.ref;
                }
            }
            modObj.Dir = installedDir || '.';

            modulesList.push(modObj);
        }
        console.log(JSON.stringify({ format_version: '1.0', modules: modulesList }));
        return;
    }

    const entries = Array.from(declared.entries());
    console.log(`\n${bold('Modules declared in configuration:')}\n.`);
    entries.forEach(([name, decl], index) => {
        const isLast = index === entries.length - 1;
        const branch = isLast ? '└──' : '├──';
        const pipe = isLast ? '   ' : '│  ';
        const isGit = isGitSource(decl.source);

        console.log(`${branch} ${cyan(`module.${name}`)}`);
        console.log(`${pipe}   ${dim('source:')} ${decl.source}`);

        if (isGit) {
            const parsed = parseGitSource(decl.source);
            if (parsed.ref) {
                console.log(`${pipe}   ${dim('version:')} ${parsed.ref}`);
            }
            const dotTestform = resolve(workDir, '.testform', 'modules', name);
            if (existsSync(dotTestform)) {
                console.log(`${pipe}   ${dim('dir:')} .testform/modules/${name}`);
            }
        }

        if (decl.scenario) {
            console.log(`${pipe}   ${dim('scenario:')} ${decl.scenario}`);
        }

        if (decl.vars && Object.keys(decl.vars).length > 0) {
            const varStrs = Object.entries(decl.vars).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
            console.log(`${pipe}   ${dim('vars:')} ${varStrs.join(', ')}`);
        }

        if (decl.outputs && Object.keys(decl.outputs).length > 0) {
            console.log(`${pipe}   ${dim('outputs:')} ${Object.keys(decl.outputs).join(', ')}`);
        }
    });
    console.log('');
};
