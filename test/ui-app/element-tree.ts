/**
 * Phase 10.5 — minimal React element-tree walker for hook-free (pure)
 * presentational components. Resolves nested pure function components and
 * collects host elements so tests can inspect props and invoke handlers
 * without a DOM.
 */
import type { ReactElement, ReactNode } from 'react';

interface HostElement {
  readonly type: string;
  readonly props: Record<string, unknown>;
}

function isElement(node: unknown): node is ReactElement {
  return typeof node === 'object' && node !== null && 'type' in node && 'props' in node;
}

export function collectHostElements(node: ReactNode, out: HostElement[] = []): HostElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (Array.isArray(node)) {
    for (const child of node) collectHostElements(child, out);
    return out;
  }
  if (!isElement(node)) return out;
  const props = node.props as Record<string, unknown>;
  if (typeof node.type === 'function') {
    // Pure function component: resolve by direct invocation (no hooks).
    const rendered = (node.type as (p: unknown) => ReactNode)(props);
    return collectHostElements(rendered, out);
  }
  if (typeof node.type === 'string') {
    out.push({ type: node.type, props });
  }
  collectHostElements(props.children as ReactNode, out);
  return out;
}

export function buttonsOf(node: ReactNode): HostElement[] {
  return collectHostElements(node).filter((element) => element.type === 'button');
}

export function textOf(node: ReactNode): string {
  const parts: string[] = [];
  const visit = (value: ReactNode): void => {
    if (value === null || value === undefined || typeof value === 'boolean') return;
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (isElement(value)) {
      const props = value.props as Record<string, unknown>;
      if (typeof value.type === 'function') {
        visit((value.type as (p: unknown) => ReactNode)(props));
        return;
      }
      visit(props.children as ReactNode);
    }
  };
  visit(node);
  return parts.join(' ');
}
