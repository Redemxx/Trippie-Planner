import { getAuthToken } from 'deepspace'

export interface ActionResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
  status?: number
}

export async function callTripAction<T = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = await getAuthToken()
  if (!token) {
    throw new Error('Please sign in to perform this action.')
  }

  const res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })

  const body = (await res.json().catch(() => ({}))) as ActionResponse<T>
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Action "${name}" failed (${res.status})`)
  }
  return (body.data ?? {}) as T
}
