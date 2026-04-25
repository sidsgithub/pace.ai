import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from '../../pages/Home'

// Mutable sessions array — tests push data in before rendering
const mockSessions = vi.hoisted<any[]>(() => [])

vi.mock('../../lib/supabase', () => {
  const usersChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: 'test-uid', name: 'sid', onboarded: true },
      error: null,
    }),
  }
  const sessionsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockImplementation(() =>
      Promise.resolve({ data: mockSessions, error: null })
    ),
  }
  const runsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
  }

  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-uid' } } }),
      },
      from: vi.fn().mockImplementation((table) => {
        if (table === 'sessions') return sessionsChain
        if (table === 'runs') return runsChain
        return usersChain
      }),
    },
  }
})

afterEach(() => {
  mockSessions.splice(0)
})

test('displays capitalised name in greeting', async () => {
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  )
  const greeting = await screen.findByText(/Good (morning|afternoon|evening), Sid/i)
  expect(greeting).toBeInTheDocument()
})

test('rest day does not show Start run button', async () => {
  mockSessions.push({
    id: 'session-1',
    session_type: 'rest',
    status: 'planned',
    session_date: new Date().toISOString().split('T')[0],
  })

  render(<MemoryRouter><Home /></MemoryRouter>)
  await waitFor(() => {
    expect(screen.queryByText(/start run/i)).not.toBeInTheDocument()
  })
})
