import { describe, it, expect } from 'vitest'
import { parseJsonArray, parseJsonObject } from '../aiJsonRepair.js'

describe('parseJsonArray', () => {
  it('parses pure JSON array', () => {
    expect(parseJsonArray('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('strips ```json fences', () => {
    const text = '```json\n[{"a":1},{"a":2}]\n```'
    expect(parseJsonArray(text)).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('extracts array from prose preamble', () => {
    const text = 'Here are the results:\n```json\n[{"x":1}]\n```\nThanks!'
    expect(parseJsonArray(text)).toEqual([{ x: 1 }])
  })

  it('recovers truncated array (missing closing bracket)', () => {
    const text = '[{"a":1},{"a":2},{"a":3'
    const result = parseJsonArray(text)
    expect(result).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('recovers array with trailing comma', () => {
    const text = '[{"a":1},{"a":2},]'
    const result = parseJsonArray(text)
    expect(result).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('returns null for non-array', () => {
    expect(parseJsonArray('{"a":1}')).toBeNull()
  })

  it('returns null for empty/null input', () => {
    expect(parseJsonArray('')).toBeNull()
    expect(parseJsonArray(null)).toBeNull()
  })

  it('handles nested arrays', () => {
    expect(parseJsonArray('[[1,2],[3,4]]')).toEqual([[1, 2], [3, 4]])
  })
})

describe('parseJsonObject', () => {
  it('parses pure JSON object', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('strips fences', () => {
    expect(parseJsonObject('```json\n{"rules":[]}\n```')).toEqual({ rules: [] })
  })

  it('extracts from prose', () => {
    const text = 'Update:\n```json\n{"version":2,"rules":[{"id":"a"}]}\n```'
    expect(parseJsonObject(text)).toEqual({ version: 2, rules: [{ id: 'a' }] })
  })

  it('returns null for arrays', () => {
    expect(parseJsonObject('[1,2]')).toBeNull()
  })

  it('returns null for empty', () => {
    expect(parseJsonObject('')).toBeNull()
    expect(parseJsonObject(null)).toBeNull()
  })

  it('handles nested objects with strings containing braces', () => {
    expect(parseJsonObject('{"text":"hello {world}","n":1}')).toEqual({
      text: 'hello {world}',
      n: 1,
    })
  })
})
