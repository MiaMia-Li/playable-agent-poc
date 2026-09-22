import { z } from 'zod'

// 只持久化应用预定义的诊断标识；错误原文、模型输出、字段值、未知字段名、响应体和堆栈均不保留。
// 用固定映射区分业务规则，避免为了定位问题而把敏感上下文写入任务事件。
const rules = {
  'Freeform builds must choose a concrete renderer': 'freeform_template_renderer',
  'Rapier requires Three.js rendering': 'rapier_requires_threejs',
  'Template physics requires the template renderer': 'template_physics_requires_template',
  'ask_user requires a request': 'request_missing',
  'Interactive request requires options': 'request_options_missing',
  'Text request cannot contain options': 'unexpected_request_options',
  'Implementation route is incomplete': 'route_incomplete',
  'Exact route cannot contain differences': 'exact_route_has_differences',
  'Non-exact route must describe differences': 'route_differences_missing',
  'Confirmation gameplay contains only internal implementation details': 'gameplay_description_invalid',
  'Confirmation does not match the validated route': 'confirmation_route_mismatch',
  'Confirmation still has open questions': 'open_questions_remaining',
  'No tool may run after a terminal tool': 'tool_after_terminal',
  'Brief update is missing': 'brief_missing',
  'Brief list update cannot add and remove the same entry': 'brief_list_conflict',
  'Annotation list is missing': 'annotations_missing',
  'Terminal tool must be the final tool': 'terminal_not_last',
  'Informational response cannot run domain tools': 'informational_has_domain_tools',
  'Market research presentation requires a completed report': 'research_report_missing',
  'Market research offer requires approval': 'research_approval_missing',
  'Revision requires an existing playable': 'revision_without_artifact',
  'Capabilities must be read before revision': 'revision_capabilities_missing',
  'Revision plan is missing': 'revision_missing',
  'Route must be validated before confirmation': 'route_not_validated',
  'Existing playables require a revision proposal': 'confirmation_for_existing_artifact',
  'Requirement plan did not reach a user-facing result': 'terminal_missing',
  'Requirement plan did not update the brief': 'brief_not_updated',
} as const

export type RequirementDiagnosticStage =
  | 'context_serialization'
  | 'structured_output'
  | 'step_validation'
  | 'analysis_tools'
  | 'plan_execution'
  | 'step_limit'

export interface RequirementDiagnostic {
  version: 1
  stage: RequirementDiagnosticStage
  /** 从 1 开始的模型循环轮次，与任务版本或构建版本无关。 */
  step: number
  rule: string
  issues: Array<{ code: string; path: Array<string | number>; rule?: string }>
}

// 字段白名单从可信 schema 提取并缓存，不从模型返回的数据中推导。
const schemaFields = new WeakMap<z.ZodType, Set<string>>()
function fieldsFor(schema: z.ZodType): Set<string> {
  const cached = schemaFields.get(schema)
  if (cached) return cached
  const fields = new Set<string>()
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return
    if ('properties' in value && value.properties && typeof value.properties === 'object') {
      for (const key of Object.keys(value.properties)) fields.add(key)
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(z.toJSONSchema(schema))
  schemaFields.set(schema, fields)
  return fields
}

export function requirementDiagnostic(
  error: unknown,
  stage: RequirementDiagnosticStage,
  step: number,
  schema: z.ZodType,
): RequirementDiagnostic {
  const fields = fieldsFor(schema)
  // SDK 可能多层包装校验错误；同时限制深度并检测循环引用，保证诊断过程能够结束。
  const seen = new Set<unknown>()
  let current = error
  for (
    let depth = 0;
    depth < 6 && (current instanceof Error || current instanceof z.ZodError) && !seen.has(current);
    depth++
  ) {
    seen.add(current)
    if (current instanceof z.ZodError) {
      return {
        version: 1,
        stage,
        step,
        rule: 'schema_invalid',
        // 限制问题数量、路径长度与数组索引；未知路径段统一隐藏，防止键名本身携带敏感信息。
        issues: current.issues.slice(0, 12).map((issue) => ({
          code: issue.code,
          ...(Object.hasOwn(rules, issue.message) ? { rule: rules[issue.message as keyof typeof rules] } : {}),
          path: issue.path
            .slice(0, 16)
            .map((part) =>
              typeof part === 'number' && Number.isSafeInteger(part) && part >= 0 && part <= 10000
                ? part
                : typeof part === 'string' && fields.has(part)
                  ? part
                  : '[unknown]',
            ),
        })),
      }
    }
    const rule = Object.hasOwn(rules, current.message) ? rules[current.message as keyof typeof rules] : undefined
    if (rule) return { version: 1, stage, step, rule, issues: [] }
    current = current.cause
  }
  return { version: 1, stage, step, rule: stage === 'step_limit' ? 'step_limit_reached' : 'unclassified', issues: [] }
}

/** Repair only recognized output validation failures, never infrastructure or tool failures. */
export function requirementRepairInstructions(diagnostic: RequirementDiagnostic): string | undefined {
  if (!['structured_output', 'step_validation', 'plan_execution'].includes(diagnostic.stage)) return
  const knownRules: readonly string[] = [
    ...Object.values(rules),
    'schema_invalid',
    'step_shape_invalid',
    'analysis_arguments_invalid',
  ]
  if (!knownRules.includes(diagnostic.rule)) return
  const explanation = Object.entries(rules).find(([, rule]) => rule === diagnostic.rule)?.[0]
  return [
    'The previous plan was rejected by output validation. No rejected plan changes were persisted. Generate a complete replacement step from the original conversation context and the existing tool results, correcting the validation errors below.',
    'Follow the supplied schema and all domain tool ordering rules. Do not invent missing user choices, approvals or evidence. If information is missing, update the brief and end with ask_user; if this is purely informational, use only respond_to_user. A terminal plan must end with a valid terminal call. Use a tool_calls step only when actual analysis is needed, and reuse completed tool results.',
    explanation ?? 'Correct the output shape, field types or analysis arguments identified below.',
    JSON.stringify(diagnostic),
  ].join('\n')
}
