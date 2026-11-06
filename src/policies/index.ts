import { PolicyEngine } from './engine';
import { PolicyDefinition } from './types';

export * from './types';
export * from './catalog';
export * from './loader';
export * from './engine';

export const policy = new PolicyEngine();
export const registerPolicy = (policyDefinition: PolicyDefinition) => policy.registry(policyDefinition, 'user');
