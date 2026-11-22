/**
 * AI chat routes — multi-turn tool-use via Vercel AI SDK + DeepSpace proxy.
 *
 * Registers four endpoints on the passed-in Hono app:
 *   POST   /api/ai/chats       — create a chat owned by the caller
 *   PATCH  /api/ai/chats/:id   — rename / patch a chat
 *   DELETE /api/ai/chats/:id   — delete chat + cascade messages
 *   POST   /api/ai/chat        — streamed assistant turn (the big one)
 *
 * Lives in its own file so worker.ts can stay small and the streaming
 * handler's full context (compaction, tools, persistence, abort handling)
 * is co-located rather than scattered through the entry file.
 */

import type { Context, Hono } from 'hono'
import {
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type ModelMessage,
} from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
  applySlidingWindow,
  deepSpaceAgentErrorSummary,
  prepareMessagesWithCompaction,
  listDeepSpaceAgentModels,
  resolveDeepSpaceAgentModel,
  streamDeepSpaceAgent,
  turnsToCoreMessages,
  buildUiParts,
  makeDefaultSummarizer,
  createUserToolExecutor,
  DEFAULT_CONTEXT_CONFIG,
  getChat,
  createChat,
  updateChat,
  deleteChatCascade,
  loadMessages,
  appendMessage,
  loggableError,
} from 'deepspace/worker'
import type { AgentToolAccessResult, AgentToolRouteOptions, ChatTurn } from 'deepspace/worker'
import { schemas } from '../schemas.js'
import { buildSystemPrompt } from './tools.js'
import { createResilientGeminiModel, formatGeminiError } from './gemini-fallback.js'
import { assertTripAccess, createServerRecordTools } from '../server/trip-helpers.js'
import {
  GEMINI_MODELS,
  getUserGeminiCredential,
  isGeminiModelId,
} from '../server/google-gemini-routes.js'
import type { DestinationData, StopData } from '../lib/trip-types.js'
import {
  formatMinutesToTime,
  hasCoords,
  isIntercityLegCard,
  parseTimeToMinutes,
  resolveActiveDayHotels,
  resolveDayContext,
  resolveEffectiveTripStartDate,
} from '../lib/route-optimizer.js'
// Type-only — TypeScript strips these at runtime, so no circular import
// with worker.ts (which imports `registerAiChatRoutes` from this file).
import type { Env, AppContext } from '../../worker.js'

type ResolveAccess = (req: Request, env: Env) => Promise<AgentToolAccessResult>
type AccessGrant = Extract<AgentToolAccessResult, { ok: true }>
/** `buildTools` from src/ai/tools.ts; it may ignore the context argument. */
type ToolFactory = AgentToolRouteOptions<Env>['buildTools']

function recordRoomStub(env: Env): DurableObjectStub {
  // Rooms are keyed by the immutable app id — the same `app:${DEEPSPACE_APP_ID}`
  // the client's RecordScope (SCOPE_ID) and worker.ts's own stubs use. Keying
  // by APP_NAME would read/write a room the browser never subscribes to.
  return env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
}

// Cap on user-supplied content length. Far above any realistic message;
// blocks accidental DoS via megabyte payloads.
const MAX_USER_CONTENT_LENGTH = 100_000

// Derive a chat title from the first user message — first non-empty line,
// trimmed to ~50 chars with an ellipsis.
function deriveTitle(content: string): string {
  const first =
    content
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? 'Untitled'
  return first.length <= 50 ? first : first.slice(0, 47).trimEnd() + '…'
}

export function registerAiChatRoutes(
  app: Hono<AppContext>,
  resolveAccess: ResolveAccess,
  buildTools: ToolFactory,
): void {
  // One chokepoint for the access-decision → HTTP mapping on every chat route.
  const requireAccess = async (c: Context<AppContext>): Promise<AccessGrant | Response> => {
    const access = await resolveAccess(c.req.raw, c.env)
    if (access.ok) return access
    const error =
      access.status === 401
        ? 'Unauthorized'
        : access.status === 403
          ? 'Forbidden'
          : 'Temporarily unavailable'
    return c.json({ error }, access.status)
  }

  // Create a new chat row owned by the caller.
  app.post('/api/ai/chats', async (c) => {
    const access = await requireAccess(c)
    if (access instanceof Response) return access
    const { auth } = access

    const raw = await c.req.json<unknown>().catch(() => null)
    const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as { title?: string }
    const stub = recordRoomStub(c.env)
    const chat = await createChat(stub, auth.userId, {
      title: body.title ?? 'New chat',
    })
    return c.json({ chat })
  })

  // Rename / patch a chat. Ownership enforced via getChat.
  app.patch('/api/ai/chats/:id', async (c) => {
    const access = await requireAccess(c)
    if (access instanceof Response) return access
    const { auth } = access

    const id = c.req.param('id')
    const stub = recordRoomStub(c.env)
    const chat = await getChat(stub, id, auth.userId)
    if (!chat) return c.json({ error: 'Not found' }, 404)

    const raw = await c.req.json<unknown>().catch(() => null)
    const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as { title?: string }
    const patch: { title?: string } = {}
    if (typeof body.title === 'string') patch.title = body.title
    // `updateChat` re-checks the chat; a delete racing this PATCH answers 404
    // instead of `ok: true` for a write that never landed.
    if (!(await updateChat(stub, id, auth.userId, patch)))
      return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
  })

  // Delete chat + cascade messages.
  app.delete('/api/ai/chats/:id', async (c) => {
    const access = await requireAccess(c)
    if (access instanceof Response) return access
    const { auth } = access

    const id = c.req.param('id')
    const stub = recordRoomStub(c.env)
    const chat = await getChat(stub, id, auth.userId)
    if (!chat) return c.json({ error: 'Not found' }, 404)

    await deleteChatCascade(stub, id, auth.userId)
    return c.json({ ok: true })
  })

  // Known limitation: two tabs sending to the same chatId concurrently can
  // interleave row writes (DO serializes individual writes but not the
  // per-request 3-write group). The next turn's history then mis-pairs
  // user/assistant rows. Closing this requires per-chatId locking in the DO;
  // out of scope for this PR. Realistic impact: rare (multi-tab same-chat
  // usage); recoverable by user (one tab works correctly going forward).
  app.post('/api/ai/chat', async (c) => {
    const access = await requireAccess(c)
    if (access instanceof Response) return access
    const { auth } = access

    const authHeader = c.req.header('Authorization') ?? ''
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!jwt) return c.json({ error: 'Unauthorized' }, 401)

    let rawBody: unknown
    try {
      rawBody = await c.req.json<unknown>()
    } catch {
      return c.json({ error: 'Invalid JSON request body' }, 400)
    }
    if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return c.json({ error: 'Request body must be a JSON object' }, 400)
    }
    const { chatId, userMessageId, content, modelId, tripContext } = rawBody as {
      chatId?: string
      userMessageId?: string
      content?: string
      modelId?: string
      tripContext?: { tripId?: string; dayNumber?: number }
    }
    if (typeof chatId !== 'string' || !chatId) return c.json({ error: 'chatId is required' }, 400)
    if (typeof userMessageId !== 'string' || !userMessageId)
      return c.json({ error: 'userMessageId is required' }, 400)
    if (typeof content !== 'string' || content.trim() === '')
      return c.json({ error: 'content is required' }, 400)
    if (content.length > MAX_USER_CONTENT_LENGTH) {
      return c.json({ error: `content exceeds ${MAX_USER_CONTENT_LENGTH} chars` }, 413)
    }
    const usingGemini = isGeminiModelId(modelId)
    const selectedModel = usingGemini ? null : resolveDeepSpaceAgentModel(modelId, 'application')
    if (!usingGemini && !selectedModel) {
      // Name the valid ids: the caller has no other way to learn them here.
      const modelIds = [
        ...listDeepSpaceAgentModels('application').map((model) => model.id),
        ...GEMINI_MODELS.map((m) => m.id),
      ]
      return c.json(
        {
          error: `Unknown modelId: ${modelId}. Valid: ${modelIds.join(', ')}`,
          code: 'unknown_model',
          modelIds,
        },
        400,
      )
    }

    let geminiCred: Awaited<ReturnType<typeof getUserGeminiCredential>> = null
    if (usingGemini) {
      geminiCred = await getUserGeminiCredential(c.env, auth.userId)
      if (!geminiCred) {
        return c.json(
          {
            error: 'Link your Google account or Gemini API key in Preferences to use Gemini.',
            code: 'google_gemini_not_linked',
          },
          400,
        )
      }
    }

    const stub = recordRoomStub(c.env)
    const chat = await getChat(stub, chatId, auth.userId)
    if (!chat) {
      console.warn('[ai-chat] REQUEST chat-not-found', { userId: auth.userId, chatId })
      return c.json({ error: 'Chat not found' }, 404)
    }

    // Load history before writing this turn. `persistTurn` later writes user then
    // assistant as separate DO operations; the ordering is intentional, but
    // it is not atomic.
    const history = await loadMessages(stub, chatId, auth.userId)
    // Carry `parts` through so compaction can truncate stale tool results AND
    // turnsToCoreMessages can rebuild assistant tool-call/tool-result pairs.
    const rawTurns: ChatTurn[] = history.map((m) => ({
      id: m.recordId,
      role: m.role,
      content: m.content,
      parts: m.parts,
    }))

    // Append the in-flight user message in memory so the LLM sees it; its DO
    // write is the first persistence operation in `persistTurn`.
    // Then dedup consecutive user messages — defense-in-depth for legacy
    // chats with orphan user rows AND for the rare case where a prior turn's
    // user-write succeeded but the assistant-write failed both retries.
    // Crucial: dedup runs AFTER appending the in-flight; otherwise a trailing
    // orphan user from history would survive the loop (no following user in
    // raw history) and then sit next to the in-flight user, sending two
    // consecutive user messages to the LLM.
    const allTurns: ChatTurn[] = [...rawTurns, { id: userMessageId, role: 'user', content }]
    const turns: ChatTurn[] = []
    for (let i = 0; i < allTurns.length; i++) {
      if (allTurns[i].role === 'user' && allTurns[i + 1]?.role === 'user') continue
      turns.push(allTurns[i])
    }

    const cachedSummary =
      chat.compactedSummary && chat.compactedThroughId
        ? { text: chat.compactedSummary, throughId: chat.compactedThroughId }
        : undefined

    // User-billed: compaction is part of the user's chat experience, not infra.
    let prepared: ChatTurn[]
    let newSummary: { text: string; throughId: string } | undefined
    try {
      const summarizer = makeDefaultSummarizer(c.env, { authToken: jwt })
      const compacted = await prepareMessagesWithCompaction(
        turns,
        DEFAULT_CONTEXT_CONFIG,
        { summarizer, cachedSummary },
      )
      prepared = compacted.messages
      newSummary = compacted.newSummary
    } catch {
      prepared = applySlidingWindow(
        turns,
        DEFAULT_CONTEXT_CONFIG.contextBudget,
        DEFAULT_CONTEXT_CONFIG.minKept,
      )
    }
    if (newSummary) {
      await updateChat(stub, chatId, auth.userId, {
        compactedSummary: newSummary.text,
        compactedThroughId: newSummary.throughId,
      })
    }

    const usedModelId = usingGemini ? (modelId as string) : selectedModel!.modelId
    const diagnosticContext = {
      profile: 'application' as const,
      provider: usingGemini ? 'google' : selectedModel!.provider,
      modelId: usedModelId,
    }
    const baseSystem = buildSystemPrompt(c.env.APP_NAME, schemas)
    let workspaceContextBlock = ''
    if (tripContext && typeof tripContext.tripId === 'string' && tripContext.tripId) {
      const serverTools = createServerRecordTools(c.env, auth.userId, jwt)
      const access = await assertTripAccess(serverTools, tripContext.tripId, auth.userId, 'viewer')
      if (access.ok) {
        const activeDayNum = typeof tripContext.dayNumber === 'number' ? tripContext.dayNumber : undefined
        const [destRes, dayStopsRes] = await Promise.all([
          serverTools.query<DestinationData>('trip_destinations', {
            where: { tripId: access.trip.recordId },
            limit: 30,
          }),
          activeDayNum
            ? serverTools.query<StopData>('trip_stops', {
                where: { tripId: access.trip.recordId, dayNumber: activeDayNum },
                limit: 100,
              })
            : Promise.resolve(null),
        ])
        const sortedDests = destRes.success
          ? destRes.data.records
              .map((d) => ({ id: d.recordId, ...d.data }))
              .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
          : []
        const destSummary = sortedDests
          .map((d) => {
            const hotelCoords =
              typeof d.lodgingLat === 'number' && typeof d.lodgingLng === 'number'
                ? `${d.lodgingLat.toFixed(5)}, ${d.lodgingLng.toFixed(5)}`
                : hasCoords(d)
                  ? `${d.lat!.toFixed(5)}, ${d.lng!.toFixed(5)}`
                  : 'unset'
            const cityCoords = hasCoords(d) ? `${d.lat!.toFixed(5)}, ${d.lng!.toFixed(5)}` : 'unset'
            const stayText =
              d.lodgingName || d.lodgingAddress
                ? ` (stay: ${d.lodgingName || 'lodging'}${d.lodgingAddress ? ` @ ${d.lodgingAddress}` : ''}, mapHotelPin: [${hotelCoords}], cityCenter: [${cityCoords}], in ${d.checkInTime || '15:00'}/out ${d.checkOutTime || '10:00'})`
                : ` (cityCenter: [${cityCoords}])`
            return `${d.name}${d.country ? `, ${d.country}` : ''}${d.arrivalDate || d.departureDate ? ` [${d.arrivalDate ?? '?'}..${d.departureDate ?? '?'}]` : ''}${stayText}`
          })
          .join(' -> ')
        const effectiveStartDate = resolveEffectiveTripStartDate(access.trip.data.startDate, sortedDests)
        const totalTripDays = access.trip.data.totalDays ?? 5
        const activeDayCtx = activeDayNum
          ? resolveDayContext(activeDayNum, totalTripDays, effectiveStartDate, sortedDests)
          : null
        const activeDayHotels = activeDayNum
          ? resolveActiveDayHotels(activeDayNum, totalTripDays, effectiveStartDate, sortedDests)
          : null
        const activeDayHotelSummary = activeDayHotels
          ? [
              activeDayHotels.startHotel
                ? `start/checkout="${activeDayHotels.startHotel.name}" @ (${activeDayHotels.startHotel.lat.toFixed(5)}, ${activeDayHotels.startHotel.lng.toFixed(5)})`
                : null,
              activeDayHotels.endHotel
                ? `end/checkin="${activeDayHotels.endHotel.name}" @ (${activeDayHotels.endHotel.lat.toFixed(5)}, ${activeDayHotels.endHotel.lng.toFixed(5)})`
                : null,
            ]
              .filter(Boolean)
              .join(' | ')
          : ''
        const sortedDayStops =
          dayStopsRes && dayStopsRes.success && dayStopsRes.data.records.length > 0
            ? dayStopsRes.data.records
                .slice()
                .sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))
            : []
        const existingStopsSummary = sortedDayStops
          .map((s) => {
            const coordPart = hasCoords(s.data)
              ? ` @ (${s.data.lat!.toFixed(5)}, ${s.data.lng!.toFixed(5)})`
              : ' (no coords)'
            const durPart =
              typeof s.data.durationMinutes === 'number' ? ` (${s.data.durationMinutes}m)` : ''
            return `  * [${s.recordId}] ${s.data.startTime || 'unscheduled'}${durPart} | ${s.data.category} | ${s.data.title}${coordPart}`
          })
          .join('\n')

        let arrivalGapHint = ''
        const travelCard = sortedDayStops.find((s) => isIntercityLegCard(s.data))
        const checkInCard = sortedDayStops.find(
          (s) => s.data.category === 'lodging' && /^\s*check\s*in\b/i.test(s.data.title),
        )
        if (travelCard && checkInCard) {
          const travelStart = parseTimeToMinutes(travelCard.data.startTime)
          const checkInStart = parseTimeToMinutes(checkInCard.data.startTime)
          const travelDur = travelCard.data.durationMinutes ?? 60
          if (travelStart !== null && checkInStart !== null) {
            const arrivalMins = travelStart + travelDur
            const gapMins = checkInStart - arrivalMins
            if (gapMins >= 60) {
              arrivalGapHint = `- arrivalToCheckInGap: ~${gapMins} min open between arrival (${formatMinutesToTime(arrivalMins)}) and check-in (${checkInCard.data.startTime}); consider scheduling hotel luggage drop-off + activities in between`
            }
          }
        }
        workspaceContextBlock = [
          '\n\nActive Trip Workspace Context:',
          `- tripId: ${access.trip.recordId}`,
          `- title: ${access.trip.data.title}`,
          `- mode: ${access.trip.data.mode}`,
          `- dates: ${effectiveStartDate ?? access.trip.data.startDate ?? 'unset'} -> ${access.trip.data.endDate ?? 'unset'} (${totalTripDays} days)`,
          `- callerAccessRole: ${access.role}`,
          ...(activeDayNum ? [`- activeDayNumber: ${activeDayNum}`] : []),
          ...(activeDayCtx?.fullDateLabel ? [`- activeDayDate: ${activeDayCtx.fullDateLabel}`] : []),
          ...(activeDayHotelSummary ? [`- activeDayMapHotelPins (authoritative H markers on map): ${activeDayHotelSummary}`] : []),
          ...(activeDayCtx?.isLocationChange && activeDayCtx.previousDestination && activeDayCtx.destination
            ? [
                `- movingDay: ${activeDayCtx.previousDestination.name} -> ${activeDayCtx.destination.name} (preserve existing Check out, Travel:, and Check in cards)`,
              ]
            : []),
          ...(arrivalGapHint ? [arrivalGapHint] : []),
          ...(destSummary ? [`- destinations: ${destSummary}`] : []),
          `- pace: ${access.trip.data.pace ?? 'balanced'}`,
          ...(access.trip.data.interests?.length
            ? [`- interests: ${access.trip.data.interests.join(', ')}`]
            : []),
          ...(existingStopsSummary ? [`- activeDayExistingStops:\n${existingStopsSummary}`] : []),
        ].join('\n')
      }
    }

    // Compaction inserts at most one summary system message at index 0; fold
    // it into the top-level `system` so we don't pass two system roles. Then
    // convert the remaining ChatTurns into AI SDK ModelMessages — splitting
    // assistant rows into the assistant + paired tool messages the SDK expects.
    const [first, ...rest] = prepared
    const summary = first?.role === 'system' ? first : null
    const systemText = summary
      ? `${baseSystem}${workspaceContextBlock}\n\n${summary.content}`
      : `${baseSystem}${workspaceContextBlock}`
    const messages = turnsToCoreMessages(summary ? rest : prepared)

    // The SDK executor runs each tool as the verified user, in the room the
    // access grant admitted them to, and forwards the route's abort signal, so
    // a tool fetch in flight is cancelled if the client navigates away
    // mid-stream. The local assistant routes use the same executor and
    // context, and streamDeepSpaceAgent caps each tool result for the model,
    // keeping both surfaces' tool behavior identical.
    const tools = buildTools(
      createUserToolExecutor(c.env, auth.userId, c.req.raw.signal, { room: access.room }),
      { env: c.env, userId: auth.userId, request: c.req.raw },
    )

    // Allocate the assistant row id BEFORE streaming starts so we can echo it
    // back via a response header. The client tags its in-flight overlay with
    // this id and dedups against the WebSocket-broadcast persisted row by id —
    // not by comparing `spawnTime` (client clock) to `createdAt` (server clock),
    // which broke for users whose clock was ahead of the server.
    const asstId = `asst-${Date.now()}-${crypto.randomUUID()}`

    // Save the finished turn: every step's messages (tool calls included), not
    // just the final step's. Called on normal completion and when the request
    // is aborted after at least one step completed.
    const persistTurn = async (text: string, responseMessages: ModelMessage[]): Promise<void> => {
      const parts = buildUiParts(responseMessages)
      if (text.trim() === '' && parts.length === 0) {
        console.warn('[ai-chat] FINISH empty turn, skipping persist')
        return
      }

      // Persist user → assistant → metadata as independent writes, not a
      // transaction. Order matters: user FIRST so chronological reads are
      // correct, then assistant. If user-write
      // exhausts retries we ABORT the assistant write — otherwise we'd persist
      // an assistant row with no preceding user row, breaking the invariant
      // relied on by the dedup + turnsToCoreMessages loop on the next turn.
      //
      // The helpers return `false` (no throw) when the chat no longer exists
      // — deleted mid-stream — and nothing was written; that is not retried,
      // and it stops the sequence the same way an exhausted retry does.
      const writeWithRetry = async (
        label: string,
        fn: () => Promise<boolean | void>,
      ): Promise<boolean> => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            if ((await fn()) === false) {
              console.warn(`[ai-chat] ${label} skipped — chat ${chatId} no longer exists`)
              return false
            }
            return true
          } catch (err) {
            console.error(`[ai-chat] ${label} ${attempt === 1 ? 'failed, retrying once' : 'retry failed'}: ${loggableError(err)}`)
          }
        }
        return false
      }

      const userOk = await writeWithRetry('user message', () =>
        appendMessage(stub, {
          id: userMessageId,
          chatId,
          userId: auth.userId,
          role: 'user',
          content,
        }),
      )
      if (!userOk) {
        console.error(
          '[ai-chat] FINISH aborting — user write did not land; skipping assistant + metadata to avoid orphan rows',
        )
        return
      }
      const assistantOk = await writeWithRetry('assistant message', () =>
        appendMessage(stub, {
          id: asstId,
          chatId,
          userId: auth.userId,
          role: 'assistant',
          content: text,
          ...(parts.length > 0 ? { parts } : {}),
        }),
      )
      if (!assistantOk) return
      await writeWithRetry('chat metadata', async () => {
        // Re-fetch so a mid-stream rename by the user isn't clobbered by a
        // stale "auto-title" derived from the captured `chat` snapshot. A
        // chat deleted mid-stream reads back as null; `updateChat` refuses
        // that case on its own (an unguarded `records.update` would upsert
        // the row back into existence), so this only decides the title.
        const fresh = await getChat(stub, chatId, auth.userId)
        const patch: { title?: string; model?: string } = { model: usedModelId }
        if (fresh && (!fresh.title || fresh.title === 'New chat')) {
          patch.title = deriveTitle(content)
        }
        return updateChat(stub, chatId, auth.userId, patch)
      })
    }

    let streamResult: { stream: ReturnType<typeof streamDeepSpaceAgent>['result']['stream'] }
    if (usingGemini && geminiCred) {
      const googleProvider =
        geminiCred.authType === 'oauth' && geminiCred.accessToken
          ? createGoogleGenerativeAI({
              apiKey: 'oauth-token',
              fetch: (input, init) => {
                const headers = new Headers(init?.headers)
                headers.delete('x-goog-api-key')
                headers.set('Authorization', `Bearer ${geminiCred.accessToken}`)
                return fetch(input, { ...init, headers })
              },
            })
          : createGoogleGenerativeAI({ apiKey: geminiCred.apiKey })

      let activeGeminiModelId = usedModelId
      const resilientModel = createResilientGeminiModel(
        (id) => googleProvider(id),
        usedModelId,
        {
          onFallback: (fromModel, toModel) => {
            activeGeminiModelId = toModel
            console.warn(`[ai-chat] gemini fallback ${fromModel} -> ${toModel} due to capacity`)
          },
        },
      )

      streamResult = streamText({
        model: resilientModel as unknown as Parameters<typeof streamText>[0]['model'],
        system: systemText,
        messages,
        tools,
        maxRetries: 0,
        stopWhen: stepCountIs(101),
        abortSignal: c.req.raw.signal,
        onError: ({ error }) => {
          console.error(
            `[ai-chat] gemini stream error (model=${activeGeminiModelId}): ${loggableError(error)}`,
          )
        },
        onEnd: ({ text, responseMessages }) =>
          persistTurn(text, responseMessages as ModelMessage[]),
        onAbort: ({ steps }) => {
          const last = steps.at(-1)
          if (!last) return
          return persistTurn(
            last.text,
            steps.flatMap((step) => step.response.messages) as ModelMessage[],
          )
        },
      })
    } else {
      const { result } = streamDeepSpaceAgent(c.env, {
        profile: 'application',
        modelId: usedModelId,
        maxToolCalls: 100,
        authToken: jwt,
        instructions: systemText,
        messages,
        tools,
        abortSignal: c.req.raw.signal,
        onError: ({ error }) => {
          console.error(
            `[ai-chat] stream error: ${deepSpaceAgentErrorSummary(error, diagnosticContext)}`,
          )
        },
        onEnd: ({ text, responseMessages }) =>
          persistTurn(text, responseMessages as ModelMessage[]),
        onAbort: ({ steps }) => {
          const last = steps.at(-1)
          if (!last) return
          return persistTurn(
            last.text,
            steps.flatMap((step) => step.response.messages) as ModelMessage[],
          )
        },
      })
      streamResult = result
    }

    return createUIMessageStreamResponse({
      headers: {
        // Lets the client tag its in-flight assistant overlay with the same id
        // the worker will use in `persistTurn`, so dedup against
        // the WebSocket-broadcast row is by id (clock-skew-proof).
        'X-Asst-Id': asstId,
      },
      stream: toUIMessageStream({
        stream: streamResult.stream,
        // Reasoning models (o-series, Claude with extended thinking) emit
        // `reasoning-start`/`reasoning-delta`/`reasoning-end` chunks. We
        // don't render them today — pass them through and the user sees a
        // stuck spinner during long thinks. Opt out at the boundary until
        // the UI gains a "thinking" disclosure block.
        sendReasoning: false,
        onError: (error: unknown): string => {
          // The return value becomes the user-visible `errorText` for every
          // `tool-input-error` / `tool-output-error` chunk and stream-level
          // error. Surface the real message so RBAC denials and validation
          // failures are debuggable; log full detail server-side.
          console.error(`[ai-chat] response error: ${loggableError(error)}`)
          return usingGemini
            ? formatGeminiError(error)
            : error instanceof Error
              ? error.message
              : String(error)
        },
      }),
    })
  })
}
