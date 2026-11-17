import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface ActiveTripChatContext {
  tripId: string | null
  tripTitle: string | null
  dayNumber: number | null
}

interface TripChatContextValue extends ActiveTripChatContext {
  setActiveTripContext: (next: ActiveTripChatContext) => void
  queuedPrompt: { id: string; text: string } | null
  queuePrompt: (text: string) => void
  clearQueuedPrompt: () => void
  openDockSignal: number
  openChatDock: () => void
}

const TripChatContext = createContext<TripChatContextValue | null>(null)

export function TripChatProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveTripChatContext>({
    tripId: null,
    tripTitle: null,
    dayNumber: null,
  })
  const [queuedPrompt, setQueuedPrompt] = useState<{ id: string; text: string } | null>(null)
  const [openDockSignal, setOpenDockSignal] = useState(0)

  const setActiveTripContext = useCallback((next: ActiveTripChatContext) => {
    setActive((prev) => {
      if (
        prev.tripId === next.tripId &&
        prev.tripTitle === next.tripTitle &&
        prev.dayNumber === next.dayNumber
      ) {
        return prev
      }
      return next
    })
  }, [])

  const queuePrompt = useCallback((text: string) => {
    setQueuedPrompt({ id: `${Date.now()}-${Math.random()}`, text })
    setOpenDockSignal((n) => n + 1)
  }, [])

  const clearQueuedPrompt = useCallback(() => {
    setQueuedPrompt(null)
  }, [])

  const openChatDock = useCallback(() => {
    setOpenDockSignal((n) => n + 1)
  }, [])

  const value = useMemo(
    () => ({
      ...active,
      setActiveTripContext,
      queuedPrompt,
      queuePrompt,
      clearQueuedPrompt,
      openDockSignal,
      openChatDock,
    }),
    [
      active,
      setActiveTripContext,
      queuedPrompt,
      queuePrompt,
      clearQueuedPrompt,
      openDockSignal,
      openChatDock,
    ],
  )

  return <TripChatContext.Provider value={value}>{children}</TripChatContext.Provider>
}

export function useTripChat() {
  return useContext(TripChatContext)
}
