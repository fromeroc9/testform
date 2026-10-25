import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { initCmd } from '../src/commands/init';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
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
        writeFileSync(join(tmpDir, 'sample.case.feature'), '@testcase\nFeature: Sample\nScenario: A\nGiven b');
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

    it('no debe continuar el proceso ni generar main.yml si el directorio está vacío', async () => {
        rmSync(join(tmpDir, 'sample.case.feature'));
        await initCmd({ dir: tmpDir, lock: true, lockTimeout: '0s', isJson: false });

        // En un empty directory, no debe generar main.yml ni state
        expect(existsSync(join(tmpDir, FILE_CONFIG))).toBe(false);
        expect(existsSync(join(tmpDir, FILE_STATE))).toBe(false);
        const calls = mockLog.mock.calls.flat().join(' ');
        expect(calls).toContain('initialized in an empty directory');
    });

    it('debe fallar si el archivo de configuración no tiene una versión válida', async () => {
        // Crear configuración sin versión
        const configPath = join(tmpDir, FILE_CONFIG);
        require('fs').writeFileSync(configPath, JSON.stringify({ backend: 'local' }));

        await expect(initCmd({ dir: tmpDir, lock: true })).rejects.toThrow();
    });

    it('debe inicializarse correctamente si main.yml es válido con bloque testform (Camino Feliz)', async () => {
        // Crear archivo de configuración válido
        const configPath = join(tmpDir, FILE_CONFIG);
        const configData = {
            testform: {
                required_version: '>= 1.0.0',
                backend: 'local'
            }
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

        const calls = mockLog.mock.calls.flat().join(' ');
        expect(calls).not.toContain('Initializing the backend...');
        expect(calls).toContain('Initializing provider plugins...');
        expect(calls).toContain('has been successfully initialized');
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
        expect(parsed.testform.backend).toEqual({
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
        expect(parsed.testform.backend.s3).toBeDefined();
        expect(parsed.testform.backend.s3.bucket).toBe('<required>');
        expect(parsed.testform.backend.s3.region).toBe('us-east-1');
    });

    it('debe crear plantilla para backend oci con namespace cuando se pasa backendType="oci"', async () => {
        await initCmd({ dir: tmpDir, backendType: 'oci' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.testform.backend.oci).toBeDefined();
        expect(parsed.testform.backend.oci.bucket).toBe('<required_oci_bucket>');
        expect(parsed.testform.backend.oci.namespace).toBe('<required_namespace>');
        expect(parsed.testform.backend.oci.region).toBe('us-ashburn-1');
    });

    it('debe crear plantilla para backend azurerm cuando se pasa backendType="azurerm"', async () => {
        await initCmd({ dir: tmpDir, backendType: 'azurerm' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.testform.backend.azurerm).toBeDefined();
        expect(parsed.testform.backend.azurerm.resource_group_name).toBe('<required>');
    });

    it('debe crear plantilla para backend gcs cuando se pasa backendType="gcs"', async () => {
        await initCmd({ dir: tmpDir, backendType: 'gcs' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.testform.backend.gcs).toBeDefined();
        expect(parsed.testform.backend.gcs.bucket).toBe('<required>');
    });

    it('debe usar backend local por defecto si se pasa un backendType desconocido', async () => {
        await initCmd({ dir: tmpDir, backendType: 'desconocido' });

        const configPath = join(tmpDir, FILE_CONFIG);
        expect(existsSync(configPath)).toBe(true);

        const parsed = YAML.parse(readFileSync(configPath, 'utf8'));
        expect(parsed.testform.backend).toBe('local');
    });

    it('debe mostrar mensaje de empty directory si no hay archivos .feature con @testcase', async () => {
        rmSync(join(tmpDir, 'sample.case.feature'));
        await initCmd({ dir: tmpDir });
        const calls = mockLog.mock.calls.flat().join(' ');
        expect(calls).toContain('initialized in an empty directory');
        expect(calls).toContain('has no Testform feature files');
    });

    it('debe mostrar mensaje de éxito si existen archivos .feature con @testcase', async () => {
        const featureDir = join(tmpDir, 'testcase');
        mkdirSync(featureDir, { recursive: true });
        writeFileSync(join(featureDir, 'login.case.feature'), '@testcase\nFeature: Login\nScenario: Success\nGiven ok');

        await initCmd({ dir: tmpDir });
        const calls = mockLog.mock.calls.flat().join(' ');
        expect(calls).toContain('has been successfully initialized');
    });

    it('debe emitir error Invalid backend configuration argument si el argumento no pertenece al backend local', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        writeFileSync(configPath, YAML.stringify({ version: '1.0', backend: 'local' }));

        await initCmd({ dir: tmpDir, backendConfigRaw: 'bucket=mi-bucket-qa' });
        const calls = mockLog.mock.calls.flat().join(' ');
        expect(calls).toContain('Invalid backend configuration argument');
        expect(calls).toContain('bucket');
    });

    it('debe emitir warning Missing backend configuration si no hay bloque backend configurado', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        writeFileSync(configPath, YAML.stringify({ version: '1.0', provider: 'local' }));

        await initCmd({ dir: tmpDir, backendConfigRaw: 'bucket=mi-bucket-qa' });
        const calls = mockLog.mock.calls.flat().join(' ');
        expect(calls).toContain('Missing backend configuration');
    });

    it('debe emitir error Backend configuration changed si cambia el backend sin -reconfigure ni -migrate-state', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        writeFileSync(configPath, YAML.stringify({ version: '1.0', backend: 'local' }));

        // Initial setup as local
        await initCmd({ dir: tmpDir });

        // User updates configuration to s3
        writeFileSync(configPath, YAML.stringify({
            version: '1.0',
            backend: {
                s3: {
                    bucket: 'my-bucket',
                    region: 'us-east-1',
                    key: 'testform.state'
                }
            }
        }));

        await initCmd({ dir: tmpDir });
        const calls = mockLog.mock.calls.flat().join(' ');
        expect(calls).toContain('Backend configuration changed');
        expect(calls).toContain('testform init -migrate-state');
        expect(calls).toContain('testform init -reconfigure');
    });

    it('debe permitir cambiar la configuración del backend si se pasa reconfigure=true (-reconfigure)', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        writeFileSync(configPath, YAML.stringify({ version: '1.0', backend: 'local' }));

        // Initial setup as default local
        await initCmd({ dir: tmpDir });

        // User updates configuration to custom local path
        writeFileSync(configPath, YAML.stringify({
            version: '1.0',
            backend: {
                local: {
                    path: 'custom.state'
                }
            }
        }));

        await initCmd({ dir: tmpDir, reconfigure: true });
        const backendJsonPath = join(tmpDir, '.testform', 'backend.json');
        expect(existsSync(backendJsonPath)).toBe(true);
        const savedBackend = JSON.parse(readFileSync(backendJsonPath, 'utf8'));
        expect(savedBackend.type).toBe('local');
        expect(savedBackend.config.path).toBe('custom.state');
    });


    it('debe emitir error Missing region value si el backend s3 no tiene region definida', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        writeFileSync(configPath, YAML.stringify({
            version: '1.0',
            backend: {
                s3: {
                    bucket: 'my-bucket',
                    key: 'testform.state'
                }
            }
        }));

        const originalRegion = process.env.AWS_REGION;
        const originalDefaultRegion = process.env.AWS_DEFAULT_REGION;
        delete process.env.AWS_REGION;
        delete process.env.AWS_DEFAULT_REGION;

        try {
            await initCmd({ dir: tmpDir, inputEnabled: false });
            const calls = mockLog.mock.calls.flat().join(' ');
            expect(calls).toContain('Missing region value');
            expect(calls).toContain('The "region" attribute or the "AWS_REGION" or "AWS_DEFAULT_REGION" environment variables must');
        } finally {
            if (originalRegion) process.env.AWS_REGION = originalRegion;
            if (originalDefaultRegion) process.env.AWS_DEFAULT_REGION = originalDefaultRegion;
        }
    });

    it('debe emitir error Missing bucket value si el backend s3 no tiene bucket definido', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        writeFileSync(configPath, YAML.stringify({
            version: '1.0',
            backend: {
                s3: {
                    region: 'us-east-1',
                    key: 'testform.state'
                }
            }
        }));

        await initCmd({ dir: tmpDir, inputEnabled: false });
        const calls = mockLog.mock.calls.flat().join(' ');
        expect(calls).toContain('Missing bucket value');
        expect(calls).toContain('The "bucket" attribute must be set for the s3 backend.');
    });

    it('debe emitir error Missing key value si el backend s3 no tiene key y no hay input interactivo', async () => {
        const configPath = join(tmpDir, FILE_CONFIG);
        writeFileSync(configPath, YAML.stringify({
            version: '1.0',
            backend: {
                s3: {
                    bucket: 'my-bucket',
                    region: 'us-east-1'
                }
            }
        }));

        await initCmd({ dir: tmpDir, inputEnabled: false });
        const calls = mockLog.mock.calls.flat().join(' ');
        expect(calls).toContain('Missing key value');
        expect(calls).toContain('The "key" attribute must be set for the s3 backend.');
    });
});

