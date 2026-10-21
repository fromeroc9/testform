import { INotify } from '../types';

export type DiagnosticSeverity = 'error' | 'warning';

export interface SourceLocation {
    file: string;
    line?: number;
    column?: number;
    snippet?: string;
    scope?: string;
}

export interface DiagnosticProps {
    type?: DiagnosticSeverity;
    title: string;
    location?: SourceLocation;
    detail?: string | string[];
    help?: string | string[];
    extra?: string[];
    close?: boolean;
}

export interface IDiagnosticComponent {
    toNotify(): INotify;
    emit(): void;
    abort(): never;
}
