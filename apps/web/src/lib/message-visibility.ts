/** Observe actual clipped message elements, including rows recycled by the virtualizer. */
export function observeVisibleMessages(root: HTMLElement, notify: (ids: string[]) => void) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const observed = new Map<HTMLElement, string>(),
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
    for (const [element, id] of observed)
      if (!root.contains(element) || element.dataset.messageId !== id) {
        observer.unobserve(element);
        observed.delete(element);
        visible.delete(id);
      }
    for (const element of root.querySelectorAll<HTMLElement>('[data-message-id]'))
      if (!observed.has(element)) {
        observed.set(element, element.dataset.messageId!);
        observer.observe(element);
      }
    publish();
  };
  const containsMessage = (node: Node) =>
    node instanceof Element &&
    (node.matches('[data-message-id]') || !!node.querySelector('[data-message-id]'));
  const mutations = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(containsMessage),
      )
    ) {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reconcile);
    }
  });
  mutations.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-message-id'],
  });
  reconcile();
  return () => {
    observer.disconnect();
    mutations.disconnect();
    clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    notify([]);
  };
}
