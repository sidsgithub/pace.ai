/**
 * Calls /api/generate-plan which generates the plan AND inserts it into Supabase
 * server-side using the service role key. Returns the inserted rows.
 */
export async function generateAndSavePlan(profile, userId) {
  const res = await fetch('/api/generate-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, userId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `generate-plan failed: ${res.status}`)
  }

  return res.json()
}
