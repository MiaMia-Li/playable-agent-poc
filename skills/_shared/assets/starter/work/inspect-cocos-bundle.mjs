import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { parse } from './vendor/acorn.mjs'

const VERSION = 2
const MAX_BYTES = 2 * 1024 * 1024
class InspectionError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}
const unsupported = () => {
  throw new InspectionError('unsupported_structure')
}
const identifier = (node, name) => node?.type === 'Identifier' && node.name === name
const property = (node) => (node?.computed ? node.property?.value : node?.property?.name)

// This is a deliberately small expression evaluator, not a JavaScript runtime.
// Source calls, property access and arbitrary identifiers are never executed.
export function inspectBundle(source) {
  if (Buffer.byteLength(source) > MAX_BYTES) throw new InspectionError('input_too_large')
  const deadline = Date.now() + 2000
  let budget = 500000
  const tick = () => {
    if (--budget < 0 || Date.now() > deadline) throw new InspectionError('analysis_budget_exceeded')
  }
  let ast
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  } catch {
    throw new InspectionError('invalid_javascript')
  }
  const declaration = ast.body[0]?.declarations?.[0]
  if (declaration?.id.type !== 'Identifier' || declaration.init?.type !== 'ArrayExpression') unsupported()
  if (ast.body[0].declarations.length !== 1) unsupported()
  const elements = declaration.init.elements
  if (
    !elements.length ||
    elements.length > 10000 ||
    elements.some((node) => node?.type !== 'Literal' || typeof node.value !== 'string')
  )
    unsupported()
  const strings = elements.map((node) => node.value)
  const decoder = ast.body.find((node) => node.type === 'FunctionDeclaration')
  const arg = decoder?.params[0]?.name
  const [subtract, lookup, returned] = decoder?.body.body ?? []
  const assignment = subtract?.expression
  const access = lookup?.declarations?.[0]
  if (
    !arg ||
    decoder.body.body.length !== 3 ||
    assignment?.operator !== '=' ||
    !identifier(assignment.left, arg) ||
    assignment.right?.type !== 'BinaryExpression' ||
    assignment.right.operator !== '-' ||
    !identifier(assignment.right.left, arg) ||
    assignment.right.right?.type !== 'Literal' ||
    !Number.isSafeInteger(assignment.right.right.value) ||
    lookup.declarations.length !== 1 ||
    access?.init?.type !== 'MemberExpression' ||
    !access.init.computed ||
    !identifier(access.init.object, declaration.id.name) ||
    !identifier(access.init.property, arg) ||
    returned?.type !== 'ReturnStatement' ||
    !identifier(returned.argument, access.id.name)
  )
    unsupported()
  const offset = assignment.right.right.value
  const aliases = new Set([decoder.id.name])
  function collectAliases(statements) {
    for (const statement of statements) {
      if (statement.type !== 'VariableDeclaration') unsupported()
      for (const item of statement.declarations) {
        if (item.id.type === 'Identifier' && item.init?.type === 'Identifier' && aliases.has(item.init.name))
          aliases.add(item.id.name)
        else unsupported()
      }
    }
  }
  collectAliases(ast.body.slice(1, ast.body.indexOf(decoder)))
  const expression = ast.body[ast.body.indexOf(decoder) + 1]?.expression
  const rotate = expression?.type === 'SequenceExpression' ? expression.expressions[0] : expression
  if (
    rotate?.type !== 'CallExpression' ||
    rotate.callee.type !== 'FunctionExpression' ||
    !identifier(rotate.arguments[0], declaration.id.name) ||
    rotate.arguments[1]?.type !== 'Literal' ||
    typeof rotate.arguments[1].value !== 'number'
  )
    unsupported()
  const body = rotate.callee.body.body
  const loop = body.at(-1)
  if (
    loop?.type !== 'WhileStatement' ||
    loop.test.type !== 'UnaryExpression' ||
    loop.test.operator !== '!' ||
    loop.test.argument.type !== 'UnaryExpression' ||
    loop.test.argument.operator !== '!' ||
    loop.test.argument.argument.type !== 'ArrayExpression' ||
    loop.test.argument.argument.elements.length !== 0
  )
    unsupported()
  collectAliases(body.slice(0, -1))
  const attempt = loop?.body.body?.find((node) => node.type === 'TryStatement')
  const calculation = attempt?.block.body?.[0]?.declarations?.[0]
  const comparison = attempt?.block.body?.[1]
  const rotationArray = rotate.callee.params[0]?.name
  const shift = comparison?.alternate?.expression
  if (
    !calculation ||
    comparison?.type !== 'IfStatement' ||
    comparison.test?.operator !== '===' ||
    !identifier(comparison.test.left, calculation.id.name) ||
    !identifier(comparison.test.right, rotate.callee.params[1]?.name) ||
    comparison.consequent?.type !== 'BreakStatement' ||
    shift?.type !== 'CallExpression' ||
    !identifier(shift.callee?.object, rotationArray) ||
    property(shift.callee) !== 'push' ||
    shift.arguments[0]?.type !== 'CallExpression' ||
    !identifier(shift.arguments[0].callee?.object, rotationArray) ||
    property(shift.arguments[0].callee) !== 'shift'
  )
    unsupported()
  function evaluate(node, rotation) {
    tick()
    if (node?.type === 'Literal' && typeof node.value === 'number') return node.value
    if (node?.type === 'UnaryExpression' && ['+', '-'].includes(node.operator)) {
      const value = evaluate(node.argument, rotation)
      return node.operator === '-' ? -value : +value
    }
    if (node?.type === 'BinaryExpression') {
      const left = evaluate(node.left, rotation),
        right = evaluate(node.right, rotation)
      switch (node.operator) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          return left / right
        case '%':
          return left % right
        default:
          unsupported()
      }
    }
    if (node?.type === 'CallExpression' && node.arguments.length === 1) {
      if (identifier(node.callee, 'parseInt')) return Number.parseInt(evaluate(node.arguments[0], rotation))
      if (node.callee.type === 'Identifier' && aliases.has(node.callee.name)) {
        const index = evaluate(node.arguments[0], rotation) - offset
        return Number.isInteger(index) && index >= 0 && index < strings.length
          ? strings[(index + rotation) % strings.length]
          : undefined
      }
    }
    unsupported()
  }
  let rotation = 0
  while (rotation < strings.length && evaluate(calculation.init, rotation) !== rotate.arguments[1].value) rotation++
  if (rotation === strings.length) throw new InspectionError('rotation_not_resolved')
  const mapping = Object.fromEntries(
    strings.map((_, index) => ['0x' + (index + offset).toString(16), strings[(index + rotation) % strings.length]]),
  )
  // Complete AST ranges are evidence locations, never string-search cut points.
  return {
    version: VERSION,
    status: 'supported',
    decoder: decoder.id.name,
    offset,
    rotation,
    stringCount: strings.length,
    initializerRange: { start: rotate.start, end: rotate.end },
    strings: mapping,
  }
}

export async function inspectFile(input, root = 'work/cocos-inspection') {
  // Size-bound the read before allocating/parsing large inputs.
  const { stat } = await import('node:fs/promises')
  if ((await stat(input)).size > MAX_BYTES) throw new InspectionError('input_too_large')
  const source = await readFile(input, 'utf8')
  const sha256 = createHash('sha256').update(source).digest('hex')
  const directory = path.join(root, `v${VERSION}-${sha256}`)
  const output = path.join(directory, 'inspection.json')
  try {
    const cached = JSON.parse(await readFile(output, 'utf8'))
    if (
      cached.version === VERSION &&
      cached.sha256 === sha256 &&
      cached.status === 'supported' &&
      cached.strings &&
      Object.keys(cached.strings).length === cached.stringCount
    ) {
      await writeFile(
        path.join(root, 'latest.json'),
        JSON.stringify(
          { version: VERSION, sha256, report: path.relative(root, output), status: cached.status, code: null },
          null,
          2,
        ),
      )
      return { cached: true, report: cached }
    }
  } catch {
    /* Incomplete or missing analysis is recomputed. */
  }
  let report
  try {
    report = { ...inspectBundle(source), sha256 }
  } catch (error) {
    report = {
      version: VERSION,
      sha256,
      status: 'unsupported',
      code: error instanceof InspectionError ? error.code : 'analysis_failed',
    }
  }
  await mkdir(directory, { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2))
  // A stable pointer avoids printing a large dictionary into model context.
  await mkdir(root, { recursive: true })
  await writeFile(
    path.join(root, 'latest.json'),
    JSON.stringify({ version: VERSION, sha256, report: path.relative(root, output), status: report.status, code: report.code ?? null }, null, 2),
  )
  return { cached: false, report }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new InspectionError('missing_input')
    const result = await inspectFile(process.argv[2], process.argv[3])
    if (result.report.status !== 'supported') {
      console.log('Cocos inspection completed: unsupported; read work/cocos-inspection/latest.json or the selected output directory. Exit zero means report saved, not decoder support.')
    } else if (result.cached) console.log('Cocos inspection cache reused')
    else console.log('Cocos inspection saved')
  } catch {
    console.error('Cocos inspection failed; check the input and output locations')
    process.exitCode = 1
  }
}
