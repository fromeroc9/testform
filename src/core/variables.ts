import { readFileSync, existsSync } from 'fs';
import { logger } from '../core/logger';
import { logger as notify } from '../core/logger';

export class VariableParser {
    private vars: Record<string, string> = {};
    private workDir: string;

    constructor(varArgs?: string | string[], varFileArgs?: string | string[], workDir: string = '.') {
        this.workDir = workDir;
        this.parseVarFiles(varFileArgs);
        this.parseVars(varArgs);
    }

    private parseVars(varArgs?: string | string[]) {
        if (!varArgs) return;
        const items = Array.isArray(varArgs) ? varArgs : [varArgs];

        for (const item of items) {
            const idx = item.indexOf('=');
            if (idx === -1) {
                notify.push({
                    type: 'warning',
                    title: `Invalid variable format: ${item}`,
                    detail: ['Variables must be in the format key=value']
                });
                continue;
            }
            const key = item.substring(0, idx).trim();
            const value = item.substring(idx + 1).trim();
            this.vars[key] = value;
        }
    }

    private parseVarFiles(varFileArgs?: string | string[]) {
        if (!varFileArgs) return;
        const items = Array.isArray(varFileArgs) ? varFileArgs : [varFileArgs];

        for (let filePath of items) {
            const path = require('path');
            filePath = path.resolve(this.workDir, filePath);
            
            if (!existsSync(filePath)) {
                notify.push({
                    type: 'error',
                    title: `Variable file not found: ${filePath}`,
                    detail: [],
                    close: true
                });
                process.exit(1);
            }

            try {
                const content = readFileSync(filePath, 'utf-8');
                let fileVars: Record<string, string> = {};
                
                if (filePath.endsWith('.json')) {
                    fileVars = JSON.parse(content);
                } else {
                    // Simple tfvars format parser (key = "value")
                    const lines = content.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
                        
                        const idx = trimmed.indexOf('=');
                        if (idx !== -1) {
                            const key = trimmed.substring(0, idx).trim();
                            let value = trimmed.substring(idx + 1).trim();
                            // Remove surrounding quotes if present
                            if (value.startsWith('"') && value.endsWith('"')) {
                                value = value.substring(1, value.length - 1);
                            } else if (value.startsWith("'") && value.endsWith("'")) {
                                value = value.substring(1, value.length - 1);
                            }
                            fileVars[key] = value;
                        }
                    }
                }

                // Merge into existing vars
                this.vars = { ...this.vars, ...fileVars };
            } catch (error: any) {
                notify.push({
                    type: 'error',
                    title: `Failed to parse variable file: ${filePath}`,
                    detail: [error.message],
                    close: true
                });
                process.exit(1);
            }
        }
    }

    public getVars(): Record<string, string> {
        return this.vars;
    }

    /**
     * Replaces ${var.name} in the given template string
     * with the corresponding values from the variables.
     */
    public applyToTemplate(template: string): string {
        let result = template;
        
        // Match ${var.NAME}
        const regex = /\$\{var\.([a-zA-Z0-9_-]+)\}/g;
        result = result.replace(regex, (match, key) => {
            return this.vars[key] !== undefined ? this.vars[key] : match;
        });

        return result;
    }
}
