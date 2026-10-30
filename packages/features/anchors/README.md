# @better-apps/anchors

Spots inside a record that features pin things to, such as a comment thread on one line of an invoice or a note on an
element of a preview deploy. An anchor kind checks a spot on the server, which stores it as JSON with the content
version it was made against. Each viewer's browser finds the spot for itself. It has no tables of its own:
[`@better-apps/comments`](../comments/README.md) and other features store anchors with what they pin.

## Kinds

```ts
import { elementAnchor } from "@better-apps/anchors"
import { comments } from "@better-apps/comments"

comments({ subjects: { invoice: { canComment: () => true } }, anchors: [elementAnchor()] })
```

- `elementAnchor()` pins to an element on a page. Its selector may use only ids, data attributes, tag names and
  structural positions, joined by descendant or child combinators, so a stored anchor can't probe a page's content.
  `isSafeSelector` applies that rule. An optional `offset` places the pin inside the element as fractions of its size,
  and `viewport` records the size of the viewport it was made in.
- `defineAnchor({ kind, schema })` adds a kind of your own. Any Standard Schema checks its value, and the kind's name
  and value type flow into the features that use it.

## In the browser

`@better-apps/anchors/dom` works on any page:

- `resolveAnchor(anchored, root, version)` finds a record's spot inside `root`, the element that holds the subject's
  content. It returns `attached` with the pin's position, `outdated` when the content version on screen differs from the
  anchor's, `detached` when the spot isn't on the page, or `null` for a record on the whole subject.
- `elementAnchorFor(element, root, point)` builds an element anchor from a spot a viewer picked, such as by clicking,
  with a selector from `selectorFor`.

`@better-apps/anchors/react` keeps a pin in place:

```tsx
import { useAnchorPosition } from "@better-apps/anchors/react"

const position = useAnchorPosition(thread, rootRef, deployId)
```

It measures after layout and again whenever the page resizes, scrolls or changes. A record is anything with
`anchorKind`, `anchor` and `anchorVersion`, such as a comment thread.
