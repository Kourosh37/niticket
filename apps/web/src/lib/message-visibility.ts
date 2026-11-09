/** Observe actual clipped message elements, including rows recycled by the virtualizer. */
export function observeVisibleMessages(root: HTMLElement, notify: (ids: string[]) => void) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const observed = new Set<HTMLElement>(),
    visible = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  const publish = () => {
    clearTimeout(timer);
    timer = setTimeout(() => notify([...visible].sort().slice(0, 50)), 100);
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.messageId!;
        const enough =
          entry.isIntersecting &&
          entry.intersectionRect.height >= Math.min(48, entry.boundingClientRect.height / 2);
        if (enough) visible.add(id);
        else visible.delete(id);
      }
      publish();
    },
    { root, threshold: [0, 0.01, 0.1, 0.25, 0.5, 0.75, 1] },
  );
  const reconcile = () => {
    for (const element of observed)
      if (!root.contains(element)) {
        observer.unobserve(element);
        observed.delete(element);
        visible.delete(element.dataset.messageId!);
      }
    for (const element of root.querySelectorAll<HTMLElement>('[data-message-id]'))
      if (!observed.has(element)) {
        observed.add(element);
        observer.observe(element);
      }
    publish();
  };
  const containsMessage = (node: Node) =>
    node instanceof Element &&
    (node.matches('[data-message-id]') || !!node.querySelector('[data-message-id]'));
  const mutations = new MutationObserver((records) => {
    if (
      records.some((record) => [...record.addedNodes, ...record.removedNodes].some(containsMessage))
    ) {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reconcile);
    }
  });
  mutations.observe(root, { childList: true, subtree: true });
  reconcile();
  return () => {
    observer.disconnect();
    mutations.disconnect();
    clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    notify([]);
  };
}
