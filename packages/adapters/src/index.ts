export interface AgentInput { value: unknown }
export interface AgentOutput { value: unknown }
export interface AgentContext { executionId: string; emit: (event: unknown) => void }
export interface AgentAdapter { id: string; run(input: AgentInput, context: AgentContext): Promise<AgentOutput> }
