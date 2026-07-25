import {
  RuleDomain,
  RulePriorityClass,
  SceneDimension,
  SymbolicTarget,
  type Rule,
  type RuleTarget,
  type ValidationFailure,
} from '../../shared/domain-model';
import { failureFromCode } from './failures';
import { AUTHORIZED_CONTEXT_PATHS } from './context';

const DOMAIN_DIMENSIONS: Readonly<Record<RuleDomain, ReadonlySet<SceneDimension>>> = {
  [RuleDomain.PrintArea]: new Set([SceneDimension.PrintAreaRules]),
  [RuleDomain.Background]: new Set([SceneDimension.Location, SceneDimension.Lighting]),
  [RuleDomain.Output]: new Set([]),
  [RuleDomain.Model]: new Set([SceneDimension.Pose, SceneDimension.DisplayMethod]),
  [RuleDomain.Decor]: new Set([SceneDimension.Decor, SceneDimension.Pose]),
  [RuleDomain.GarmentColor]: new Set([SceneDimension.GarmentColor]),
  [RuleDomain.Composition]: new Set([
    SceneDimension.Composition,
    SceneDimension.Pose,
    SceneDimension.Camera,
    SceneDimension.DisplayMethod,
    SceneDimension.View,
  ]),
  [RuleDomain.Cover]: new Set([]),
  [RuleDomain.Palette]: new Set([SceneDimension.GarmentColor]),
  [RuleDomain.Product]: new Set([SceneDimension.Product, SceneDimension.View]),
  [RuleDomain.Validation]: new Set([]),
  [RuleDomain.Artwork]: new Set([]),
  [RuleDomain.Prompt]: new Set([]),
  [RuleDomain.Session]: new Set([SceneDimension.Season]),
  [RuleDomain.Export]: new Set([]),
  [RuleDomain.Group]: new Set([]),
};

const DOMAIN_SYMBOLS: Readonly<Record<RuleDomain, ReadonlySet<SymbolicTarget>>> = {
  [RuleDomain.PrintArea]: new Set([
    SymbolicTarget.PrintAreaTooSmall,
    SymbolicTarget.PrintAreaCentered,
    SymbolicTarget.PrintAreaMinSize,
  ]),
  [RuleDomain.Background]: new Set([SymbolicTarget.ReadableBackground]),
  [RuleDomain.Output]: new Set([
    SymbolicTarget.CollageOutput,
    SymbolicTarget.OutputBPublish,
    SymbolicTarget.ArtworkUpload,
  ]),
  [RuleDomain.Model]: new Set([SymbolicTarget.Generation]),
  [RuleDomain.Decor]: new Set([SymbolicTarget.SeasonalDecor]),
  [RuleDomain.GarmentColor]: new Set([SymbolicTarget.NonSelectedColors]),
  [RuleDomain.Composition]: new Set([
    SymbolicTarget.Generation,
    SymbolicTarget.SceneDedupSignature,
  ]),
  [RuleDomain.Cover]: new Set([
    SymbolicTarget.CoverBuild,
    SymbolicTarget.CoverPublish,
    SymbolicTarget.OutputBInCover,
  ]),
  [RuleDomain.Palette]: new Set([SymbolicTarget.NonSelectedColors]),
  [RuleDomain.Product]: new Set([SymbolicTarget.Generation]),
  [RuleDomain.Validation]: new Set([SymbolicTarget.Generation]),
  [RuleDomain.Artwork]: new Set([SymbolicTarget.ArtworkUpload]),
  [RuleDomain.Prompt]: new Set([]),
  [RuleDomain.Session]: new Set([SymbolicTarget.Generation]),
  [RuleDomain.Export]: new Set([]),
  [RuleDomain.Group]: new Set([]),
};

function literalAllowed(domain: RuleDomain, value: string): boolean {
  if (value.length === 0) return false;
  const symbolic = Object.values(SymbolicTarget).find((candidate) => candidate === value);
  if (symbolic) return DOMAIN_SYMBOLS[domain].has(symbolic);

  const reservedDomain: Array<{
    readonly prefix: string;
    readonly domains: readonly RuleDomain[];
  }> = [
    { prefix: 'scene.paletteColorId', domains: [RuleDomain.GarmentColor] },
    { prefix: 'scene.view', domains: [RuleDomain.Composition, RuleDomain.Product] },
    { prefix: 'scene.dedupSignature', domains: [RuleDomain.Composition] },
    {
      prefix: 'scene.',
      domains: [RuleDomain.Composition, RuleDomain.Product, RuleDomain.Model, RuleDomain.Decor],
    },
    { prefix: 'printArea.', domains: [RuleDomain.PrintArea] },
    { prefix: 'background.', domains: [RuleDomain.Background] },
    { prefix: 'outputB.', domains: [RuleDomain.Output] },
    { prefix: 'output.', domains: [RuleDomain.Output] },
    { prefix: 'cover.', domains: [RuleDomain.Cover] },
    { prefix: 'artwork.', domains: [RuleDomain.Artwork, RuleDomain.Output] },
    { prefix: 'prompt.', domains: [RuleDomain.Prompt] },
    { prefix: 'export.', domains: [RuleDomain.Export] },
    { prefix: 'group.', domains: [RuleDomain.Group] },
    { prefix: 'session.', domains: [RuleDomain.Session, RuleDomain.Validation] },
  ];
  const reserved = reservedDomain.find((entry) => value.startsWith(entry.prefix));
  return reserved ? reserved.domains.includes(domain) : true;
}

function contextRefAllowed(domain: RuleDomain, ref: string): boolean {
  if (!(AUTHORIZED_CONTEXT_PATHS as readonly string[]).includes(ref)) return true;
  if (domain === RuleDomain.GarmentColor) return ref === 'session.colorSelection.colorIds';
  if (domain === RuleDomain.Composition) return ref === 'session.requestedSceneCount';
  if (domain === RuleDomain.Palette) return ref === 'session.colorSelection.colorIds';
  return false;
}

/**
 * CORRECTIVE #3 (Phase 2 corrective release): authoritative mapping of every
 * `RulePriorityClass` to the `RuleDomain`(s) it may legitimately be used
 * with. Previously only two ad-hoc checks existed (Season vs GarmentColor,
 * PaletteLock vs GarmentColor/Palette), so combinations such as
 * `priority: PrintArea, domain: Composition` were silently accepted.
 * Grounded in docs/spec/04_RULE_ENGINE_REVISED.md §2 "Governs" column:
 *  - PrintArea (1): "absolute within its domain" — PrintArea domain only.
 *  - AudienceSafety (2): "Kids-vs-adult models, audience legality" — Model
 *    (on-model display) and Session/Validation (audience/session gating).
 *  - Season (3): "decor & background domains only" (explicit).
 *  - PaletteLock (4): "garment-color domain only" (explicit; Palette
 *    treated as the same closure family as GarmentColor).
 *  - SceneAesthetic (5, lowest): "Composition/pose/camera, dedup, counts,
 *    dependency/cover shaping" — the broad, catch-all priority; every
 *    remaining domain not exclusively reserved above.
 */
const PRIORITY_DOMAINS: Readonly<Record<RulePriorityClass, ReadonlySet<RuleDomain>>> = {
  [RulePriorityClass.PrintArea]: new Set([
    RuleDomain.PrintArea,
    RuleDomain.Background,
    RuleDomain.Output,
  ]),
  [RulePriorityClass.AudienceSafety]: new Set([
    RuleDomain.Model,
    RuleDomain.Product,
    RuleDomain.Session,
    RuleDomain.Validation,
  ]),
  [RulePriorityClass.Season]: new Set([
    RuleDomain.Decor,
    RuleDomain.Background,
    RuleDomain.Validation,
  ]),
  [RulePriorityClass.PaletteLock]: new Set([RuleDomain.GarmentColor, RuleDomain.Palette]),
  [RulePriorityClass.SceneAesthetic]: new Set([
    RuleDomain.Composition,
    RuleDomain.Model,
    RuleDomain.Decor,
    RuleDomain.Product,
    RuleDomain.Cover,
    RuleDomain.Output,
    RuleDomain.Artwork,
    RuleDomain.Prompt,
    RuleDomain.Export,
    RuleDomain.Group,
  ]),
};

function priorityDomainAllowed(priority: RulePriorityClass, domain: RuleDomain): boolean {
  return PRIORITY_DOMAINS[priority]?.has(domain) ?? false;
}

export function validateDomainIsolation(rule: Rule): ValidationFailure | null {
  if (!priorityDomainAllowed(rule.priority, rule.domain)) {
    return failureFromCode('RULE_CFG_003', 'rule.priority', rule.id, {
      priority: rule.priority,
      domain: rule.domain,
      detail: `priority ${String(rule.priority)} may not be used with domain ${String(rule.domain)}`,
    });
  }
  for (const target of rule.effect.targets) {
    if (!targetAllowed(rule.domain, target)) {
      return failureFromCode('RULE_CFG_001', 'rule.effect.targets', rule.id, {
        priority: rule.priority,
        domain: rule.domain,
      });
    }
  }
  if (rule.effect.type === 'limit' && rule.effect.limit === undefined) {
    return failureFromCode('RULE_CFG_001', 'rule.effect.limit', rule.id, {
      priority: rule.priority,
      domain: rule.domain,
    });
  }
  if (rule.effect.type !== 'limit' && rule.effect.limit !== undefined) {
    return failureFromCode('RULE_CFG_001', 'rule.effect.limit', rule.id, {
      priority: rule.priority,
      domain: rule.domain,
    });
  }
  return null;
}

function targetAllowed(domain: RuleDomain, target: RuleTarget): boolean {
  if (target.kind === 'dimension') return DOMAIN_DIMENSIONS[domain].has(target.dimension);
  if (target.kind === 'symbolic') return DOMAIN_SYMBOLS[domain].has(target.symbol);
  if (target.kind === 'contextRef') return contextRefAllowed(domain, target.ref.ref);
  return literalAllowed(domain, target.value);
}
