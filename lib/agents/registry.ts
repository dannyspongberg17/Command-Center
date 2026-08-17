import type { LucideIcon } from "lucide-react";
import { LineChart } from "lucide-react";

export type AgentDefinition = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  route: string;
};

/**
 * Single source of truth for every agent hosted in the Command Center.
 * The sidebar and home page render from this list only — adding a new
 * agent means adding a new entry here (plus its own app/agents/<id> and
 * lib/agents/<id> folders), never editing an existing agent's files.
 */
export const agentRegistry: AgentDefinition[] = [
  {
    id: "investment",
    name: "Investment",
    description: "Track holdings and get AI-generated portfolio insights.",
    icon: LineChart,
    route: "/agents/investment",
  },
];

export function getAgent(id: string): AgentDefinition | undefined {
  return agentRegistry.find((agent) => agent.id === id);
}
