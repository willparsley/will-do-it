import React from 'react';
import { loadTypeScript } from './load-typescript.mjs';

export function driver(filename, exportName, props, overrides = {}) {
  const slots = [];
  let index = 0;
  const effects = [];
  const hooks = {
    ...React,
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useMemo: compute => compute(),
    useCallback: callback => callback,
    useEffect: effect => { effects.push(effect); },
  };
  const Component = loadTypeScript(filename, { react: hooks, ...overrides })[exportName];
  return { effects, render() { index = 0; return Component(props); } };
}

export function nodes(tree, predicate) {
  if (tree == null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
export function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  return text(tree.props?.children);
}
export const button = (tree, label) => nodes(tree, n => n.type === 'button' && text(n) === label)[0];
