# React Hooks

Check the catalog before writing a custom hook. Each hook links to its implementation for signatures and options.

## Conventions

- **Reuse first.** Before writing a hook, check the catalog below. Only write a custom hook when nothing here fits.
- **One hook per file**, named `use{Name}.ts`, colocated with its feature or under a shared `hooks/` folder.
- **The React Compiler is on** — don't hand-write `useMemo`/`useCallback`/`React.memo` for performance; follow the Rules
  of React.
- **Follow the Rules of Hooks** (call unconditionally, top level). `oxlint`'s `react/rules-of-hooks` enforces this.

## `@mantine/hooks` catalog

Public hooks in Mantine 9.6.0.

### State

| Hook | Use |
| --- | --- |
| [`useCounter`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-counter/use-counter.ts) | integer counter with `increment`/`decrement`/`set`/`reset`. |
| [`useDisclosure`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-disclosure/use-disclosure.ts) | boolean with `{ open, close, toggle }` handlers (modals, drawers, popovers). |
| [`useForceUpdate`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-force-update/use-force-update.ts) | return a function that forces a re-render. |
| [`useInputState`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-input-state/use-input-state.ts) | state helper for controlled inputs (accepts an event or a value). |
| [`useListState`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-list-state/use-list-state.ts) | array state with `append`/`prepend`/`insert`/`remove`/`reorder`/`setItem`/`apply`. |
| [`useMap`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-map/use-map.ts) | Store key/value pairs and re-render when the map changes. |
| [`usePagination`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-pagination/use-pagination.ts) | pagination model: `active`, `range`, `next`, `previous`, `setPage`. |
| [`useQueue`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-queue/use-queue.ts) | Keep a limited number of items active and queue the rest until space opens. |
| [`useSelection`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-selection/use-selection.ts) | multi-select list state (select/deselect/toggle/all). |
| [`useSetState`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-set-state/use-set-state.ts) | partial state merges, like class `setState`. |
| [`useSet`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-set/use-set.ts) | Store unique values and re-render when the set changes. |
| [`useStateHistory`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-state-history/use-state-history.ts) | value with `back`/`forward`/`reset` history (undo/redo). |
| [`useToggle`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-toggle/use-toggle.ts) | cycle through a list of values (boolean by default). |
| [`useUncontrolled`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-uncontrolled/use-uncontrolled.ts) | manage a component that can be controlled or uncontrolled. |
| [`useValidatedState`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-validated-state/use-validated-state.ts) | value plus its validation state. |

### Timing — debounce / throttle / intervals

| Hook | Use |
| --- | --- |
| [`useDebouncedCallback`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-debounced-callback/use-debounced-callback.ts) | a debounced callback. |
| [`useDebouncedState`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-debounced-state/use-debounced-state.ts) | state whose updates are debounced. |
| [`useDebouncedValue`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-debounced-value/use-debounced-value.ts) | debounced copy of a changing value. |
| [`useInterval`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-interval/use-interval.ts) | managed `setInterval` with `start`/`stop`/`toggle`. |
| [`useThrottledCallback`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-throttled-callback/use-throttled-callback.ts) | Limit how often a callback runs during repeated calls. |
| [`useThrottledState`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-throttled-state/use-throttled-state.ts) | Limit how often updates to local state take effect. |
| [`useThrottledValue`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-throttled-value/use-throttled-value.ts) | Limit how often a changing value reaches consumers. |
| [`useTimeout`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-timeout/use-timeout.ts) | managed `setTimeout` with `start`/`clear`. |

### Storage & URL

| Hook | Use |
| --- | --- |
| [`useHash`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-hash/use-hash.ts) | state synced to the URL hash. |
| [`useLocalStorage`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-local-storage/use-local-storage.ts) | state synced to `localStorage` (and across tabs). |
| [`useSessionStorage`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-session-storage/use-session-storage.ts) | state synced to `sessionStorage`. |

### Lifecycle & refs

| Hook | Use |
| --- | --- |
| [`useCallbackRef`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/utils/use-callback-ref/use-callback-ref.ts) | Keep a stable callback identity while calling the latest callback. |
| [`useDidUpdate`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-did-update/use-did-update.ts) | effect that skips the first render. |
| [`useIsFirstRender`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-is-first-render/use-is-first-render.ts) | boolean: is this the first render. |
| [`useIsomorphicEffect`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-isomorphic-effect/use-isomorphic-effect.ts) | `useLayoutEffect` on the client, `useEffect` on the server. |
| [`useLogger`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-logger/use-logger.ts) | log a component's lifecycle and props (debugging). |
| [`useMergedRef`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-merged-ref/use-merged-ref.ts) | merge multiple refs into one callback ref. |
| [`useMounted`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-mounted/use-mounted.ts) | boolean: has the component mounted. |
| [`usePrevious`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-previous/use-previous.ts) | the previous value of a variable. |
| [`useShallowEffect`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-shallow-effect/use-shallow-effect.ts) | effect with shallow dependency comparison. |

### DOM interaction

| Hook | Use |
| --- | --- |
| [`useClickOutside`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-click-outside/use-click-outside.ts) | detect clicks/taps outside a ref (dismiss menus/modals). |
| [`useDrag`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-drag/use-drag.ts) | drag interactions with position state. |
| [`useElementSize`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-resize-observer/use-resize-observer.ts) | Read the width and height of the attached element. |
| [`useEventListener`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-event-listener/use-event-listener.ts) | attach an event listener to an element via ref. |
| [`useFocusReturn`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-focus-return/use-focus-return.ts) | return focus to the trigger after an overlay closes. |
| [`useFocusTrap`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-focus-trap/use-focus-trap.ts) | trap keyboard focus inside an element (modals). |
| [`useFocusWithin`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-focus-within/use-focus-within.ts) | boolean: focus is within the subtree. |
| [`useHover`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-hover/use-hover.ts) | `{ ref, hovered }` for hover state. |
| [`useInViewport`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-in-viewport/use-in-viewport.ts) | simple "is this element in the viewport" boolean. |
| [`useIntersection`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-intersection/use-intersection.ts) | `IntersectionObserver` for an element (lazy loading, reveal). |
| [`useLongPress`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-long-press/use-long-press.ts) | long-press gesture handler. |
| [`useMove`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-move/use-move.ts) | track pointer movement over an element (sliders, color pickers). |
| [`useMutationObserverTarget`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-mutation-observer/use-mutation-observer.ts) | Observe DOM mutations on a supplied target element or target getter. |
| [`useMutationObserver`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-mutation-observer/use-mutation-observer.ts) | observe DOM mutations on an element. |
| [`useRadialMove`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-radial-move/use-radial-move.ts) | angular/radial movement (dials, knobs). |
| [`useResizeObserver`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-resize-observer/use-resize-observer.ts) | observe an element's size via `ResizeObserver`. |
| [`useRovingIndex`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-roving-index/use-roving-index.ts) | roving `tabindex` keyboard navigation for a group. |
| [`useScrollIntoView`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-scroll-into-view/use-scroll-into-view.ts) | animated scroll of an element into view. |
| [`useSplitter`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-splitter/use-splitter.ts) | resizable split-pane sizing. |
| [`useWindowEvent`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-window-event/use-window-event.ts) | attach a `window` event listener for the component's lifetime. |

### Scroll, viewport & window

| Hook | Use |
| --- | --- |
| [`useHeadroom`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-headroom/use-headroom.ts) | show/hide a sticky header based on scroll direction. |
| [`useMousePosition`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-mouse/use-mouse.ts) | Track mouse coordinates across the document. |
| [`useMouse`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-mouse/use-mouse.ts) | Track pointer coordinates relative to the attached element. |
| [`usePageLeave`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-page-leave/use-page-leave.ts) | callback when the pointer leaves the document. |
| [`useScrollDirection`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-scroll-direction/use-scroll-direction.ts) | current scroll direction (up/down). |
| [`useScrollSpy`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-scroll-spy/use-scroll-spy.ts) | the active section based on scroll position. |
| [`useScroller`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-scroller/use-scroller.ts) | Control horizontal scrolling, drag to scroll, and report which direction has more content. |
| [`useTextSelection`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-text-selection/use-text-selection.ts) | the current `Selection` on the page. |
| [`useViewportSize`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-viewport-size/use-viewport-size.ts) | reactive window `{ width, height }`. |
| [`useWindowScroll`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-window-scroll/use-window-scroll.ts) | scroll position + `scrollTo`. |

### Environment & device

| Hook | Use |
| --- | --- |
| [`useClipboard`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-clipboard/use-clipboard.ts) | `copy(value)` + `copied` state. |
| [`useColorScheme`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-color-scheme/use-color-scheme.ts) | the system light/dark preference. |
| [`useDocumentTitle`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-document-title/use-document-title.ts) | set `document.title`. |
| [`useDocumentVisibility`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-document-visibility/use-document-visibility.ts) | whether the tab is visible. |
| [`useEyeDropper`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-eye-dropper/use-eye-dropper.ts) | the browser EyeDropper API. |
| [`useFavicon`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-favicon/use-favicon.ts) | set the page favicon. |
| [`useFetch`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-fetch/use-fetch.ts) | minimal fetch wrapper with `loading`/`error`/`data`. |
| [`useFileDialog`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-file-dialog/use-file-dialog.ts) | open a file picker without an `<input>`. |
| [`useFullscreenDocument`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-fullscreen/use-fullscreen.ts) | Toggle fullscreen for the document. |
| [`useFullscreenElement`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-fullscreen/use-fullscreen.ts) | Toggle fullscreen for the element attached to the returned ref. |
| [`useIdle`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-idle/use-idle.ts) | boolean: user has been idle past a timeout. |
| [`useMask`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-mask/use-mask.ts) | masked input formatting. |
| [`useMediaQuery`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-media-query/use-media-query.ts) | subscribe to a CSS media query. |
| [`useNetwork`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-network/use-network.ts) | online status + connection info. |
| [`useOrientation`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-orientation/use-orientation.ts) | device/screen orientation. |
| [`useOs`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-os/use-os.ts) | detected operating system. |
| [`useReducedMotion`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-reduced-motion/use-reduced-motion.ts) | `prefers-reduced-motion` boolean. |

### Utilities

| Hook | Use |
| --- | --- |
| [`useCollapse`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-collapse/use-collapse.ts) | animated height collapse/expand. |
| [`useFloatingWindow`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-floating-window/use-floating-window.ts) | Make an element draggable and optionally constrain it to the viewport. |
| [`useHorizontalCollapse`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-collapse/use-horizontal-collapse.ts) | Animate the width of expanding or collapsing content. |
| [`useHotkeys`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-hotkeys/use-hotkeys.ts) | register global keyboard shortcuts. |
| [`useId`](https://github.com/mantinedev/mantine/blob/9.6.0/packages/%40mantine/hooks/src/use-id/use-id.ts) | a stable unique id (SSR-safe). |
