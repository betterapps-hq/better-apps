# Parity triage log: Better Booking design run

For the Parity engineering team. Written while designing Better Booking (`apps/booking/booking.par`) with one lead agent
and three subagents, all driving Parity through its CLI.

- **Parity:** desktop 0.45.1, Windows 11 Pro 10.0.26300
- **CLI:** `@parity-app/cli@0.31.0`, run with `npx -y @parity-app/cli@0.31.0` from the project folder
- **Project:** `@better-apps/booking`, a TanStack Start app with no `src/components`. Its components come from
  `@buildkitgg/shadcn-baseui-kit` (Buildkit's shadcn Nova kit on Base UI 1.x), found through `components.json`. Its
  stylesheet is `src/styles.css`, which imports the kit's compiled stylesheet and adds four brand tokens.
- **Date:** 2026-11-10

Severity: **high** blocks a design or forces a workaround that changes what's built; **medium** costs time or hides a
mistake; **low** is polish.

## Entries

### 1. Open dialogs, menus and other portalled popups draw unstyled, at the end of the frame

- **Type:** bug
- **Severity:** high
- **Steps:**
  1. In a design, insert the kit's dialog, open:
     `{ type: "component", component: "nova/Dialog", props: { open: true }, slots: { children: [{ type: "component", component: "nova/DialogContent", slots: { children: [/* DialogHeader, DialogTitle, a field, DialogFooter */] } }] } }`.
  2. `parity screenshot <design>`.
  3. The same with `nova/AlertDialog` (`open: true`) and `nova/DropdownMenu` (`open: true`, with a trigger and
     `DropdownMenuContent`).
- **Expected:** the dialog draws over the frame as it does in the app: centred, on its backdrop, with the kit's styles.
  The menu draws beside its trigger.
- **Actual:** the popup's content draws as unstyled HTML (serif default font, native buttons, no surface, no backdrop)
  below the frame's content, at its left edge. The dialog's frame also scrolls, so the screenshot starts about 175px
  down the page and cuts the top off. The dropdown menu's items draw as plain text under the trigger. `parity problems`
  reports nothing for these frames.
- **Why, as far as we can tell:** the kit's `DialogContent`, `AlertDialogContent` and `DropdownMenuContent` wrap their
  popup in Base UI's `Portal`, which appends to `document.body`. The frame's stylesheet and tokens seem to be scoped to
  the frame's own root, so what's portalled to the body gets neither. The kit's parts don't pass a `container` through,
  and a design can't pass an element as a prop anyway.
- **Error text:** none. That's part of the problem: nothing says the popup escaped the frame.
- **Workaround:** draw every popup in place with layouts: an absolutely positioned overlay with a scrim, and a surface
  using the `popover`, `popover-foreground` and `border` tokens, holding the kit's real buttons and fields. This is the
  one place the designs don't use the project's components. It affects Dialog, AlertDialog, DropdownMenu, Select's and
  Combobox's lists, Popover, Tooltip, Sheet and toasts.
- **Suggestion:** give each frame its own portal root (or scope styles so `body` inside a frame is styled), and have
  `problems` flag elements drawn outside the frame's root.

### 2. A project that gets its styles from a compiled kit stylesheet has only three type sizes and no shadows

- **Type:** difficulty
- **Severity:** medium
- **Steps:** `parity tokens --category font-size --limit 200`, then `GetTokens({ category: "shadow" })` in a snippet.
- **Expected:** enough of a type scale to set a page title, and a shadow for raised surfaces.
- **Actual:** `text-base`, `text-sm` and `text-xs` are the only sizes ("3 tokens"), and there are no shadow tokens. The
  kit's own components use larger type and shadows through utility classes compiled into its stylesheet, but those
  aren't variables, so styles can't name them. `size: "text-2xl"`, `"1.5rem"` and `"24px"` all warn and draw at the
  inherited size.
- **Error text:** `size "text-2xl" isn't a token. Use a name from GetTokens().` and
  `shadow "shadow-lg" isn't a token. Use a name from GetTokens().`
- **Workaround:** page titles are `text-base` at weight 600; popups have a border and no shadow.
- **What `parity tokens` returns:** `parity tokens --category font-size --limit 200` prints
  `3 tokens. Name them in styles without "--".` then `text-base: default 1rem`, `text-sm: default .875rem`,
  `text-xs: default .75rem`. `parity tokens --category shadow` prints `No tokens match.`
- **Why:** the kit's `dist/styles.css` is compiled Tailwind v4.3.3 output, not a stylesheet that imports Tailwind's
  theme. Tailwind only emits the theme variables its build used, and in that file the only `--text-*` variables are
  `--text-base`, `--text-sm` and `--text-xs`, with no `--shadow-*` at all. So Parity reads the file correctly, and the
  app has no Tailwind build of its own (`vite.config.ts` has only TanStack Start and React), so `text-2xl` wouldn't
  exist in its CSS either. The kit's own larger type and shadows are utility classes baked into its components.
- **What would help:** say so in the warning ("this project defines no larger size; add `--text-2xl` to
  `src/styles.css`"), let `SetTokens` or a new call add a token rather than only change one, and offer the framework's
  default scale (marked as not yet in the project) when the project's stylesheet is a compiled Tailwind build.

### 3. Instance overrides keyed by a node's name are stored and silently do nothing

- **Type:** bug
- **Severity:** medium
- **Steps:**
  1. Make a component design with a text node named `Workspace` (id `Vjl0N`).
  2. `Insert(screen, { type: "instance", design: "app-sidebar", overrides: { "Workspace": { text: "Personal" } } })`.
  3. Screenshot the screen, then `Get` the instance.
- **Expected:** either the override applies (states' `changes` take names, so it's natural to try), or the call fails or
  warns that `Workspace` isn't a node id in `app-sidebar`.
- **Actual:** the call succeeds with no warning, `Get` returns the override as written, and the frame draws the
  component's own text. Keyed by id (`{ "Vjl0N": { text: "Personal" } }`) it works.
- **Error text:** none.
- **Workaround:** read the component design's ids first:
  `Get("app-sidebar", (n) => { if (n.name) ids[n.name] = n.id })`.
- **Also:** `guide/components.md` says "`execute` can't edit overrides … yet", but `Insert` and `Replace` accept an
  instance with `overrides` and they work. Worth documenting, since it's the only way to vary a copy without
  `ExtractComponent`'s params.

### 4. A component design can't be given params except through ExtractComponent

- **Type:** improvement
- **Severity:** medium
- **Steps:** try to build a sidebar component design with a text param for the workspace name and a boolean for "is
  Personal": `CreateDesign({ kind: "component", root })` takes no `params`, and no call adds one.
- **Expected:** a way to declare params (and variants) directly, such as `CreateDesign({ params })` or `AddParam`.
- **Actual:** the only route is to build two or more occurrences that differ, run `FindRepeats`, then
  `ExtractComponent`. For a single shared part such as an app sidebar, that means building throwaway copies.
- **Workaround:** states on the component design for the current nav item, and instance `overrides` by id (entry 3) for
  the texts.

### 5. `position` takes only `"absolute"`, and the error doesn't say what makes a parent the anchor

- **Type:** improvement
- **Severity:** low
- **Steps:** `CreateDesign({ root: { type: "layout", style: { position: "relative" } } })`.
- **Actual:** `Failed, nothing changed: root/style/position: expected "absolute"`.
- **Expected:** the message, or `document.md`, to say that an absolute child is placed against its parent layout without
  the parent needing anything. It works; it took a failed call to find out.

### 6. Borders are all four sides or none

- **Type:** improvement
- **Severity:** low
- **Steps:** give a header layout `border: "border", borderWidth: 1` to get a line under it.
- **Actual:** a full box. There's no per-side width.
- **Workaround:** a `nova/Separator` under the header.

### 7. A state can't change anything inside an instance, though `document.md` says it can

- **Type:** bug (or the docs are wrong)
- **Severity:** high
- **Found by:** subagent A
- **Steps:**
  1. A screen `03-dashboard` holds an instance (id `ag69f`, named `App sidebar`) of the component design `app-sidebar`,
     whose workspace text node has id `Vjl0N` and name `Workspace`.
  2. `AddState("03-dashboard", { name: "Personal", changes: { "ag69f/Vjl0N": { text: "Personal" } } })`.
- **Expected:** the state changes the instance's inner text. `document.md` says: "A state's patches can reach inside an
  instance the same way, keyed `instance/inner`, so one copy can change in one state."
- **Actual:** the call fails. The same for `"App sidebar/Vjl0N"` and `"App sidebar/Workspace"`. The other routes fail
  too, and one is accepted and does nothing:
  - `Update("03-dashboard/ag69f/Vjl0N", { text }, { state })` fails.
  - `Update(instance, { overrides })` fails.
  - a state change of `{ [instance]: { props: { overrides: … } } }` applies with no warning and changes nothing.
- **Error text:** `Failed, nothing changed: No layer "ag69f/Vjl0N" in 03-dashboard`; `No design "03-dashboard/ag69f"`;
  `overrides: Update can't change this; use Replace, Move or Responsive`.
- **Workaround:** a second, hidden instance with the other values, swapped with the first by the state. Every screen
  with a "Personal" or "member" state carries two sidebars because of this.

### 8. A state's `hidden: true` loses to a responsive `hidden: false` when the base is hidden too

- **Type:** bug
- **Severity:** medium
- **Found by:** subagent A
- **Steps:**
  1. Give a node `hidden: true` and `responsive: { mobile: { hidden: false } }` (a card list only phones show).
  2. Add a state with `changes: { thatNode: { hidden: true } }` (an empty state that hides the list).
  3. Screenshot that state in `mobile-light`.
- **Expected:** the node is hidden, since `document.md` says "States win over responsive patches."
- **Actual:** the node shows on the phone in that state. A guess, not checked: the state's change equals the base value,
  so it isn't stored, and the responsive patch then applies.
- **Error text:** none.
- **Workaround:** keep the node visible in the base and hide it with `Responsive(node, "desktop", { hidden: true })` and
  the same for `tablet`. The state's `hidden: true` then holds.

### 9. A layout with nothing showing inside draws a dashed placeholder in frames and screenshots, and takes room

- **Type:** bug
- **Severity:** medium
- **Found by:** subagent A
- **Steps:** a layout whose only child is hidden, in the base or by a state: a wrapper around a hidden instance, or a
  header's actions row whose one button a state hides. `parity screenshot <design> --state <that state>`.
- **Expected:** nothing drawn. A screenshot is meant to show what the app would show, and an empty flex box shows
  nothing.
- **Actual:** a dashed teal box about 24px wide, which also pushes what's beside it.
- **Error text:** none.
- **Workaround:** hide the layout itself in the state, and never leave a wrapper empty.

### 10. `problems` doesn't notice content squeezing a sibling

- **Type:** improvement
- **Severity:** medium
- **Found by:** subagent A
- **Steps:** a table wider than its column, in a row beside the sidebar. In some states the sidebar shrank from 256px to
  185px; in others it didn't.
- **Expected:** `problems` to flag a fixed-width part drawn narrower than its width, or a table wider than its
  container.
- **Actual:** `No problems found`. It showed only because two frames of the same design differed.
- **Workaround:** a `Measure` loop over every state, comparing the sidebar's width.

### 11. Props from a component's wider types warn but work; `null` doesn't remove an enum prop

- **Type:** improvement (the first), docs or validation bug (the second)
- **Severity:** low
- **Found by:** subagent A
- **Steps and actual:**
  - `nova/Calendar` with `selected`, and `nova/Input` with `style`, warn and then render as asked.
    `Props("nova/Calendar", { all: true })` lists `defaultMonth`, `disabled` and `weekStartsOn` but not `selected`,
    which react-day-picker types per mode.
  - `Update(path, { props: { "aria-sort": null } })` applies with a warning, though `execute.md` says to set a key to
    `null` to remove it. `unset: { props: ["aria-sort"] }` works.
- **Error text:** `nova/Calendar has no prop "selected". Check Props("nova/Calendar").`;
  `nova/Input has no prop "style".`;
  `nova/TableHead aria-sort is one of "none", "ascending", "descending", "other", not null`.

### 12. A prop can't be a `Date`

- **Type:** difficulty
- **Severity:** low
- **Found by:** subagent A
- **Steps:** set a Calendar's selected day or its `disabled: { before }`. Props are JSON, so there's no `Date`.
- **Actual:** ISO strings happen to work (`selected: "2026-11-19T12:00:00"`). A date-only string lands a day early in a
  zone behind UTC.
- **Suggestion:** a documented way to pass a date, such as `{ $date: "2026-11-19" }`.

### 13. `Get(path, visit)`'s `at.parent` isn't documented, and isn't the parent node

- **Type:** improvement (docs)
- **Severity:** low
- **Found by:** subagent A
- **Steps:** in a visit, read `at.parent.id` to insert beside a node.
- **Actual:** `undefined`, which surfaces later as `No layer "undefined"`. `execute.md` lists `parent` among the visit's
  arguments without saying what it holds.
- **Workaround:** visit the parent and read its children.

### 14. `parity a11y` is slow on tall designs

- **Type:** difficulty
- **Severity:** low
- **Found by:** subagent A
- **Steps:** `parity a11y` on seven designs in a row, one of them with eight frames about 2,500px tall.
- **Actual:** the run passed two minutes, most of it on the tall design. No progress is printed while it runs.

### 15. `Responsive()` replaces a viewport's earlier style patch instead of merging with it

- **Type:** bug
- **Severity:** medium
- **Found by:** subagent B
- **Steps:**
  1. Insert a layout with `responsive: { mobile: { style: { direction: "column", align: "stretch" } } }`.
  2. `Responsive(path, "mobile", { style: { width: "fill" } })`.
  3. `Get(path)`.
- **Expected:** `responsive.mobile.style` holds all three keys. `execute.md` says patches "merge with the viewport's
  earlier patch".
- **Actual:** `responsive.mobile.style` is `{ width: "fill" }` only, so a row that stacked on phones silently stopped
  stacking.
- **Error text:** none.
- **Workaround:** pass the whole style again in every `Responsive` call.

### 16. `self: "center"` with `width: "fill"` and a `maxWidth` hugs its content

- **Type:** difficulty
- **Severity:** medium
- **Found by:** subagent B, and the lead with dialogs
- **Steps:** in a column layout, a child with `{ width: "fill", maxWidth: 240, self: "center" }` (a centred page
  column), or a dialog surface with `{ width: "fill", maxWidth: 112 }` inside a parent with `align: "center"`.
- **Expected:** as wide as the parent allows up to `maxWidth`, and centred: the usual centred column.
- **Actual:** the centred child is as wide as its content: about 675px for a short page, and 784px in the 390px frame
  when a row inside can't wrap. Without `self`, the dialog filled to its `maxWidth` but sat at the left edge, ignoring
  the parent's `align: "center"`.
- **Error text:** from `problems`: `Column … sticks out of the 390px frame by 197px on the left and 197px on the right`.
- **Workaround:** a fixed width with `self: "center"` on desktop, and a `Responsive` patch to `width: "fill"` on phones.

### 17. `problems` reports a deliberate sideways scroller as clipped

- **Type:** improvement
- **Severity:** low
- **Found by:** subagent B
- **Steps:** a row with `overflow: "scroll"` holding seven day buttons, in the 390px frame. `parity problems <design>`.
- **Expected:** no finding: the row scrolls on purpose.
- **Actual:** each child past the edge is `clipped`. Four stay on the public booking page's phone frames, so the design
  can't reach a clean `problems` run.
- **Error text:** `Day Thu, Nov 12: 82px on the right cut off by Days, which clips its overflow`.

### 18. Scrollbars in phone frames are the desktop's, and take room

- **Type:** difficulty
- **Severity:** low
- **Found by:** subagent B
- **Steps:** a row with `overflow: "scroll"` in `mobile-light`, on Windows 11. Screenshot it.
- **Expected:** a phone's overlay scrollbar, or none: the frame stands for a phone.
- **Actual:** Windows' classic scrollbar, 17px tall with arrow buttons. It takes the row's height, so a 64px row in an
  80px box also got a vertical scrollbar.
- **Workaround:** a taller wrapper. The scrollbar still shows in the screenshot.

### 19. An absolutely placed component with `left` and `right` keeps its own width

- **Type:** difficulty
- **Severity:** low
- **Found by:** subagent B
- **Steps:** `nova/Separator` with `style: { position: "absolute", left: 14, right: 0 }` (an hour line in a week grid).
- **Expected:** it stretches between the two edges, as a layout does.
- **Actual:** it stays 100% wide and starts at `left`, so it runs past its parent.
- **Workaround:** an absolutely placed layout around the separator.

### 20. `Measure`'s nodes are flat, while `Problems` nests the same numbers in `box`

- **Type:** improvement (docs and consistency)
- **Severity:** low
- **Found by:** subagent B
- **Actual:** `Measure` returns `x`, `y`, `width` and `height` on each node. `Problems` returns
  `box: { x, y, width, height }`. `execute.md` describes `Measure` as returning "every node's box".

Entries 8 and 9 were also hit by subagent B, on its own designs: the empty-layout placeholder shows for a spacer and for
a colour swatch with a background too.

### 21. A state can't show something on one viewport only

- **Type:** difficulty
- **Severity:** medium
- **Found by:** subagent C
- **Steps:** a menu drawn at the design's root, hidden in the base, shown by a state with `hidden: false`. Add
  `Responsive(menu, "mobile", { hidden: true })` so phones don't show the desktop's menu.
- **Expected:** a way to say "this state shows it on desktop only", such as a state patch per viewport.
- **Actual:** the state's `hidden: false` wins on every viewport, so the desktop's menu also shows on the phone, in the
  wrong place.
- **Workaround:** an outer wrapper the state shows and an inner node the responsive patch hides, with the wrapper given
  `{ position: "absolute", width: 0, height: 0, overflow: "hidden" }` so its placeholder (entry 9) doesn't show.

### 22. A drawn popup can't be anchored to its trigger

- **Type:** improvement
- **Severity:** medium
- **Found by:** subagent C, and every agent that drew a menu
- **Steps:** draw an open row menu in place (entry 1's workaround) as an absolute layout at the design's root.
- **Actual:** its `top` and `right` come from `Measure` numbers, once per viewport, and they're wrong again when
  anything above the trigger moves or a state moves the trigger.
- **Expected:** a way to place a node against another node ("below this, right edges aligned"). Fixing entry 1 would
  remove most of the need.

### 23. Inline text ignores `maxWidth` and `textAlign`, and no style breaks a long word

- **Type:** difficulty
- **Severity:** low
- **Found by:** subagents A and C
- **Steps:**
  - a `span` text with `lines: 1` and `maxWidth: 40` measured 224px;
  - `textAlign: "end"` on a `span` inside a table cell does nothing, so numbers in the kit's tables aren't
    right-aligned;
  - a web address in a 225px column can't wrap: only `lines: 1` with an ellipsis works.
- **Expected:** a warning that the style has no effect on an inline tag, or the text made a block when it's given a
  width; and a style for `overflow-wrap`.
- **Workaround:** a `p` inside a layout that has the `maxWidth`.

### 24. Text and layout layers can't carry an `aria-label` or screen-reader-only text

- **Type:** improvement
- **Severity:** low
- **Found by:** subagent C
- **Steps:** an en dash in a table cell that should be named "Doesn't apply to web addresses"; a chart drawn with
  layouts that needs a table of the same numbers for screen readers.
- **Actual:** only component nodes take props, so the name lives in the layer's name, where `a11y` and the built code
  don't see it.

### 25. A node path deeper than `design/node` fails as an unknown design

- **Type:** difficulty
- **Severity:** low
- **Found by:** subagents A, B and C
- **Steps:** `Update(at.path + "/" + child.id, …)` where `at.path` is `15-link/NPuLZ`.
- **Actual:** the error reads as if the design were missing, when the path has one segment too many.
- **Error text:** `No design "15-link/NPuLZ"`.
- **Expected:** "a node path is `design/node`; `15-link/NPuLZ/abc` has three parts".

### 26. `exec` lists every named node it created

- **Type:** improvement
- **Severity:** low
- **Found by:** the lead
- **Steps:** `parity exec` a snippet that builds a whole screen with named layouts.
- **Actual:** the result ends with a "Created:" list of every named node and its id, often 100 lines or more, which
  costs an agent more than the snippet's own output.
- **Workaround:** `| grep -v "^  [A-Za-z].* = "`.
- **Expected:** a flag such as `--quiet`, or list only what the snippet's top-level calls returned.

## More detail on earlier entries

- **Entry 8** (subagent C): `GetDesign(id).states` shows no entry for the node after
  `AddState(id, { name: "Empty", changes: { "Link cards": { hidden: true } } })`, so `AddState` drops a patch that
  equals the base value. It stays missing after the base changes: with the base made `hidden: false`, the state still
  didn't hide the node until `UpdateState` added the patch again.
- **Entry 9** (subagents B and C, and the lead): the placeholder also shows for a spacer, a colour swatch with a
  background, and an absolutely positioned scrim with a background and no children, which gave every dialog state a
  dashed outline around the frame. It gave chart bars (empty layouts with a background and a height) a 24px minimum
  width inside 13px columns, so they overlapped until they got `width: "fill"` and `minWidth: 0`. A layout with a size
  or a background isn't empty in any sense that matters. Workaround used across the designs: a text child holding one
  space.
- **Entry 10** (subagent C, and the lead): the cause was the shared shell. The kit's `SidebarInset` has
  `min-width: auto`, so a wide table squeezed the sidebar on 14 screens (185px on Booking pages, 235px on Bookings,
  197px on Links, 0px on Link). `problems` found none of them. After setting `minWidth: 0` on the inset, the Booking
  pages table scrolled sideways inside the kit's table container in three of its states, and `problems` and `Measure`
  both missed that too: every row measured 960px in a 960px table while the screenshot showed a scrollbar.

## What worked

- **Three agents edited one project at once**, each in its own designs, making about 290 tool calls between them. No
  agent reported a lost edit or a conflict, as `execute.md` promises for calls that change different designs.
- States, responsive patches and instances kept the app to 27 designs holding 151 states (each default counted), where a
  canvas of copies would have needed a frame for each.
- `problems` and `a11y` found real layout and naming mistakes before any screenshot was read.
- Failed snippets changed nothing and said which line failed, so retries were cheap.

## Correction to entry 14, after the run

Entry 14 (`parity a11y` is slow) is probably not a Parity fault. Timed afterwards with one agent and nothing else
running, in one shell: `a11y` on a 12-frame design took 4.8 s, `problems` on the same design 3.4 s, a 12-frame
`screenshot` 4.2 s, and `exec` of `Print(1)` 2.2 s, of which about 1.8 s is `npx` starting. During the run the same
commands took 30 to 85 s each, but so did Bash calls that ran no Parity command at all (median 22 s for `ls` and `cat`),
because four agents were each starting a Git Bash login shell per call. What's left to check on Parity's side: whether
renders for several clients queue behind each other, and whether a first render after a change is much slower than a
repeat.

## Filed with `parity report`

Eight reports were sent on 2026-11-10, each tagged `test_run: app-build-better-booking-2026-11-10` and starting with
`[app-build-better-booking-2026-11-10]` in its text, to mark them as coming from a real app build. Sentry files each in
Linear and links the issue from the feedback.

| Entry     | Report                                                                      | Sent with frames of |
| --------- | --------------------------------------------------------------------------- | ------------------- |
| 1         | Portalled popups draw unstyled outside the frame                            | `kit-check`         |
| 7         | A state can't change anything inside an instance                            | `03-dashboard`      |
| 8         | `AddState` drops a patch that equals the base value                         | `14-links`          |
| 15        | `Responsive()` replaces a viewport's earlier style patch                    | none                |
| 3         | Instance overrides keyed by name are stored and ignored                     | `app-sidebar`       |
| 9         | An empty layout draws a dashed placeholder and takes room                   | none                |
| 10        | `problems` misses a squeezed sibling and a table scrolling in its container | `04-booking-pages`  |
| 11 and 25 | `null` on an enum prop, and "No design" for a path one segment too deep     | none                |

Entry 15 was reproduced again before filing, in a throwaway design: after
`Responsive(path, "mobile", { style: { width: "fill" } })` the node's `responsive` was
`{"mobile":{"style":{"width":"fill"}}}`, and a further call with `{ gap: 2 }` left only `{"gap":2}`.
