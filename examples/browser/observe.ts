import type { ElementHandle, JSHandle, Page } from 'playwright';

export interface BrowserTarget {
  readonly id: string;
  readonly index: number;
  readonly kind: 'click' | 'input';
  readonly tag: string;
  readonly role: string;
  readonly region: string;
  readonly name: string;
  readonly href: string;
  readonly value: string;
  readonly placeholder: string;
  readonly inViewport: boolean;
}

export interface PageSnapshot {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly scrollY: number;
  readonly canScrollDown: boolean;
  readonly totalTargets: number;
  readonly truncated: boolean;
  readonly targets: readonly BrowserTarget[];
}

export interface Observation {
  readonly snapshot: PageSnapshot;
  target(target: BrowserTarget): Promise<ElementHandle<HTMLElement>>;
  dispose(): Promise<void>;
}

/** Keep references to the observed nodes. A later DOM replacement must not redirect a click. */
export async function observe(page: Page, maxTargets = 96): Promise<Observation> {
  if (!Number.isInteger(maxTargets) || maxTargets < 1 || maxTargets > 200) throw new Error('maxTargets must be between 1 and 200.');
  const handle = await page.evaluateHandle(({ limit }) => {
    const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
    const visible = (node: HTMLElement) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && rect.right > 0 && rect.left < innerWidth && rect.bottom + scrollY > 0
        && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
        && !node.closest('[inert], [aria-hidden="true"]');
    };
    const shadowRoots: ShadowRoot[] = [];
    const deep = (scope: Document | ShadowRoot | HTMLElement, selector: string): HTMLElement[] => {
      const found = [...scope.querySelectorAll<HTMLElement>(selector)];
      for (const host of scope.querySelectorAll<HTMLElement>('*')) {
        if (host.shadowRoot) {
          if (!shadowRoots.includes(host.shadowRoot)) shadowRoots.push(host.shadowRoot);
          found.push(...deep(host.shadowRoot, selector));
        }
      }
      return found;
    };
    const dialogs = deep(document, '[role="dialog"],dialog[open],[aria-modal="true"]').filter(visible);
    const root = dialogs.at(-1) ?? document.body;
    const nodes = deep(root, 'a[href],button,input,textarea,summary,[role="button"],[role="link"],[role="menuitem"],[role="option"],[contenteditable="true"]');
    const entries = nodes.flatMap((node, index) => {
      if (!visible(node) || node.matches(':disabled,[aria-disabled="true"]')) return [];
      const tag = node.tagName.toLowerCase();
      const type = (node.getAttribute('type') ?? 'text').toLowerCase();
      if (tag === 'input' && !['text', 'search', 'url', 'email', 'tel', 'button', 'submit'].includes(type)) return [];
      const input = tag === 'textarea' || node.isContentEditable || tag === 'input' && !['button', 'submit'].includes(type);
      const tree = node.getRootNode() as Document | ShadowRoot;
      const labelled = clean((node.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => tree.getElementById(id)?.textContent ?? '').join(' '));
      const labels = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
        ? clean([...(node.labels ?? [])].map(label => label.textContent).join(' ')) : '';
      const placeholder = clean(node.getAttribute('placeholder'));
      const name = (clean(node.getAttribute('aria-label')) || labelled || labels || clean(node.innerText)
        || clean(node.getAttribute('title')) || placeholder || clean(node.querySelector('img')?.getAttribute('alt'))
        || clean(node.getAttribute('name')) || (node instanceof HTMLInputElement ? node.value : '')).slice(0, 240);
      if (!name && !input) return [];
      const href = node instanceof HTMLAnchorElement ? node.href : '';
      if (href && !/^https?:/.test(href)) return [];
      const rect = node.getBoundingClientRect();
      const inViewport = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      let ancestor: Element | null = node;
      let region = 'page';
      while (ancestor) {
        if (ancestor.matches('header,nav,main,footer,dialog,[role="navigation"],[role="banner"],[role="main"],[role="dialog"]')) {
          region = ancestor.getAttribute('role') ?? ancestor.tagName.toLowerCase();
          break;
        }
        const tree = ancestor.getRootNode();
        ancestor = ancestor.parentElement ?? (tree instanceof ShadowRoot ? tree.host : null);
      }
      return [{ node, originalIndex: index, target: {
        id: '', index: 0, kind: input ? 'input' as const : 'click' as const, tag,
        role: node.getAttribute('role') ?? '', region, name, href,
        value: input ? (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : node.innerText).slice(0, 500) : '',
        placeholder, inViewport,
      } }];
    });
    // Prioritize the visible viewport and editable controls, not any task-specific label or URL.
    entries.sort((a, b) => Number(b.target.inViewport) - Number(a.target.inViewport)
      || Number(b.target.kind === 'input') - Number(a.target.kind === 'input') || a.originalIndex - b.originalIndex);
    const selected = entries.slice(0, limit);
    const targets = selected.map((item, index) => ({ ...item.target, id: `e${index}`, index }));
    return {
      nodes: selected.map(item => item.node),
      snapshot: {
        url: location.href, title: document.title,
        text: (root.innerText ?? '').slice(0, 8000) + '\n' + shadowRoots.flatMap(shadow => [...shadow.children]
          .filter(child => child instanceof HTMLElement && visible(child))
          .map(child => (child as HTMLElement).innerText ?? '')).join('\n').slice(0, 2000), scrollY,
        canScrollDown: scrollY + innerHeight < document.documentElement.scrollHeight - 4,
        totalTargets: entries.length, truncated: entries.length > limit, targets,
      },
    };
  }, { limit: maxTargets });
  const snapshot = await handle.evaluate(value => value.snapshot);
  const nodes: JSHandle<HTMLElement[]> = await handle.getProperty('nodes');
  let disposed = false;
  return {
    snapshot,
    async target(target) {
      if (disposed || snapshot.targets[target.index] !== target || page.url() !== snapshot.url) throw new Error('stale-target');
      const reference = await nodes.getProperty(String(target.index));
      const element = reference.asElement() as ElementHandle<HTMLElement> | null;
      if (!element) { await reference.dispose(); throw new Error('stale-target'); }
      // The held ElementHandle cannot resolve to a replacement node as a locator could.
      const valid = await element.evaluate((node, expected) => {
        if (!node.isConnected) return false;
        const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
        const tree = node.getRootNode() as Document | ShadowRoot;
        const labelled = clean((node.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => tree.getElementById(id)?.textContent ?? '').join(' '));
        const labels = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
          ? clean([...(node.labels ?? [])].map(label => label.textContent).join(' ')) : '';
        const name = (clean(node.getAttribute('aria-label')) || labelled || labels || clean(node.innerText)
          || clean(node.getAttribute('title')) || clean(node.getAttribute('placeholder'))
          || clean(node.querySelector('img')?.getAttribute('alt')) || clean(node.getAttribute('name'))
          || (node instanceof HTMLInputElement ? node.value : '')).slice(0, 240);
        const rect = node.getBoundingClientRect();
        const href = node instanceof HTMLAnchorElement ? node.href : '';
        const value = expected.kind === 'input' ? (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : node.innerText).slice(0, 500) : '';
        return node.isConnected && rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden'
          && !node.matches(':disabled,[aria-disabled="true"]') && !node.closest('[inert],[aria-hidden="true"]')
          && href === expected.href && name === expected.name && value === expected.value;
      }, target);
      if (!valid) { await element.dispose(); throw new Error('stale-target'); }
      return element;
    },
    async dispose() {
      disposed = true;
      await nodes.dispose();
      await handle.dispose();
    },
  };
}

/** Bound hydration/debounced search without waiting for analytics connections to become idle. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 12000 });
  await page.evaluate(() => new Promise<void>(resolve => {
    let quiet: ReturnType<typeof setTimeout>;
    const finish = () => { observer.disconnect(); clearTimeout(quiet); clearTimeout(deadline); resolve(); };
    const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(finish, 250); });
    const deadline = setTimeout(finish, 1200);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    quiet = setTimeout(finish, 250);
  }));
}
