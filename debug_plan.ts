import { join } from 'path';
import { State } from './src/core/state';
import { resource } from './src/adapters/resources';
import { TestrunParser } from './src/core/parsers/testrun-parser';
import { Config } from './src/core/config';
import { ITest } from './src/types';

(async () => {
    const dir = '/Users/fromero/Desktop/Personal/CA-HT360';
    const state = new State(dir, 'testform.state', 'testform.state.backup');
    await state.init();

    const config = new Config(dir);
    const test = config.getTestrun();
    const parser = new TestrunParser(dir, config.getVariables());
    const scenarios = parser.content();
    const filtered = parser.filter(scenarios, test, 'testrun');

    const stateMap = new Map(state.getResources('github_testrun').map((r: any) => [r.identity, r]));

    for (const s of filtered) {
        const identity = s.custom?.identity;
        if (identity !== '@tr-1') continue;

        const oldAttributes = stateMap.get(identity)?.attributes;
        const newPayload = resource.evaluate('github_testrun', s, { state });

        const keys = Object.keys(newPayload);
        for (const key of keys) {
            const newVal = (newPayload as any)[key];
            const oldVal = (oldAttributes as any)[key];
            if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
                console.log(`Difference in ${key}:`);
                console.log(`old: ${JSON.stringify(oldVal)}`);
                console.log(`new: ${JSON.stringify(newVal)}`);
            }
        }
    }
})();
