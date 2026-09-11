export interface EnvironmentSnapshot { id: string; state: Record<string, unknown> }
export interface ToolEnvironment { snapshot(): Promise<EnvironmentSnapshot>; reset(): Promise<void> }
