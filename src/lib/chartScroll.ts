const WHEEL_PASS_THROUGH_BOUND = "__fitDashboardWheelPassThroughBound";

type ChartLike = {
  getDom: () => HTMLElement;
};

function findScrollableParent(start: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = start;
  while (el && el.parentElement) {
    el = el.parentElement;
    const style = window.getComputedStyle(el);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const canScrollX = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    if (canScrollY || canScrollX) {
      return el;
    }
  }
  return null;
}

export function enableChartWheelPageScroll(chart: ChartLike) {
  const dom = chart.getDom();
  if ((dom as any)[WHEEL_PASS_THROUGH_BOUND]) {
    return;
  }

  const scrollParent = findScrollableParent(dom);

  const onWheel = (event: WheelEvent) => {
    // Keep Ctrl/Cmd+wheel reserved for chart zoom interactions.
    if (event.ctrlKey || event.metaKey) {
      return;
    }

    if (scrollParent) {
      scrollParent.scrollBy({
        top: event.deltaY,
        left: event.deltaX,
        behavior: "auto",
      });
    } else {
      window.scrollBy({
        top: event.deltaY,
        left: event.deltaX,
        behavior: "auto",
      });
    }
    event.preventDefault();
  };

  dom.addEventListener("wheel", onWheel, { passive: false, capture: true });
  (dom as any)[WHEEL_PASS_THROUGH_BOUND] = true;
}
