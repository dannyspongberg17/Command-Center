import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { agentRegistry } from "@/lib/agents/registry";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Command Center
      </h1>
      <p className="mt-1 text-neutral-500">
        Your personal hub of AI-powered agents.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {agentRegistry.map((agent) => {
          const Icon = agent.icon;
          return (
            <Link key={agent.id} href={agent.route}>
              <Card className="h-full transition-colors hover:border-neutral-300 dark:hover:border-neutral-700">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="rounded-lg bg-neutral-100 p-2 dark:bg-neutral-800">
                      <Icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-neutral-400" />
                  </div>
                  <CardTitle className="mt-3">{agent.name} Agent</CardTitle>
                  <CardDescription>{agent.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
