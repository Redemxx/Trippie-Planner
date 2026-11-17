import { describe, expect, it, vi } from 'vitest'
import {
  createResilientGeminiModel,
  formatGeminiError,
  GeminiCapacityExhaustedError,
  getGeminiFallbackCandidates,
  isGeminiCapacityOrTransientError,
  type GoogleLanguageModel,
} from './gemini-fallback'

function makeFakeModel(
  modelId: string,
  handler: (modelId: string) => Promise<{ stream: ReadableStream }>,
): GoogleLanguageModel {
  return {
    specificationVersion: 'v4',
    provider: 'google.generative-ai',
    modelId,
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('not used in test')
    },
    doStream: () => handler(modelId),
  } as unknown as GoogleLanguageModel
}

describe('gemini-fallback', () => {
  it('detects 503 high demand errors as transient capacity failures, not auth errors', () => {
    const highDemandErr = Object.assign(
      new Error(
        'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
      ),
      { statusCode: 503 },
    )
    const authErr = Object.assign(new Error('API key not valid'), { statusCode: 400 })
    const unauthErr = Object.assign(new Error('Unauthorized'), { statusCode: 401 })

    expect(isGeminiCapacityOrTransientError(highDemandErr)).toBe(true)
    expect(isGeminiCapacityOrTransientError(authErr)).toBe(false)
    expect(isGeminiCapacityOrTransientError(unauthErr)).toBe(false)
    expect(formatGeminiError(highDemandErr)).toContain('high demand')
  })

  it('cascades to fallback Gemini models on 503 high demand and pins the working model', async () => {
    const called: string[] = []
    const fallbacks: Array<[string, string]> = []
    const resilient = createResilientGeminiModel(
      (id) =>
        makeFakeModel(id, async (candidate) => {
          called.push(candidate)
          if (candidate === 'gemini-4-hydrogen') {
            throw Object.assign(
              new Error('This model is currently experiencing high demand.'),
              { statusCode: 503 },
            )
          }
          return { stream: new ReadableStream() }
        }),
      'gemini-4-hydrogen',
      {
        retryDelayMs: 0,
        onFallback: (from, to) => fallbacks.push([from, to]),
      },
    )

    // Step 1: primary fails twice (initial + 1 quick retry), succeeds on gemini-3.8-flash
    await resilient.doStream({} as never)
    expect(called).toEqual(['gemini-4-hydrogen', 'gemini-4-hydrogen', 'gemini-3.8-flash'])
    expect(fallbacks).toEqual([['gemini-4-hydrogen', 'gemini-3.8-flash']])
    expect(resilient.modelId).toBe('gemini-3.8-flash')

    // Step 2 in same turn: pinned directly to gemini-3.8-flash
    await resilient.doStream({} as never)
    expect(called).toEqual([
      'gemini-4-hydrogen',
      'gemini-4-hydrogen',
      'gemini-3.8-flash',
      'gemini-3.8-flash',
    ])
  })

  it('does not retry or fallback on 401/403 authentication errors', async () => {
    const called: string[] = []
    const resilient = createResilientGeminiModel(
      (id) =>
        makeFakeModel(id, async (candidate) => {
          called.push(candidate)
          throw Object.assign(new Error('Invalid OAuth token'), { statusCode: 401 })
        }),
      'gemini-4-hydrogen',
      { retryDelayMs: 0 },
    )

    await expect(resilient.doStream({} as never)).rejects.toThrow('Invalid OAuth token')
    expect(called).toEqual(['gemini-4-hydrogen'])
  })

  it('throws GeminiCapacityExhaustedError with clean message when all candidates return 503', async () => {
    const called: string[] = []
    const resilient = createResilientGeminiModel(
      (id) =>
        makeFakeModel(id, async (candidate) => {
          called.push(candidate)
          throw Object.assign(
            new Error('This model is currently experiencing high demand.'),
            { statusCode: 503 },
          )
        }),
      'gemini-4-hydrogen',
      { retryDelayMs: 0 },
    )

    await expect(resilient.doStream({} as never)).rejects.toBeInstanceOf(
      GeminiCapacityExhaustedError,
    )
    expect(called).toEqual([
      'gemini-4-hydrogen',
      'gemini-4-hydrogen',
      ...getGeminiFallbackCandidates('gemini-4-hydrogen').slice(1),
    ])
  })

  it('respects abortSignal immediately without exhausting fallback chain', async () => {
    const ac = new AbortController()
    const spy = vi.fn()
    const resilient = createResilientGeminiModel(
      (id) =>
        makeFakeModel(id, async (candidate) => {
          spy(candidate)
          ac.abort()
          throw Object.assign(new Error('503 Unavailable'), { statusCode: 503 })
        }),
      'gemini-4-hydrogen',
      { retryDelayMs: 0 },
    )

    await expect(
      resilient.doStream({ abortSignal: ac.signal } as never),
    ).rejects.toThrow('503 Unavailable')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
