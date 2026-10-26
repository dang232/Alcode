import type { Window } from 'happy-dom';

/**
 * happy-dom 18 defines `Node.prototype.nodeName` as a stub returning `''`
 * (only the subclasses answer correctly). Browsers define no such member on
 * `Node.prototype`, so the nearest subclass override answers instead.
 *
 * DOMPurify captures exactly `Node.prototype`'s getter and uses it for every
 * node it visits, so under happy-dom 18 every tag reads as `''`: allowlisted
 * elements are unwrapped and forbidden ones (`script`, `style`) are never
 * recognised. Sanitization silently stops working.
 *
 * This installs the browser behaviour — dispatch to the nearest override
 * below `Node.prototype` — on one test `Window`, before DOMPurify binds to
 * it. Production needs no change: it runs on real DOM implementations.
 */
export function installHappyDomNodeNameShim(win: Window): void {
  const stop: object = win.Node.prototype;
  Object.defineProperty(stop, 'nodeName', {
    configurable: true,
    get(this: unknown): string {
      let proto: object | null = Object.getPrototypeOf(this);
      while (proto !== null && proto !== stop) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'nodeName');
        if (descriptor) {
          if (typeof descriptor.get === 'function') return descriptor.get.call(this) as string;
          return descriptor.value as string;
        }
        proto = Object.getPrototypeOf(proto);
      }
      return '';
    },
  });
}
