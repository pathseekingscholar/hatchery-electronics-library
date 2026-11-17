import { describe, expect, it } from 'vitest'
import { makeDemoCatalog } from '../backend/demoSeed'
import { exportCsv, planImport } from './csv'

const catalog = makeDemoCatalog()

describe('CSV import planning', () => {
  it('round-trips an export as updates with no errors', () => {
    const plan = planImport(exportCsv(catalog), catalog)
    expect(plan.fatal).toBeNull()
    expect(plan.summary.errors).toBe(0)
    expect(plan.summary.duplicates).toBe(0)
    expect(plan.summary.create).toBe(0)
    expect(plan.summary.update).toBe(catalog.parts.length)
  })

  it('reports invalid and duplicate rows and groups multiple locations', () => {
    const csv = [
      'name,value,category,location_code,quantity,stock_status,last_checked,published',
      'Resistor,1 kΩ,Resistors,A-02,,in stock,2026-11-01,yes', // new part
      'Resistor,1 kΩ,Resistors,OVF,,low,,yes', // same part, second location
      'Resistor,1 kΩ,Resistors,A-02,,,,yes', // duplicate part+location
      ',10 kΩ,Resistors,A-02,,,,yes', // missing name
      'Mystery,,Resistors,Z-99,,,,yes', // unknown location
      'Thing,,Gizmos,A-02,three,,,yes', // bad quantity + new category
      'Resistor,220 Ω,Resistors,A-01-2,,low,11/02/2026,yes', // matches existing part
    ].join('\n')
    const plan = planImport(csv, catalog)
    expect(plan.rows.map((r) => r.status)).toEqual(['create', 'create', 'duplicate', 'error', 'error', 'error', 'update'])
    expect(plan.items).toHaveLength(2)
    expect(plan.items[0].stock.map((s) => s.status)).toEqual(['in_stock', 'low'])
    expect(plan.rows[5].messages.join(' ')).toMatch(/New category/)
    expect(plan.items[1].part.id).toBe('p-1')
  })

  it('never invents a count for uncounted stock', () => {
    const plan = planImport('name,location_code\nWidget,A-03', catalog)
    expect(plan.items[0].stock[0]).toMatchObject({ quantity: null, status: 'unverified', last_checked_at: null })
  })

  it('rejects files without a name column', () => {
    expect(planImport('foo,bar\n1,2', catalog).fatal).toMatch(/name/)
  })
})
