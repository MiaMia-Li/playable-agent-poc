// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioAccount } from '@/components/playable/studio-account'

afterEach(cleanup)

describe('StudioAccount', () => {
  it('renders the shared public experience UI independently of the account label', () => {
    render(<StudioAccount accountLabel="公开体验" publicAccess />)

    const account = screen.getByLabelText('账户：公开体验，任务共享')
    expect(account).toHaveTextContent('公开体验')
    expect(account).toHaveTextContent('共享')
  })

  it('renders a regular account label and its initial', () => {
    render(<StudioAccount accountLabel="Playable Studio" />)

    const account = screen.getByLabelText('账户：Playable Studio')
    expect(account).toHaveTextContent('P')
    expect(account).toHaveTextContent('Playable Studio')
    expect(account).not.toHaveTextContent('共享')
  })
})
