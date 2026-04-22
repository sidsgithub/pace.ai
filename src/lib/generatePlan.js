/**
 * Calls /api/generate-plan which generates the plan AND inserts it into Supabase
 * server-side using the service role key. Returns the inserted rows.
 *
 * Options:
 *   adjustmentReason: string | null  — coach note to factor into the new plan
 *   force: boolean                   — bypass the duplicate-plan skip check
 */
export async function generateAndSavePlan(profile, userId, options = {}) {
  const { adjustmentReason = null, force = false } = options

  const res = await fetch('/api/generate-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, userId, adjustmentReason, force }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `generate-plan failed: ${res.status}`)
  }

  return res.json()
}
