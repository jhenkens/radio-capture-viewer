// Minimal Alpine.js type declarations for component magic properties

declare module "alpinejs" {
  interface Alpine {
    data(name: string, callback: () => object): void;
    store(name: string): unknown;
    store(name: string, value: object): void;
    start(): void;
    $data(el: Element): Record<string, unknown>;
  }

  const Alpine: Alpine;
  export default Alpine;
}

// Alpine magic properties available inside component functions via `this`
interface AlpineMagics {
  $dispatch(event: string, detail?: unknown): void;
  $watch(property: string, callback: (value: unknown) => void): void;
  $refs: Record<string, HTMLElement>;
  $el: HTMLElement;
  $store: Record<string, unknown>;
  $nextTick(callback: () => void): Promise<void>;
}
