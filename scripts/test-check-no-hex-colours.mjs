// Run: node --test scripts/test-check-no-hex-colours.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hexColours, compareToBaseline, lowerBaseline } from './check-no-hex-colours.mjs'

const sfc = (template, style) => `<template>\n${template}\n</template>\n<script setup lang="ts">\nconst a = '#fff'\n</script>\n<style scoped>\n${style}\n</style>\n`

test('counts #rgb, #rgba, #rrggbb and #rrggbbaa in style blocks, with line numbers', () => {
  const found = hexColours(sfc('<div />', '.a { color: #fff; }\n.b { background: #12345678; border-color: #abcd; }\n.c { color: #A1B2C3; }'))
  assert.deepEqual(found.map((f) => f.hex), ['#fff', '#12345678', '#abcd', '#A1B2C3'])
  assert.equal(found[0].line, 8)
  assert.equal(found[3].line, 10)
})

test('ignores script blocks, ID selectors that are not hex, five- and seven-digit runs, and tokens', () => {
  assert.deepEqual(hexColours(sfc('<p>#123 is an issue</p>', '#app { color: var(--color-primary); }\n.x { a: #abcde; b: #1234567; }')), [])
})

test('ignores CSS block and line comments, but not a // inside url()', () => {
  const style = '/* was #fff (#161) */\n.a { color: var(--x); } // see #abc\n.b { background: url(http://x/#fed); }'
  assert.deepEqual(hexColours(sfc('<div />', style)).map((f) => f.hex), ['#fed'])
})

test('counts hex in inline style= and :style attributes of the template', () => {
  const tpl = '<div style="color: #f00" :style="{ background: \'#00ff00\' }" title="#bad">\n<span v-bind:style="{ color: \'#123\' }" /></div>'
  assert.deepEqual(hexColours(sfc(tpl, '')).map((f) => f.hex), ['#f00', '#00ff00', '#123'])
})

test('several style blocks all count', () => {
  const src = '<template><div /></template>\n<style>\n.a { color: #111; }\n</style>\n<style scoped>\n.b { color: #222; }\n</style>\n'
  assert.deepEqual(hexColours(src).map((f) => f.hex), ['#111', '#222'])
})

test('a file over its baseline, or new with any, fails; at or under baseline passes', () => {
  const r = compareToBaseline({ 'a.vue': 3, 'b.vue': 2, 'c.vue': 1, 'd.vue': 0 }, { 'a.vue': 3, 'b.vue': 1 })
  assert.deepEqual(r.over, [
    { file: 'b.vue', count: 2, allowed: 1 },
    { file: 'c.vue', count: 1, allowed: 0 },
  ])
  assert.deepEqual(r.lowered, [])
})

test('a count below its baseline, or a baselined file gone, is reported as lowered', () => {
  const r = compareToBaseline({ 'a.vue': 1 }, { 'a.vue': 3, 'gone.vue': 2 })
  assert.deepEqual(r.over, [])
  assert.deepEqual(r.lowered, [
    { file: 'a.vue', count: 1, allowed: 3 },
    { file: 'gone.vue', count: 0, allowed: 2 },
  ])
})

test('lowerBaseline only lowers: it never raises a count or adds a file, and drops zeros', () => {
  const next = lowerBaseline({ 'a.vue': 1, 'b.vue': 5, 'new.vue': 4 }, { 'b.vue': 2, 'a.vue': 3, 'gone.vue': 2 })
  assert.deepEqual(next, { 'a.vue': 1, 'b.vue': 2 })
  assert.deepEqual(Object.keys(next), ['a.vue', 'b.vue'])
})
