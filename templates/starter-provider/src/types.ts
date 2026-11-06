export interface IStarterProviderConfig {
    baseUrl?: string;
    token?: string;
    tokenEnv?: string;
    [key: string]: any;
}

export interface IRemoteResourceAttributes {
    title: string;
    description?: string;
    labels?: string[];
    [key: string]: any;
}

export interface IRemoteResourceResult {
    id: string | number;
    number?: number;
    title?: string;
    [key: string]: any;
}
