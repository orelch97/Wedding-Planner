import { useLayoutEffect, useRef } from "react";

let activeModalCount = 0;
let previousBodyOverflow = "";
const modalStack = [];

function lockBody() {
  if (activeModalCount === 0 && typeof document !== "undefined") {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  activeModalCount += 1;
}

function unlockBody() {
  activeModalCount = Math.max(0, activeModalCount - 1);
  if (activeModalCount === 0 && typeof document !== "undefined") {
    document.body.style.overflow = previousBodyOverflow;
  }
}

function focusableElements(container) {
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) =>
    element.getAttribute("aria-hidden") !== "true" &&
    !element.closest("[inert]") &&
    element.getClientRects().length > 0
  );
}

/** Common focus containment/restoration, Escape, and nested-modal body scroll locking. */
export function useAccessibleModal({
  open,
  containerRef,
  onRequestClose,
  initialFocusRef,
  initialFocus = "first",
}) {
  const closeRef = useRef(onRequestClose);

  useLayoutEffect(() => {
    closeRef.current = onRequestClose;
  }, [onRequestClose]);

  useLayoutEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    const previousFocus = document.activeElement;
    const entry = { container };
    modalStack.push(entry);
    const nodes = focusableElements(container);
    const preferred = initialFocusRef?.current;
    const target = (preferred && nodes.includes(preferred) ? preferred : null)
      || (initialFocus === "last" ? nodes.at(-1) : nodes[0])
      || container;
    lockBody();
    if (target === container && !container.hasAttribute("tabindex")) {
      container.setAttribute("tabindex", "-1");
    }
    requestAnimationFrame(() => target.focus({ preventScroll: true }));

    const onKeyDown = (event) => {
      if (modalStack[modalStack.length - 1] !== entry) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const stackIndex = modalStack.lastIndexOf(entry);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      unlockBody();
      if (previousFocus?.isConnected && typeof previousFocus.focus === "function") {
        requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
      }
    };
  }, [open, containerRef, initialFocusRef, initialFocus]);
}
