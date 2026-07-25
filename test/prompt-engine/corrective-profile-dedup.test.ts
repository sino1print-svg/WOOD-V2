import { describe, expect, it } from 'vitest';
import { composeOutputA } from '../../src/engines/prompt-engine';
import { inputA } from './fixtures';

describe('Prompt Engine corrective — approved profile and dedup validation', () => {
  it('rejects invalid Phase 4 obstruction enum and ratio/prototype defects', () => {
    const base = inputA();
    const badObstruction = {
      ...base.product,
      printAreaProfile: {
        ...base.product.printAreaProfile,
        forbiddenOverlaps: ['not-an-obstruction'],
      },
    };
    expect(composeOutputA({ ...base, product: badObstruction as never }).ok).toBe(false);
    const badRatio = {
      ...base.product,
      printAreaProfile: { ...base.product.printAreaProfile, minSizeRatio: 1.1 },
    };
    expect(composeOutputA({ ...base, product: badRatio as never }).ok).toBe(false);
    const custom = Object.assign(Object.create({}), base.product.printAreaProfile);
    expect(
      composeOutputA({ ...base, product: { ...base.product, printAreaProfile: custom } as never })
        .ok,
    ).toBe(false);
  });

  it.each([
    ['sceneTemplateId', 42],
    ['poseId', false],
    ['cameraAngle', 'invalid-angle'],
    ['compositionId', null],
    ['hash', true],
    ['hash', '   '],
  ])('rejects malformed dedup field %s', (field, value) => {
    const base = inputA();
    const scene = {
      ...base.scene,
      dedupSignature: { ...base.scene.dedupSignature, [field]: value },
    };
    expect(composeOutputA({ ...base, scene: scene as never }).ok).toBe(false);
  });

  it('rejects unknown, inherited and accessor dedup fields', () => {
    const base = inputA();
    expect(
      composeOutputA({
        ...base,
        scene: {
          ...base.scene,
          dedupSignature: { ...base.scene.dedupSignature, extra: 1 },
        } as never,
      }).ok,
    ).toBe(false);
    const inherited = Object.assign(Object.create({ hash: 'x' }), { ...base.scene.dedupSignature });
    delete inherited.hash;
    expect(
      composeOutputA({ ...base, scene: { ...base.scene, dedupSignature: inherited } as never }).ok,
    ).toBe(false);
    const accessor = { ...base.scene.dedupSignature } as Record<string, unknown>;
    Object.defineProperty(accessor, 'hash', { enumerable: true, get: () => 'x' });
    expect(
      composeOutputA({ ...base, scene: { ...base.scene, dedupSignature: accessor } as never }).ok,
    ).toBe(false);
  });
});
