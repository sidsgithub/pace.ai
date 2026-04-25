import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OTPInput from '../../components/OTPInput'

test('renders exactly 6 OTP input boxes', () => {
  render(<OTPInput />)
  const inputs = screen.getAllByRole('textbox')
  expect(inputs).toHaveLength(6)
})

test('helper text says 6-digit not 8-digit', () => {
  render(<OTPInput />)
  expect(screen.getByText(/6-digit/i)).toBeInTheDocument()
})

test('auto-fills all boxes when a 6-digit number is pasted', async () => {
  const user = userEvent.setup()
  render(<OTPInput />)

  const inputs = screen.getAllByRole('textbox')
  await user.click(inputs[0])
  await user.paste('123456')

  expect(inputs[0]).toHaveValue('1')
  expect(inputs[1]).toHaveValue('2')
  expect(inputs[2]).toHaveValue('3')
  expect(inputs[3]).toHaveValue('4')
  expect(inputs[4]).toHaveValue('5')
  expect(inputs[5]).toHaveValue('6')
})

test('clears all boxes and refocuses first input on error', async () => {
  const { rerender } = render(<OTPInput />)

  // simulate filled state then error
  rerender(<OTPInput error="Incorrect code" />)

  const inputs = screen.getAllByRole('textbox')
  inputs.forEach(input => {
    expect(input).toHaveValue('')
  })
  expect(inputs[0]).toHaveFocus()
})
