import { useMemo, useState } from 'react'
import { CheckSquare, Plus, Trash2, Wallet } from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@/components/ui'
import { CATEGORY_META, type ChecklistData, type StopCategory, type StopData } from '@/lib/trip-types'

export interface ChecklistRecord extends ChecklistData {
  id: string
}

interface BudgetChecklistTabProps {
  stops: StopData[]
  travelers: number
  currency: string
  checklists: ChecklistRecord[]
  canEdit: boolean
  onAddChecklist: (category: ChecklistData['category'], label: string) => Promise<void>
  onToggleChecklist: (itemId: string, completed: boolean) => Promise<void>
  onRemoveChecklist: (itemId: string) => Promise<void>
}

const CHECKLIST_CATS: Record<ChecklistData['category'], string> = {
  booking: 'Reservations',
  gear: 'Camera & Gear',
  documents: 'Documents & Passes',
  packing: 'Packing',
}

export function BudgetChecklistTab({
  stops,
  travelers,
  currency,
  checklists,
  canEdit,
  onAddChecklist,
  onToggleChecklist,
  onRemoveChecklist,
}: BudgetChecklistTabProps) {
  const { success, error } = useToast()
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState<ChecklistData['category']>('packing')
  const [adding, setAdding] = useState(false)

  const budgetByCategory = useMemo(() => {
    const map = new Map<StopCategory, number>()
    let totalPerPerson = 0
    for (const s of stops) {
      const cost = s.estimatedCost ?? 0
      if (cost <= 0) continue
      totalPerPerson += cost
      map.set(s.category, (map.get(s.category) ?? 0) + cost)
    }
    return {
      totalPerPerson,
      totalGroup: totalPerPerson * Math.max(1, travelers),
      rows: Array.from(map.entries()).sort((a, b) => b[1] - a[1]),
    }
  }, [stops, travelers])

  const completedCount = checklists.filter((c) => c.completed).length

  async function handleAdd() {
    if (!label.trim()) return
    setAdding(true)
    try {
      await onAddChecklist(category, label.trim())
      setLabel('')
      success('Checklist updated', 'Item added to shared trip list.')
    } catch (err) {
      error('Could not add item', err instanceof Error ? err.message : 'Failed')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Budget Card */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-primary" aria-hidden />
            <h3 className="text-base font-semibold text-foreground">Estimated Activity Budget</h3>
          </div>
          <Badge variant="secondary">{travelers} traveler{travelers > 1 ? 's' : ''}</Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3.5">
          <div>
            <span className="text-xs text-muted-foreground">Per person</span>
            <p className="mt-0.5 text-xl font-bold text-foreground">
              {currency} {budgetByCategory.totalPerPerson.toFixed(0)}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Group total</span>
            <p className="mt-0.5 text-xl font-bold text-primary">
              {currency} {budgetByCategory.totalGroup.toFixed(0)}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          {budgetByCategory.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Add estimated costs on itinerary stops to track food, tickets, and day-trip spend.
            </p>
          ) : (
            budgetByCategory.rows.map(([cat, amount]) => {
              const meta = CATEGORY_META[cat]
              const pct = Math.round((amount / Math.max(1, budgetByCategory.totalPerPerson)) * 100)
              return (
                <div key={cat} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{meta.label}</span>
                    <span className="text-muted-foreground">
                      {currency} {amount.toFixed(0)} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: meta.color }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* Checklist Card */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckSquare className="size-4 text-primary" aria-hidden />
            <h3 className="text-base font-semibold text-foreground">Gear, Bookings &amp; Packing</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {completedCount}/{checklists.length} done
          </span>
        </div>

        {canEdit && (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div>
              <Label>Group</Label>
              <Select
                value={category}
                onValueChange={(v) => v && setCategory(v as ChecklistData['category'])}
                items={CHECKLIST_CATS}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CHECKLIST_CATS).map(([k, text]) => (
                    <SelectItem key={k} value={k}>
                      {text}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px] flex-1">
              <Label htmlFor="chk-label">New checklist item</Label>
              <Input
                id="chk-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Reserve sunset observation deck"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAdd()
                }}
              />
            </div>
            <Button size="sm" loading={adding} onClick={handleAdd}>
              <Plus className="size-3.5" aria-hidden />
              Add
            </Button>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {checklists.length === 0 ? (
            <EmptyState
              icon={<CheckSquare className="size-5" />}
              title="Checklist is clear"
              description="Track train tickets, camera lenses, universal adapters, and restaurant reservations here."
            />
          ) : (
            checklists.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Checkbox
                    checked={Boolean(item.completed)}
                    disabled={!canEdit}
                    onCheckedChange={(checked) =>
                      void onToggleChecklist(item.id, Boolean(checked))
                    }
                  />
                  <div className="min-w-0">
                    <span
                      className={`block truncate text-sm ${
                        item.completed ? 'text-muted-foreground line-through' : 'text-foreground'
                      }`}
                    >
                      {item.label}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {CHECKLIST_CATS[item.category]}
                    </span>
                  </div>
                </div>
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${item.label}`}
                    onClick={() => void onRemoveChecklist(item.id)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
