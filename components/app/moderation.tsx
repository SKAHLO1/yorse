"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, errorText } from "@/lib/api"
import type { Complaint, ComplaintStatus, Review } from "@/lib/types"

function useInvalidateAdmin() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" || q.queryKey[0] === "job" })
}

export function ComplaintModeration({ c }: { c: Complaint }) {
  const invalidate = useInvalidateAdmin()
  const [status, setStatus] = useState<ComplaintStatus>(c.status)
  const [notes, setNotes] = useState(c.adminNotes ?? "")
  const [busy, setBusy] = useState(false)
  const dirty = status !== c.status || notes !== (c.adminNotes ?? "")
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v as ComplaintStatus)}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="under_review">Under review</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await api(`/admin/complaints/${c.id}`, { method: "PATCH", body: { status, adminNotes: notes || null } })
              toast.success("Complaint updated")
              await invalidate()
            } catch (e) {
              toast.error(errorText(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      <Textarea rows={2} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="Admin notes (visible to the person who filed it)" />
    </div>
  )
}

export function ReviewModeration({ r }: { r: Review }) {
  const invalidate = useInvalidateAdmin()
  const [note, setNote] = useState(r.moderationNote ?? "")
  const [busy, setBusy] = useState(false)
  const target = r.status === "published" ? "hidden" : "published"
  return (
    <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-border pt-3">
      <Textarea rows={1} className="min-h-9 flex-1" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Moderation note" />
      <Button
        size="sm"
        variant={target === "hidden" ? "destructive" : "outline"}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await api(`/admin/reviews/${r.id}`, { method: "PATCH", body: { status: target, moderationNote: note || null } })
            toast.success(target === "hidden" ? "Review hidden" : "Review published")
            await invalidate()
          } catch (e) {
            toast.error(errorText(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        {target === "hidden" ? "Hide review" : "Publish review"}
      </Button>
    </div>
  )
}
