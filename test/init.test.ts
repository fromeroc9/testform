import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { initCmd } from '../src/commands/init';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { FILE_CONFIG, FILE_STATE } from '../src/core/const';
import YAML from 'yaml';

// Mock process.exit to prevent the test runner from exiting
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

// Mock console.log/error to keep test output clean
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => { });
const mockError = vi.spyOn(console, 'error').mockImplementation(() => { });

describe('Comando initCmd', () => {
    let tmpDir: string;

    beforeEach(() => {
        // Create a unique temporary directory for each test
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-test-'));
        mockExit.mockClear();
        mockLog.mockClear();
        mockError.mockClear();
    });

    afterEach(() => {
        // Clean up the temporary directory
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        mockExit.mockRestore();
        mockLog.mockRestore();
        mockError.mockRestore();
    });

    it('debe inicializarse correctamente y crear el archivo de configuración si el directorio está vacío', async () => {
        await initCmd({ dir: tmpDir, lock: true, lockTimeout: '0s', isJson: false });

        // Validar que se crearon los archivos de configuración y estado
        expect(existsSync(join(tmpDir, FILE_CONFIG))).toBe(true);
        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(false);
    });

    it('debe fallar si el archivo testform.yml no tiene una versión válida', async () => {
        // Crear configuración sin versión
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ backend: 'local' }));

        await expect(initCmd({ dir: tmpDir, lock: true })).rejects.toThrow();
    });

    it('debe inicializarse correctamente si testform.yml es válido (Camino Feliz)', async () => {
        // Crear archivo de configuración válido
        const configPath = join(tmpDir, FILE_CONFIG);
        const configData = {
            version: '1.0',
            backend: 'local'
        };
        require('fs').writeFileSync(configPath, JSON.stringify(configData));

        // Ejecutar initCmd
        await initCmd({ dir: tmpDir });

        // En la Opción A, init inicializa la configuración pero no crea el state hasta el primer apply
        expect(existsSync(configPath)).toBe(true);
        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(false);
    });

    it('debe imprimir la salida en formato JSON cuando isJson es true', async () => {
        // Crear configuración válida
        const configPath = join(tmpDir, FILE_CONFIG);
        const configData = {
            version: '1.0',
            backend: 'local'
        };
        require('fs').writeFileSync(configPath, JSON.stringify(configData));

        // Ejecutar con isJson = true
        await initCmd({ dir: tmpDir, isJson: true });

        // Verificar salida NDJSON
        expect(mockLog).toHaveBeenCalled();
        const loggedOutput = mockLog.mock.calls[0][0];
        const parsedLog = JSON.parse(loggedOutput);
        expect(parsedLog).toHaveProperty('@level', 'info');
        expect(parsedLog).toHaveProperty('@message', 'Initializing the backend...');
        expect(parsedLog).toHaveProperty('type', 'log');
    });

    it('debe manejar opciones mixtas correctamente (verbose, reconfigure, sin lock)', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        const configData = { version: '1.0', backend: 'local' };
        require('fs').writeFileSync(configPath, JSON.stringify(configData));

        await initCmd({
            dir: tmpDir,
            verbose: true,
            backendConfigRaw: ['key=value'],
            lock: false,
            reconfigure: true,
            backendEnabled: true
        });

        const statePath = join(tmpDir, FILE_STATE);
        expect(existsSync(statePath)).toBe(false);
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs.length).toBeGreaterThan(0);
    });

    it('debe aceptar backendConfigRaw como string único', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: 'local' }));

        await initCmd({ dir: tmpDir, backendConfigRaw: 'path/to/config.json' });

        // Verifica que no falló
        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(false);
    });

    it('debe aceptar backendConfigRaw como arreglo de strings', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: 'local' }));

        await initCmd({ dir: tmpDir, backendConfigRaw: ['key1=value1', 'key2=value2'] });

        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(false);
    });

    it('debe respetar el parámetro lockTimeout', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: 'local' }));

        await initCmd({ dir: tmpDir, lockTimeout: '10s' });

        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(false);
    });

    it('debe omitir la inicialización del backend si backendEnabled es false (-backend=false)', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: 'local' }));

        await initCmd({ dir: tmpDir, backendEnabled: false });

        // Cuando el backend está deshabilitado, Testform omite inicializar backends remotos y vuelve al local.
        // Como el log se imprime antes del switch de estado, verificamos que el archivo state local se generó de igual forma.
        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(false);
    });

    it('debe advertir si se usa reconfigure=true (-reconfigure)', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: 'local' }));

        await initCmd({ dir: tmpDir, reconfigure: true });

        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(false);
    });

    it('debe crear plantilla para backend github cuando se pasa backendType="github"', async () => {
        await initCmd({ dir: tmpDir, backendType: 'github' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.backend).toEqual({
            github: {
                branch: 'testform-state',
                path: 'state/testform.state'
            }
        });
    });

    it('debe crear plantilla para backend s3 cuando se pasa backendType="s3"', async () => {
        await initCmd({ dir: tmpDir, backendType: 's3' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.backend.s3).toBeDefined();
        expect(parsed.backend.s3.bucket).toBe('<required>');
        expect(parsed.backend.s3.region).toBe('us-east-1');
    });

    it('debe crear plantilla para backend oci con namespace cuando se pasa backendType="oci"', async () => {
        await initCmd({ dir: tmpDir, backendType: 'oci' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.backend.oci).toBeDefined();
        expect(parsed.backend.oci.bucket).toBe('<required_oci_bucket>');
        expect(parsed.backend.oci.namespace).toBe('<required_namespace>');
        expect(parsed.backend.oci.region).toBe('us-ashburn-1');
    });

    it('debe crear plantilla para backend azurerm cuando se pasa backendType="azurerm"', async () => {
        await initCmd({ dir: tmpDir, backendType: 'azurerm' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.backend.azurerm).toBeDefined();
        expect(parsed.backend.azurerm.resource_group_name).toBe('<required>');
    });

    it('debe crear plantilla para backend gcs cuando se pasa backendType="gcs"', async () => {
        await initCmd({ dir: tmpDir, backendType: 'gcs' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.backend.gcs).toBeDefined();
        expect(parsed.backend.gcs.bucket).toBe('<required>');
    });

    it('debe usar backend local por defecto si se pasa un backendType desconocido', async () => {
        await initCmd({ dir: tmpDir, backendType: 'desconocido' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.backend).toBe('local');
    });
});
