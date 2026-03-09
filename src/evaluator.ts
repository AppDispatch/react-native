import type { EvaluationContext } from "@openfeature/core";
import type { FlagDefinition, RuleDefinition } from "./types";

export type EvalReason =
  | "DISABLED"
  | "DEFAULT"
  | "TARGETING_MATCH"
  | "SPLIT"
  | "ERROR";

export interface EvalResult {
  value: unknown;
  variant: string | undefined;
  reason: EvalReason;
}

/**
 * Evaluate a flag against the given context.
 * Rules are evaluated in priority order (lower = first).
 * If no rule matches, the flag's default value is returned.
 */
export function evaluateFlag(
  flag: FlagDefinition,
  context: EvaluationContext,
): EvalResult {
  if (!flag.enabled) {
    return { value: flag.defaultValue, variant: undefined, reason: "DISABLED" };
  }

  const sorted = [...flag.rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    const result = evaluateRule(rule, flag, context);
    if (result) return result;
  }

  const defaultVariation = flag.variations.find(
    (v) => JSON.stringify(v.value) === JSON.stringify(flag.defaultValue),
  );
  return {
    value: flag.defaultValue,
    variant: defaultVariation?.name ?? undefined,
    reason: "DEFAULT",
  };
}

function evaluateRule(
  rule: RuleDefinition,
  flag: FlagDefinition,
  context: EvaluationContext,
): EvalResult | null {
  switch (rule.ruleType) {
    case "user_list":
      return evaluateUserList(rule, flag, context);
    case "percentage_rollout":
      return evaluatePercentageRollout(rule, flag, context);
    case "attribute":
      return evaluateAttributeRule(rule, flag, context);
    default:
      return null;
  }
}

function evaluateUserList(
  rule: RuleDefinition,
  flag: FlagDefinition,
  context: EvaluationContext,
): EvalResult | null {
  const userIds = (rule.ruleConfig.userIds as string) ?? "";
  const ids = userIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const targetingKey = context.targetingKey;
  if (!targetingKey || !ids.includes(targetingKey)) {
    return null;
  }

  const variation = flag.variations.find(
    (v) => JSON.stringify(v.value) === JSON.stringify(rule.variantValue),
  );

  return {
    value: rule.variantValue,
    variant: variation?.name ?? undefined,
    reason: "TARGETING_MATCH",
  };
}

function evaluatePercentageRollout(
  rule: RuleDefinition,
  flag: FlagDefinition,
  context: EvaluationContext,
): EvalResult | null {
  const rollout = rule.ruleConfig.rollout as
    | Array<{ variationId: number; weight: number }>
    | undefined;

  if (!rollout || rollout.length === 0) return null;

  const targetingKey = context.targetingKey ?? "";
  const bucket = hashToBucket(flag.key + targetingKey);

  let cumulative = 0;
  for (const entry of rollout) {
    cumulative += entry.weight;
    if (bucket < cumulative) {
      const variation = flag.variations.find((v) => v.id === entry.variationId);
      return {
        value: variation?.value ?? flag.defaultValue,
        variant: variation?.name ?? undefined,
        reason: "SPLIT",
      };
    }
  }

  return null;
}

function evaluateAttributeRule(
  rule: RuleDefinition,
  _flag: FlagDefinition,
  context: EvaluationContext,
): EvalResult | null {
  const conditions = rule.ruleConfig.conditions as
    | Array<{ attribute: string; operator: string; values: string[] }>
    | undefined;

  if (!conditions || conditions.length === 0) return null;

  for (const condition of conditions) {
    const attrValue = context[condition.attribute];

    if (condition.operator === "exists") {
      if (attrValue === undefined || attrValue === null) return null;
      continue;
    }
    if (condition.operator === "not_exists") {
      if (attrValue !== undefined && attrValue !== null) return null;
      continue;
    }

    if (attrValue === undefined || attrValue === null) return null;
    const strValue = String(attrValue);

    switch (condition.operator) {
      case "eq":
        if (strValue !== condition.values[0]) return null;
        break;
      case "neq":
        if (strValue === condition.values[0]) return null;
        break;
      case "in":
        if (!condition.values.includes(strValue)) return null;
        break;
      case "not_in":
        if (condition.values.includes(strValue)) return null;
        break;
      case "contains":
        if (!strValue.includes(condition.values[0])) return null;
        break;
      case "starts_with":
        if (!strValue.startsWith(condition.values[0])) return null;
        break;
      case "ends_with":
        if (!strValue.endsWith(condition.values[0])) return null;
        break;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const numA = Number(strValue);
        const numB = Number(condition.values[0]);
        if (isNaN(numA) || isNaN(numB)) return null;
        if (condition.operator === "gt" && !(numA > numB)) return null;
        if (condition.operator === "gte" && !(numA >= numB)) return null;
        if (condition.operator === "lt" && !(numA < numB)) return null;
        if (condition.operator === "lte" && !(numA <= numB)) return null;
        break;
      }
      case "semver_gt":
      case "semver_gte":
      case "semver_lt":
      case "semver_lte": {
        const cmp = compareSemver(strValue, condition.values[0]);
        if (condition.operator === "semver_gt" && !(cmp > 0)) return null;
        if (condition.operator === "semver_gte" && !(cmp >= 0)) return null;
        if (condition.operator === "semver_lt" && !(cmp < 0)) return null;
        if (condition.operator === "semver_lte" && !(cmp <= 0)) return null;
        break;
      }
      default:
        return null;
    }
  }

  return {
    value: rule.variantValue,
    variant: undefined,
    reason: "TARGETING_MATCH",
  };
}

function compareSemver(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const segA = partsA[i] ?? 0;
    const segB = partsB[i] ?? 0;
    if (segA > segB) return 1;
    if (segA < segB) return -1;
  }
  return 0;
}

/**
 * Simple deterministic hash → 0–99 bucket.
 * Uses FNV-1a for speed and decent distribution.
 */
function hashToBucket(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash % 100;
}
