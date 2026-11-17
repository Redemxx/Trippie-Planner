import type { createGoogleGenerativeAI } from '@ai-sdk/google'

export type GoogleLanguageModel = ReturnType<ReturnType<typeof createGoogleGenerativeAI>>

const FALLBACK_CHAINS: Record<string, readonly string[]> = {
  'gemini-4-hydrogen': [
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
  ],
  'gemini-4-carbon': [
    'gemini-4-carbon',
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
  ],
  'gemini-4-argon': [
    'gemini-4-argon',
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
  ],
  'gemini-3.8-flash': [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-4-hydrogen',
  ],
  'gemini-3.5-flash': [
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-2.5-flash',
    'gemini-4-hydrogen',
  ],
}

const DEFAULT_FALLBACK_TAIL = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
] as const

export function getGeminiFallbackCandidates(primaryModelId: string): string[] {
  const configured = FALLBACK_CHAINS[primaryModelId] ?? [primaryModelId, ...DEFAULT_FALLBACK_TAIL]
  return Array.from(new Set(configured))
}

function unwrapError(error: unknown): { statusCode?: number; text: string } {
  if (!error || typeof error !== 'object') {
    return { text: String(error ?? '') }
  }
  const obj = error as {
    statusCode?: number
    message?: string
    responseBody?: string
    lastError?: unknown
    errors?: unknown[]
  }
  const nested = obj.lastError ?? obj.errors?.[obj.errors.length - 1]
  if (nested && nested !== error) {
    const inner = unwrapError(nested)
    return {
      statusCode: inner.statusCode ?? obj.statusCode,
      text: `${obj.message ?? ''} ${inner.text} ${obj.responseBody ?? ''}`.trim(),
    }
  }
  return {
    statusCode: obj.statusCode,
    text: `${obj.message ?? ''} ${obj.responseBody ?? ''}`.trim(),
  }
}

export function isGeminiAuthError(error: unknown): boolean {
  const { statusCode, text } = unwrapError(error)
  if (statusCode === 401 || statusCode === 403) return true
  return /api key not valid|invalid authentication|permission_denied|unauthenticated/i.test(text)
}

export function isGeminiCapacityOrTransientError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  if (isGeminiAuthError(error)) return false
  const { statusCode, text } = unwrapError(error)
  if (
    statusCode === 404 ||
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504
  ) {
    return true
  }
  return /high demand|spikes in demand|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|rate limit|temporarily unavailable|try again later|model .* is not found|not supported for generateContent/i.test(
    text,
  )
}

export function formatGeminiError(error: unknown): string {
  const { statusCode, text } = unwrapError(error)
  if (isGeminiAuthError(error)) {
    return 'Google Gemini authentication failed. Reconnect your Google account or update your Gemini API key in Preferences.'
  }
  if (
    statusCode === 503 ||
    /high demand|spikes in demand|UNAVAILABLE|overloaded/i.test(text)
  ) {
    return 'Google Gemini is experiencing high demand right now (HTTP 503), even after automatic fallback across Gemini models. Click Retry in a moment or switch temporarily to Claude or GPT in the model picker.'
  }
  if (statusCode === 429 || /RESOURCE_EXHAUSTED|rate limit|quota/i.test(text)) {
    return 'Google Gemini rate limit or quota exceeded for your account/key. Wait a moment and click Retry, or switch to Claude or GPT in the model picker.'
  }
  return error instanceof Error ? error.message : String(error)
}

export class GeminiCapacityExhaustedError extends Error {
  readonly triedModels: string[]
  override readonly cause: unknown

  constructor(triedModels: string[], lastError: unknown) {
    super(formatGeminiError(lastError))
    this.name = 'GeminiCapacityExhaustedError'
    this.triedModels = triedModels
    this.cause = lastError
  }
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface ResilientGeminiOptions {
  retryDelayMs?: number
  onFallback?: (fromModel: string, toModel: string, error: unknown) => void
}

/**
 * Wraps a Google Gemini `LanguageModel` factory so transient capacity spikes
 * (HTTP 503 high demand, 429, 5xx) retry once briefly and then cascade cleanly
 * through compatible Gemini fallback models, pinning the working model across
 * multi-step tool calls in the same turn.
 */
export function createResilientGeminiModel(
  createModel: (modelId: string) => GoogleLanguageModel,
  primaryModelId: string,
  options?: ResilientGeminiOptions,
): GoogleLanguageModel {
  const baseModel = createModel(primaryModelId)
  const retryDelayMs = options?.retryDelayMs ?? 350
  let activeModelId = primaryModelId

  function orderedCandidates(): string[] {
    const base = getGeminiFallbackCandidates(primaryModelId)
    if (activeModelId === primaryModelId) return base
    return [activeModelId, ...base.filter((id) => id !== activeModelId)]
  }

  async function runWithFallback<TResult>(
    abortSignal: AbortSignal | undefined,
    invoke: (model: GoogleLanguageModel) => PromiseLike<TResult>,
  ): Promise<TResult> {
    const candidates = orderedCandidates()
    const tried: string[] = []
    let lastError: unknown

    for (let idx = 0; idx < candidates.length; idx++) {
      const candidateId = candidates[idx]
      const attemptsForCandidate = idx === 0 ? 2 : 1

      for (let attempt = 0; attempt < attemptsForCandidate; attempt++) {
        if (abortSignal?.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
        try {
          if (!tried.includes(candidateId)) tried.push(candidateId)
          const model = createModel(candidateId)
          const result = await invoke(model)
          if (candidateId !== activeModelId) {
            options?.onFallback?.(activeModelId, candidateId, lastError)
            activeModelId = candidateId
          }
          return result
        } catch (err) {
          lastError = err
          if (abortSignal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
            throw err
          }
          if (!isGeminiCapacityOrTransientError(err)) {
            throw err
          }
          if (attempt + 1 < attemptsForCandidate) {
            await sleepWithAbort(retryDelayMs, abortSignal)
          }
        }
      }
    }

    throw new GeminiCapacityExhaustedError(tried, lastError)
  }

  return {
    specificationVersion: baseModel.specificationVersion,
    provider: baseModel.provider,
    get modelId() {
      return activeModelId
    },
    supportedUrls: baseModel.supportedUrls,
    doGenerate: (callOptions) =>
      runWithFallback(callOptions.abortSignal, (model) => model.doGenerate(callOptions)),
    doStream: (callOptions) =>
      runWithFallback(callOptions.abortSignal, (model) => model.doStream(callOptions)),
  }
}
