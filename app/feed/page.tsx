"use client"

import Link from "next/link"
import { Plus } from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { LiveFeed } from "@/components/app/feed"
import { Button } from "@/components/ui/button"

export default function FeedPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-brand text-2xl font-bold">Open jobs</h1>
            <p className="text-sm text-muted-foreground">Every public job currently accepting applications.</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/jobs/new">
              <Plus className="size-4" /> Post a job
            </Link>
          </Button>
        </div>
        <LiveFeed limit={50} showAllLink={false} />
      </div>
    </AppShell>
  )
}
