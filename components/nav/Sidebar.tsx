"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { agentRegistry } from "@/lib/agents/registry";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="px-5 py-5">
        <span className="text-lg font-semibold tracking-tight">
          Command Center
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        <NavLink href="/" active={pathname === "/"} icon={LayoutGrid}>
          Home
        </NavLink>

        <div className="px-3 pt-4 pb-1 text-xs font-medium uppercase tracking-wider text-neutral-400">
          Agents
        </div>
        {agentRegistry.map((agent) => (
          <NavLink
            key={agent.id}
            href={agent.route}
            active={pathname.startsWith(agent.route)}
            icon={agent.icon}
          >
            {agent.name}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}
