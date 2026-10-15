import { describe, expect, it } from 'vitest'
import { todayInTunis } from './today'

describe('todayInTunis', () => {
  it('gives the day in Tunisia (UTC+1), not in UTC: 23:30 UTC is already tomorrow there', () => {
    expect(todayInTunis(Date.UTC(2026, 9, 14, 23, 30))).toBe('2026-10-15')
  })

  it('keeps the day before midnight in Tunis', () => {
    expect(todayInTunis(Date.UTC(2026, 9, 14, 22, 59))).toBe('2026-10-14')
  })

  it('writes month and day on two digits', () => {
    expect(todayInTunis(Date.UTC(2026, 0, 5, 12))).toBe('2026-01-05')
  })

  it('crosses the year in Tunis time', () => {
    expect(todayInTunis(Date.UTC(2026, 11, 31, 23, 15))).toBe('2027-01-01')
  })
})
