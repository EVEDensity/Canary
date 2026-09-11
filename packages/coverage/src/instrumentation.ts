export function feature<T>(featureId: string, operation: () => T): T { return operation(); }
