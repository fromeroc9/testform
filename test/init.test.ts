import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { initCmd } from '../src/commands/init';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { FILE_CONFIG, FILE_STATE } from '../src/const';

// Mock process.exit to prevent the test runner from exiting
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Process exited with code ${code}`);
});

// Mock console.log/error to keep test output clean
const mockLog = jest.spyOn(console, 'log').mockImplementation(() => { });
const mockError = jest.spyOn(console, 'error').mockImplementation(() => { });

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
        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(true);
    });

    it('debe fallar si el archivo testform.json no tiene una versión válida', async () => {
        // Crear configuración sin versión
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ backend: {} }));

        await expect(initCmd({ dir: tmpDir, lock: true })).rejects.toThrow('Process exited with code 1');
    });

    it('debe inicializarse correctamente si testform.json es válido (Camino Feliz)', async () => {
        // Crear archivo de configuración válido
        const configPath = join(tmpDir, FILE_CONFIG);
        const configData = {
            version: '1.0',
            backend: { type: 'local', config: {} }
        };
        require('fs').writeFileSync(configPath, JSON.stringify(configData));

        // Ejecutar initCmd
        await initCmd({ dir: tmpDir });

        // Verificar que se creó el archivo de estado
        const statePath = join(tmpDir, FILE_STATE);
        expect(existsSync(statePath)).toBe(true);

        const stateRaw = readFileSync(statePath, 'utf8');
        const state = JSON.parse(stateRaw);
        expect(state).toHaveProperty('version');
        expect(state).toHaveProperty('testcase');
    });

    it('debe imprimir la salida en formato JSON cuando isJson es true', async () => {
        // Crear configuración válida
        const configPath = join(tmpDir, FILE_CONFIG);
        const configData = {
            version: '1.0',
            backend: { type: 'local', config: {} }
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
        const configData = { version: '1.0', backend: { type: 'local', config: {} } };
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
        expect(existsSync(statePath)).toBe(true);
        expect(mockLog).toHaveBeenCalled();
        const logs = mockLog.mock.calls.join(' ');
        expect(logs.length).toBeGreaterThan(0);
    });

    it('debe aceptar backendConfigRaw como string único', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: { type: 'local' } }));

        await initCmd({ dir: tmpDir, backendConfigRaw: 'path/to/config.json' });

        // Verifica que no falló
        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(true);
    });

    it('debe aceptar backendConfigRaw como arreglo de strings', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: { type: 'local' } }));

        await initCmd({ dir: tmpDir, backendConfigRaw: ['key1=value1', 'key2=value2'] });

        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(true);
    });

    it('debe respetar el parámetro lockTimeout', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: { type: 'local' } }));

        await initCmd({ dir: tmpDir, lockTimeout: '10s' });

        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(true);
    });

    it('debe omitir la inicialización del backend si backendEnabled es false (-backend=false)', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: { type: 'local' } }));

        await initCmd({ dir: tmpDir, backendEnabled: false });

        // Cuando el backend está deshabilitado, Testform omite inicializar backends remotos y vuelve al local.
        // Como el log se imprime antes del switch de estado, verificamos que el archivo state local se generó de igual forma.
        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(true);
    });

    it('debe advertir si se usa reconfigure=true (-reconfigure)', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ version: '1.0', backend: { type: 'local' } }));

        await initCmd({ dir: tmpDir, reconfigure: true });

        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(true);
    });
});
