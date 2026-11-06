import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { providersCmd } from '../src/commands/providers';
import { resource } from '../src/core/resources';
import { getCommandHelp } from '../src/core/help';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Providers Resource Subcommand and Management', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-providers-resource-test-'));
    });

    afterEach(() => {
        try {
            rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Ignore
        }
    });

    it('should provide Terraform-style help for providers resource subcommand', () => {
        const help = getCommandHelp('providers resource');
        expect(help).toBeDefined();
        expect(help).toContain('Usage: testform [global options] providers resource [action] [name] [options]');
        expect(help).toContain('list');
        expect(help).toContain('show <name>');
        expect(help).toContain('scaffold <name>');
        expect(help).toContain('-json');
    });

    it('should scaffold a new custom resource template via providers resource scaffold', async () => {
        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => logs.push(args.join(' '));

        try {
            await providersCmd({
                dir: tmpDir,
                action: 'resource',
                args: ['scaffold', 'pokemon_badge']
            });

            const targetFile = join(tmpDir, '.testform', 'resources', 'pokemon_badge.ts');
            expect(existsSync(targetFile)).toBe(true);

            const content = readFileSync(targetFile, 'utf-8');
            expect(content).toContain('pokemon_badgeResource');
            expect(content).toContain('type: "pokemon_badge"');
            expect(content).toContain('attributes:');
            expect(content).toContain('state:');
            expect(content).toContain('lifecycle:');

            const output = logs.join('\n');
            expect(output).toContain('Successfully scaffolded custom resource template');
            expect(output).toContain('pokemon_badge');
        } finally {
            console.log = originalLog;
        }
    });

    it('should scaffold with --json output via providersCmd', async () => {
        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => logs.push(args.join(' '));

        try {
            await providersCmd({
                dir: tmpDir,
                action: 'resource',
                args: ['scaffold', 'custom_order'],
                isJson: true
            });

            const output = logs.join('\n').trim();
            const parsed = JSON.parse(output);
            expect(parsed.scaffold).toBe('custom_order');
            expect(parsed.path).toContain('custom_order.ts');
            expect(existsSync(parsed.path)).toBe(true);
        } finally {
            console.log = originalLog;
        }
    });

    it('should list registered resource templates as JSON via providers resource', async () => {
        // Register a mock resource template
        resource.registry({
            type: 'test_item',
            attributes: () => ({ foo: 'bar' })
        }, 'user');

        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => logs.push(args.join(' '));

        try {
            await providersCmd({
                dir: tmpDir,
                action: 'resource',
                args: ['list'],
                isJson: true
            });

            const output = logs.join('\n').trim();
            const parsed = JSON.parse(output);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed).toContain('test_item');
        } finally {
            console.log = originalLog;
        }
    });

    it('should show template details via providers resource show', async () => {
        resource.registry({
            type: 'detailed_item',
            attributes: () => ({ title: 'item' }),
            state: { status: () => 'active' }
        }, 'user');

        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => logs.push(args.join(' '));

        try {
            await providersCmd({
                dir: tmpDir,
                action: 'resource',
                args: ['show', 'detailed_item'],
                isJson: true
            });

            const output = logs.join('\n').trim();
            const parsed = JSON.parse(output);
            expect(parsed.type).toBe('detailed_item');
            expect(parsed.state).toBeDefined();
        } finally {
            console.log = originalLog;
        }
    });
});
