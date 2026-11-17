/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 * All travel data lookups and structured AI generations use `'user'` billing
 * so each signed-in user pays from their own DeepSpace credits.
 */

export const integrations: Record<
  string,
  { billing: 'developer' | 'user'; anonymous?: boolean }
> = {
  google: { billing: 'user' },
  composio: { billing: 'user' },
  serpapi: { billing: 'user' },
  openweathermap: { billing: 'user' },
  exa: { billing: 'user' },
  openai: { billing: 'user' },
  anthropic: { billing: 'user' },
  wikipedia: { billing: 'user' },
}
